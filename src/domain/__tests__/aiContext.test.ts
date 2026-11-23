import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyAiQuestionTopics,
  sanitizeAiContextSnapshot,
} from '../aiContext.ts';

const SAMPLE_FULL_CONTEXT = {
  resumoExecutivo: {
    cashBalance: 120000,
    forecastMonthEndCash: 150000,
    receivables30Days: 45000,
    receivables30Count: 2,
    overdueReceivablesCount: 0,
    monthResult: 30000,
    averageMarginPct: 18.5,
    activeProjectsCount: 2,
    negotiatingQuotesCount: 1,
    unissuedInvoicesAmount: 0,
  },
  fluxoCaixaProjetado5Meses: [
    {
      monthKey: '2026-11',
      label: 'nov/2026',
      contractedIn: 50000,
      funnelWeightedIn: 10000,
      realizedIn: 20000,
      outflows: 35000,
      provisionsIncluded: 4000,
      projectedBalance: 135000,
      projectedBalanceWithFunnel: 145000,
      isNegative: false,
    },
  ],
  folhaEquipe: {
    totalHeadcount: 4,
    cltCount: 3,
    otherCount: 1,
    recurringNonCltCount: 1,
    basePayroll: 16000,
    chargesTotal: 4500,
    provisionsTotal: 2500,
    totalMonthlyCost: 23000,
    paramsConfigured: true,
  },
  dividasResumo: {
    totalBalance: 25000,
    overdueTaxesBalance: 0,
    monthlyCommitment: 2500,
    nextDueDate: '2026-12-10',
    activeCount: 1,
  },
  obras: [
    {
      nome: 'Casa Jardim Botânico',
      tipo: 'Casa residencial',
      status: 'Em execução',
      valorContrato: 900000,
      clientName: 'Cliente Privado',
      dre: {
        revenueBudgeted: 900000,
        revenueRealized: 300000,
        marginRealized: 60000,
        marginRealizedPct: 20,
      },
    },
  ],
  etapasEmAndamentoOuAtrasadas: [
    {
      obraId: 'p1',
      codigo: '01.01',
      etapa: 'Fundação',
      status: 'Em andamento',
      progressoPct: 60,
      atrasoCategoria: '',
      atrasoJustificativa: '',
    },
  ],
  orcamentosAbertos: [
    {
      codigo: 'ORC-01',
      titulo: 'Reforma Centro',
      tipo: 'Reforma',
      cliente: 'Fulano da Silva',
      valor: 180000,
      probabilidadePct: 60,
      status: 'Em negociação',
    },
  ],
  colaboradoresResumo: [
    {
      nome: 'João Pedro',
      funcao: 'Mestre de obras',
      vinculo: 'CLT',
      obraAtual: 'Sem alocação',
      baseSalary: 5800,
      cpf: '123.456.789-00',
      asoValidade: '2027-01-10',
      nr18Validade: '2026-12-15',
      nr35Validade: '2027-02-01',
      paymentMethod: 'PIX',
    },
  ],
  conformidade: [
    {
      tipo: 'Certidão',
      titulo: 'CND Federal',
      vencimento: '2026-11-28',
      status: 'Vence em breve',
      obra: 'Empresa',
      fileName: 'cnd_secreta_2026.pdf',
      notes: 'Observação interna confidencial',
    },
  ],
  prontidaoLicitacoesPct: 85,
  recebimentosSemNota: [
    {
      descricao: 'Parcela 1',
      valor: 25000,
      vencimento: '2026-11-30',
      receiptRef: 'comp-123.pdf',
    },
  ],
};

test('cashflow question sends only executive and cashflow data', () => {
  const topics = classifyAiQuestionTopics('Quanto entra e sai nos próximos 5 meses?', false);
  assert.ok(topics.has('cashflow'));
  assert.ok(!topics.has('team_allocation'));
  assert.ok(!topics.has('compliance'));

  const sanitized = sanitizeAiContextSnapshot(
    SAMPLE_FULL_CONTEXT,
    'Quanto entra e sai nos próximos 5 meses?',
    false,
  );
  assert.ok('resumoExecutivo' in sanitized);
  assert.ok('fluxoCaixaProjetado5Meses' in sanitized);
  assert.equal('colaboradoresAlocacao' in sanitized, false);
  assert.equal('conformidade' in sanitized, false);
  assert.equal('orcamentosAbertos' in sanitized, false);
  assert.equal('obras' in sanitized, false);
});

test('certidoes question sends only compliance without fileName or notes', () => {
  const sanitized = sanitizeAiContextSnapshot(
    SAMPLE_FULL_CONTEXT,
    'Quais certidões vencem este mês?',
    false,
  );
  assert.ok(Array.isArray(sanitized.conformidade));
  assert.equal('fluxoCaixaProjetado5Meses' in sanitized, false);
  assert.equal('colaboradoresAlocacao' in sanitized, false);

  const first = (sanitized.conformidade as Record<string, unknown>[])[0];
  assert.equal(first.titulo, 'CND Federal');
  assert.equal('fileName' in first, false);
  assert.equal('notes' in first, false);
});

test('team allocation question strips individual salary, CPF, ASO/NR docs, and payment method', () => {
  const sanitized = sanitizeAiContextSnapshot(
    SAMPLE_FULL_CONTEXT,
    'Quem está sem obra alocada atualmente?',
    false,
  );
  assert.equal('obras' in sanitized, false);
  assert.ok(Array.isArray(sanitized.colaboradoresAlocacao));
  const emp = (sanitized.colaboradoresAlocacao as Record<string, unknown>[])[0];
  assert.equal(emp.nome, 'João Pedro');
  assert.equal(emp.obraAtual, 'Sem alocação');
  assert.equal('baseSalary' in emp, false);
  assert.equal('cpf' in emp, false);
  assert.equal('asoValidade' in emp, false);
  assert.equal('nr18Validade' in emp, false);
  assert.equal('nr35Validade' in emp, false);
  assert.equal('paymentMethod' in emp, false);
});

test('project cost/margin question strips clientName and keeps DRE', () => {
  const sanitized = sanitizeAiContextSnapshot(
    SAMPLE_FULL_CONTEXT,
    'Qual o custo real e margem de cada obra?',
    false,
  );
  assert.ok(Array.isArray(sanitized.obras));
  const obra = (sanitized.obras as Record<string, unknown>[])[0];
  assert.equal(obra.nome, 'Casa Jardim Botânico');
  assert.equal('clientName' in obra, false);
  assert.ok(obra.dre);
});
