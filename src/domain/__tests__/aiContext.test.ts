import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAiQuestionTopics, readAiFacts, renderAiAnswer, resolveAiPeriod } from '../aiContext';
import { calcularDreObra, calcularPrevisaoCaixa } from '../pilotisAdapters';
import { formatBRL, formatPercentBR } from '../formatters';
import { simulateCommercialCash } from '../orcamentos';
import type { FinancialTransaction, PilotisDataState, Project } from '../../types/pilotis';

const today = '2026-11-25';
const audit = { ownerUid: 'pilotis', createdBy: 'Sócio' as const, updatedBy: 'Sócio' as const };
const project: Project = {
  ...audit, id: 'obra', name: 'Residência Alto', quoteId: '', clientId: '', clientName: '', type: 'Casa residencial',
  contractValue: 12000, budgetedLabor: 4000, budgetedSubcontract: 0, budgetedEquipment: 0, budgetedBdi: 0, budgetedTax: 0,
  startDate: '2026-10-08', baselineEndDate: '', forecastEndDate: '', status: 'Em execução', contractSigned: true, warrantyStartDate: '',
};
function movement(id: string, options: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    ...audit, id, date: '2026-11-20', dueDate: '2026-10-01', description: 'Comprovante confidencial', projectId: 'obra', projectName: project.name,
    entryKind: 'income', category: 'Recebimento', amount: 5000, isForecast: false, status: 'Recebido', invoiceStatus: 'A emitir',
    paymentMethod: '', installmentLabel: '', quoteId: '', debtId: '', source: 'manual', ...options,
  };
}
function company(overrides: Partial<PilotisDataState> = {}): PilotisDataState {
  return {
    settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], dailyLogs: [], transactions: [],
    debts: [], employees: [], allocations: [], pops: [], complianceItems: [], tenders: [], warrantyCalls: [], auditLogs: [], ...overrides,
  };
}

test('usa DRE e projeção do Financeiro com as mesmas bases e cita os registros', () => {
  const base = company({ projects: [project], transactions: [
    movement('tx-recebida', {}), movement('tx-paga', { entryKind: 'expense', category: 'Folha', status: 'Pago', amount: 2000 }),
    movement('tx-emprestimo', { entryKind: 'loan', status: 'Não é receita', amount: 3100 }),
    movement('tx-prevista', { isForecast: true, status: 'A vencer', dueDate: '2026-12-10' }),
  ] });
  const question = 'Qual a margem realizada da Residência Alto?';
  const facts = readAiFacts(base, question, today, classifyAiQuestionTopics(question, false));
  const dre = calcularDreObra(project, base.transactions, base.stages);
  const margin = facts.find((fact) => fact.label === 'Margem realizada da obra');
  assert.equal(margin?.value, formatPercentBR(dre.margemRealizadaPct));
  assert.equal(margin?.source.subject, project.name);
  assert.ok(margin?.source.records.includes('tx-recebida'));
  assert.equal(facts.find((fact) => fact.label === 'Receita realizada da obra')?.value, formatBRL(dre.receita.realizado));
  const cashQuestion = 'Quanto entra e sai nos próximos 5 meses?';
  const cash = readAiFacts(base, cashQuestion, today, classifyAiQuestionTopics(cashQuestion, false));
  const projection = calcularPrevisaoCaixa(base, 5, today).meses;
  assert.deepEqual(cash.filter(({ label }) => label.startsWith('Entradas contratadas')).map(({ value }) => value), projection.map((row) => formatBRL(row.contratadoEntradas)));
  assert.deepEqual(cash.filter(({ label }) => label.startsWith('Saídas totais')).map(({ value }) => value), projection.map((row) => formatBRL(row.saidasTotais)));
  assert.equal(JSON.stringify(facts).includes('Comprovante confidencial'), false);
});

test('aceita somente IDs de fatos calculados e mantém sugestões fora do modo Analista', () => {
  const base = company({ transactions: [movement('real', {})] });
  const question = 'Como está o caixa?';
  const topics = classifyAiQuestionTopics(question, false);
  const facts = readAiFacts(base, question, today, topics);
  const fact = facts.find((row) => row.source.module === 'Financeiro · Fluxo de caixa')!;
  const malicious = { factIds: ['inexistente', fact.id, fact.id], suggestionIds: ['simulator', 'pilotis-external'], answer: 'Valor inventado' };
  const analyst = renderAiAnswer(malicious, facts, 'Analista', question, false);
  assert.deepEqual(analyst.facts, [fact]);
  assert.deepEqual(analyst.suggestions, []);
  assert.doesNotMatch(JSON.stringify(analyst), /Valor inventado/);
  assert.deepEqual(renderAiAnswer(malicious, facts, 'Consultor', question, false).suggestions, ['simulator']);
  assert.match(renderAiAnswer({}, [], 'Analista', 'Qual a obrigação trabalhista?', false).text, /Não há dados/);
  assert.equal(renderAiAnswer({}, [], 'Analista', 'Qual a obrigação trabalhista?', false).guidance, true);
});

test('usa data do recebimento para notas e separa previsto de realizado', () => {
  const question = 'Quanto foi recebido sem nota neste mês?';
  const topics = classifyAiQuestionTopics(question, false);
  const rows = [movement('real', { amount: 1200 }), movement('outra-data', { date: '2026-10-30', amount: 100 }),
    movement('previsto', { isForecast: true, status: 'A vencer', amount: 999999 })];
  const facts = readAiFacts(company({ transactions: rows }), question, today, topics);
  const total = facts.find(({ label }) => label === 'Total recebido sem nota emitida')!;
  assert.equal(total.value, formatBRL(1200));
  assert.deepEqual(total.source.records, ['real']);
  assert.deepEqual(resolveAiPeriod('e no mês passado?', today), { start: '2026-10-01', end: '2026-10-31' });
  assert.deepEqual(resolveAiPeriod('entre 01/11/2026 e 10/11/2026', today), { start: '2026-11-01', end: '2026-11-10' });
});

test('simula só no modo Consultor e com valor de uma obra ou orçamento cadastrado', () => {
  const question = 'Simule a Residência Alto com 20% de entrada e 5 parcelas';
  const topics = classifyAiQuestionTopics(question, false);
  const base = company({ projects: [project] });
  const scenario = readAiFacts(base, question, today, topics, '', 'Consultor').filter(({ label }) => label.startsWith('Cenário simulado'));
  const expected = simulateCommercialCash({ valorTotal: project.contractValue, entradaPct: 20, nParcelas: 5, dataInicio: today });
  assert.equal(scenario.find(({ label }) => label.includes('parcela mensal média'))?.value, formatBRL(expected.parcelaMensalMedia));
  assert.equal(readAiFacts(company(), question, today, topics, '', 'Consultor').length, 0);
  assert.equal(readAiFacts(base, question, today, topics).some(({ label }) => label.startsWith('Cenário simulado')), false);
});

test('banco vazio não converte valores ausentes em zero no resumo semanal', () => {
  assert.deepEqual(readAiFacts(company(), '', today, classifyAiQuestionTopics('', true)), []);
});
