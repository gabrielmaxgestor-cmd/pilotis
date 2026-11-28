import { randomBytes } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { isValidISODate } from '../domain/formatters.ts';
import { planningTodayISO } from '../domain/pilotisAdapters.ts';
import { REPORT_PHOTO_LIMIT } from '../domain/workReport.ts';
import type { ActorRole } from '../types/pilotis.ts';
import { WorkReportError, reportIdPattern, shareTokenPattern, type WorkReportStore } from './workReportStore.ts';

type Options = {
  store: () => WorkReportStore;
  authorizedEmail: string;
  verifyToken: (token: string) => Promise<{ uid?: string; email?: string; email_verified?: boolean }>;
};

function privateHeaders(res: Response) {
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
}

export function showSharedWorkReport(_req: Request, res: Response) {
  const nonce = randomBytes(18).toString('base64url');
  privateHeaders(res);
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'nonce-" + nonce +
    "'; style-src 'nonce-" + nonce + "'; connect-src 'self'; frame-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  res.status(200).type('html').send(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Relatório de andamento da obra</title><style nonce="' + nonce + '">' +
    'body{background:#f6f5f2;color:#14181f;font:16px system-ui,sans-serif;margin:0}main{max-width:1050px;margin:auto;padding:1rem}' +
    'h1{font-size:1.35rem;margin:.25rem 0 1rem}a{display:inline-block;color:#1f3a5f;padding:.55rem 0}a:focus-visible{outline:2px solid #1f3a5f}' +
    'iframe{border:1px solid #d7d2c9;width:100%;height:78vh;background:white;box-sizing:border-box}</style>' +
    '<main><h1>Relatório de andamento da obra</h1><p id="status" role="status">Carregando relatório…</p>' +
    '<div id="view" hidden><a id="open" target="_blank" rel="noopener noreferrer">Abrir PDF</a>' +
    '<iframe title="Relatório de andamento em PDF" id="pdf"></iframe></div></main>' +
    '<script nonce="' + nonce + '">' +
    "const status = document.getElementById('status');" +
    "const unavailable = 'Este link está indisponível, expirou ou foi revogado.';" +
    "const token = location.hash.slice(1);" +
    "if (!/^[A-Za-z0-9_-]{43}$/.test(token)) status.textContent = unavailable;" +
    "else fetch('/api/work-reports/public', {method:'POST',credentials:'omit',cache:'no-store'," +
    "headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})" +
    ".then(response=>{if (!response.ok) throw Error();return response.blob()})" +
    ".then(blob=>{const url=URL.createObjectURL(blob);document.getElementById('open').href=url;" +
    "document.getElementById('pdf').src=url;document.getElementById('view').hidden=false;status.remove()})" +
    ".catch(()=>{status.textContent=unavailable});" +
    '</script></html>');
}

function route(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => void handler(req, res).catch(next);
}

function id(value: unknown) {
  if (typeof value !== 'string' || !reportIdPattern.test(value)) throw new WorkReportError(400, 'Registro inválido.');
  return value;
}

function registeredBy(value: unknown): ActorRole {
  if (value === 'Sócio' || value === 'Responsável administrativo') return value;
  throw new WorkReportError(400, 'Informe quem registrou a ação.');
}

function sendPdf(res: Response, bytes: Buffer, disposition: 'attachment' | 'inline') {
  res.set('Content-Disposition', disposition + '; filename="relatorio-de-andamento.pdf"');
  res.status(200).type('application/pdf').send(bytes);
}

