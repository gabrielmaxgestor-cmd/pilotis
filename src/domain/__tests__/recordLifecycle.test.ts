import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FinancialTransaction, PilotisDataState, Project } from '../../types/pilotis';
import { activePilotisData, ledgerSignedAmount } from '../recordLifecycle';
import { calcularDreEmpresa, calcularIndicadoresDashboard, calcularResumoFinanceiroPeriodo } from '../pilotisAdapters';

const empty: PilotisDataState = {
  settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], transactions: [],
  debts: [], employees: [], allocations: [], pops: [], complianceItems: [], tenders: [], warrantyCalls: [],
  dailyLogs: [], auditLogs: [],
};
const day = '2027-01-20';
function movement(fields: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    id: 'original', description: 'Compra', date: day, dueDate: day, projectId: 'Empresa', projectName: '',
    amount: 125, category: 'Materiais', entryKind: 'expense', isForecast: false, status: 'Pago',
    invoiceStatus: 'Não se aplica', paymentMethod: 'Pix', installmentLabel: '', quoteId: '', debtId: '',
    source: 'manual', ownerUid: 'company', createdBy: 'Sócio', updatedBy: 'Sócio', ...fields,
  };
}

test('o par de estorno tem sinais opostos e zera caixa, resultado e DRE no período original', () => {
  const original = movement({ status: 'Estornado', reversalId: 'inverse' });
  const inverse = movement({ id: 'inverse', status: 'Estorno', reversalOfId: 'original' });
  const data = { ...empty, transactions: [original, inverse] };
  assert.equal(ledgerSignedAmount(original), -125);
  assert.equal(ledgerSignedAmount(inverse), 125);
  const finance = calcularResumoFinanceiroPeriodo(data, day);
  assert.equal(finance.saldoRealizadoCaixa, 0);
  assert.equal(finance.resultadoMes, 0);
  assert.equal(calcularIndicadoresDashboard(data, day).saldoRealizadoCaixa, 0);
  assert.equal(calcularIndicadoresDashboard(data, day).sistemaVazio, false);
  assert.equal(calcularDreEmpresa(data, '2027-01-01', '2027-01-31').custosTotais.realizado, 0);
});

test('arquivar retira a obra dos indicadores e conserva o dinheiro realizado', () => {
  const project = { id: 'obra', name: 'Reforma', status: 'Contratada', archive: { at: day, by: 'Sócio' } } as Project;
  const transaction = movement({ projectId: project.id, id: 'despesa' });
  const data = activePilotisData({ ...empty, projects: [project], transactions: [transaction] });
  assert.deepEqual(data.projects, []);
  assert.equal(calcularIndicadoresDashboard(data, day).obrasAtivasQtd, null);
  assert.equal(calcularIndicadoresDashboard(data, day).saldoRealizadoCaixa, -125);
});
