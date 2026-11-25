import { Bytes, doc, getDoc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getBlob, getStorage, ref, uploadBytes } from 'firebase/storage';
import { auth, db } from '../lib/firebase';
import { DAILY_PHOTO_LIMIT, DAILY_PHOTO_MAX_BYTES, isValidISODate, type FieldJob } from '../domain';
import type { DailyLog, DailyPhotoBackend } from '../types/pilotis';

type DiaryJob = Extract<FieldJob, { kind: 'diary' }>;
const configuredBackend: DailyPhotoBackend =
  import.meta.env?.VITE_DAILY_LOG_PHOTO_BACKEND === 'storage' ? 'storage' : 'firestore';

const storagePath = (uid: string, logId: string, imageId: string) => `dailyLogs/${uid}/${logId}/${imageId}.jpg`;

export async function compressDailyLogPhoto(file: File): Promise<Blob> {
  if (file.type && !file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('Imagem inválida.');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('O aparelho não conseguiu preparar a foto.');
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    for (const resize of [1, 0.8, 0.6, 0.4]) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale * resize));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale * resize));
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const compressed = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.76));
      if (compressed?.type === 'image/jpeg' && compressed.size <= DAILY_PHOTO_MAX_BYTES) return compressed;
    }
    throw new Error('A foto está muito grande. Selecione outra imagem.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function saveDailyLogFromQueue(job: DiaryJob) {
  const { id, uid, actor, draft, photos } = job;
  if (!isValidISODate(draft.date) || !Number.isInteger(draft.presentCount) || draft.presentCount < 0 || !draft.activities.trim()) {
    throw new Error('Confira a data, a equipe presente e as atividades.');
  }
  if (photos.length > DAILY_PHOTO_LIMIT || photos.some(({ blob }) => blob.type !== 'image/jpeg' || blob.size <= 0 || blob.size > DAILY_PHOTO_MAX_BYTES)) {
    throw new Error('O registro contém fotos incompatíveis.');
  }

  const logRef = doc(db, 'dailyLogs', id);
  if (configuredBackend === 'storage' && photos.length > 0) {
    if ((await getDocFromServer(logRef)).exists()) return;
    // The document is published only after all uploads succeed. Fixed object paths are safe to retry.
    const storage = getStorage(auth.app);
    for (const photo of photos) {
      await uploadBytes(ref(storage, storagePath(uid, id, photo.id)), photo.blob, { contentType: 'image/jpeg' });
    }
  }
  const encoded = configuredBackend === 'firestore'
    ? await Promise.all(photos.map(async (photo) => ({
      id: photo.id, content: Bytes.fromUint8Array(new Uint8Array(await photo.blob.arrayBuffer())),
    }))) : [];

  await runTransaction(db, async (tx) => {
    if ((await tx.get(logRef)).exists()) return;
    const audit = { ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    tx.set(logRef, {
      ...draft, ...audit, photoNotes: [],
      photoBackend: configuredBackend, photoIds: photos.map((photo) => photo.id),
    });
    for (const photo of encoded) {
      tx.set(doc(logRef, 'photos', photo.id), { ...audit, mimeType: 'image/jpeg', content: photo.content });
    }
    tx.set(doc(db, 'auditLogs', id), {
      ownerUid: uid, registeredBy: actor, action: 'Criação', entityType: 'dailyLogs',
      summary: 'Registro de diário de obra', createdAt: serverTimestamp(),
    });
  });
}

export async function readDailyLogPhoto(log: DailyLog, photoId: string): Promise<Blob> {
  if (log.photoBackend === 'storage') {
    return getBlob(ref(getStorage(auth.app), storagePath(log.ownerUid, log.id, photoId)), DAILY_PHOTO_MAX_BYTES);
  }
  const snapshot = await getDoc(doc(db, 'dailyLogs', log.id, 'photos', photoId));
  const content = snapshot.data()?.content as Bytes | undefined;
  if (!content) throw new Error('Foto indisponível.');
  return new Blob([content.toUint8Array().slice().buffer as ArrayBuffer], { type: 'image/jpeg' });
}
