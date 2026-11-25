import type { Allocation, Employee, Project } from '../types/pilotis';
import { calcularEncargos } from './equipe';
import { addDaysISO, addMonthsISO, diffDaysISO, isValidISODate } from './formatters';
import type { TaxChargeParameters } from './types';

type TeamProject = Pick<Project, 'id' | 'name' | 'contractKind' | 'type' | 'status'>;
type TeamData = { employees: Employee[]; allocations: Allocation[]; projects: TeamProject[] };

export function weekStartingOn(date: string): string {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDaysISO(date, -((weekday + 6) % 7));
}

export function plannedWeeks(date: string): string[] {
  const first = weekStartingOn(date);
  return Array.from({ length: 8 }, (_, index) => addDaysISO(first, index * 7));
}

function hasScheduledVacation(employee: Employee, date: string): boolean {
  return employee.employmentType === 'CLT' &&
    Boolean(employee.vacationStart && employee.vacationEnd &&
      employee.vacationStart <= date && date <= employee.vacationEnd);
}

export function resolveTeamWeek(employee: Employee, week: string, data: TeamData) {
  const allocations = data.allocations.filter((item) => item.employeeId === employee.id && item.weekStart === week);
  const allocation = allocations[0];
  const projectId = allocation ? allocation.projectId : employee.currentProjectId;
  const project = data.projects.find((item) => item.id === projectId && (allocation || item.status !== 'Concluída'));
  const vacation = allocation?.status === 'Férias' ||
    (employee.employmentType === 'CLT' &&
      Boolean(employee.vacationStart && employee.vacationEnd &&
        employee.vacationStart <= addDaysISO(week, 6) && employee.vacationEnd >= week));
  const conflict = new Set(allocations.map((item) => item.status + '/' + item.projectId + '/' + (item.stageId ?? ''))).size > 1;
  const started = !employee.startDate || employee.startDate <= addDaysISO(week, 6);
  const label = conflict ? 'Conflito'
    : !started ? 'Ainda não iniciou'
    : vacation ? 'Férias'
    : project ? (project.contractKind === 'Satélite' || project.type === 'Obra satélite' ? 'Satélite · ' : '') + project.name
    : 'Sem obra';
  return { allocation, project, label, vacation, conflict, started, idle: started && !conflict && !vacation && !project };
}

export interface PayrollAllocation {
  employeeId: string;
  employeeName: string;
  projectId: string;
  projectName: string;
  paymentMethod: string;
  category: 'Folha' | 'Pró-labore';
  base: number;
  charges: number | null;
  provisions: number | null;
  amount: number;
  vacation: boolean;
}

function prorate(total: number, before: number, after: number, days: number): number {
  const cents = Math.round(total * 100);
  return (Math.round(cents * after / days) - Math.round(cents * before / days)) / 100;
}

export function planMonthlyPayroll(
  data: TeamData,
  month: string,
  parameters: TaxChargeParameters | null,
) {
  const first = month + '-01';
  if (!isValidISODate(first)) throw new Error('Informe um mês válido para a folha.');
  const next = addMonthsISO(first, 1);
  const daysInMonth = diffDaysISO(next, first) ?? 0;
  const lines: PayrollAllocation[] = [];
  const conflicts = new Set<string>();
  let configured = true;
  for (const employee of data.employees) {
    if (employee.baseSalary <= 0 || (employee.paymentFrequency === 'oneOff' && employee.paymentMonth !== month)) continue;
    const groups = new Map<string, { project?: TeamProject; vacation: boolean; days: number }>();
    const weeks = new Map<string, ReturnType<typeof resolveTeamWeek>>();
    let eligibleDays = 0;
    for (let day = 0; day < daysInMonth; day++) {
      const date = addDaysISO(first, day);
      if (employee.startDate && date < employee.startDate) continue;
      const week = weekStartingOn(date);
      let cell = weeks.get(week);
      if (!cell) {
        cell = resolveTeamWeek(employee, week, data);
        weeks.set(week, cell);
      }
      if (cell.conflict) conflicts.add(employee.name);
      const vacation = cell.allocation?.status === 'Férias' || hasScheduledVacation(employee, date);
      const project = vacation || cell.conflict ? undefined : cell.project;
      const key = vacation ? 'Férias' : project?.id ?? 'Empresa';
      const group = groups.get(key) ?? { project, vacation, days: 0 };
      group.days++;
      eligibleDays++;
      groups.set(key, group);
    }
    if (!eligibleDays) continue;
    const costs = calcularEncargos({ vinculo: employee.employmentType, salarioBase: employee.baseSalary }, parameters, addDaysISO(next, -1));
    configured &&= costs.configurado;
    const divisor = employee.paymentFrequency === 'oneOff' ? eligibleDays : daysInMonth;
    let allocatedDays = 0;
    for (const group of groups.values()) {
      const after = allocatedDays + group.days;
      const base = prorate(costs.salarioBase, allocatedDays, after, divisor);
      const charges = costs.encargosMensais === null ? null : prorate(costs.encargosMensais, allocatedDays, after, divisor);
      const provisions = costs.provisoesMensais === null ? null : prorate(costs.provisoesMensais, allocatedDays, after, divisor);
      allocatedDays = after;
      const amount = (Math.round(base * 100) + Math.round((charges ?? 0) * 100) + Math.round((provisions ?? 0) * 100)) / 100;
      if (amount > 0) lines.push({
        employeeId: employee.id,
        employeeName: employee.name,
        paymentMethod: employee.paymentMethod || '',
        projectId: group.project?.id ?? 'Empresa',
        projectName: group.project?.name ?? 'Empresa',
        category: employee.employmentType === 'Sócio' ? 'Pró-labore' : 'Folha',
        base, charges, provisions, amount, vacation: group.vacation,
      });
    }
  }
  const sumCents = (select: (line: PayrollAllocation) => number) =>
    lines.reduce((sum, line) => sum + Math.round(select(line) * 100), 0) / 100;

  const centers = new Map<string, { id: string; name: string; amount: number }>();
  for (const line of lines) {
    const previous = centers.get(line.projectId);
    const cents = Math.round((previous?.amount ?? 0) * 100) + Math.round(line.amount * 100);
    centers.set(line.projectId, { id: line.projectId, name: line.projectName, amount: cents / 100 });
  }
  return {
    lines, centers: [...centers.values()], configured, conflicts: [...conflicts],
    totalKnown: sumCents((line) => line.amount),
    provisions: configured ? sumCents((line) => line.provisions ?? 0) : null,
  };
}
