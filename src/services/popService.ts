import { Bytes, doc, getDoc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import {
  isValidPopAttachment, nextPopVersion, planningTodayISO, POP_MEDIA_CHUNK_BYTES,
  POP_MEDIA_TOTAL_BYTES, popPublicationNumber, readPopContent, validatePopContent,
} from '../domain';
import type { ActorRole, Pop, PopAttachment, PopContent, PopVersion } from '../types/pilotis';
import { compressDailyLogPhoto } from './dailyLogPhotos';
import { generateId } from './pilotisService';

export type NewPopFile = { attachment: PopAttachment; blob: Blob };

export async function preparePopAttachment(file: File): Promise<NewPopFile> {
  const blob = file.type.startsWith('image/') ? await compressDailyLogPhoto(file) : file;
  const attachment = {
    id: generateId('media'), name: file.name.trim().slice(0, 160), contentType: blob.type,
    size: blob.size, chunkCount: Math.ceil(blob.size / POP_MEDIA_CHUNK_BYTES),
  };
  if (!isValidPopAttachment(attachment)) throw new Error('Selecione uma foto ou um vídeo MP4, WebM ou MOV de até 5 MB.');
  return { attachment, blob };
}

async function encodeFiles(files: NewPopFile[]) {
  if (files.reduce((total, file) => total + file.blob.size, 0) > POP_MEDIA_TOTAL_BYTES) throw new Error('Os arquivos excedem 5 MB.');
  return (await Promise.all(files.map(async ({ attachment, blob }) => {
    if (!isValidPopAttachment(attachment) || attachment.size !== blob.size || attachment.contentType !== blob.type) {
      throw new Error('O arquivo não corresponde ao anexo informado.');
    }
    const parts = [];
    for (let index = 0; index < attachment.chunkCount; index += 1) {
      const start = index * POP_MEDIA_CHUNK_BYTES;
      const content = Bytes.fromUint8Array(new Uint8Array(await blob.slice(start, start + POP_MEDIA_CHUNK_BYTES).arrayBuffer()));
      parts.push({ id: attachment.id + '_' + index, attachmentId: attachment.id, index, content });
    }
    return parts;
  }))).flat();
}

export async function readPopAttachment(popId: string, attachment: PopAttachment) {
  if (!isValidPopAttachment(attachment)) throw new Error('Anexo inválido.');
  const snapshots = await Promise.all(Array.from({ length: attachment.chunkCount }, (_, index) =>
    getDoc(doc(db, 'popMediaChunks', attachment.id + '_' + index))));
  const chunks = snapshots.map((snapshot, index) => {
    const part = snapshot.data();
    if (!part || part.popId !== popId || part.attachmentId !== attachment.id || part.index !== index || !(part.content instanceof Bytes)) {
      throw new Error('Anexo indisponível.');
    }
    return part.content.toUint8Array().slice().buffer as ArrayBuffer;
  });
  const blob = new Blob(chunks, { type: attachment.contentType });
  if (blob.size !== attachment.size) throw new Error('Anexo incompleto.');
  return blob;
}

type SaveParams = {
  uid: string; actor: ActorRole; popId?: string; expectedRevision?: number;
} & (
  { action: 'draft' | 'publish'; content: PopContent; files: NewPopFile[]; changeSummary?: string } |
  { action: 'restore'; versionId: string; changeSummary: string }
);

function publicationMetadata(pop: Pop) {
  return {
    ...(pop.approvedBy ? { approvedBy: pop.approvedBy } : {}),
    ...(pop.publishedOn ? { publishedOn: pop.publishedOn } : {}),
    ...(pop.changeSummary ? { changeSummary: pop.changeSummary } : {}),
  };
}

export async function savePop(params: SaveParams): Promise<string> {
  const { uid, actor, action } = params;
  const id = params.popId ?? generateId('pop');
  const ref = doc(db, 'pops', id);
  const changeSummary = params.changeSummary?.trim() ?? '';
  if (action !== 'draft' && (!changeSummary || changeSummary.length > 500)) {
    throw new Error('Descreva o que mudou em até 500 caracteres para publicar.');
  }
  const content = action === 'restore' ? null : validatePopContent(params.content);
  const files = params.action === 'restore' ? [] : params.files;
  if (files.some((file) => !content?.attachments?.some((item) => item.id === file.attachment.id &&
      item.name === file.attachment.name && item.size === file.attachment.size && item.contentType === file.attachment.contentType))) {
    throw new Error('Selecione os arquivos que fazem parte do POP.');
  }
  const parts = await encodeFiles(files);

  await runTransaction(db, async (tx) => {
    const old = params.popId ? (await tx.get(ref)).data() as Pop | undefined : undefined;
    if (params.popId && (!old || old.ownerUid !== uid)) throw new Error('POP indisponível.');
    if (old && (old.revision ?? 0) !== (params.expectedRevision ?? 0)) {
      throw new Error('O POP foi atualizado em outra sessão. Reabra o editor para conferir a versão atual.');
    }
    let editing = content;
    if (params.action === 'restore') {
      const archived = (await tx.get(doc(db, 'popVersions', params.versionId))).data() as PopVersion | undefined;
      if (!old || !archived || archived.ownerUid !== uid || archived.popId !== id) throw new Error('Versão indisponível.');
      editing = validatePopContent(archived);
    }
    if (!editing) throw new Error('Conteúdo do POP indisponível.');

    if (action !== 'restore') {
      const existing = [...(old?.attachments ?? []), ...(old?.draft?.attachments ?? []), ...files.map((file) => file.attachment)];
      if (editing.attachments?.some((item) => !existing.some((saved) => saved.id === item.id &&
          saved.name === item.name && saved.contentType === item.contentType && saved.size === item.size && saved.chunkCount === item.chunkCount))) {
        throw new Error('Um dos anexos não pertence ao POP.');
      }
    }

    const audit = { ownerUid: uid, createdBy: actor, updatedBy: actor, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    const revision = (old?.revision ?? 0) + 1;
    const number = popPublicationNumber(old);
    const version = nextPopVersion(old);
    if (action !== 'draft' && old && number > 0) {
      tx.set(doc(db, 'popVersions', id + '_v' + number), {
        ...audit, ...readPopContent(old), ...publicationMetadata(old), popId: id,
        publicationNumber: number, version: old.version,
      });
    }
    const written = action === 'draft'
      ? {
        ...(number === 0 ? editing : {}),
        draft: editing, status: 'Em revisão', revision, publicationNumber: number,
        version: old?.version ?? 'v1.0',
      }
      : {
        ...editing, draft: action === 'restore' ? old?.draft ?? null : null,
        status: action === 'restore' && old?.draft ? 'Em revisão' : 'Vigente', revision, publicationNumber: number + 1, version,
        approvedBy: actor, publishedOn: planningTodayISO(), changeSummary,
      };
    if (old) tx.update(ref, { ...written, updatedBy: actor, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...written, ...audit });

    for (const { id: partId, ...part } of parts) {
      tx.set(doc(db, 'popMediaChunks', partId), { ...part, ...audit, popId: id });
    }
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, entityType: 'pops', action: old ? 'Atualização' : 'Criação',
      summary: (action === 'draft' ? 'Revisão salva · ' : action === 'restore' ? 'POP restaurado · ' : 'POP publicado · ') + editing.title,
      beforeValue: old?.version ?? '', afterValue: action === 'draft' ? 'Em revisão' : version,
      createdAt: serverTimestamp(),
    });
  });
  return id;
}
