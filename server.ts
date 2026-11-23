import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response, type Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { GoogleGenAI } from '@google/genai';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { sanitizeAiContextSnapshot } from './src/domain/aiContext.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
export const DEFAULT_GEMINI_MODEL = 'gemini-4-hydrogen';
export const MAX_AI_BODY_BYTES = 200 * 1024; // 200 KB
export const AI_RATE_LIMIT_MAX_REQUESTS = 20;
export const AI_RATE_LIMIT_WINDOW_MS = 60_000;

interface FirebaseAppletConfig {
  projectId?: string;
}

function loadFirebaseProjectId(): string {
  const configPath = path.resolve(__dirname, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw) as FirebaseAppletConfig;
  const projectId = parsed.projectId?.trim();
  if (!projectId || projectId === 'remixed-project-id') {
    throw new Error('Projeto Firebase não provisionado em firebase-applet-config.json.');
  }
  return projectId;
}

function getAdminAuth(): Auth {
  const app = getApps().length
    ? getApp()
    : initializeApp({ projectId: loadFirebaseProjectId() });
  return getAuth(app);
}

export function getAuthorizedCompanyEmail(override?: string): string {
  return (
    override ??
    process.env.COMPANY_EMAIL ??
    process.env.VITE_COMPANY_EMAIL ??
    'empresa@pilotis.com.br'
  )
    .trim()
    .toLowerCase();
}

