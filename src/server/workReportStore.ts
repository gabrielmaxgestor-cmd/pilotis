import { createHash, randomBytes } from 'node:crypto';
import { FieldValue, Timestamp, type CollectionReference, type Firestore, type Query } from 'firebase-admin/firestore';
import { isValidISODate } from '../domain/formatters.ts';
import { planningTodayISO } from '../domain/pilotisAdapters.ts';
import { buildWorkReport, reportMonth, REPORT_PHOTO_LIMIT, REPORT_SHARE_DAYS, type ClientApproval,
  type ReportPhotoSelection, type WorkReportRecord } from '../domain/workReport.ts';
import type { ActorRole, CompanySettings, CustomerMaterial, DailyLog, Project, ProjectStage, ScheduleProgress } from '../types/pilotis.ts';
import { createWorkReportPdf, prepareReportJpeg, REPORT_SOURCE_PHOTO_BYTES } from './workReportPdf.ts';

export const reportIdPattern = /^[A-Za-z0-9_-]{1,128}$/;
export const shareTokenPattern = /^[A-Za-z0-9_-]{43}$/;
const CHUNK_BYTES = 700_000;
const MAX_CHUNKS = 10;
const DAY_MS = 86_400_000;
const VIEW_PAGE_SIZE = 20;

export class WorkReportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

type StoredReport = {
  ownerUid: string;
  month: string;
  createdAt: Timestamp;
  createdBy: ActorRole;
  chunkCount: number;
  shareHash?: string;
  shareExpiresAt?: Timestamp;
  shareRevokedAt?: Timestamp;
  sentAt?: Timestamp;
  sentBy?: ActorRole;
};
type ReadStoragePhoto = (path: string) => Promise<Buffer>;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const activeShare = (row: StoredReport, now: number) => Boolean(row.shareHash && !row.shareRevokedAt &&
  row.shareExpiresAt && row.shareExpiresAt.toMillis() > now);
const isoTime = (date?: Timestamp) => date?.toDate().toISOString() ?? null;

function record(id: string, row: StoredReport, now: number): WorkReportRecord {
  return {
    id, month: row.month, createdAt: row.createdAt.toDate().toISOString(), createdBy: row.createdBy,
    sentAt: isoTime(row.sentAt), sentBy: row.sentBy ?? null,
    shareExpiresAt: isoTime(row.shareExpiresAt), shareRevokedAt: isoTime(row.shareRevokedAt), shareActive: activeShare(row, now),
  };
}

async function readPages<T>(source: Query): Promise<T[]> {
  let page = await source.limit(150).get();
  const rows: T[] = [];
  for (;;) {
    rows.push(...page.docs.map((row) => ({ ...row.data(), id: row.id }) as T));
    if (page.size < 150) return rows;
    page = await source.startAfter(page.docs[page.size - 1]).limit(150).get();
  }
}

async function actualPhoto(db: Firestore, storage: ReadStoragePhoto, uid: string, projectId: string,
  selected: ReportPhotoSelection, logs: Map<string, DailyLog>, from: string, through: string) {
  const log = logs.get(selected.logId);
  if (!log || log.ownerUid !== uid || log.projectId !== projectId || !isValidISODate(log.date) ||
    log.date < from || log.date > through || !log.photoIds?.includes(selected.photoId)) {
    throw new WorkReportError(400, 'Selecione apenas fotos sincronizadas do diário da obra no mês escolhido.');
  }
  let bytes: Buffer;
  try {
    if (log.photoBackend === 'storage') {
      bytes = await storage('dailyLogs/' + uid + '/' + log.id + '/' + selected.photoId + '.jpg');
    } else {
      const row = (await db.doc('dailyLogs/' + log.id).collection('photos').doc(selected.photoId).get()).data();
      if (!row || row.ownerUid !== uid || row.mimeType !== 'image/jpeg' || !Buffer.isBuffer(row.content)) throw Error();
      bytes = row.content;
    }
    if (bytes.length > REPORT_SOURCE_PHOTO_BYTES) throw Error();
    return { image: prepareReportJpeg(bytes), caption: selected.caption, date: log.date };
  } catch {
    throw new WorkReportError(422, 'Uma das fotos selecionadas está indisponível. Abra o diário e confira os arquivos antes de gerar.');
  }
}

