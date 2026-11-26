import type { ActorRole, DailyLog, ProjectStage } from '../types/pilotis';

export const DAILY_PHOTO_LIMIT = 6;
export const DAILY_PHOTO_MAX_BYTES = 384 * 1024;
export const FIELD_OFFLINE_NOTICE = 'Sem conexão · salvo no aparelho, sincroniza depois';

export type DailyLogDraft = Pick<DailyLog, 'projectId' | 'date' | 'presentCount' | 'weather' | 'activities' | 'occurrences' | 'presentTeam'>;
export type FieldStageFields = Pick<ProjectStage, 'progressPct' | 'materialExpectedDate' | 'checklistCompleted'>;

export interface FieldStageUpdate {
  previous: FieldStageFields;
  next: Partial<FieldStageFields>;
  popId: string;
  complete: boolean;
}

interface FieldJobBase {
  id: string;
  uid: string;
  actor: ActorRole;
  queuedAt: number;
  error?: string;
}

export type FieldJob = FieldJobBase & ({
  kind: 'diary';
  draft: DailyLogDraft;
  photos: { id: string; blob: Blob }[];
} | {
  kind: 'stage';
  projectId: string;
  stageId: string;
  knownStageIds: string[];
  update: FieldStageUpdate;
});

function equalField(a: FieldStageFields[keyof FieldStageFields], b: FieldStageFields[keyof FieldStageFields]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const ordered = [...b].sort();
    return a.length === b.length && [...a].sort().every((x, index) => x === ordered[index]);
  }
  return a === b;
}

export function getFieldStageFields(stage: ProjectStage): FieldStageFields {
  return {
    progressPct: stage.progressPct ?? 0,
    materialExpectedDate: stage.materialExpectedDate ?? '',
    checklistCompleted: stage.checklistCompleted ?? [],
  };
}

export function applyFieldStageUpdate(stage: ProjectStage, update: FieldStageUpdate): ProjectStage {
  const current = getFieldStageFields(stage);
  if ((update.complete || update.next.checklistCompleted !== undefined) && (stage.popId ?? '') !== update.popId) {
    throw new Error('O POP vinculado mudou. Abra a etapa e confira o checklist atualizado.');
  }
  for (const key of Object.keys(update.next) as (keyof FieldStageFields)[]) {
    const value = update.next[key];
    if (value !== undefined && !equalField(current[key], update.previous[key]) && !equalField(current[key], value)) {
      throw new Error('A etapa mudou desde o registro. Confira os dados atuais antes de enviar novamente.');
    }
  }
  const merged = { ...stage, ...current, ...update.next };
  if (update.complete || stage.status === 'Concluída') return { ...merged, status: 'Concluída', progressPct: 100 };
  if (stage.status === 'A fazer' && (update.next.progressPct ?? 0) > 0) return { ...merged, status: 'Em andamento' };
  return merged;
}

export function fieldJobLane(job: FieldJob): string {
  return job.kind === 'stage' ? job.stageId : job.id;
}

export function isRetryableFieldError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code?.split('/').at(-1);
  return Boolean(code && ['unavailable', 'deadline-exceeded', 'cancelled', 'aborted', 'network-request-failed',
    'retry-limit-exceeded', 'unknown', 'resource-exhausted', 'internal'].includes(code));
}

export async function drainFieldJobs(
  jobs: FieldJob[],
  sync: (job: FieldJob) => Promise<void>,
  acknowledge: (id: string) => Promise<void>,
  fail: (job: FieldJob, error: string) => Promise<void>,
  connected: () => boolean,
) {
  const paused = new Set<string>();
  for (const job of jobs) {
    if (!connected()) break;
    const lane = fieldJobLane(job);
    if (job.error) paused.add(lane);
    if (paused.has(lane)) continue;
    try {
      await sync(job);
    } catch (error) {
      paused.add(lane);
      if (connected() && !isRetryableFieldError(error)) {
        await fail(job, error instanceof Error ? error.message : 'Não foi possível sincronizar.');
      }
      continue;
    }
    await acknowledge(job.id);
  }
}
