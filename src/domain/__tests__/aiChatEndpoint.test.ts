import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApiApp, runScheduledAiSummary, getConfiguredGeminiModel, DEFAULT_GEMINI_MODEL, MAX_AI_BODY_BYTES } from '../../../server.ts';
import type { AiTurn } from '../aiContext';
import type { PilotisDataState } from '../../types/pilotis';
import type { AiStore, StoredAiTurn } from '../../server/aiStore';

function memoryStore(overrides: Partial<PilotisDataState> = {}) {
  const results = new Map<string, Map<string, AiTurn>>();
  const reads: string[] = [];
  const store: AiStore = {
    async read(uid) {
      reads.push(uid);
      return {
        settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], dailyLogs: [], transactions: [],
        debts: [], employees: [], allocations: [], pops: [], complianceItems: [], tenders: [], warrantyCalls: [], auditLogs: [],
        ...overrides,
      };
    },
    async history(uid) { return [...(results.get(uid)?.values() ?? [])]; },
    async find(uid, id) { return results.get(uid)?.get(id); },
    async save(uid: string, id: string, turn: StoredAiTurn) {
      const rows = results.get(uid) ?? new Map();
      results.set(uid, rows);
      if (!rows.has(id)) rows.set(id, { id, ...turn });
      return rows.get(id)!;
    },
  };
  return { store, reads };
}

