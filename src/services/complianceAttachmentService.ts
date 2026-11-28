import { auth } from '../lib/firebase';
import { COMPLIANCE_MAX_BYTES, type ComplianceDraft, type ComplianceVersion } from '../domain/complianceAttachments';
import type { ActorRole } from '../types/pilotis';

export type ComplianceVersionPage = { activeId: string; versions: ComplianceVersion[]; next: string | null };

async function request(path: string, body?: object) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Entre no Pilotis para acessar os anexos.');
  const response = await fetch('/api/compliance-attachments/' + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || 'Não foi possível acessar o anexo.');
  }
  return response;
}

export async function uploadComplianceAttachment(itemId: string, actor: ActorRole, draft: ComplianceDraft,
  file: File, editing: boolean, expectedAttachment: string) {
  if (!file.size || file.size > COMPLIANCE_MAX_BYTES) throw new Error('Anexe um PDF, PNG, JPEG ou DOCX de até 10 MB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo selecionado.'));
    reader.readAsDataURL(file);
  });
  const response = await request(encodeURIComponent(itemId), { actor, editing, expectedAttachment, draft, name: file.name, base64 });
  return response.json() as Promise<ComplianceDraft & { projectName: string; attachmentId: string }>;
}

export async function listComplianceVersions(itemId: string, after?: string) {
  const res = await request(encodeURIComponent(itemId) + (after ? '?after=' + encodeURIComponent(after) : ''));
  return res.json() as Promise<ComplianceVersionPage>;
}

export async function getComplianceAttachment(itemId: string, fileId: string) {
  const res = await request(encodeURIComponent(itemId) + '/' + encodeURIComponent(fileId));
  const name = /filename="([^"]+)"/i.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'anexo';
  return { blob: await res.blob(), name };
}

export async function removeComplianceAttachment(itemId: string, attachmentId: string, actor: ActorRole) {
  await request(encodeURIComponent(itemId) + '/' + encodeURIComponent(attachmentId) + '/remove', { actor });
}
