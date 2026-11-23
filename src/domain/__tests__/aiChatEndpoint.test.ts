import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import {
  createApiApp,
  DEFAULT_GEMINI_MODEL,
  getConfiguredGeminiModel,
} from '../../../server.ts';

async function withTestServer(
  options: Parameters<typeof createApiApp>[0],
  fn: (baseUrl: string) => Promise<void>,
) {
  const app = createApiApp(options);
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const addr = server.address() as AddressInfo;
    await fn(`http://127.0.0.1:${addr.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('getConfiguredGeminiModel defaults to valid model and respects GEMINI_MODEL', () => {
  assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-4-hydrogen');
  assert.equal(getConfiguredGeminiModel(''), 'gemini-4-hydrogen');
  assert.equal(getConfiguredGeminiModel('gemini-4-neon'), 'gemini-4-neon');
});

test('POST /api/ai/chat returns 401 when missing Authorization header', async () => {
  await withTestServer(
    {
      verifyIdToken: async () => ({ email: 'empresa@pilotis.com.br', email_verified: true }),
      generateContent: async () => 'ok',
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'Qual o saldo?' }),
      });
      assert.equal(res.status, 401);
    },
  );
});

test('POST /api/ai/chat returns 401 for invalid token, wrong email, or unverified email', async () => {
  await withTestServer(
    {
      authorizedCompanyEmail: 'empresa@pilotis.com.br',
      verifyIdToken: async (token) => {
        if (token === 'wrong-email') {
          return { email: 'outro@gmail.com', email_verified: true };
        }
        if (token === 'unverified') {
          return { email: 'empresa@pilotis.com.br', email_verified: false };
        }
        throw new Error('Invalid token');
      },
      generateContent: async () => 'ok',
    },
    async (baseUrl) => {
      for (const token of ['bad', 'wrong-email', 'unverified']) {
        const res = await fetch(`${baseUrl}/api/ai/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ question: 'Qual o saldo?' }),
        });
        assert.equal(res.status, 401, `Expected 401 for token=${token}`);
      }
    },
  );
});

test('POST /api/ai/chat succeeds with verified company token and strips sensitive fields', async () => {
  let capturedContents = '';
  let capturedModel = '';

  await withTestServer(
    {
      authorizedCompanyEmail: 'empresa@pilotis.com.br',
      geminiModel: 'gemini-4-hydrogen',
      verifyIdToken: async (token) => {
        assert.equal(token, 'valid-company-token');
        return { email: 'EMPRESA@pilotis.com.br', email_verified: true };
      },
      generateContent: async ({ model, contents }) => {
        capturedModel = model;
        capturedContents = contents;
        return 'Resposta baseada nos dados.';
      },
    },
    async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-company-token',
        },
        body: JSON.stringify({
          mode: 'Analista',
          question: 'Quem está sem obra alocada atualmente?',
          contextSnapshot: {
            colaboradoresAlocacao: [
              {
                nome: 'Carlos',
                funcao: 'Pedreiro',
                vinculo: 'CLT',
                obraAtual: 'Sem alocação',
                baseSalary: 4200,
                cpf: '000.000.000-00',
                asoValidade: '2026-12-30',
              },
            ],
            conformidade: [{ titulo: 'CND Secreta', fileName: 'secret.pdf' }],
          },
        }),
      });
      assert.equal(res.status, 200);
      const data = (await res.json()) as { answer?: string };
      assert.equal(data.answer, 'Resposta baseada nos dados.');
      assert.equal(capturedModel, 'gemini-4-hydrogen');
      assert.ok(capturedContents.includes('Carlos'));
      assert.equal(capturedContents.includes('4200'), false);
      assert.equal(capturedContents.includes('000.000.000-00'), false);
      assert.equal(capturedContents.includes('2026-12-30'), false);
      assert.equal(capturedContents.includes('CND Secreta'), false);
    },
  );
});

test('POST /api/ai/chat rejects payloads larger than 200 KB with 413', async () => {
  await withTestServer(
    {
      authorizedCompanyEmail: 'empresa@pilotis.com.br',
      verifyIdToken: async () => ({ email: 'empresa@pilotis.com.br', email_verified: true }),
      generateContent: async () => 'ok',
    },
    async (baseUrl) => {
      const oversizedPadding = 'x'.repeat(210 * 1024);
      const res = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-company-token',
        },
        body: JSON.stringify({
          question: 'Qual o saldo?',
          contextSnapshot: { padding: oversizedPadding },
        }),
      });
      assert.equal(res.status, 413);
    },
  );
});

test('POST /api/ai/chat enforces 20 requests per minute rate limit with 429', async () => {
  const fixedNow = 1_700_000_000_000;
  await withTestServer(
    {
      authorizedCompanyEmail: 'empresa@pilotis.com.br',
      verifyIdToken: async () => ({ email: 'empresa@pilotis.com.br', email_verified: true }),
      generateContent: async () => 'ok',
      rateLimitMax: 20,
      rateLimitWindowMs: 60_000,
      now: () => fixedNow,
    },
    async (baseUrl) => {
      for (let i = 1; i <= 20; i++) {
        const res = await fetch(`${baseUrl}/api/ai/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-company-token',
          },
          body: JSON.stringify({ question: 'Qual o saldo?' }),
        });
        assert.equal(res.status, 200, `Request #${i} should succeed`);
      }

      const blocked = await fetch(`${baseUrl}/api/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-company-token',
        },
        body: JSON.stringify({ question: 'Qual o saldo?' }),
      });
      assert.equal(blocked.status, 429);
    },
  );
});