export function createWorkReportStore(db: Firestore, storage: ReadStoragePhoto, now = () => Date.now()) {
  async function projectFor(uid: string, id: string) {
    const ref = db.collection('projects').doc(id);
    const stored = (await ref.get()).data();
    if (!stored || stored.ownerUid !== uid) throw new WorkReportError(404, 'Obra indisponível.');
    return { ref, project: { ...stored, id } as Project };
  }

  async function ownedReport(uid: string, projectId: string, id: string) {
    const { ref } = await projectFor(uid, projectId);
    const reportRef = ref.collection('workReports').doc(id);
    const row = (await reportRef.get()).data() as StoredReport | undefined;
    if (!row || row.ownerUid !== uid) throw new WorkReportError(404, 'Relatório indisponível.');
    return { reportRef, row };
  }

  async function readPdf(ref: FirebaseFirestore.DocumentReference, count: number) {
    if (!Number.isInteger(count) || count < 1 || count > MAX_CHUNKS) throw new WorkReportError(404, 'Relatório indisponível.');
    const parts = await db.getAll(...Array.from({ length: count }, (_, i) => ref.collection('pdf').doc(String(i))));
    const bytes = parts.map((part) => part.get('bytes'));
    if (bytes.some((part) => !Buffer.isBuffer(part))) throw new WorkReportError(404, 'Relatório indisponível.');
    return Buffer.concat(bytes);
  }

  function audit(uid: string, actor: ActorRole, id: string, message: string, detail = '') {
    return {
      ownerUid: uid, registeredBy: actor, action: message === 'Relatório gerado' ? 'Criação' : 'Atualização',
      entityType: 'workReports', entityId: id, summary: message, afterValue: detail, createdAt: FieldValue.serverTimestamp(),
    };
  }

  function approvals(source: CollectionReference) {
    return readPages<ClientApproval>(source.orderBy('title'));
  }

  return {
    async list(uid: string, projectId: string, cursor?: string) {
      const { ref } = await projectFor(uid, projectId);
      const source = ref.collection('workReports');
      let sorted = source.orderBy('createdAt', 'desc').limit(VIEW_PAGE_SIZE + 1);
      if (cursor) {
        const previous = await source.doc(cursor).get();
        if (!previous.exists) throw new WorkReportError(400, 'Página do histórico indisponível.');
        sorted = sorted.startAfter(previous);
      }
      const [page, pending] = await Promise.all([sorted.get(), approvals(ref.collection('clientApprovals'))]);
      const rows = page.docs.slice(0, VIEW_PAGE_SIZE);
      return { reports: rows.map((row) => record(row.id, row.data() as StoredReport, now())), approvals: pending,
        nextCursor: page.size > VIEW_PAGE_SIZE ? rows.at(-1)!.id : null };
    },

    async saveApproval(uid: string, actor: ActorRole, projectId: string, input: ClientApproval) {
      const { ref } = await projectFor(uid, projectId);
      const source = ref.collection('clientApprovals');
      const target = input.id ? source.doc(input.id) : source.doc();
      await db.runTransaction(async (tx) => {
        const prior = (await tx.get(target)).data();
        if (input.id && (!prior || prior.ownerUid !== uid)) throw new WorkReportError(404, 'Aprovação indisponível.');
        const approval = { title: input.title, dueDate: input.dueDate, approvedAt: input.approvedAt,
          updatedBy: actor, updatedAt: FieldValue.serverTimestamp() };
        if (prior) tx.update(target, approval);
        else tx.create(target, { ...approval, ownerUid: uid, createdBy: actor, createdAt: FieldValue.serverTimestamp() });
        tx.create(db.collection('auditLogs').doc(), {
          ownerUid: uid, registeredBy: actor, action: prior ? 'Atualização' : 'Criação',
          entityType: 'clientApprovals', entityId: target.id, summary: 'Aprovação do cliente registrada',
          afterValue: input.approvedAt ? 'Aprovada em ' + input.approvedAt : 'Pendente', createdAt: FieldValue.serverTimestamp(),
        });
      });
    },

    async generate(uid: string, actor: ActorRole, projectId: string, month: string,
      selected: ReportPhotoSelection[], logoJpeg: string, authorized: boolean) {
      const today = planningTodayISO(new Date(now()));
      const period = reportMonth(month, today);
      if (!period || selected.length > REPORT_PHOTO_LIMIT || (selected.length && !authorized)) {
        throw new WorkReportError(400, 'Confirme o mês e a autorização das fotos selecionadas.');
      }
      const { ref, project } = await projectFor(uid, projectId);
      const scoped = (name: string) => db.collection(name).where('projectId', '==', projectId);
      const logIds = [...new Set(selected.map((photo) => photo.logId))];
      const [settingsSnap, stages, materials, progressHistory, pending, logSnaps] = await Promise.all([
        db.collection('companySettings').doc(uid).get(),
        readPages<ProjectStage>(scoped('stages')), readPages<CustomerMaterial>(scoped('customerMaterials')),
        period.next > today ? Promise.resolve([]) : readPages<ScheduleProgress>(scoped('scheduleProgress')),
        approvals(ref.collection('clientApprovals')),
        logIds.length ? db.getAll(...logIds.map((id) => db.collection('dailyLogs').doc(id))) : Promise.resolve([]),
      ]);
      const byLog = new Map(logSnaps.filter((doc) => doc.exists).map((doc) => [doc.id, { ...doc.data(), id: doc.id } as DailyLog]));
      const settings = settingsSnap.data() as CompanySettings | undefined;
      const photos = await Promise.all(selected.map((photo) => actualPhoto(db, storage, uid, projectId,
        photo, byLog, period.first, period.cutoff)));
      const report = buildWorkReport({ project, settings, stages: stages.filter((row) => row.ownerUid === uid),
        materials: materials.filter((row) => row.ownerUid === uid),
        progressHistory: progressHistory.filter((row) => row.ownerUid === uid), approvals: pending, month, today });
      let logo: ReturnType<typeof prepareReportJpeg> | undefined;
      if (settings?.logoDataUrl && settings.pdfShowLogo !== false) {
        try { logo = prepareReportJpeg(Buffer.from(logoJpeg, 'base64')); }
        catch { throw new WorkReportError(422, 'A logo da empresa está indisponível. Confira a imagem em Configurações.'); }
      }
      const pdf = createWorkReportPdf(report, photos, logo);
      const chunkCount = Math.ceil(pdf.length / CHUNK_BYTES);
      if (chunkCount > MAX_CHUNKS) throw new WorkReportError(422, 'O PDF ficou grande demais. Selecione menos fotos.');
      const pdfRef = ref.collection('workReports').doc();
      const stored = { ownerUid: uid, month, chunkCount, createdBy: actor, createdAt: Timestamp.fromMillis(now()),
        updatedBy: actor, updatedAt: FieldValue.serverTimestamp() };
      const batch = db.batch();
      batch.create(pdfRef, { ...stored, authorizedPhotos: selected.map(({ logId, photoId }) => ({ logId, photoId })) });
      for (let i = 0; i < chunkCount; i++) {
        batch.create(pdfRef.collection('pdf').doc(String(i)), { bytes: Buffer.from(pdf.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) });
      }
      batch.create(db.collection('auditLogs').doc(), audit(uid, actor, pdfRef.id, 'Relatório gerado',
        month + ' · ' + selected.length + ' foto(s) autorizada(s)'));
      await batch.commit();
      return record(pdfRef.id, stored, now());
    },

    async download(uid: string, projectId: string, id: string) {
      const { reportRef, row } = await ownedReport(uid, projectId, id);
      return readPdf(reportRef, row.chunkCount);
    },

    async change(uid: string, actor: ActorRole, projectId: string, id: string, action: 'share' | 'revoke' | 'sent') {
      const { reportRef } = await ownedReport(uid, projectId, id);
      const token = action === 'share' ? randomBytes(32).toString('base64url') : null;
      const updatedAt = Timestamp.fromMillis(now());
      const expiry = Timestamp.fromMillis(updatedAt.toMillis() + REPORT_SHARE_DAYS * DAY_MS);
      const shares = db.collection('workReportShares');
      return db.runTransaction(async (tx) => {
        const row = (await tx.get(reportRef)).data() as StoredReport | undefined;
        if (!row || row.ownerUid !== uid) throw new WorkReportError(404, 'Relatório indisponível.');
        const next = { ...row };
        const update: Record<string, unknown> = { updatedBy: actor, updatedAt: FieldValue.serverTimestamp() };
        let actionLabel: string;
        if (action === 'share' && token) {
          const digest = hash(token);
          if (row.shareHash) tx.delete(shares.doc(row.shareHash));
          tx.create(shares.doc(digest), { projectId, reportId: id, expiresAt: expiry });
          update.shareHash = next.shareHash = digest;
          update.shareExpiresAt = next.shareExpiresAt = expiry;
          update.shareRevokedAt = FieldValue.delete();
          delete next.shareRevokedAt;
          actionLabel = 'Link de relatório gerado';
        } else if (action === 'revoke') {
          if (row.shareHash) tx.delete(shares.doc(row.shareHash));
          update.shareRevokedAt = next.shareRevokedAt = updatedAt;
          actionLabel = 'Link de relatório revogado';
        } else {
          update.sentAt = next.sentAt = updatedAt;
          update.sentBy = next.sentBy = actor;
          actionLabel = 'Envio do relatório registrado';
        }
        tx.update(reportRef, update);
        tx.create(db.collection('auditLogs').doc(), audit(uid, actor, id, actionLabel));
        return { report: record(id, next, now()), token };
      });
    },

    async publicPdf(token: string) {
      if (!shareTokenPattern.test(token)) return null;
      const digest = hash(token);
      const shareRef = db.collection('workReportShares').doc(digest);
      const shared = (await shareRef.get()).data();
      if (!shared || shared.expiresAt?.toMillis() <= now()) return null;
      const ref = db.collection('projects').doc(shared.projectId).collection('workReports').doc(shared.reportId);
      const row = (await ref.get()).data() as StoredReport | undefined;
      if (!row || row.shareHash !== digest || !activeShare(row, now())) return null;
      const pdf = await readPdf(ref, row.chunkCount);
      if (shared.expiresAt.toMillis() <= now() || !(await shareRef.get()).exists) return null;
      return pdf;
    },
  };
}

export type WorkReportStore = ReturnType<typeof createWorkReportStore>;
