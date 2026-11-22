import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

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

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.post('/api/ai/chat', async (req, res) => {
    try {
      const body = (req.body || {}) as AiRequestBody;
      const mode = body.mode === 'Consultor' ? 'Consultor' : 'Analista';
      const isWeeklySummary = Boolean(body.isWeeklySummary);
      const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1200) : '';

      if (!isWeeklySummary && !question) {
        res.status(400).json({ error: 'Informe uma pergunta para consultar a IA Operacional.' });
        return;
      }

      const ai = getGeminiClient();
      const contextJson = JSON.stringify(body.contextSnapshot ?? {}, null, 2).slice(0, 60000);
      const userPrompt = isWeeklySummary
        ? `Gere o resumo semanal operacional com base apenas neste retrato atual do sistema:\n\n${contextJson}`
        : `Pergunta do gestor: "${question}"\n\nRetrato atual dos dados reais do sistema:\n${contextJson}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: userPrompt,
        config: {
          systemInstruction: buildSystemInstruction(mode, isWeeklySummary),
        },
      });

      const answer = response.text?.trim();
      if (!answer) {
        res.status(502).json({ error: 'A IA não retornou resposta textual. Tente novamente.' });
        return;
      }

      res.json({ answer });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro interno ao consultar a IA Operacional.';
      console.error('AI Operacional error:', message);
      res.status(500).json({ error: message });
    }
  });

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
    console.log(`Pilotis server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Pilotis server:', err);
  process.exit(1);
});
