import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, FieldValue, type Firestore, type Timestamp } from 'firebase-admin/firestore';
import type { getStorage } from 'firebase-admin/storage';
import { COMPLIANCE_ID, COMPLIANCE_LEGACY_MAX_BYTES, COMPLIANCE_MAX_BYTES, complianceStoragePath, isComplianceMime,
  prepareComplianceDraft, sanitizeComplianceFilename, type ComplianceDraft, type ComplianceMime, type ComplianceVersion } from '../domain/complianceAttachments.ts';
import type { ActorRole, ComplianceItem } from '../types/pilotis.ts';
import { detectComplianceMime } from './complianceAttachmentContent.ts';

type Bucket = ReturnType<ReturnType<typeof getStorage>['bucket']>;
type FileRow = {
  ownerUid: string;
  itemId: string;
  name: string;
  mimeType: ComplianceMime;
  content?: Buffer;
  storagePath?: string;
  projectId?: string;
  sha256?: string;
  createdAt?: Timestamp;
  removedAt?: Timestamp;
};
type MigrationRow = { attachmentId: string; itemId: string; name: string; status: 'migrated' | 'ready' | 'already-migrated' | 'failed';
  sizeBytes?: number; sha256?: string; reason?: string };

export class ComplianceFileError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const serverTime = () => FieldValue.serverTimestamp();
const isoTime = (date?: Timestamp) => date?.toDate().toISOString() ?? null;
const storageMessage = 'Storage indisponível. Confira o bucket e as permissões do servidor. O anexo anterior foi preservado.';
const errorCode = (error: unknown) => error && typeof error === 'object' && 'code' in error ? Number(error.code) : 0;

