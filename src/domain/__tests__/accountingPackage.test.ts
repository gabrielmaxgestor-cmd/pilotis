import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Debt, Employee, FinancialTransaction, Installment, PilotisDataState } from '../../types/pilotis';
import { buildAccountingPackage } from '../accountingPackage';
import { calcularResumoDividas, calcularResumoFinanceiroPeriodo, calculateTeamPayroll } from '../pilotisAdapters';
import { getInvoiceReceipts, pendingInvoiceReceipts, sumPendingInvoices } from '../complianceWorkflows';
import { accountingCsv, accountingWorkbookSheets } from '../../utils/accountingPackageFiles';

const november = { start: '2026-11-01', end: '2026-11-30' };
const details = { actor: 'Sócio' as const, generatedAt: '30/11/2026, 18:00' };
const empty: PilotisDataState = {
  settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], transactions: [], debts: [],
  dailyLogs: [], employees: [], allocations: [], pops: [], complianceItems: [], tenders: [], warrantyCalls: [], auditLogs: [],
};

const movement = (id: string, amount: number, fields: Partial<FinancialTransaction> = {}) => ({
  id, amount, entryKind: 'income', status: 'Recebido', date: '2026-11-15', dueDate: '', invoiceStatus: 'Emitida',
  projectId: 'Empresa', projectName: 'Empresa', category: 'Receita de obra', description: 'Nome privado da operação',
  isForecast: false, source: 'manual', ...fields,
}) as FinancialTransaction;

test('confere caixa, recebimentos, impostos, folha e saldo devedor com os módulos de origem', () => {
  const data: PilotisDataState = {
    ...empty, transactions: [
      movement('paid-installment', 400.35, { installmentId: 'parcel', invoiceStatus: 'A emitir' }),
      movement('duplicate', 400.35, { installmentId: 'parcel', invoiceStatus: 'A emitir' }),
      movement('mirror', 400.35, { installmentId: 'parcel', isForecast: true, status: 'A vencer' }),
      movement('local', 205.17),
      movement('loan', 700, { entryKind: 'loan', status: 'Não é receita' }),
      movement('tax', 120.10, { entryKind: 'expense', status: 'Pago', category: 'Impostos' }),
      movement('payroll-payment', 40.07, { entryKind: 'expense', status: 'Pago', source: 'folha' }),
      movement('reversed', 200, { status: 'Estornado' }),
      movement('reversal', 200, { status: 'Estorno' }),
      movement('outside', 500, { date: '2026-12-01' }),
      movement('promised-tax', 35.67, { date: '2026-10-29', dueDate: '2026-11-25', entryKind: 'expense',
        status: 'A vencer', isForecast: true, category: 'Tributos' }),
    ], installments: [{
      id: 'parcel', projectId: 'Empresa', projectName: 'Empresa', clientName: 'Cliente privado', label: '01/02',
      amount: 400.35, receivedDate: '2026-11-15', dueDate: '2026-10-29', invoiceStatus: 'A emitir', status: 'Recebida',
      transactionId: 'paid-installment',
    } as Installment],
    employees: [{ id: 'privado-employee', employmentType: 'CLT', name: 'Profissional com nome privado',
      baseSalary: 1600 } as Employee],
    complianceItems: [{ id: 'guide', kind: 'Obrigação', category: 'ISS', title: 'Guia de ISS de Nome Privado',
      status: 'Pendente', competence: '11/2026', dueDate: '2026-11-24', projectId: '', notes: 'Observações privadas' } as PilotisDataState['complianceItems'][number]],
    debts: [{ id: 'loan-debt', principalBalance: 600, nextDueDate: '2026-11-30', monthlyCost: 12.5, debtType: 'Empréstimo bancário',
      creditor: 'Credor privado', status: 'Em dia', remainingInstallments: 2 } as Debt],
  };
  const result = buildAccountingPackage(data, november, details, november.end);
  assert.equal(result.hasData, true);
  const summary = new Map(result.sheets[0].rows.map(([key, _ref, amount]) => [key, amount]));
  const financial = calcularResumoFinanceiroPeriodo(data, november.end);
  assert.equal(summary.get('Receitas recebidas'), financial.entradasMes);
  assert.equal(summary.get('Despesas pagas'), financial.saidasMes);
  assert.equal(summary.get('Empréstimos recebidos'), 700);
  assert.equal(summary.get('Resultado operacional'), financial.resultadoMes);
  assert.equal(summary.get('Movimento líquido de caixa'), financial.saldoRealizadoCaixa);
  assert.equal(summary.get('Parcelas recebidas'), 400.35);
  assert.equal(summary.get('Recebimentos com nota pendente'), sumPendingInvoices(pendingInvoiceReceipts(getInvoiceReceipts(data.transactions, data.installments))));
  assert.equal(summary.get('Folha e encargos · total conhecido'), calculateTeamPayroll(data, '2026-11').totalKnown);
  assert.equal(summary.get('Tributos pagos'), financial.composicaoDespesas.rows.find((entry) => entry.key === 'taxes')?.amount);
  assert.equal(summary.get('Saldo devedor em aberto'), calcularResumoDividas(data.debts).dividaTotal);
  const transactions = result.sheets.find((sheet) => sheet.title === 'Lançamentos')!;
  assert.equal(transactions.count, 6);
  assert.equal(transactions.rows.find((row) => row[0] === 'promised-tax')?.[6], 'Previsto');
  const content = JSON.stringify(result);
  assert.doesNotMatch(content, /Cliente privado|Profissional com nome privado|Credor privado|Observações privadas|privado-employee|Nome privado da operação/);
  assert.match(content, /Não configurado/);
});

test('período vazio mantém os cabeçalhos em ambos os formatos e mostra Sem dados', () => {
  const result = buildAccountingPackage(empty, november, details, november.end);
  assert.equal(result.hasData, false);
  assert.equal(result.sheets.length, 7);
  for (const table of result.sheets) {
    assert.ok(table.rows.some((row) => row[0] === 'Sem dados'));
    assert.ok(table.rows.every((row) => row.length === table.headers.length));
    assert.match(accountingCsv(table), /^\uFEFF".+"\r\n/);
  }
  const workbook = accountingWorkbookSheets(result.sheets);
  assert.deepEqual(workbook.map((sheet) => sheet.sheet), result.sheets.map((table) => table.title));
  assert.throws(() => buildAccountingPackage(empty, { start: november.end, end: november.start }, details, november.end), /período válido/);
});

test('CSV usa decimais em português e ambos os formatos neutralizam textos que parecem fórmulas', () => {
  const table = { title: 'Lançamentos', fileName: 'lancamentos.csv', headers: ['Centro', 'Valor (R$)'],
    rows: [['  =Fórmula("x")', -1.5], ['Obra', 10]], count: 2, moneyColumns: [1] };
  assert.match(accountingCsv(table), /"'\=Fórmula\(""x""\)";-1,50\r\n"Obra";10,00/);
  const [sheet] = accountingWorkbookSheets([table]);
  assert.equal((sheet.data[1][0] as { value: string }).value, "'=Fórmula(\"x\")");
  assert.equal((sheet.data[1][1] as { value: number }).value, -1.5);
});
