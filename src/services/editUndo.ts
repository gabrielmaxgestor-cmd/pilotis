import {
  deleteField, collection, doc, runTransaction, serverTimestamp, type DocumentReference,
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { ActorRole } from '../types/pilotis';

export const UNDO_DURATION_MS = 8000;
const EVENT = 'pilotis-edit-undo';
type Fields = Record<string, unknown>;

export interface UndoNotice {
  undo: () => Promise<void>;
}

export function publishEditUndo(undo?: () => Promise<void>) {
  if (undo && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<UndoNotice>(EVENT, { detail: { undo } }));
  }
}

export function subscribeEditUndo(listener: (notice: UndoNotice) => void) {
  const handle = (event: Event) => listener((event as CustomEvent<UndoNotice>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}

function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if ('isEqual' in left && typeof left.isEqual === 'function') return left.isEqual(right);
  if (left instanceof Date || right instanceof Date) {
    return left instanceof Date && right instanceof Date && left.getTime() === right.getTime();
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const entries = Object.entries(left);
  return entries.length === Object.keys(right).length && entries.every(([key, value]) =>
    Object.hasOwn(right, key) && sameValue(value, (right as Fields)[key]));
}

interface EditedRecord {
  ref: DocumentReference;
  before: object;
  after: object;
}

export function prepareEditUndo(uid: string, actor: ActorRole, edits: EditedRecord[]) {
  const changed = edits.map(({ ref, before, after }) => ({
    ref, before: before as Fields,
    entries: Object.entries(after).filter(([key, value]) =>
      !['ownerUid', 'createdBy', 'createdAt', 'updatedBy', 'updatedAt'].includes(key) &&
      !sameValue((before as Fields)[key], value)),
  })).filter(({ entries }) => entries.length > 0);
  if (!changed.length) return undefined;
  const auditRef = doc(collection(db, 'auditLogs'));
  return async () => {
    await runTransaction(db, async (tx) => {
      const current = await Promise.all(changed.map(({ ref }) => tx.get(ref)));
      for (const [index, edit] of changed.entries()) {
        const data = current[index].data();
        if (!data || data.ownerUid !== uid || data.archive || !edit.entries.every(([key, value]) => sameValue(data[key], value))) {
          throw new Error('O registro mudou após esta edição. As alterações mais recentes foram preservadas.');
        }
        const patch = Object.fromEntries(edit.entries.map(([key]) =>
          [key, Object.hasOwn(edit.before, key) ? edit.before[key] : deleteField()]));
        tx.update(edit.ref, { ...patch, updatedBy: actor, updatedAt: serverTimestamp() });
      }
      tx.set(auditRef, {
        ownerUid: uid, registeredBy: actor, action: 'Atualização',
        entityType: changed[0].ref.parent.id, entityId: changed[0].ref.id,
        summary: 'Edição desfeita', afterValue: 'Valores anteriores restaurados', createdAt: serverTimestamp(),
      });
    });
  };
}
