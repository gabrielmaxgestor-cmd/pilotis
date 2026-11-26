import type { Pop, Project, ProjectStage, StageStatus } from '../types/pilotis';

export const DEFAULT_WORK_IN_PROGRESS_LIMIT = 4;
export const MAX_WORK_IN_PROGRESS_LIMIT = 100;

export const DELAY_CATEGORIES = ['Chuva', 'Material do cliente', 'Equipe', 'Retrabalho', 'Projeto', 'Outros'] as const;

export const WORKFLOW_COLUMNS: { status: StageStatus; label: string }[] = [
  { status: 'A fazer', label: 'A fazer' },
  { status: 'Em andamento', label: 'Em andamento' },
  { status: 'Aguardando material', label: 'Aguardando' },
  { status: 'Em conferência', label: 'Em conferência' },
  { status: 'Concluída', label: 'Concluída' },
];

export function validateWorkInProgressLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_WORK_IN_PROGRESS_LIMIT) {
    throw new Error(`Informe um limite entre 1 e ${MAX_WORK_IN_PROGRESS_LIMIT} etapas.`);
  }
}

export function normalizeDelayCategory(category: string) {
  return category === 'Fornecedor' || category === 'Outro' ? 'Outros' : category;
}

export function validateStageDelay(stage: ProjectStage, requiresReason: boolean) {
  const category = normalizeDelayCategory(stage.delayCategory ?? '');
  const reason = (stage.delayJustification ?? '').trim();
  if (requiresReason || category || reason) {
    if (!DELAY_CATEGORIES.some((item) => item === category) || !reason) {
      throw new Error('Informe a categoria e a justificativa do atraso.');
    }
  }
}

export function validateStageWorkflow(
  stage: ProjectStage,
  previous: ProjectStage | undefined,
  stages: ProjectStage[],
  project: Pick<Project, 'workInProgressLimit'>,
  pop?: Pick<Pop, 'acceptanceCriteria'>,
) {
  if (stage.status === 'Em andamento' && previous?.status !== 'Em andamento') {
    const limit = project.workInProgressLimit ?? DEFAULT_WORK_IN_PROGRESS_LIMIT;
    const ongoing = stages.filter((item) => item.id !== stage.id && item.status === 'Em andamento').length;
    if (ongoing >= limit) throw new Error(`Limite de ${limit} etapas em andamento atingido nesta obra.`);
  }
  if (stage.status === 'Em andamento' || stage.status === 'Em conferência' || stage.status === 'Concluída') {
    const pending = stage.dependsOn.find((id) => !stages.some((item) => item.id === id && item.status === 'Concluída'));
    if (pending) {
      const predecessor = stages.find((item) => item.id === pending);
      throw new Error(`Conclua a etapa predecessora “${predecessor?.name ?? pending}” antes de avançar.`);
    }
  }
  if (stage.status === 'Concluída' && stage.popId) {
    if (!pop) throw new Error('O POP vinculado está indisponível para conferir o checklist.');
    if (!(pop.acceptanceCriteria ?? []).every((criterion) => (stage.checklistCompleted ?? []).includes(criterion))) {
      throw new Error('Complete todos os critérios do checklist de qualidade do POP antes de concluir.');
    }
  }
  if (previous?.status === 'Concluída' && stage.status !== 'Concluída') {
    const successor = stages.find((item) => item.dependsOn?.includes(stage.id) &&
      (item.status === 'Em andamento' || item.status === 'Em conferência' || item.status === 'Concluída'));
    if (successor) throw new Error(`A etapa “${successor.name}” já avançou e depende desta conclusão.`);
  }
}
