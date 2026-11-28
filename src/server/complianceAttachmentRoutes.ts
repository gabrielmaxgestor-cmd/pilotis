import express, { type NextFunction, type Request, type Response } from 'express';
import { COMPLIANCE_ID, COMPLIANCE_MAX_BYTES, type ComplianceDraft } from '../domain/complianceAttachments.ts';
import { ComplianceFileError, type ComplianceAttachmentStore } from './complianceAttachmentStore.ts';
import type { ActorRole } from '../types/pilotis.ts';

type Options = {
  store: () => ComplianceAttachmentStore;
  authorizedEmail: string;
  verifyToken: (token: string) => Promise<{ uid?: string; email?: string; email_verified?: boolean }>;
};
const base64Limit = Math.ceil(COMPLIANCE_MAX_BYTES / 3) * 4;
const kinds = ['Obrigação', 'Certidão', 'Documento de obra', 'Licitação'];
const states = ['Em dia', 'Válida', 'Anexado', 'Vence em breve', 'Pendente', 'Parcial'];

function id(value: unknown) {
  if (typeof value !== 'string' || !COMPLIANCE_ID.test(value)) throw new ComplianceFileError(400, 'Registro inválido.');
  return value;
}

function actor(value: unknown): ActorRole {
  if (value !== 'Sócio' && value !== 'Responsável administrativo') throw new ComplianceFileError(400, 'Informe quem registrou o anexo.');
  return value;
}

function draftOf(value: unknown): ComplianceDraft {
  if (!value || typeof value !== 'object') throw new ComplianceFileError(400, 'Confira os dados do documento.');
  const row = value as Record<string, unknown>;
  if (['kind', 'title', 'category', 'projectId', 'competence', 'dueDate', 'issuedDate', 'fileName', 'status', 'notes']
    .some((key) => typeof row[key] !== 'string') || typeof row.mandatory !== 'boolean' ||
    !kinds.includes(row.kind as string) || !states.includes(row.status as string)) {
    throw new ComplianceFileError(400, 'Confira os dados do documento.');
  }
  if (row.projectId) id(row.projectId);
  return row as ComplianceDraft;
}

function route(handle: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => void handle(req, res).catch(next);
}

export function createComplianceAttachmentRouter(options: Options) {
  const router = express.Router();
  router.use((req, res, next) => void (async () => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization')?.trim() ?? '')?.[1];
    const user = token ? await options.verifyToken(token).catch(() => null) : null;
    if (!user?.uid || !COMPLIANCE_ID.test(user.uid) || user.email_verified !== true ||
      user.email?.trim().toLowerCase() !== options.authorizedEmail) {
      res.status(401).json({ error: 'Conta da empresa obrigatória.' });
      return;
    }
    res.locals.uid = user.uid;
    next();
  })().catch(next));

  router.get('/:itemId', route(async (req, res) => {
    const after = req.query.after === undefined ? undefined : id(req.query.after);
    res.json(await options.store().list(res.locals.uid, id(req.params.itemId), after));
  }));
  router.get('/:itemId/:attachmentId', route(async (req, res) => {
    const content = await options.store().download(res.locals.uid, id(req.params.itemId), id(req.params.attachmentId));
    res.set('Content-Disposition', 'attachment; filename="' + content.name + '"');
    res.type(content.mimeType).send(content.bytes);
  }));
  router.post('/:itemId', express.json({ limit: base64Limit + 8192 }), route(async (req, res) => {
    const { base64, name, editing, expectedAttachment } = req.body ?? {};
    if (typeof base64 !== 'string' || !base64.length || base64.length > base64Limit || base64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || typeof name !== 'string' || !name || name.length > 255 ||
      typeof editing !== 'boolean' || typeof expectedAttachment !== 'string') {
      throw new ComplianceFileError(400, 'Escolha um PDF, PNG, JPEG ou DOCX de até 10 MB.');
    }
    const row = await options.store().saveVersion(res.locals.uid, actor(req.body.actor), id(req.params.itemId), editing,
      expectedAttachment ? id(expectedAttachment) : '', draftOf(req.body.draft), name, Buffer.from(base64, 'base64'));
    res.status(201).json(row);
  }));
  router.post('/:itemId/:attachmentId/remove', express.json({ limit: '1kb' }), route(async (req, res) => {
    await options.store().remove(res.locals.uid, actor(req.body?.actor), id(req.params.itemId), id(req.params.attachmentId));
    res.sendStatus(204);
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof ComplianceFileError) res.status(error.status).json({ error: error.message });
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      res.status(413).json({ error: 'Anexe um arquivo de até 10 MB.' });
    } else if (error instanceof SyntaxError) res.status(400).json({ error: 'Arquivo ou dados inválidos.' });
    else res.status(500).json({ error: 'Não foi possível concluir a operação. Confira o documento e tente novamente.' });
  });
  return router;
}