export function createWorkReportRouter(options: Options) {
  const router = express.Router();
  router.use((_req, res, next) => { privateHeaders(res); next(); });

  router.post('/public', express.json({ limit: '1kb' }), route(async (req, res) => {
    const token = req.body?.token;
    const pdf = typeof token === 'string' && shareTokenPattern.test(token) ? await options.store().publicPdf(token) : null;
    if (!pdf) res.status(404).json({ error: 'Relatório indisponível.' });
    else sendPdf(res, pdf, 'inline');
  }));

  router.use('/projects/:projectId', (req, res, next) => void (async () => {
    const token = /^Bearer\s+(\S+)$/i.exec(req.get('Authorization')?.trim() ?? '')?.[1];
    const user = token ? await options.verifyToken(token).catch(() => null) : null;
    if (!user?.uid || !reportIdPattern.test(user.uid) || user.email_verified !== true ||
      user.email?.trim().toLowerCase() !== options.authorizedEmail) {
      res.status(401).json({ error: 'Conta autorizada obrigatória.' });
      return;
    }
    res.locals.uid = user.uid;
    res.locals.projectId = id(req.params.projectId);
    next();
  })().catch(next));

  const projectPath = '/projects/:projectId';
  router.get(projectPath, route(async (req, res) => {
    const cursor = req.query.after === undefined ? undefined : id(req.query.after);
    res.json(await options.store().list(res.locals.uid, res.locals.projectId, cursor));
  }));
  router.post(projectPath + '/approvals', express.json({ limit: '2kb' }), route(async (req, res) => {
    const actor = registeredBy(req.body?.actor);
    const { title, dueDate, approvedAt, approvalId } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim() || title.trim().length > 160 ||
      typeof dueDate !== 'string' || (dueDate && !isValidISODate(dueDate)) ||
      typeof approvedAt !== 'string' || (approvedAt && (!isValidISODate(approvedAt) || approvedAt > planningTodayISO()))) {
      throw new WorkReportError(400, 'Confira a aprovação, o prazo e a data da resposta.');
    }
    await options.store().saveApproval(res.locals.uid, actor, res.locals.projectId,
      { id: approvalId ? id(approvalId) : '', title: title.trim(), dueDate, approvedAt });
    res.sendStatus(204);
  }));
  router.post(projectPath, express.json({ limit: '200kb' }), route(async (req, res) => {
    const { month, photos, logoJpeg = '', photosAuthorized } = req.body ?? {};
    const actor = registeredBy(req.body?.actor);
    if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !Array.isArray(photos) || photos.length > REPORT_PHOTO_LIMIT ||
      typeof logoJpeg !== 'string' || logoJpeg.length > 170_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(logoJpeg)) {
      throw new WorkReportError(400, 'Confira o mês, a logo e a seleção de fotos.');
    }
    const selected = photos.map((photo) => {
      if (typeof photo?.caption !== 'string' || !photo.caption.trim() || photo.caption.trim().length > 160) {
        throw new WorkReportError(400, 'Informe uma legenda de até 160 caracteres para cada foto.');
      }
      return { logId: id(photo.logId), photoId: id(photo.photoId), caption: photo.caption.trim() };
    });
    if (new Set(selected.map(({ logId, photoId }) => logId + '/' + photoId)).size !== selected.length) {
      throw new WorkReportError(400, 'Selecione cada foto apenas uma vez.');
    }
    const created = await options.store().generate(res.locals.uid, actor, res.locals.projectId,
      month, selected, logoJpeg, photosAuthorized === true);
    res.status(201).json(created);
  }));
  router.get(projectPath + '/:reportId/pdf', route(async (req, res) => {
    const pdf = await options.store().download(res.locals.uid, res.locals.projectId, id(req.params.reportId));
    sendPdf(res, pdf, 'attachment');
  }));
  router.post(projectPath + '/:reportId/:action', express.json({ limit: '1kb' }), route(async (req, res) => {
    const action = req.params.action;
    if (action !== 'share' && action !== 'revoke' && action !== 'sent') throw new WorkReportError(404, 'Ação indisponível.');
    res.json(await options.store().change(res.locals.uid, registeredBy(req.body?.actor), res.locals.projectId,
      id(req.params.reportId), action));
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof WorkReportError) res.status(error.status).json({ error: error.message });
    else if (error instanceof SyntaxError || (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large')) {
      res.status(400).json({ error: 'Confira os dados enviados para o relatório.' });
    } else {
      res.status(500).json({ error: 'Não foi possível concluir a operação do relatório.' });
    }
  });
  return router;
}
