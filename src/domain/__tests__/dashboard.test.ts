import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularPainelDashboard } from '../dashboard';
import { calcularPrevisaoCaixa } from '../pilotisAdapters';
import type { ComplianceItem, FinancialTransaction, Installment, PilotisDataState, Project, ProjectStage, Quote } from '../../types/pilotis';

const today = '2026-11-25';
const audit = { ownerUid: 'pilotis', createdBy: 'Sócio' as const, updatedBy: 'Sócio' as const };

function data(overrides: Partial<PilotisDataState> = {}): PilotisDataState {
  return {
    settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], dailyLogs: [], transactions: [],
    debts: [], employees: [], allocations: [], pops: [], complianceItems: [], tenders: [], warrantyCalls: [], auditLogs: [],
    ...overrides,
  };
}

function transaction(id: string, override: Partial<FinancialTransaction> = {}): FinancialTransaction {
  return {
    ...audit, id, date: '2026-11-24', dueDate: '2026-11-24', description: id, entryKind: 'income',
    projectId: 'Empresa', projectName: 'Empresa', category: 'Recebimento', amount: 1000, isForecast: false, status: 'Recebido',
    invoiceStatus: 'A emitir', paymentMethod: '', installmentLabel: '', quoteId: '', debtId: '', source: 'manual', ...override,
  };
}
function installment(id: string, dueDate: string, amount: number): Installment {
  return {
    ...audit, id, dueDate, amount, number: 1, label: id, projectId: 'obra', projectName: 'Obra', quoteId: 'orc',
    clientId: 'cliente', clientName: '', status: 'A vencer', invoiceStatus: 'A emitir', receivedDate: '', transactionId: '',
  };
}
function project(id: string, override: Partial<Project> = {}): Project {
  return {
    ...audit, id, name: id, quoteId: '', clientId: '', clientName: '', type: 'Casa residencial',
    contractValue: 8000, budgetedLabor: 0, budgetedSubcontract: 0, budgetedEquipment: 0, budgetedBdi: 0, budgetedTax: 0,
    startDate: '2026-12-11', baselineEndDate: '', forecastEndDate: '2027-01-13', status: 'Contratada',
    contractSigned: false, warrantyStartDate: '', ...override,
  };
}

test('banco vazio não tem valores para KPIs, projeção ou carteira', () => {
  const empty = calcularPainelDashboard(data(), today);
  assert.equal(empty.isEmpty, true);
  assert.equal(empty.canConfirmQuote, false);
  assert.deepEqual([
    empty.metrics.saldoRealizadoCaixa, empty.metrics.aReceber30Dias, empty.metrics.resultadoMes, empty.metrics.obrasAtivasQtd,
    empty.currentMonthBalance,
  ], [null, null, null, null, null]);
  assert.deepEqual([empty.projection, empty.work, empty.alerts, empty.coverage], [[], [], [], []]);
});

test('os KPIs reagem aos registros e a projeção preserva os saldos do Financeiro', () => {
  const base = data({
    transactions: [
      transaction('recebimento'),
      transaction('empréstimo', { entryKind: 'loan', status: 'Não é receita', amount: 500 }),
      transaction('pagamento', { entryKind: 'expense', status: 'Pago', amount: 200 }),
      transaction('despesa prevista', { entryKind: 'expense', status: 'A vencer', isForecast: true, amount: 2500, dueDate: '2026-12-15' }),
    ],
    installments: [installment('vencida', '2026-11-20', 100), installment('30 dias', '2026-12-25', 700), installment('31 dias', '2026-12-26', 90)],
    projects: [project('contratada'), project('concluída', { status: 'Concluída' })],
  });
  const panel = calcularPainelDashboard(base, today);
  assert.equal(panel.isEmpty, false);
  assert.deepEqual(
    [panel.metrics.saldoRealizadoCaixa, panel.metrics.aReceber30Dias, panel.metrics.resultadoMes, panel.metrics.obrasAtivasQtd],
    [1300, 800, 800, 1],
  );
  assert.equal(panel.metrics.aReceberAtrasoQtd, 1);
  const forecast = calcularPrevisaoCaixa(base, 6, today);
  assert.deepEqual(panel.projection, forecast.meses.slice(1));
  assert.deepEqual(panel.projection.map((row) => row.mesKey), ['2026-12', '2027-01', '2027-02', '2027-03', '2027-04']);
  assert.equal(panel.projection[0].contratadoEntradas, 790);
  assert.ok(panel.projection[0].negativo);
  assert.equal(panel.currentMonthBalance, forecast.meses[0].saldoProjetado);
  assert.deepEqual(
    panel.alerts.filter((alert) => alert.categoria === 'caixa').map((alert) => alert.id),
    forecast.mesesNegativos.map((key) => 'caixa-negativo-' + key),
  );
});

