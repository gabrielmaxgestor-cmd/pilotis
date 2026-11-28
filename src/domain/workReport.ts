import { addDaysISO, addMonthsISO, formatDateBR, isValidISODate } from './formatters';
import { weeksToCalendarDays } from './customerMaterials';
import { calcularCurvaSObra, getProjectSchedule } from './pilotisAdapters';
import type { CompanySettings, CustomerMaterial, Project, ProjectStage, ScheduleProgress } from '../types/pilotis';

export const REPORT_PHOTO_LIMIT = 8;
export const REPORT_SHARE_DAYS = 30;

export interface ClientApproval {
  id: string;
  title: string;
  dueDate: string;
  approvedAt: string;
}

export interface ReportPhotoSelection {
  logId: string;
  photoId: string;
  caption: string;
}

export interface WorkReportRecord {
  id: string;
  month: string;
  createdAt: string;
  createdBy: string;
  sentAt: string | null;
  sentBy: string | null;
  shareExpiresAt: string | null;
  shareRevokedAt: string | null;
  shareActive: boolean;
}

export function reportMonth(month: string, today: string) {
  const first = month + '-01';
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidISODate(first) || first > today) return null;
  const next = addMonthsISO(first, 1);
  return { first, last: addDaysISO(next, -1), next, cutoff: next <= today ? addDaysISO(next, -1) : today };
}

export function reportText(value: string) {
  return (value ?? '').replace(/\b(?:BRL|USD|EUR|GBP)\s*[\d.,]+|(?:R\$|US\$|[$€£])\s*[\d.,]+|\b\d+(?:[.,]\d+)*\s+(?:reais|d[oó]lares|euros|libras)\b/gi,
    '[valor omitido]').replace(/\s+/g, ' ').trim();
}

export function buildWorkReport(input: {
  project: Project;
  settings?: Pick<CompanySettings, 'companyName' | 'accentColor'>;
  stages: ProjectStage[];
  materials: CustomerMaterial[];
  approvals: ClientApproval[];
  progressHistory: ScheduleProgress[];
  month: string;
  today: string;
}) {
  const { project, settings, stages, materials, approvals, progressHistory, month, today } = input;
  const period = reportMonth(month, today);
  if (!period) throw new Error('Selecione um mês válido até o mês atual.');
  const projectStages = stages.filter((stage) => stage.projectId === project.id);
  const schedule = getProjectSchedule(project, projectStages, today, materials);
  const history = progressHistory.filter((row) => row.projectId === project.id && isValidISODate(row.date) && row.date <= period.cutoff &&
    Number.isFinite(row.progressPct) && row.progressPct >= 0 && row.progressPct <= 100)
    .sort((a, b) => b.date.localeCompare(a.date) || b.scheduleRevision - a.scheduleRevision);
  const currentMonth = month === today.slice(0, 7);
  const currentProgress = currentMonth ? calcularCurvaSObra(projectStages, schedule.referenceWeek, undefined, false, schedule.criticalPath) : null;
  const progress = currentMonth ? currentProgress?.possuiDados ? currentProgress.progressoRealizadoPct : null : history[0]?.progressPct ?? null;
  const completed = projectStages.filter((stage) => stage.status === 'Concluída' && isValidISODate(stage.completedDate) &&
    stage.completedDate >= period.first && stage.completedDate <= period.cutoff)
    .sort((a, b) => a.completedDate.localeCompare(b.completedDate))
    .map((stage) => ({ name: reportText(stage.name), date: stage.completedDate }));
  const upcoming = projectStages.filter((stage) => stage.status !== 'Concluída').map((stage) => {
    const detail = schedule.details.get(stage.id);
    return { name: reportText(stage.name), date: isValidISODate(project.startDate) && detail
      ? addDaysISO(project.startDate, weeksToCalendarDays(detail.inicioMaisCedo)) : null };
  }).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.name.localeCompare(b.name, 'pt-BR'));
  return {
    title: reportText(project.name),
    company: reportText(settings?.companyName?.trim() || 'Pilotis'),
    accent: /^#[\da-f]{6}$/i.test(settings?.accentColor ?? '') ? settings.accentColor : '#9A6212',
    period: month.slice(5) + '/' + month.slice(0, 4),
    snapshotDate: formatDateBR(today),
    progressDate: formatDateBR(currentMonth ? today : history[0]?.date),
    progress,
    forecast: project.status === 'Concluída' ? project.closureDate || null : schedule.forecastEndDate ||
      (isValidISODate(project.forecastEndDate) ? project.forecastEndDate : null),
    closed: project.status === 'Concluída',
    completed,
    undatedCompletions: projectStages.filter((stage) => stage.status === 'Concluída' && !isValidISODate(stage.completedDate)).length,
    upcoming,
    materials: project.status === 'Concluída' ? [] : schedule.materials.rows.filter((row) => row.item.status !== 'Entregue' &&
      row.stage?.status !== 'Concluída').map((row) => ({ name: reportText(row.item.description), status: row.status,
      requiredDate: row.necessaryDate, promisedDate: row.item.promisedDate })),
    approvals: approvals.filter((row) => !row.approvedAt).map((row) => ({ name: reportText(row.title), date: row.dueDate })),
  };
}

export type WorkReport = ReturnType<typeof buildWorkReport>;
