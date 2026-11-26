import { drainFieldJobs, isValidISODate, type FieldJob } from '../domain';
import { auth } from '../lib/firebase';
import type { ActorRole, Project } from '../types/pilotis';
import { saveDailyLogFromQueue } from './dailyLogPhotos';
import { saveProjectStage } from './pilotisService';

const changeEvent = 'pilotis-field-queue';
const channel = typeof BroadcastChannel === 'function' && typeof window !== 'undefined' ? new BroadcastChannel(changeEvent) : null;
channel?.addEventListener('message', () => window.dispatchEvent(new Event(changeEvent)));
const flushing = new Map<string, Promise<void>>();
let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pilotis-field-work', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('jobs', { keyPath: 'id' }).createIndex('uid', 'uid');
      request.result.createObjectStore('photos', { keyPath: 'key' }).createIndex('savedAt', 'savedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Feche as outras janelas para abrir os registros locais.'));
  }).catch((error) => { database = undefined; throw error; });
  return database;
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Não foi possível salvar no aparelho.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível salvar no aparelho.'));
  });
}

function announce() {
  window.dispatchEvent(new Event(changeEvent));
  channel?.postMessage('changed');
}

export function subscribeFieldQueue(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}

export async function readFieldQueue(uid: string): Promise<FieldJob[]> {
  const db = await openDatabase();
  const jobs = await requestValue(db.transaction('jobs').objectStore('jobs').index('uid').getAll(uid)) as FieldJob[];
  return jobs.sort((a, b) => a.queuedAt - b.queuedAt || a.id.localeCompare(b.id));
}

export async function putFieldJob(job: FieldJob): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('jobs', 'readwrite');
  tx.objectStore('jobs').put(job);
  await transactionDone(tx);
  announce();
}

export async function removeFieldJob(uid: string, id: string): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('jobs', 'readwrite');
  const store = tx.objectStore('jobs');
  const done = transactionDone(tx);
  const lookup = store.get(id);
  lookup.onsuccess = () => { if (lookup.result?.uid === uid) store.delete(id); };
  await done;
  announce();
}

type CachedPhoto = { key: string; blob: Blob; savedAt: number };

export async function getCachedDiaryPhoto(uid: string, logId: string, photoId: string): Promise<Blob | undefined> {
  const db = await openDatabase();
  const value = await requestValue(db.transaction('photos').objectStore('photos').get(uid + '/' + logId + '/' + photoId)) as CachedPhoto | undefined;
  return value?.blob;
}

export async function cacheDiaryPhoto(uid: string, logId: string, photoId: string, blob: Blob): Promise<void> {
  const db = await openDatabase();
  const tx = db.transaction('photos', 'readwrite');
  const photos = tx.objectStore('photos');
  photos.put({ key: uid + '/' + logId + '/' + photoId, blob, savedAt: Date.now() });
  const count = photos.count();
  count.onsuccess = () => {
    let excess = count.result - 60;
    if (excess <= 0) return;
    const cursor = photos.index('savedAt').openCursor();
    cursor.onsuccess = () => {
      if (cursor.result && excess > 0) { cursor.result.delete(); excess -= 1; cursor.result.continue(); }
    };
  };
  await transactionDone(tx);
}

export function flushFieldQueue(uid: string): Promise<void> {
  const running = flushing.get(uid);
  if (running) return running;
  const connected = () => navigator.onLine && auth.currentUser?.uid === uid;

  async function synchronize() {
    const jobs = await readFieldQueue(uid);
    await drainFieldJobs(jobs, async (job) => {
      if (job.kind === 'diary') {
        await saveDailyLogFromQueue(job);
        await Promise.allSettled(job.photos.map((photo) => cacheDiaryPhoto(uid, job.id, photo.id, photo.blob)));
      } else {
        await saveProjectStage({ uid, actor: job.actor, project: { id: job.projectId },
          knownStages: job.knownStageIds.map((id) => ({ id })), stageId: job.stageId, fieldUpdate: job.update, operationId: job.id });
      }
    }, (id) => removeFieldJob(uid, id), (job, error) => putFieldJob({ ...job, error }), connected);
  }

  const active = (async () => {
    if (!connected()) return;
    if (navigator.locks) {
      await navigator.locks.request('pilotis-field-sync-' + uid, { ifAvailable: true }, async (lock) => {
        if (lock) await synchronize();
      });
    } else {
      await synchronize();
    }
  })().finally(() => flushing.delete(uid));
  flushing.set(uid, active);
  return active;
}

export function startFieldSync(uid: string) {
  const sync = () => { void flushFieldQueue(uid).catch((error) => console.warn('Sincronização de campo:', error)); };
  window.addEventListener('online', sync);
  window.addEventListener('focus', sync);
  const timer = window.setInterval(sync, 15000);
  sync();
  return () => {
    window.clearInterval(timer);
    window.removeEventListener('online', sync);
    window.removeEventListener('focus', sync);
  };
}

export async function importLegacyDailyQueue(uid: string, projects: Project[]) {
  const key = 'pilotis_offline_logs';
  const raw = localStorage.getItem(key);
  if (!raw || !globalThis.crypto?.subtle) return;
  let items: unknown;
  try { items = JSON.parse(raw); } catch { return; }
  if (!Array.isArray(items)) return;
  const remaining = [];
  for (const [index, item] of items.entries()) {
    if (!item || !projects.some((project) => project.id === item.projectId && project.ownerUid === uid) ||
      typeof item.activities !== 'string' || !isValidISODate(item.date ?? '')) { remaining.push(item); continue; }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([index, item])));
    const id = 'log_legacy_' + Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, '0')).join('');
    const actor: ActorRole = item.actor === 'Responsável administrativo' ? 'Responsável administrativo' : 'Sócio';
    await putFieldJob({ id, uid, actor, queuedAt: Date.now(), kind: 'diary', photos: [], draft: {
      projectId: item.projectId, date: item.date, presentCount: Number(item.presentCount) || 0, weather: item.weather,
      activities: item.activities, occurrences: typeof item.occurrences === 'string' ? item.occurrences : '',
    } });
  }
  if (localStorage.getItem(key) === raw) {
    if (remaining.length) localStorage.setItem(key, JSON.stringify(remaining));
    else localStorage.removeItem(key);
  }
  await flushFieldQueue(uid);
}
