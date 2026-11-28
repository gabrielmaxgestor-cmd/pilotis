import express from 'express';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ARCHIVABLE_COLLECTIONS, DELETE_CONFIRMATION, type ArchivableCollection } from '../domain/recordLifecycle.ts';
import type { ActorRole } from '../types/pilotis.ts';

const links: Record<ArchivableCollection, ReadonlyArray<readonly [string, string]>> = {
  clients: [['quotes', 'clientId'], ['projects', 'clientId'], ['parcelas', 'clientId']],
  quotes: [['projects', 'quoteId'], ['parcelas', 'quoteId'], ['transactions', 'quoteId']],
  projects: [
    ['quotes', 'projectId'], ['parcelas', 'projectId'], ['transactions', 'projectId'],
    ['stages', 'projectId'], ['allocations', 'projectId'], ['employees', 'currentProjectId'],
    ['complianceItems', 'projectId'], ['dailyLogs', 'projectId'], ['fieldSync', 'projectId'],
    ['baselines', 'projectId'], ['scheduleProgress', 'projectId'], ['projectRisks', 'projectId'],
    ['projectClosures', 'projectId'], ['projectFollowUps', 'projectId'], ['warrantyCalls', 'projectId'],
  ],
  employees: [['allocations', 'employeeId'], ['transactions', 'payrollEmployeeId']],
};

class DeletionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;

export async function permanentRecordDeletion(db: Firestore, uid: string, entity: ArchivableCollection, id: string, actor: ActorRole) {
  const ref = db.collection(entity).doc(id);
  const audit = db.collection('auditLogs').doc();
  const tombstone = db.collection('recordTombstones').doc(entity + '_' + id);
  await db.runTransaction(async (tx) => {
    const row = (await tx.get(ref)).data();
    if (!row || row.ownerUid !== uid) throw new DeletionError(404, 'Registro não encontrado.');
    if (!row.archive || (entity === 'projects' && row.status === 'Concluída')) {
      throw new DeletionError(409, 'A exclusão definitiva requer um registro arquivado.');
    }
    const hasContract = entity === 'quotes' && (row.projectId || row.status === 'Ganho' ||
      (row.contractSignStatus && row.contractSignStatus !== 'Não gerado') || row.contractAddenda?.length);
    const hasProjectIdentity = entity === 'projects' && (row.clientId || row.quoteId || row.contractPdf);
    const parent = entity === 'quotes' && row.clientId ? db.collection('clients').doc(row.clientId)
      : entity === 'employees' && row.currentProjectId && !['Sem obra', 'Empresa'].includes(row.currentProjectId)
        ? db.collection('projects').doc(row.currentProjectId) : undefined;
    if (hasContract || hasProjectIdentity || (parent && (await tx.get(parent)).exists)) {
      throw new DeletionError(409, 'Este registro tem vínculos e pode permanecer arquivado.');
    }

    const queries = links[entity].map(([collection, field]) => db.collection(collection)
      .where(field, '==', id).where('ownerUid', '==', uid).limit(1));
    if (entity === 'employees') queries.push(ref.collection('occurrences').limit(1));
    if (entity === 'clients' && row.name) {
      queries.push(db.collection('projects').where('clientName', '==', row.name).where('ownerUid', '==', uid).limit(1));
    }
    const references = await Promise.all(queries.map((query) => tx.get(query)));
    if (references.some((snapshot) => !snapshot.empty)) {
      throw new DeletionError(409, 'Este registro tem vínculos e pode permanecer arquivado.');
    }

    tx.create(tombstone, { ownerUid: uid, createdAt: FieldValue.serverTimestamp() });
    tx.create(audit, {
      ownerUid: uid, registeredBy: actor, action: 'Exclusão', entityType: entity, entityId: id,
      summary: ('Exclusão definitiva · ' + (row.name || row.title || id)).slice(0, 240),
      beforeValue: 'Arquivado', afterValue: 'Excluído definitivamente', createdAt: FieldValue.serverTimestamp(),
    });
    tx.delete(ref);
  });
}

export function createRecordDeletionRouter(options: {
  database: () => Firestore;
  authorizedEmail: string;
  verifyToken: (token: string) => Promise<{ uid?: string; email?: string; email_verified?: boolean }>;
}) {
  const router = express.Router();
  router.post('/delete', express.json({ limit: '2kb' }), async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization?.trim() ?? '')?.[1];
    const token = bearer ? await options.verifyToken(bearer).catch(() => null) : null;
    if (!token?.uid || !idPattern.test(token.uid) || token.email_verified !== true ||
      token.email?.trim().toLowerCase() !== options.authorizedEmail) {
      res.status(401).json({ error: 'Conta autorizada obrigatória.' });
      return;
    }
    const { entity, id, actor, confirmation } = req.body ?? {};
    if (!ARCHIVABLE_COLLECTIONS.includes(entity) || typeof id !== 'string' || !idPattern.test(id) ||
      (actor !== 'Sócio' && actor !== 'Responsável administrativo') || confirmation !== DELETE_CONFIRMATION) {
      res.status(400).json({ error: 'Confira o registro, o responsável e a confirmação digitada.' });
      return;
    }
    try {
      await permanentRecordDeletion(options.database(), token.uid, entity, id, actor);
      res.status(204).end();
    } catch (error) {
      if (error instanceof DeletionError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      console.error('Falha ao excluir registro arquivado.', { code: (error as { code?: unknown }).code });
      res.status(500).json({ error: 'Não foi possível confirmar os vínculos do registro. Nenhum registro foi excluído.' });
    }
  });
  return router;
}
