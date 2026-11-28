import { deleteField, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import type { ActorRole, ArchiveMeta } from '../types/pilotis';
import type { ArchivableCollection } from '../domain/recordLifecycle';
import { generateId } from './pilotisService';

export async function setRecordArchived(
  uid: string, actor: ActorRole, entity: ArchivableCollection, id: string, archived: boolean,
) {
  const ref = doc(db, entity, id);
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  await runTransaction(db, async (tx) => {
    const row = (await tx.get(ref)).data() as (ArchiveMeta & { ownerUid: string; status?: string; name?: string; title?: string }) | undefined;
    if (!row || row.ownerUid !== uid || Boolean(row.archive) === archived) {
      throw new Error('O registro já mudou. Reabra a lista e tente novamente.');
    }
    if (entity === 'projects' && row.status === 'Concluída') throw new Error('Obras encerradas não podem ser arquivadas.');
    tx.update(ref, {
      archive: archived ? { at: serverTimestamp(), by: actor } : deleteField(),
      archiveAuditId: auditRef.id,
      updatedBy: actor, updatedAt: serverTimestamp(),
    });
    tx.set(auditRef, {
      ownerUid: uid, registeredBy: actor, entityType: entity, entityId: id, action: 'Atualização',
      summary: ((archived ? 'Arquivamento · ' : 'Restauração · ') + (row.name || row.title || id)).slice(0, 240),
      beforeValue: archived ? 'Ativo' : 'Arquivado', afterValue: archived ? 'Arquivado' : 'Ativo',
      createdAt: serverTimestamp(),
    });
  });
}

export async function deleteArchivedRecord(
  actor: ActorRole, entity: ArchivableCollection, id: string, confirmation: string,
) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Entre no sistema para excluir este registro.');
  const response = await fetch('/api/records/delete', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ entity, id, actor, confirmation }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error ?? 'Não foi possível excluir o registro.');
  }
}