const EMAIL = 'gabrielmaxgestor@gmail.com';
const base = {
  authorizedCompanyEmail: EMAIL,
  now: () => Date.parse('2026-11-25T12:00:00Z'),
  verifyIdToken: async (token: string) => ({
    uid: token, email: token === 'foreign' ? 'foreign@pilotis.com.br' : EMAIL, email_verified: token !== 'unverified',
  }),
};
const postBody = (options: object = {}) => ({ question: 'Como está o caixa?', registeredBy: 'Sócio', ...options });
async function withServer(options: Parameters<typeof createApiApp>[0], run: (call: (method: string, token?: string, body?: unknown, headers?: object) => Promise<Response>) => Promise<void>) {
  const app = createApiApp({ ...base, ...options });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address() as AddressInfo;
    await run((method, token, body, headers) => fetch('http://127.0.0.1:' + port + '/api/ai/chat', {
      method,
      headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

test('rejeita token e e-mail não verificados antes de ler qualquer dado', async () => {
  const { store, reads } = memoryStore();
  await withServer({ store }, async (call) => {
    assert.equal((await call('POST', undefined, postBody())).status, 401);
    assert.equal((await call('GET', 'foreign')).status, 401);
    assert.equal((await call('POST', 'unverified', postBody())).status, 401);
  });
  assert.deepEqual(reads, []);
});

test('banco vazio ignora contexto enviado pelo navegador, salva conversa e dispensa Gemini', async () => {
  const { store, reads } = memoryStore();
  await withServer({ store, generateContent: async () => { assert.fail('Gemini não deve ser chamado sem fatos'); } }, async (call) => {
    const result = await call('POST', 'pilotis', postBody({ contextSnapshot: { cashBalance: 999999 }, ownerUid: 'foreign' }));
    assert.equal(result.status, 200);
    const { turn } = await result.json() as { turn: AiTurn };
    assert.match(turn.answer.text, /Não há dados/);
    assert.deepEqual(turn.answer.facts, []);
    assert.equal(turn.createdBy, 'Sócio');
    const history = await call('GET', 'pilotis');
    assert.match(history.headers.get('cache-control') || '', /no-store/);
    assert.equal((await history.json()).turns[0].id, turn.id);
    assert.deepEqual((await (await call('GET', 'otheruid')).json()).turns, []);
    assert.equal((await call('POST', 'otheruid', postBody({ previousTurnId: turn.id }))).status, 404);
  });
  assert.deepEqual(reads, ['pilotis']);
});

test('entrega o valor calculado com fonte, persiste sequência e trata repetição de envio', async () => {
  const { store } = memoryStore({
    debts: [{ id: 'debito', ownerUid: 'pilotis', createdBy: 'Sócio', updatedBy: 'Sócio', creditor: 'Banco', debtType: 'Empréstimo bancário',
      principalBalance: 500, monthlyCost: 50, remainingInstallments: 10, nextDueDate: '2026-12-04', status: 'Em dia', notes: 'privado' }],
  });
  let generated = 0;
  await withServer({
    store,
    generateContent: async ({ contents }) => {
      generated++;
      const { facts } = JSON.parse(contents) as { facts: Array<{ id: string; label: string }> };
      assert.doesNotMatch(contents, /privado|999999/);
      return JSON.stringify({ answer: 'R$ 999999', factIds: [facts.find((row) => row.label === 'Saldo devedor')?.id, 'inventado'], suggestionIds: [] });
    },
  }, async (call) => {
    const body = postBody({ question: 'Qual o saldo da dívida?', requestId: '00000000-0000-0000-0000-000000000001' });
    const first = await call('POST', 'pilotis', body);
    assert.equal(first.status, 200);
    const { turn } = await first.json() as { turn: AiTurn };
    assert.match(turn.answer.facts[0].value, /500,00/);
    assert.deepEqual(turn.answer.facts[0].source.records, ['debito']);
    assert.doesNotMatch(JSON.stringify(turn), /999999/);
    const repeated = await call('POST', 'pilotis', body);
    assert.equal((await repeated.json()).turn.id, turn.id);
    assert.equal(generated, 1);
    const followup = await call('POST', 'pilotis', postBody({ question: 'E o próximo vencimento?', previousTurnId: turn.id }));
    assert.equal(followup.status, 200);
    assert.equal((await followup.json()).turn.conversationId, turn.conversationId);
    assert.equal(generated, 2);
  });
});

test('limita corpo e aplica rate limit por UID autenticado', async () => {
  const { store } = memoryStore();
  await withServer({ store, rateLimitMax: 2 }, async (call) => {
    assert.equal((await call('POST', 'pilotis', { filler: 'x'.repeat(MAX_AI_BODY_BYTES) })).status, 413);
    assert.equal((await call('POST', 'pilotis', '{')).status, 400);
    const limited = await call('POST', 'pilotis', postBody(), { 'X-Forwarded-For': '203.0.113.10' });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '60');
  });
});

test('modelo padrão é configurável no servidor', () => {
  assert.equal(getConfiguredGeminiModel(' '), DEFAULT_GEMINI_MODEL);
  assert.equal(getConfiguredGeminiModel('override'), 'override');
});

test('resumo agendado exige a conta verificada e registra uma vez por semana com autoria do sistema', async () => {
  const { store, reads } = memoryStore();
  const options = {
    store, authorizedCompanyEmail: EMAIL, now: () => Date.parse('2026-11-30T11:00:00Z'),
    generateContent: async () => assert.fail('Gemini não deve ser chamado sem fatos'),
  };
  await assert.rejects(runScheduledAiSummary({
    ...options,
    findCompanyUser: async () => ({ uid: 'company', email: EMAIL, disabled: false, emailVerified: false }),
  }), /ativa e verificada/);
  assert.deepEqual(reads, []);

  const validOptions = {
    ...options,
    findCompanyUser: async (email: string) => ({ uid: 'company', email, disabled: false, emailVerified: true }),
  };
  const first = await runScheduledAiSummary(validOptions);
  const retry = await runScheduledAiSummary(validOptions);
  assert.equal(first.id, 'weekly-2026-11-30');
  assert.equal(first.createdBy, 'Sistema');
  assert.equal(first.weekly, true);
  assert.match(first.answer.text, /Não há dados/);
  assert.deepEqual(retry, first);
  assert.deepEqual(reads, ['company']);
});
