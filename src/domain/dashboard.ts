import type { PilotisDataState, Project, Quote } from '../types/pilotis';
import { addDaysISO, addMonthsISO, formatMonthLabelBR, isValidISODate, monthKey } from './formatters';
import {
  calcularAlertasSistema,
  calcularIndicadoresDashboard,
  calcularPrevisaoCaixa,
  calcularProgressoObra,
  calcularResumoFunilOrcamentos,
  getProjectSchedule,
  planningTodayISO,
} from './pilotisAdapters';

export const DASHBOARD_MONTHS_AHEAD = 5;

interface ContractWindow {
  start: string | null;
  end: string | null;
}

function isOpenQuote(quote: Pick<Quote, 'status'>) {
  return quote.status === 'Rascunho' || quote.status === 'Enviado' || quote.status === 'Em negociação';
}

function isActiveProject(project: Pick<Project, 'status'>) {
  return project.status === 'Contratada' || project.status === 'Em execução';
}

function projectDates(project: Project, forecastEnd: string | null) {
  const date = project.startDate?.trim();
  const start = isValidISODate(date) ? date : null;
  const end = [forecastEnd, project.forecastEndDate, project.baselineEndDate]
    .map((value) => value?.trim())
    .find((value) => value && isValidISODate(value) && (!start || value >= start)) ?? null;
  return { start, end };
}

function futureCoverage(windows: ContractWindow[], referenceDate: string) {
  const monthStart = monthKey(referenceDate) + '-01';
  return Array.from({ length: DASHBOARD_MONTHS_AHEAD }, (_, index) => {
    const start = addMonthsISO(monthStart, index + 1);
    const end = addDaysISO(addMonthsISO(start, 1), -1);
    const key = monthKey(start);
    const covered = windows.some((work) => work.start && work.start <= end &&
      (work.end ? work.end >= start : work.start >= start));
    const uncertain = !covered && windows.some((work) =>
      (!work.start && (!work.end || work.end >= start)) ||
      (!work.end && work.start && work.start < start),
    );
    return { key, label: formatMonthLabelBR(key), status: covered ? 'covered' as const : uncertain ? 'unknown' as const : 'uncovered' as const };
  });
}

export function calcularPainelDashboard(data: PilotisDataState, referenceDate = planningTodayISO()) {
  const metrics = calcularIndicadoresDashboard(data, referenceDate);
  const isEmpty = Object.entries(data).every(([key, value]) =>
    key === 'settings' || key === 'auditLogs' || !Array.isArray(value) || value.length === 0,
  );
  const openQuotes = data.quotes.filter(isOpenQuote);
  const funnel = calcularResumoFunilOrcamentos(data.quotes);
  const canConfirmQuote = data.quotes.some((quote) =>
    !quote.projectId && quote.status !== 'Perdido' && quote.status !== 'Descartado',
  );

  const lateStages = new Map<string, number>();
  const work = data.projects.filter(isActiveProject).map((project) => {
    const stages = data.stages.filter((stage) => stage.projectId === project.id);
    const schedule = getProjectSchedule(project, stages, referenceDate);
    const dates = projectDates(project, schedule.forecastEndDate);
    const window: ContractWindow = { start: dates.start, end: dates.end && dates.end >= referenceDate ? dates.end : null };
    if (!schedule.criticalPath.cicloDetectado && schedule.todayWeek !== null) {
      for (const stage of stages) {
        const plannedEnd = schedule.details.get(stage.id)?.terminoMaisCedo;
        if (stage.status === 'Concluída' || plannedEnd === undefined) continue;
        const delay = Math.round(schedule.todayWeek * 7) - Math.ceil(plannedEnd * 7);
        if (delay > 0) lateStages.set(stage.id, delay);
      }
    }
    return {
      project,
      window,
      progress: calcularProgressoObra(project.id, stages),
      nextStage: schedule.nextStage?.name,
      completion: dates.end,
      delayedStagesCount: stages.filter((stage) => stage.status !== 'Concluída' && (lateStages.has(stage.id) || stage.delayJustification)).length,
    };
  });

  // Project from the current month so its movements carry into the five full months shown.
  const forecast = calcularPrevisaoCaixa(data, DASHBOARD_MONTHS_AHEAD + 1, referenceDate);
  return {
    metrics,
    referenceDate,
    isEmpty,
    openQuotes,
    funnel,
    canConfirmQuote,
    work,
    coverage: data.projects.length || data.quotes.length ? futureCoverage(work.map(({ window }) => window), referenceDate) : [],
    projection: forecast.meses.slice(1),
    currentMonthBalance: forecast.meses[0]?.saldoProjetado ?? null,
    alerts: calcularAlertasSistema(data, referenceDate, { forecast, lateStages }),
  };
}