test('carteira futura cruza datas de obras ativas e não usa expectativa do funil como contrato', () => {
  const quote = { id: 'proposta', status: 'Em negociação', totalValue: 20000, probabilityPct: 50, installmentsCount: 5,
    downPaymentPct: 0, code: 'OR-1', title: 'Proposta em negociação' } as Quote;
  const base = data({
    projects: [
      project('residência'),
      project('satélite', { startDate: '2027-04-01', forecastEndDate: '', baselineEndDate: '2027-05-01', status: 'Em execução' }),
      project('encerrada', { startDate: '2027-03-01', forecastEndDate: '2027-03-31', status: 'Concluída' }),
    ],
    quotes: [quote],
  });
  const panel = calcularPainelDashboard(base, today);
  assert.deepEqual(panel.coverage.map((row) => row.status), ['covered', 'covered', 'uncovered', 'uncovered', 'covered']);
  assert.equal(panel.canConfirmQuote, true);
  assert.equal(panel.funnel.valorFunil, 20000);
  assert.ok(panel.projection.some((month) => month.funilPonderadoEntradas > 0));
  assert.equal(panel.projection.some((month) => month.contratadoEntradas > 0), false);

  const unfinishedSchedule = calcularPainelDashboard(data({ projects: [
    project('obra sem prazo', { startDate: '2027-02-08', forecastEndDate: '' }),
  ] }), today);
  assert.deepEqual(unfinishedSchedule.coverage.map((row) => row.status), ['uncovered', 'uncovered', 'covered', 'unknown', 'unknown']);
});

test('atrasos do cronograma e alertas de tributos, certidões e garantia usam seus registros de origem', () => {
  const stage: ProjectStage = {
    ...audit, id: 'etapa', projectId: 'obra', wbsCode: '1.1', phase: 'Execução', name: 'Etapa em execução', responsible: '',
    durationWeeks: 1, startWeek: 0, baselineStartWeek: 0, baselineDurationWeeks: 1, progressPct: 40, budgetedCost: 2000,
    popId: '', dependsOn: [], isMilestone: false, status: 'Em andamento', materialExpectedDate: '', delayCategory: '', delayJustification: '',
    checklistCompleted: [],
  };
  const certificate: ComplianceItem = {
    ...audit, id: 'certidão', kind: 'Certidão', title: 'Certidão estadual', category: 'Estadual', projectId: '', projectName: '',
    competence: '', dueDate: '2026-11-28', issuedDate: '2026-11-10', fileName: '', mandatory: true, status: 'Válida', notes: '',
  };
  const panel = calcularPainelDashboard(data({
    projects: [project('obra', { startDate: '2026-11-17', status: 'Em execução' })],
    stages: [stage],
    complianceItems: [certificate],
    transactions: [transaction('guia', { entryKind: 'expense', category: 'Tributos', status: 'A vencer', isForecast: true })],
    warrantyCalls: [{ ...audit, id: 'chamado', projectId: 'entregue', projectName: '', description: 'Chamado do cliente',
      openedDate: '2026-11-19', deadlineDate: '2026-11-24', status: 'Em atendimento', cost: 0 }],
  }), today);
  assert.equal(panel.work[0].progress, 40);
  assert.equal(panel.work[0].delayedStagesCount, 1);
  assert.equal(panel.work[0].nextStage, stage.name);
  assert.equal(panel.work[0].completion, '2026-11-24');
  assert.match(panel.alerts.find((row) => row.referenciaId === stage.id)?.mensagem ?? '', /1 dia/);
  for (const [categoria, referenciaId] of [['tributo', 'guia'], ['certidao', 'certidão'], ['garantia', 'chamado']]) {
    assert.ok(panel.alerts.some((alert) => alert.categoria === categoria && alert.referenciaId === referenciaId));
  }
});