export function getConfiguredGeminiModel(override?: string): string {
  const configured = (override ?? process.env.GEMINI_MODEL ?? '').trim();
  return configured || DEFAULT_GEMINI_MODEL;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Chave GEMINI_API_KEY não configurada no servidor.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface AiRequestBody {
  mode?: string;
  question?: string;
  contextSnapshot?: unknown;
  isWeeklySummary?: boolean;
}

function buildSystemInstruction(mode: string, isWeeklySummary: boolean): string {
  const baseRules = [
    'Você é a IA Operacional do Sistema de Gestão Pilotis (construtora de alto padrão em Valença/RJ).',
    'Responda sempre em português do Brasil claro, direto e profissional, usando R$ e datas dd/mm/aaaa.',
    'REGRA INVIOLÁVEL: baseie-se EXCLUSIVAMENTE nos dados JSON fornecidos no contexto do sistema.',
    'Se não houver dados suficientes ou um módulo estiver vazio, diga explicitamente "Sem dados suficientes no sistema para responder a isso" e indique o que precisa ser cadastrado. NUNCA invente números, nomes, obras, prazos ou estimativas sem lastro nos registros.',
    'Lembre-se: empréstimo nunca é receita; previsto e realizado são sempre separados; materiais de obra são comprados pelo cliente.',
    'Cite ao final as fontes exatas do contexto consultado (ex.: "Fontes: Financeiro · Lançamentos, Planejamento · Etapas").',
  ];

  if (isWeeklySummary) {
    return [
      ...baseRules,
      'Gere um resumo semanal executivo objetivo com duas seções curtas: "O que mudou / Panorama atual" e "Pontos de atenção por prioridade (Urgente, Atenção, Info)".',
      'Se a base estiver vazia, informe que ainda não há registros para gerar resumo semanal e liste os primeiros passos recomendados.',
    ].join('\n');
  }

  if (mode === 'Consultor') {
    return [
      ...baseRules,
      'Modo CONSULTOR: além de diagnosticar os números reais do contexto, apresente até 3 sugestões práticas numeradas para avaliação da gestão, conectando aos módulos do sistema (Financeiro, Orçamentos, Planejamento, Equipe, Conformidade).',
      'Deixe explícito ao final: "Estas são sugestões baseadas nos dados do sistema, não afirmações de fato. Decisões fiscais, tributárias e trabalhistas devem ser validadas com contador ou advogado."',
    ].join('\n');
  }

  return [
    ...baseRules,
    'Modo ANALISTA: responda de forma estritamente factual, objetiva e quantitativa sobre os registros reais fornecidos no contexto, sem especular.',
  ].join('\n');
}

export type VerifyIdTokenFn = (idToken: string) => Promise<Partial<DecodedIdToken>>;
export type GenerateAiAnswerFn = (params: {
  model: string;
  contents: string;
  systemInstruction: string;
}) => Promise<string | undefined>;

export interface AiChatRouterOptions {
  verifyIdToken?: VerifyIdTokenFn;
  generateContent?: GenerateAiAnswerFn;
  authorizedCompanyEmail?: string;
  geminiModel?: string;
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
  now?: () => number;
}

function getRateLimitKey(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded =
    typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]?.trim()
        : '';
  return firstForwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

export function createAiChatRouter(options: AiChatRouterOptions = {}): Router {
  const router = express.Router();
  const rateLimitMax = options.rateLimitMax ?? AI_RATE_LIMIT_MAX_REQUESTS;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? AI_RATE_LIMIT_WINDOW_MS;
  const nowFn = options.now ?? (() => Date.now());
  const hitsByClient = new Map<string, number[]>();

  const verifyIdToken: VerifyIdTokenFn =
    options.verifyIdToken ??
    (async (token: string) => {
      return getAdminAuth().verifyIdToken(token);
    });

  const generateContent: GenerateAiAnswerFn =
    options.generateContent ??
    (async ({ model, contents, systemInstruction }) => {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
        },
      });
      return response.text;
    });

  const rateLimitMiddleware = (req: Request, res: Response, next: NextFunction) => {
    const now = nowFn();
    const cutoff = now - rateLimitWindowMs;
    const key = getRateLimitKey(req);
    const activeHits = (hitsByClient.get(key) || []).filter((ts) => ts > cutoff);

    if (activeHits.length >= rateLimitMax) {
      const oldest = activeHits[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + rateLimitWindowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'Limite de 20 requisições por minuto excedido. Tente novamente em instantes.',
      });
      return;
    }

    activeHits.push(now);
    hitsByClient.set(key, activeHits);

    if (hitsByClient.size > 500) {
      for (const [k, list] of hitsByClient.entries()) {
        if (!list.some((ts) => ts > cutoff)) {
          hitsByClient.delete(k);
        }
      }
    }

    next();
  };

  const requireCompanyAuth = async (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (typeof authHeader !== 'string') {
      res.status(401).json({ error: 'Autenticação obrigatória.' });
      return;
    }

    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    const idToken = bearerMatch?.[1]?.trim();
    if (!idToken) {
      res.status(401).json({ error: 'Token de autenticação ausente ou inválido.' });
      return;
    }

    let decoded: Partial<DecodedIdToken>;
    try {
      decoded = await verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: 'Token Firebase inválido ou expirado.' });
      return;
    }

    const authorizedEmail = getAuthorizedCompanyEmail(options.authorizedCompanyEmail);
    const tokenEmail = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
    if (decoded.email_verified !== true || !tokenEmail || tokenEmail !== authorizedEmail) {
      res.status(401).json({
        error: 'Usuário não autorizado ou e-mail não verificado para acessar a IA Operacional.',
      });
      return;
    }

    next();
  };

  const rejectOversizedContentLength = (req: Request, res: Response, next: NextFunction) => {
    const rawLen = req.headers['content-length'];
    if (typeof rawLen === 'string') {
      const contentLength = Number(rawLen);
      if (Number.isFinite(contentLength) && contentLength > MAX_AI_BODY_BYTES) {
        res.status(413).json({
          error: 'Corpo da requisição excede o limite de 200 KB.',
        });
        return;
      }
    }
    next();
  };

  router.post(
    '/',
    rateLimitMiddleware,
    requireCompanyAuth,
    rejectOversizedContentLength,
    express.json({ limit: MAX_AI_BODY_BYTES }),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body || {}) as AiRequestBody;
        const mode = body.mode === 'Consultor' ? 'Consultor' : 'Analista';
        const isWeeklySummary = Boolean(body.isWeeklySummary);
        const question =
          typeof body.question === 'string' ? body.question.trim().slice(0, 1200) : '';

        if (!isWeeklySummary && !question) {
          res.status(400).json({ error: 'Informe uma pergunta para consultar a IA Operacional.' });
          return;
        }

        const model = getConfiguredGeminiModel(options.geminiModel);
        const sanitizedContext = sanitizeAiContextSnapshot(
          body.contextSnapshot,
          question,
          isWeeklySummary,
        );
        const contextJson = JSON.stringify(sanitizedContext, null, 2).slice(0, 60000);
        const userPrompt = isWeeklySummary
          ? `Gere o resumo semanal operacional com base apenas neste retrato atual do sistema:\n\n${contextJson}`
          : `Pergunta do gestor: "${question}"\n\nRetrato atual dos dados reais do sistema:\n${contextJson}`;

        const rawAnswer = await generateContent({
          model,
          contents: userPrompt,
          systemInstruction: buildSystemInstruction(mode, isWeeklySummary),
        });

        const answer = rawAnswer?.trim();
        if (!answer) {
          res.status(502).json({ error: 'A IA não retornou resposta textual. Tente novamente.' });
          return;
        }

        res.json({ answer });
      } catch (err) {
        const errObj = err as { status?: number; message?: string };
        const status = typeof errObj?.status === 'number' ? errObj.status : 500;
        const message =
          err instanceof Error
            ? err.message
            : 'Erro interno ao consultar a IA Operacional.';
        console.error('AI Operacional error:', message);
        res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
      }
    },
  );

  // Error middleware to ensure oversized/malformed payloads return clean JSON instead of HTML
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const parseErr = err as { type?: string; status?: number };
    if (parseErr?.type === 'entity.too.large' || parseErr?.status === 413) {
      res.status(413).json({
        error: 'Corpo da requisição excede o limite de 200 KB.',
      });
      return;
    }
    if (parseErr?.type === 'entity.parse.failed' || parseErr?.status === 400) {
      res.status(400).json({
        error: 'JSON inválido no corpo da requisição.',
      });
      return;
    }
    next(err);
  });

  return router;
}

export function createApiApp(options: AiChatRouterOptions = {}): express.Express {
  const app = express();
  app.use('/api/ai/chat', createAiChatRouter(options));
  return app;
}

async function startServer() {
  const app = createApiApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(
      `Pilotis server listening on http://0.0.0.0:${PORT} (model: ${getConfiguredGeminiModel()})`,
    );
  });
}

const isDirectExecution =
  typeof process.argv[1] === 'string' &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  startServer().catch((err) => {
    console.error('Failed to start Pilotis server:', err);
    process.exit(1);
  });
}
