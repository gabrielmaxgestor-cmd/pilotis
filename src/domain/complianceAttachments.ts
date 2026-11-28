import { isValidISODate } from './formatters';
import { normalizeCompetence } from './complianceWorkflows';
import type { AuditMeta, ComplianceItem } from '../types/pilotis';

export const COMPLIANCE_MAX_BYTES = 10 * 1024 * 1024;
export const COMPLIANCE_LEGACY_MAX_BYTES = 700 * 1024;
export const COMPLIANCE_MIME_EXTENSIONS = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
} as const;

export type ComplianceMime = keyof typeof COMPLIANCE_MIME_EXTENSIONS;
export const COMPLIANCE_FILE_ACCEPT = Object.keys(COMPLIANCE_MIME_EXTENSIONS).join(',') + ',.pdf,.png,.jpg,.jpeg,.docx';
export const COMPLIANCE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type ComplianceDraft = Omit<ComplianceItem, keyof AuditMeta | 'id' | 'attachmentId' | 'projectName'>;
export type ComplianceVersion = {
  id: string;
  name: string;
  mimeType: ComplianceMime;
  createdAt: string | null;
  removedAt: string | null;
};

export function isComplianceMime(value: unknown): value is ComplianceMime {
  return typeof value === 'string' && Object.hasOwn(COMPLIANCE_MIME_EXTENSIONS, value);
}

export function sanitizeComplianceFilename(value: string, mime: ComplianceMime) {
  const basename = value.split(/[\\/]/).at(-1) ?? '';
  const base = basename.replace(/\.[^.]*$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 100);
  return (base || 'arquivo') + '.' + COMPLIANCE_MIME_EXTENSIONS[mime];
}

export function complianceStoragePath(uid: string, projectId: string, itemId: string, fileId: string, name: string) {
  return ['complianceAttachments', uid, projectId || 'company', itemId, fileId, name].join('/');
}

export function prepareComplianceDraft(input: ComplianceDraft) {
  const trim = (value: string, max: number) => value.trim().slice(0, max);
  const title = trim(input.title, 160);
  const competence = normalizeCompetence(input.competence);
  if (!title) throw new Error('Informe o nome do registro.');
  if (input.kind === 'Obrigação' && (!competence || !isValidISODate(input.dueDate))) {
    throw new Error('Informe a competência e o vencimento da obrigação.');
  }
  if (input.kind === 'Certidão' && (!isValidISODate(input.issuedDate) || !isValidISODate(input.dueDate))) {
    throw new Error('Informe a emissão e a validade da certidão.');
  }
  if ((input.dueDate && !isValidISODate(input.dueDate)) || (input.issuedDate && !isValidISODate(input.issuedDate)) ||
    (input.kind !== 'Obrigação' && input.issuedDate && input.dueDate && input.dueDate < input.issuedDate)) {
    throw new Error('Confira a emissão e a validade. A validade deve ser igual ou posterior à emissão.');
  }
  if (input.kind === 'Documento de obra' && !input.projectId) throw new Error('Selecione a obra do documento.');
  return { kind: input.kind, title, category: trim(input.category, 80), projectId: input.projectId,
    competence: competence || trim(input.competence, 40), dueDate: input.dueDate, issuedDate: input.issuedDate,
    fileName: trim(input.fileName, 160), mandatory: input.mandatory, status: input.status, notes: trim(input.notes, 500) };
}
