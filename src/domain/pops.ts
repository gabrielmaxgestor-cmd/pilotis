import type { Pop, PopAttachment, PopContent, ProjectStage } from '../types/pilotis';

export const POP_MEDIA_CHUNK_BYTES = 640 * 1024;
export const POP_MEDIA_TOTAL_BYTES = 5 * 1024 * 1024;
export const POP_ATTACHMENT_LIMIT = 8;
export const POP_MEDIA_TYPES = ['image/jpeg', 'video/mp4', 'video/webm', 'video/quicktime'];

export function isPublishedPop(pop: Pop) {
  return pop.publicationNumber !== 0;
}

export function linkedPopChecklist(stage: Pick<ProjectStage, 'popId' | 'popReview' | 'status'>, pop?: Pop) {
  if (stage.status === 'Concluída' && stage.popReview?.popId === stage.popId) return stage.popReview;
  if (pop?.id === stage.popId && isPublishedPop(pop)) return {
    popId: pop.id, version: pop.version, acceptanceCriteria: pop.acceptanceCriteria ?? [],
  };
  return undefined;
}

export function popPublicationNumber(pop: Pop | undefined) {
  return pop ? pop.publicationNumber ?? 1 : 0;
}

export function nextPopVersion(pop: Pop | undefined) {
  if (!pop || popPublicationNumber(pop) === 0) return 'v1.0';
  const match = /^v?(\d{1,6})\.(\d{1,6})$/.exec(pop.version);
  return match ? 'v' + Number(match[1]) + '.' + (Number(match[2]) + 1) : 'v1.' + popPublicationNumber(pop);
}

export function readPopContent(source: PopContent): PopContent {
  return {
    title: source.title ?? '',
    serviceType: source.serviceType ?? '',
    linkedStagePhase: source.linkedStagePhase ?? '',
    objective: source.objective ?? '',
    materialsAndEpi: source.materialsAndEpi ?? '',
    tools: source.tools ?? '',
    protectiveEquipment: source.protectiveEquipment ?? '',
    steps: source.steps ?? [],
    acceptanceCriteria: source.acceptanceCriteria ?? [],
    attachments: source.attachments ?? [],
    usedInOnboarding: Boolean(source.usedInOnboarding),
  };
}

export function validatePopContent(source: PopContent): PopContent {
  const content = readPopContent(source);
  content.title = content.title.trim();
  content.serviceType = content.serviceType.trim();
  if (!content.title || !content.serviceType) throw new Error('Informe o título e o tipo de serviço.');
  if (content.title.length > 160 || content.serviceType.length > 80 || content.linkedStagePhase.length > 80 ||
      [content.objective, content.materialsAndEpi, content.tools, content.protectiveEquipment].some((value) => (value ?? '').length > 1000)) {
    throw new Error('Um dos textos está acima do limite da seção.');
  }
  if (content.steps.length > 20 || content.steps.some((step) => !step.trim() || step.length > 300) ||
      content.acceptanceCriteria.length > 20 || content.acceptanceCriteria.some((item) => !item.trim() || item.length > 200)) {
    throw new Error('Use até 20 passos (300 caracteres cada) e até 20 critérios (200 caracteres cada).');
  }
  if (new Set(content.acceptanceCriteria.map((item) => item.trim())).size !== content.acceptanceCriteria.length) {
    throw new Error('Cada critério de aceite deve aparecer uma única vez.');
  }
  const attachments = content.attachments ?? [];
  if (attachments.length > POP_ATTACHMENT_LIMIT || attachments.reduce((total, item) => total + item.size, 0) > POP_MEDIA_TOTAL_BYTES) {
    throw new Error('Anexe até oito arquivos, com no máximo 5 MB no total.');
  }
  if (new Set(attachments.map((item) => item.id)).size !== attachments.length ||
      attachments.some((item) => !isValidPopAttachment(item))) throw new Error('Há anexos inválidos neste POP.');
  return content;
}

export function isValidPopAttachment(item: PopAttachment) {
  return /^[-_a-zA-Z0-9]{1,50}$/.test(item.id) && item.name.trim().length > 0 && item.name.length <= 160 &&
    POP_MEDIA_TYPES.includes(item.contentType) && Number.isInteger(item.size) && item.size > 0 &&
    item.size <= POP_MEDIA_TOTAL_BYTES && item.chunkCount === Math.ceil(item.size / POP_MEDIA_CHUNK_BYTES);
}