export function createComplianceAttachmentStore(db: Firestore, bucket: Bucket) {
  const items = db.collection('complianceItems');
  const files = db.collection('complianceFiles');

  async function requireItem(uid: string, itemId: string) {
    const row = (await items.doc(itemId).get()).data() as ComplianceItem | undefined;
    if (!row || row.ownerUid !== uid) throw new ComplianceFileError(404, 'Documento indisponível.');
    return row;
  }

  async function requireProject(uid: string, projectId: string) {
    if (!projectId) return '';
    const project = (await db.collection('projects').doc(projectId).get()).data();
    if (!project || project.ownerUid !== uid) throw new ComplianceFileError(404, 'Obra indisponível.');
    return String(project.name ?? '').slice(0, 160);
  }

  function storageVersion(uid: string, projectId: string, itemId: string, fileId: string, name: string, mimeType: ComplianceMime, bytes: Buffer) {
    return { name, mimeType, sizeBytes: bytes.length, sha256: digest(bytes), projectId,
      storagePath: complianceStoragePath(uid, projectId, itemId, fileId, name) };
  }

  async function writeObject(version: ReturnType<typeof storageVersion>, bytes: Buffer, verify: boolean) {
    const file = bucket.file(version.storagePath);
    try {
      await file.save(bytes, { resumable: false, validation: 'crc32c', preconditionOpts: { ifGenerationMatch: 0 },
        metadata: { contentType: version.mimeType, cacheControl: 'private, no-store' } });
    } catch (error) {
      if (errorCode(error) !== 412) throw new ComplianceFileError(503, storageMessage);
      verify = true;
    }
    if (verify) {
      try {
        const [copy] = await file.download();
        if (copy.length !== bytes.length || digest(copy) !== version.sha256) throw Error();
      } catch {
        throw new ComplianceFileError(409, 'A cópia do Storage não corresponde ao arquivo original. O Firestore foi preservado.');
      }
    }
  }

  function audit(uid: string, actor: ActorRole, itemId: string, summary: string, beforeValue: string, afterValue: string, action = 'Atualização') {
    return { ownerUid: uid, registeredBy: actor, action, entityType: 'complianceItems', entityId: itemId,
      summary, beforeValue, afterValue, createdAt: serverTime() };
  }

  return {
    async saveVersion(uid: string, actor: ActorRole, itemId: string, editing: boolean, expectedAttachment: string, draft: ComplianceDraft,
      originalName: string, bytes: Buffer) {
      if (!bytes.length || bytes.length > COMPLIANCE_MAX_BYTES) throw new ComplianceFileError(400, 'Anexe um arquivo de até 10 MB.');
      const mime = detectComplianceMime(bytes);
      if (!mime) throw new ComplianceFileError(400, 'Anexe um arquivo válido em PDF, PNG, JPEG ou DOCX.');
      let normalized: ReturnType<typeof prepareComplianceDraft>;
      try { normalized = prepareComplianceDraft(draft); }
      catch (error) { throw new ComplianceFileError(400, error instanceof Error ? error.message : 'Confira o documento.'); }

      const current = editing ? await requireItem(uid, itemId) : null;
      if (current && (current.kind !== draft.kind || (current.attachmentId ?? '') !== expectedAttachment)) {
        throw new ComplianceFileError(409, 'O anexo atual mudou. Reabra o registro antes de substituir.');
      }
      const projectName = await requireProject(uid, normalized.projectId);
      const fileId = 'cmpfile_' + randomUUID().replace(/-/g, '');
      const name = sanitizeComplianceFilename(originalName, mime);
      const version = storageVersion(uid, normalized.projectId, itemId, fileId, name, mime, bytes);
      const row = { ...normalized, projectName, fileName: name, attachmentId: fileId };
      const itemRef = items.doc(itemId);
      const fileRef = files.doc(fileId);
      await writeObject(version, bytes, false);
      try {
        await db.runTransaction(async (tx) => {
          const previous = (await tx.get(itemRef)).data() as ComplianceItem | undefined;
          if (editing ? !previous || previous.ownerUid !== uid || previous.kind !== draft.kind ||
            (previous.attachmentId ?? '') !== expectedAttachment : Boolean(previous)) {
            throw new ComplianceFileError(409, 'O registro mudou durante o envio. Reabra o documento e tente de novo.');
          }
          const updated = { updatedAt: serverTime(), updatedBy: actor };
          tx.create(fileRef, { ...version, ownerUid: uid, itemId, createdAt: serverTime(), createdBy: actor, ...updated });
          if (previous) tx.update(itemRef, { ...row, ...updated });
          else tx.create(itemRef, { ...row, ownerUid: uid, createdAt: serverTime(), createdBy: actor, ...updated });
          tx.create(db.collection('auditLogs').doc(), audit(uid, actor, itemId, previous?.attachmentId ? 'Anexo substituído' : 'Anexo incluído',
            previous?.fileName || '', name, previous ? 'Atualização' : 'Criação'));
        });
      } catch (error) {
        // A confirmed failure leaves the uploaded object unreferenced. For ambiguous commits retain it for safe recovery.
        if (error instanceof ComplianceFileError) await bucket.file(version.storagePath).delete({ ignoreNotFound: true }).catch(() => undefined);
        throw error;
      }
      return row;
    },

    async list(uid: string, itemId: string, after?: string) {
      const item = await requireItem(uid, itemId);
      let query = files.where('itemId', '==', itemId).orderBy(FieldPath.documentId());
      if (after) query = query.startAfter(after);
      const page = await query.limit(41).get();
      const rows = page.docs.slice(0, 40);
      const active = !after && item.attachmentId && !rows.some((row) => row.id === item.attachmentId)
        ? await files.doc(item.attachmentId).get() : undefined;
      const versions = (active?.exists ? [active, ...rows] : rows).flatMap((doc): ComplianceVersion[] => {
        const file = doc.data() as FileRow;
        if (file.ownerUid !== uid || file.itemId !== itemId || !isComplianceMime(file.mimeType)) return [];
        return [{ id: doc.id, name: file.name, mimeType: file.mimeType, createdAt: isoTime(file.createdAt), removedAt: isoTime(file.removedAt) }];
      });
      return { activeId: item.attachmentId ?? '', versions, next: page.size > rows.length ? rows.at(-1)!.id : null };
    },

    async download(uid: string, itemId: string, attachmentId: string) {
      await requireItem(uid, itemId);
      const file = (await files.doc(attachmentId).get()).data() as FileRow | undefined;
      if (!file || file.ownerUid !== uid || file.itemId !== itemId || !isComplianceMime(file.mimeType)) {
        throw new ComplianceFileError(404, 'Anexo indisponível.');
      }
      let bytes = file.content;
      if (file.storagePath) {
        if (file.storagePath !== complianceStoragePath(uid, file.projectId ?? '', itemId, attachmentId, file.name)) {
          throw new ComplianceFileError(404, 'Anexo indisponível.');
        }
        try {
          [bytes] = await bucket.file(file.storagePath).download();
        } catch {
          if (!Buffer.isBuffer(bytes)) throw new ComplianceFileError(503, 'Não foi possível ler o anexo no Storage.');
        }
      }
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > COMPLIANCE_MAX_BYTES ||
        (file.sha256 && digest(bytes) !== file.sha256)) throw new ComplianceFileError(422, 'Não foi possível validar a integridade do anexo.');
      return { bytes, mimeType: file.mimeType, name: sanitizeComplianceFilename(file.name, file.mimeType) };
    },

    async remove(uid: string, actor: ActorRole, itemId: string, attachmentId: string) {
      const itemRef = items.doc(itemId);
      const fileRef = files.doc(attachmentId);
      await db.runTransaction(async (tx) => {
        const [itemDoc, fileDoc] = await Promise.all([tx.get(itemRef), tx.get(fileRef)]);
        const item = itemDoc.data() as ComplianceItem | undefined;
        const file = fileDoc.data() as FileRow | undefined;
        if (!item || item.ownerUid !== uid || !file || file.ownerUid !== uid || file.itemId !== itemId) {
          throw new ComplianceFileError(404, 'Anexo indisponível.');
        }
        if (file.removedAt && item.attachmentId !== attachmentId) return;
        if (item.attachmentId !== attachmentId) throw new ComplianceFileError(409, 'O anexo atual mudou. Reabra o documento.');
        const updated = { updatedBy: actor, updatedAt: serverTime() };
        tx.update(fileRef, { ...updated, removedAt: serverTime(), removedBy: actor });
        tx.update(itemRef, { ...updated, attachmentId: FieldValue.delete(), fileName: '',
          ...(item.status === 'Anexado' ? { status: 'Pendente' } : {}) });
        tx.create(db.collection('auditLogs').doc(), audit(uid, actor, itemId, 'Anexo removido do documento', file.name, 'Removido'));
      });
    },

    async migrate(uid: string, actor: ActorRole, apply: boolean) {
      const results: MigrationRow[] = [];
      const query = files.where('ownerUid', '==', uid).orderBy(FieldPath.documentId());
      let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
      for (;;) {
        const page = await (cursor ? query.startAfter(cursor) : query).limit(50).get();
        for (const doc of page.docs) {
          const file = doc.data() as FileRow;
          const entry: MigrationRow = { attachmentId: doc.id, itemId: file.itemId || '', name: file.name || '', status: 'failed' };
          results.push(entry);
          try {
            if (file.storagePath && !file.content) {
              entry.status = 'already-migrated'; continue;
            }
            if (!COMPLIANCE_ID.test(doc.id) || !COMPLIANCE_ID.test(file.itemId) ||
              !Buffer.isBuffer(file.content) || !file.content.length || file.content.length > COMPLIANCE_LEGACY_MAX_BYTES ||
              !isComplianceMime(file.mimeType) || detectComplianceMime(file.content) !== file.mimeType) {
              throw new ComplianceFileError(422, 'Arquivo legado fora do tamanho ou tipo esperado.');
            }
            const item = await requireItem(uid, file.itemId);
            const projectId = item.projectId || '';
            if (projectId && !COMPLIANCE_ID.test(projectId)) throw new ComplianceFileError(422, 'Código de obra inválido.');
            const name = sanitizeComplianceFilename(file.name, file.mimeType);
            const version = storageVersion(uid, projectId, file.itemId, doc.id, name, file.mimeType, file.content);
            entry.sizeBytes = version.sizeBytes; entry.sha256 = version.sha256;
            if (!apply) { entry.status = 'ready'; continue; }
            await writeObject(version, file.content, true);
            const transferred = await db.runTransaction(async (tx) => {
              const current = (await tx.get(doc.ref)).data() as FileRow | undefined;
              const linked = (await tx.get(items.doc(file.itemId))).data() as ComplianceItem | undefined;
              if (current?.storagePath === version.storagePath && !current.content && current.sha256 === version.sha256) return false;
              if (!current || current.ownerUid !== uid || current.itemId !== file.itemId || !Buffer.isBuffer(current.content) ||
                digest(current.content) !== version.sha256 || !linked || linked.ownerUid !== uid ||
                (linked.projectId || '') !== projectId) throw new ComplianceFileError(409, 'Registro alterado durante a migração. Execute novamente.');
              tx.update(doc.ref, { ...version, content: FieldValue.delete(), updatedAt: serverTime(), updatedBy: actor, migratedAt: serverTime() });
              if (linked.attachmentId === doc.id) tx.update(items.doc(file.itemId), { fileName: name, updatedAt: serverTime(), updatedBy: actor });
              tx.create(db.collection('auditLogs').doc(), audit(uid, actor, file.itemId, 'Anexo migrado para o Storage', file.name, name));
              return true;
            });
            entry.status = transferred ? 'migrated' : 'already-migrated';
          } catch (error) {
            entry.reason = error instanceof ComplianceFileError ? error.message : 'Falha ao acessar o anexo ou atualizar a referência.';
          }
        }
        if (page.size < 50) break;
        cursor = page.docs.at(-1);
      }
      return { mode: apply ? 'apply' : 'dry-run', generatedAt: new Date().toISOString(),
        totals: { examined: results.length, ready: results.filter((row) => row.status === 'ready').length,
          migrated: results.filter((row) => row.status === 'migrated').length,
          alreadyMigrated: results.filter((row) => row.status === 'already-migrated').length,
          failed: results.filter((row) => row.status === 'failed').length }, files: results };
    },
  };
}

export type ComplianceAttachmentStore = ReturnType<typeof createComplianceAttachmentStore>;
