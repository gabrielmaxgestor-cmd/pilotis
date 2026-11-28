import { weeksToCalendarDays } from './customerMaterials';
import type { ModuleKey, PilotisDataState } from '../types/pilotis';
import { resolverStatusConformidade } from './conformidade';
import { deduplicarReceitasEParcelas, resolverStatusDivida, resolverStatusLancamento, resolverStatusParcela } from './financeiro';
import { addDaysISO, addMonthsISO, isValidISODate } from './formatters';
import { onboardingDeadline } from './equipe';
import { getProjectSchedule, planningTodayISO, toDomainInstallments, toDomainTransactions } from './pilotisAdapters';
import { getWarrantyWindow } from './projectClosure';
import { resolveTeamWeek, weekStartingOn } from './teamPlanning';

export const AGENDA_TYPES = {
  installment: { label: 'Parcelas', exportTitle: 'Vencimento de parcela' },
  bill: { label: 'Contas e dívidas', exportTitle: 'Vencimento de conta' },
  guide: { label: 'Guias e obrigações', exportTitle: 'Vencimento de guia ou obrigação' },
  certificate: { label: 'Certidões', exportTitle: 'Validade de certidão' },
  document: { label: 'Documentos', exportTitle: 'Prazo de documento' },
  milestone: { label: 'Marcos', exportTitle: 'Marco de obra' },
  stage: { label: 'Etapas', exportTitle: 'Prazo de etapa' },
  material: { label: 'Materiais', exportTitle: 'Data prometida de material' },
  vacation: { label: 'Férias', exportTitle: 'Férias' },
  training: { label: 'Treinamentos e SST', exportTitle: 'Prazo de treinamento ou SST' },
  warranty: { label: 'Garantias', exportTitle: 'Fim da garantia de obra' },
  warrantyCall: { label: 'Chamados', exportTitle: 'Prazo de chamado de garantia' },
} as const;

export type AgendaType = keyof typeof AGENDA_TYPES;
export type AgendaViewMode = 'month' | 'week';

export interface AgendaTarget {
  module: Extract<ModuleKey, 'financial' | 'compliance' | 'planning' | 'team'>;
  tab: string;
  params: Record<string, string>;
}

export interface AgendaEvent {
  id: string;
  type: AgendaType;
  title: string;
  start: string;
  end: string;
  projectId: string;
  projectName: string;
  status?: string;
  target: AgendaTarget;
}

export interface AgendaPeriod { start: string; end: string }

export function agendaPeriod(date: string, view: AgendaViewMode): AgendaPeriod {
  if (view === 'week') {
    const start = weekStartingOn(date);
    return { start, end: addDaysISO(start, 6) };
  }
  const start = date.slice(0, 7) + '-01';
  return { start, end: addDaysISO(addMonthsISO(start, 1), -1) };
}

export function agendaDays(period: AgendaPeriod, padWeeks = false): string[] {
  const first = padWeeks ? weekStartingOn(period.start) : period.start;
  const last = padWeeks ? addDaysISO(weekStartingOn(period.end), 6) : period.end;
  const days: string[] = [];
  for (let day = first; day <= last; day = addDaysISO(day, 1)) days.push(day);
  return days;
}

export function agendaEventsInPeriod(events: readonly AgendaEvent[], period: AgendaPeriod, type = '', projectId = '') {
  return events.filter((event) => event.start <= period.end && event.end >= period.start &&
    (!type || event.type === type) &&
    (!projectId || (projectId === 'Empresa' ? !event.projectId : event.projectId === projectId)));
}

