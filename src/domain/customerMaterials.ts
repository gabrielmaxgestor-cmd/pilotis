import type { CustomerMaterial, CustomerMaterialInput, CustomerMaterialStatus, Project, ProjectStage, ProjectType } from '../types/pilotis';
import { addDaysISO, diffDaysISO, formatDateBR, isValidISODate } from './formatters';
import { normalizeSearch } from './listQuery';
import type { CaminhoCriticoResult } from './planejamento';

export const MATERIAL_STATUSES: readonly CustomerMaterialStatus[] = ['A comprar', 'Comprado', 'Em transporte', 'Entregue'];
export const DEFAULT_MATERIAL_LEAD_DAYS = 7;

export function weeksToCalendarDays(weeks: number): number {
  return Math.ceil(weeks * 7 - 1e-8);
}

export function materialDeliveryEstimate(item: CustomerMaterialInput, today: string): string | null {
  if (item.status === 'Entregue') return isValidISODate(item.deliveredDate) ? item.deliveredDate : null;
  return isValidISODate(item.promisedDate) && item.promisedDate > today ? item.promisedDate : today;
}

export function materialStartConstraints(project: Pick<Project, 'id' | 'startDate'>, stages: ProjectStage[], materials: readonly CustomerMaterial[], today: string) {
  const eligibleStages = new Map(stages.map((stage) => [stage.id, stage]));
  const limits = new Map<string, number>();
  for (const item of materials) {
    const stage = eligibleStages.get(item.stageId);
    if (!stage || item.projectId !== project.id || (stage.status === 'Concluída' && item.status !== 'Entregue')) continue;
    const delivery = materialDeliveryEstimate(item, today);
    const days = diffDaysISO(delivery, project.startDate);
    if (days !== null && Number.isInteger(item.leadDays) && item.leadDays >= 0) {
      limits.set(stage.id, Math.max(limits.get(stage.id) ?? 0, (days + item.leadDays) / 7));
    }
  }
  return limits;
}

export function materialScheduleRows(project: Pick<Project, 'id' | 'startDate'>, stages: ProjectStage[],
  materials: readonly CustomerMaterial[], today: string, path: CaminhoCriticoResult, original: CaminhoCriticoResult = path) {
  const details = new Map(path.detalhes.map((entry) => [entry.etapaId, entry]));
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const blockedStages = new Map<string, string[]>();
  const rows = materials.filter((item) => item.projectId === project.id).map((item) => {
    const stage = byId.get(item.stageId);
    const detail = details.get(item.stageId);
    const plannedStart = detail && isValidISODate(project.startDate)
      ? addDaysISO(project.startDate, weeksToCalendarDays(detail.inicioAntesDaRestricao ?? detail.inicioMaisCedo)) : null;
    const necessaryDate = plannedStart ? addDaysISO(plannedStart, -item.leadDays) : null;
    const delivery = materialDeliveryEstimate(item, today);
    const estimatedWaitDays = necessaryDate ? Math.max(0, diffDaysISO(delivery, necessaryDate) ?? 0) : null;
    const overdue = item.status !== 'Entregue' && (
      (isValidISODate(item.promisedDate) && item.promisedDate < today) || Boolean(estimatedWaitDays)
    );
    if (overdue && stage && stage.status !== 'Concluída') {
      const names = blockedStages.get(stage.id) ?? [];
      names.push(item.description);
      blockedStages.set(stage.id, names);
    }
    return {
      item, stage, necessaryDate, estimatedWaitDays,
      status: overdue ? 'Atrasado' as const : item.status, critical: Boolean(detail?.critica),
    };
  }).sort((a, b) => (a.necessaryDate ?? '9999').localeCompare(b.necessaryDate ?? '9999') ||
    a.item.description.localeCompare(b.item.description, 'pt-BR'));
  return {
    rows, blockedStages,
    deliveryImpactDays: !isValidISODate(project.startDate) || path.cicloDetectado || original.cicloDetectado
      ? null : Math.max(0, weeksToCalendarDays(path.duracaoTotal) - weeksToCalendarDays(original.duracaoTotal)),
  };
}

export type CustomerMaterialPlan = ReturnType<typeof materialScheduleRows>;
export type CustomerMaterialRow = CustomerMaterialPlan['rows'][number];

export function withMaterialHold(stage: ProjectStage, blockedStages: CustomerMaterialPlan['blockedStages']): ProjectStage {
  const blocking = blockedStages.get(stage.id);
  if (!blocking?.length || stage.status === 'Concluída') return stage;
  return { ...stage, status: 'Aguardando material', delayCategory: 'Material do cliente',
    delayJustification: 'Entrega em atraso · ' + blocking.join(', ') };
}

const templates: Record<ProjectType, Array<{ key: string; title: string; stageName: RegExp }>> = {
  'Casa residencial': [
    { key: 'foundation', title: 'Materiais de fundação e estrutura', stageName: /fundacao|estrutura/ },
    { key: 'roof', title: 'Materiais de cobertura', stageName: /cobertura|telhado/ },
    { key: 'plumbing', title: 'Tubos e conexões hidráulicas', stageName: /hidraulic/ },
    { key: 'electrical', title: 'Materiais elétricos', stageName: /eletric/ },
    { key: 'flooring', title: 'Pisos e revestimentos', stageName: /revestimento interno|pisos/ },
    { key: 'finish', title: 'Louças e metais', stageName: /acabamentos finais/ },
  ],
  Reforma: [
    { key: 'installations', title: 'Materiais hidráulicos e elétricos', stageName: /instalac/ },
    { key: 'flooring', title: 'Pisos e revestimentos', stageName: /revestimento|pisos/ },
    { key: 'painting', title: 'Tintas e acessórios', stageName: /pintura/ },
  ],
  'Obra satélite': [
    { key: 'protection', title: 'Materiais de proteção do local', stageName: /protecao|preparacao/ },
    { key: 'service', title: 'Materiais do serviço principal', stageName: /servico principal|execucao/ },
  ],
};

export function customerMaterialTemplate(type: ProjectType, stages: ProjectStage[], existing: readonly CustomerMaterial[], leadDays: number) {
  const rows: CustomerMaterialInput[] = [];
  for (const template of templates[type] ?? []) {
    const stage = stages.find((item) => item.status !== 'Concluída' && !item.isMilestone &&
      template.stageName.test(normalizeSearch(item.name)));
    if (!stage || existing.some((row) => row.templateKey === template.key ||
      (row.stageId === stage.id && normalizeSearch(row.description) === normalizeSearch(template.title)))) continue;
    rows.push({ stageId: stage.id, description: template.title, quantity: null, unit: '', leadDays,
      promisedDate: '', deliveredDate: '', status: 'A comprar', clientContact: '', notes: '', templateKey: template.key });
  }
  return rows;
}

export function describeMaterialDates(item: CustomerMaterialInput, necessary: string | null) {
  return ['Necessária: ' + formatDateBR(necessary), 'Prometida: ' + formatDateBR(item.promisedDate),
    'Entregue: ' + formatDateBR(item.deliveredDate), 'Antecedência: ' + item.leadDays + ' dia(s)', item.status].join(' · ');
}