export function buildAgendaEvents(data: PilotisDataState, today = planningTodayISO()): AgendaEvent[] {
  const events: AgendaEvent[] = [];
  const projectNames = new Map(data.projects.map((project) => [project.id, project.name]));
  const people = new Map(data.employees.map((employee) => [employee.id, employee]));
  function add(event: Omit<AgendaEvent, 'end' | 'projectId' | 'projectName'> & Partial<Pick<AgendaEvent, 'end' | 'projectId' | 'projectName'>>) {
    const start = event.start?.trim();
    const end = event.end?.trim() || start;
    if (!isValidISODate(start) || !isValidISODate(end) || end < start) return;
    const projectId = event.projectId && !['Empresa', 'Sem obra'].includes(event.projectId) ? event.projectId : '';
    events.push({ ...event, start, end, projectId, projectName: projectId ? projectNames.get(projectId) || event.projectName || '' : '' });
  }
  const financial = (id: string, tab: string): AgendaTarget => ({ module: 'financial', tab, params: { registro: id } });
  const planning = (projectId: string, tab: string, id: string): AgendaTarget => ({
    module: 'planning', tab, params: { 'planning.obra': projectId, registro: id },
  });
  const team = (id: string, record?: string): AgendaTarget => ({
    module: 'team', tab: 'Cadastro', params: { 'team.colaborador': id, ...(record ? { registro: record } : {}) },
  });

  for (const row of data.installments) {
    add({ id: 'installment-' + row.id, type: 'installment', title: row.number === 0 ? 'Entrada · ' + row.label : 'Parcela · ' + row.label,
      start: row.dueDate, projectId: row.projectId, projectName: row.projectName,
      status: resolverStatusParcela({ status: row.status, vencimento: row.dueDate }, today),
      target: financial(row.id, 'A receber') });
  }
  const txById = new Map(data.transactions.map((row) => [row.id, row]));
  const linkedReceipts = new Set(data.installments.map((row) => row.transactionId).filter(Boolean));
  const installments = toDomainInstallments(data.installments);
  const { lancamentosUnicos } = deduplicarReceitasEParcelas(toDomainTransactions(data.transactions), installments);
  const existingInstallments = new Set(installments.map((row) => row.id));
  const debtDates = new Set<string>();
  for (const entry of lancamentosUnicos) {
    const row = txById.get(entry.id);
    if (!row || row.entryKind === 'loan' || linkedReceipts.has(row.id) ||
      (row.installmentId && existingInstallments.has(row.installmentId))) continue;
    const date = row.dueDate || (row.isForecast ? row.date : '');
    if (row.debtId && isValidISODate(date)) debtDates.add(row.debtId + ':' + date);
    add({ id: 'bill-' + row.id, type: 'bill', title: row.description, start: date,
      projectId: row.projectId, projectName: row.projectName, status: resolverStatusLancamento(entry, today),
      target: financial(row.id, row.entryKind === 'expense' ? 'A pagar' : 'A receber') });
  }
  for (const row of data.debts) {
    if (row.status === 'Quitada' || debtDates.has(row.id + ':' + row.nextDueDate)) continue;
    add({ id: 'debt-' + row.id, type: 'bill', title: 'Dívida · ' + row.creditor, start: row.nextDueDate,
      status: resolverStatusDivida({ status: row.status, proximoVencimento: row.nextDueDate }, today),
      target: financial(row.id, 'Dívidas e crédito') });
  }
  for (const row of data.complianceItems) {
    const type = row.kind === 'Obrigação' ? 'guide' : row.kind === 'Certidão' ? 'certificate' : 'document';
    const tab = row.kind === 'Obrigação' ? 'Obrigações' : row.kind === 'Certidão' ? 'Certidões'
      : row.kind === 'Licitação' ? 'Licitações' : 'Documentos por obra';
    add({ id: 'compliance-' + row.id, type, title: row.title, start: row.dueDate,
      projectId: row.projectId, projectName: row.projectName,
      status: resolverStatusConformidade({ tipo: row.kind, status: row.status, vencimento: row.dueDate }, today),
      target: { module: 'compliance', tab, params: { registro: row.id } } });
  }
  const stagesByProject = new Map<string, PilotisDataState['stages']>();
  for (const stage of data.stages) {
    const stages = stagesByProject.get(stage.projectId) ?? [];
    stages.push(stage);
    stagesByProject.set(stage.projectId, stages);
  }
  for (const project of data.projects) {
    const stages = stagesByProject.get(project.id) ?? [];
    const schedule = stages.length ? getProjectSchedule(project, stages, today, data.customerMaterials) : undefined;
    const delivery = project.status === 'Concluída' && isValidISODate(project.closureDate) ? project.closureDate
      : schedule?.forecastEndDate || project.forecastEndDate || project.baselineEndDate;
    add({ id: 'delivery-' + project.id, type: 'milestone', title: 'Entrega · ' + project.name, start: delivery,
      projectId: project.id, status: project.status, target: planning(project.id, 'Visão geral', '') });
    for (const stage of stages) {
      const finish = schedule?.details.get(stage.id)?.terminoMaisCedo;
      const label = stage.wbsCode ? stage.wbsCode + ' · ' + stage.name : stage.name;
      const target = planning(project.id, 'Cronograma', stage.id);
      if (finish !== undefined && Number.isFinite(finish) && !schedule?.criticalPath.cicloDetectado && isValidISODate(project.startDate)) {
        add({ id: 'stage-' + stage.id, type: stage.isMilestone ? 'milestone' : 'stage',
          title: label, start: addDaysISO(project.startDate, weeksToCalendarDays(finish)),
          projectId: project.id, status: stage.status, target });
      }
      add({ id: 'material-' + stage.id, type: 'material', title: 'Material · ' + label, start: stage.materialExpectedDate,
        projectId: project.id, status: stage.status, target });
    }
    for (const { item, necessaryDate, status } of schedule?.materials.rows ?? []) {
      const target = planning(project.id, 'Materiais do cliente', item.id);
      if (necessaryDate) add({ id: 'material-needed-' + item.id, type: 'material', title: 'Material necessário · ' + item.description,
        start: necessaryDate, projectId: project.id, status, target });
      if (item.promisedDate !== necessaryDate) add({ id: 'material-promised-' + item.id, type: 'material',
        title: 'Entrega prometida · ' + item.description, start: item.promisedDate, projectId: project.id, status, target });
    }
    const warranty = getWarrantyWindow(project, today);
    if (warranty) add({ id: 'warranty-' + project.id, type: 'warranty', title: 'Fim da garantia · ' + project.name,
      start: warranty.end, projectId: project.id, target: planning(project.id, 'Pós-obra', project.id) });
  }
  for (const call of data.warrantyCalls) {
    if (!projectNames.has(call.projectId)) continue;
    add({ id: 'call-' + call.id, type: 'warrantyCall', title: call.description, start: call.deadlineDate,
      projectId: call.projectId, projectName: call.projectName, status: call.status,
      target: planning(call.projectId, 'Pós-obra', call.id) });
  }
  for (const employee of data.employees) {
    const projectAt = (date: string) => isValidISODate(date)
      ? resolveTeamWeek(employee, weekStartingOn(date), data, date).project?.id
      : undefined;
    if (employee.employmentType === 'CLT' && employee.vacationStart && employee.vacationEnd) {
      add({ id: 'vacation-' + employee.id, type: 'vacation', title: 'Férias · ' + employee.name,
        start: employee.vacationStart, end: employee.vacationEnd,
        projectId: projectAt(employee.vacationStart), target: team(employee.id, employee.id) });
    }
    const training = [
      ['aso', 'ASO', employee.asoExpiry],
      ['nr18', 'NR-18', employee.nr18Expiry],
      ['nr35', 'NR-35', employee.nr35Expiry],
      ['epi', 'EPIs', employee.epiExpiry],
      ['onboarding', 'Integração', employee.onboardingStatus === 'Concluída' ? null : onboardingDeadline(employee.onboardingStart, employee.startDate)],
    ] as const;
    for (const [key, label, date] of training) {
      if (date) add({ id: 'training-' + key + '-' + employee.id, type: 'training', title: label + ' · ' + employee.name,
        start: date, projectId: projectAt(date), target: team(employee.id, employee.id) });
    }
  }
  for (const allocation of data.allocations) {
    const employee = people.get(allocation.employeeId);
    if (!employee || allocation.status !== 'Férias' || !isValidISODate(allocation.weekStart)) continue;
    const end = addDaysISO(allocation.weekStart, 6);
    const start = allocation.effectiveFrom && allocation.effectiveFrom >= allocation.weekStart ? allocation.effectiveFrom : allocation.weekStart;
    if (employee.employmentType === 'CLT' && employee.vacationStart && employee.vacationEnd &&
      employee.vacationStart <= start && employee.vacationEnd >= end) continue;
    add({ id: 'allocation-' + allocation.id, type: 'vacation', title: 'Férias · ' + employee.name,
      start, end, projectId: allocation.projectId, projectName: allocation.projectName,
      target: team(employee.id, allocation.id) });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title, 'pt-BR') || a.id.localeCompare(b.id));
}
