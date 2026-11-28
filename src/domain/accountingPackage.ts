import { getInvoiceReceipts, normalizeCompetence, OBLIGATION_TYPES, pendingInvoiceReceipts, sumPendingInvoices } from './complianceWorkflows';
import { resolverStatusConformidade } from './conformidade';
import { expenseGroup } from './financialCharts';
import { deduplicarReceitasEParcelas, isRealizedCashEntry, resolverStatusDivida, resolverStatusLancamento, signedCashAmount } from './financeiro';
import { addMonthsISO, formatDateBR, isValidISODate, roundCents } from './formatters';
import { calcularResumoDividas, calculateTeamPayroll, toDomainInstallments, toDomainTransactions } from './pilotisAdapters';
import type { ActorRole, PilotisDataState } from '../types/pilotis';

export const ACCOUNTING_COLLECTIONS = [
  'transactions', 'installments', 'projects', 'employees', 'allocations', 'settings', 'complianceItems', 'debts',
] as const;

type PackageRow = (string | number | null)[];
export type AccountingTable = { title: string; fileName: string; headers: string[]; rows: PackageRow[]; moneyColumns?: number[]; count: number };
export type AccountingPeriod = { start: string; end: string };
type ExportDetails = { actor: ActorRole; generatedAt: string };

const date = (value?: string) => formatDateBR(value, '');
const competence = (value: string) => value ? value.slice(5, 7) + '/' + value.slice(0, 4) : '';
const kinds = { receita: 'Receita', despesa: 'Despesa', emprestimo: 'Empréstimo' } as const;
const sum = <T>(rows: readonly T[], value: (row: T) => number) =>
  rows.reduce((cents, row) => cents + Math.round(roundCents(value(row)) * 100), 0) / 100;
const byDateAndId = (first: { data: string; id: string }, second: { data: string; id: string }) =>
  first.data.localeCompare(second.data) || first.id.localeCompare(second.id);

export function validAccountingPeriod({ start, end }: AccountingPeriod) {
  return isValidISODate(start) && isValidISODate(end) && start <= end;
}

function table(title: string, fileName: string, headers: string[], rows: PackageRow[], totals: PackageRow[] = [],
  moneyColumns?: number[]): AccountingTable {
  return { title, fileName, headers, count: rows.length, rows: rows.length ? [...rows, ...totals] :
    [['Sem dados', ...headers.slice(1).map(() => null)]], moneyColumns };
}

function payrollRows(data: PilotisDataState, period: AccountingPeriod) {
  type Result = { month: string; center: string; category: string; base: number; charges: number | null; provisions: number | null; total: number };
  const results: Result[] = [];
  if (!data.employees.length) return results;
  for (let first = period.start.slice(0, 7) + '-01'; isValidISODate(first) && first <= period.end; first = addMonthsISO(first, 1)) {
    const month = first.slice(0, 7);
    const payroll = calculateTeamPayroll(data, month);
    const groups = new Map<string, typeof payroll.lines>();
    for (const row of payroll.lines) {
      const key = row.projectId + '/' + row.category;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const { projectName: center, category } = group[0];
      results.push({ month, center, category, base: sum(group, (row) => row.base),
        charges: group.some((row) => row.charges === null) ? null : sum(group, (row) => row.charges ?? 0),
        provisions: group.some((row) => row.provisions === null) ? null : sum(group, (row) => row.provisions ?? 0),
        total: sum(group, (row) => row.amount) });
    }
  }
  return results.sort((a, b) => a.month.localeCompare(b.month) || a.center.localeCompare(b.center, 'pt-BR') || a.category.localeCompare(b.category));
}

export function buildAccountingPackage(data: PilotisDataState, period: AccountingPeriod,
  details: ExportDetails, referenceDate: string) {
  if (!validAccountingPeriod(period)) throw new Error('Informe um período válido. A data inicial deve ser anterior ou igual à final.');
  const contains = (day: string | undefined) => isValidISODate(day) && day! >= period.start && day! <= period.end;
  const projectNames = new Map(data.projects.map((project) => [project.id, project.name]));
  const center = (id: string, saved?: string) => id === 'Empresa' || !id ? 'Empresa' : projectNames.get(id) || saved || id;
  const savedCenters = new Map(data.transactions.map((row) => [row.id, row.projectName]));
  const { lancamentosUnicos } = deduplicarReceitasEParcelas(toDomainTransactions(data.transactions), toDomainInstallments(data.installments));
  const ledger = lancamentosUnicos.map((row) => ({ ...row, realized: isRealizedCashEntry(row),
    center: center(row.obraId, savedCenters.get(row.id)) }))
    .filter((row) => contains(row.realized ? row.data : row.vencimento || row.data)).sort(byDateAndId);
  const realized = ledger.filter((row) => row.realized);
  const projected = ledger.filter((row) => !row.realized);
  const income = sum(realized.filter((row) => row.tipo === 'receita'), (row) => row.valor);
  const paid = sum(realized.filter((row) => row.tipo === 'despesa'), (row) => row.valor);
  const loans = sum(realized.filter((row) => row.tipo === 'emprestimo'), (row) => row.valor);
  const expectedIncome = sum(projected.filter((row) => row.tipo === 'receita'), (row) => row.valor);
  const expectedExpenses = sum(projected.filter((row) => row.tipo === 'despesa'), (row) => row.valor);
  const cash = sum(realized, signedCashAmount);
  const ledgerTable = table('Lançamentos', 'lancamentos.csv',
    ['Código', 'Data do lançamento', 'Vencimento', 'Tipo', 'Categoria', 'Obra ou centro de custo', 'Natureza', 'Situação', 'Valor (R$)'],
    ledger.map((row) => [row.id, date(row.data), date(row.vencimento), kinds[row.tipo], row.categoria, row.center,
      row.realized ? 'Realizado' : 'Previsto', resolverStatusLancamento(row, referenceDate), row.valor]),
    [
      ...(realized.length ? [
        ['Total de receitas recebidas', null, null, null, null, null, 'Realizado', null, income],
        ['Total de despesas pagas', null, null, null, null, null, 'Realizado', null, paid],
        ['Total de empréstimos recebidos', null, null, null, null, null, 'Realizado', null, loans],
        ['Resultado operacional', null, null, null, null, null, 'Realizado', null, roundCents(income - paid)],
        ['Movimento líquido de caixa', null, null, null, null, null, 'Realizado', null, cash],
      ] : []),
      ...(projected.length ? [
        ['Total de receitas previstas', null, null, null, null, null, 'Previsto', null, expectedIncome],
        ['Total de despesas previstas', null, null, null, null, null, 'Previsto', null, expectedExpenses],
      ] : []),
    ], [8]);

  const installments = data.installments.filter((row) => row.status === 'Recebida' && contains(row.receivedDate || row.dueDate))
    .sort((a, b) => (a.receivedDate || a.dueDate).localeCompare(b.receivedDate || b.dueDate) || a.id.localeCompare(b.id));
  const installmentTotal = sum(installments, (row) => row.amount);
  const installmentTable = table('Parcelas recebidas', 'parcelas-recebidas.csv',
    ['Código da parcela', 'Parcela', 'Obra', 'Vencimento', 'Recebimento', 'Nota fiscal', 'Código do lançamento', 'Valor recebido (R$)'],
    installments.map((row) => [row.id, row.label, center(row.projectId, row.projectName), date(row.dueDate),
      date(row.receivedDate), row.invoiceStatus || 'A emitir', row.transactionId, row.amount]),
    [['Total recebido em parcelas', null, null, null, null, null, null, installmentTotal]], [7]);

  const receipts = getInvoiceReceipts(data.transactions, data.installments).filter((row) => contains(row.date));
  const issued = receipts.filter((row) => row.invoiceStatus === 'Emitida');
  const pending = pendingInvoiceReceipts(receipts);
  const invoiceTotal = [...issued, ...pending].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
  const issuedTotal = sum(issued, (row) => row.amount);
  const pendingTotal = sumPendingInvoices(pending);
  const invoiceTable = table('Notas fiscais', 'notas-fiscais.csv',
    ['Código do recebimento', 'Data do recebimento', 'Obra ou centro de custo', 'Nota fiscal', 'Valor do recebimento (R$)'],
    invoiceTotal.map((row) => [row.target.installmentId || row.target.transactionId, date(row.date),
      center(row.projectId, row.projectName), row.invoiceStatus, row.amount]),
    [['Total com nota emitida', null, null, 'Emitida', issuedTotal],
      ['Total pendente de emissão', null, null, 'A emitir ou não emitida', pendingTotal]], [4]);

  const payroll = payrollRows(data, period);
  const known = (value: number | null) => value ?? 'Não configurado';
  const payrollSum = sum(payroll, (row) => row.total);
  const chargeTotal = payroll.some((row) => row.charges === null) ? null : sum(payroll, (row) => row.charges ?? 0);
  const provisionTotal = payroll.some((row) => row.provisions === null) ? null : sum(payroll, (row) => row.provisions ?? 0);
  const payrollTable = table('Folha e encargos', 'folha-e-encargos.csv',
    ['Competência', 'Obra ou centro de custo', 'Categoria', 'Base (R$)', 'Encargos (R$)', 'Provisões (R$)', 'Total conhecido (R$)'],
    payroll.map((row) => [competence(row.month), row.center, row.category, row.base, known(row.charges), known(row.provisions), row.total]),
    [['Total da folha calculada', null, null, sum(payroll, (row) => row.base), known(chargeTotal), known(provisionTotal), payrollSum]],
    [3, 4, 5, 6]);

  const tax = ledger.filter((row) => row.tipo === 'despesa' && expenseGroup(row) === 'taxes');
  const taxPaid = sum(tax.filter((row) => row.realized), (row) => row.valor);
  const taxOpen = sum(tax.filter((row) => !row.realized), (row) => row.valor);
  const obligations = data.complianceItems.filter((row) => row.kind === 'Obrigação' && contains(row.dueDate))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  const taxTable = table('Tributos', 'tributos.csv',
    ['Código', 'Registro', 'Competência', 'Data do lançamento', 'Vencimento', 'Categoria', 'Obra ou centro de custo', 'Situação', 'Valor (R$)'],
    [
      ...tax.map((row) => [row.id, row.realized ? 'Tributo pago' : 'Tributo previsto', null, date(row.data), date(row.vencimento),
        row.categoria, row.center, resolverStatusLancamento(row, referenceDate), row.valor]),
      ...obligations.map((row) => [row.id, 'Obrigação fiscal', competence(normalizeCompetence(row.competence || '')), null, date(row.dueDate),
        OBLIGATION_TYPES.find((category) => category === row.category) ?? 'Outra obrigação', center(row.projectId, row.projectName),
        resolverStatusConformidade({ tipo: row.kind, status: row.status, vencimento: row.dueDate }, referenceDate), null]),
    ],
    tax.length ? [['Total pago', null, null, null, null, null, null, null, taxPaid],
      ['Total previsto', null, null, null, null, null, null, null, taxOpen]] : [], [8]);

  const debts = data.debts.filter((row) => contains(row.nextDueDate))
    .sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate) || a.id.localeCompare(b.id));
  const debtTotals = calcularResumoDividas(debts);
  const debtTable = table('Dívidas', 'dividas.csv',
    ['Código', 'Tipo', 'Próximo vencimento', 'Situação', 'Parcelas restantes', 'Saldo devedor (R$)', 'Custo mensal (R$)'],
    debts.map((row) => [row.id, row.debtType, date(row.nextDueDate),
      resolverStatusDivida({ status: row.status, proximoVencimento: row.nextDueDate }, referenceDate),
      row.remainingInstallments ?? null, row.principalBalance, row.monthlyCost ?? null]),
    [['Total de dívidas em aberto', null, null, null, null, debtTotals.dividaTotal, debtTotals.custoMensal ?? 'Sem dados']], [5, 6]);

  const sheets = [ledgerTable, installmentTable, invoiceTable, payrollTable, taxTable, debtTable];
  const hasData = sheets.some((sheet) => sheet.count > 0);
  const summary = table('Resumo', 'resumo.csv', ['Item', 'Referência', 'Valor (R$)'], [
    ['Início do período', date(period.start), null], ['Fim do período', date(period.end), null],
    ['Gerado em (horário de Brasília)', details.generatedAt, null], ['Registrado por', details.actor, null],
    ['Lançamentos', 'Movimento realizado por data ou previsto por vencimento. Estornos e espelhos de parcelas ficam fora dos totais.', null],
    ['Parcelas', 'Data do recebimento. Para parcelas antigas sem essa data, usa-se o vencimento.', null],
    ['Notas fiscais', 'Situação atual dos recebimentos no período.', null],
    ['Folha e encargos', 'Folha calculada na Equipe para cada competência abrangida, com o mês completo e os totais por centro.', null],
    ['Tributos', 'Pagamentos e previsões do Financeiro, além de obrigações por vencimento sem valor monetário vinculado.', null],
    ['Dívidas', 'Saldos atuais, filtrados pelo próximo vencimento no período.', null],
    ...(hasData ? [
      ['Receitas recebidas', null, realized.length ? income : null],
      ['Despesas pagas', null, realized.length ? paid : null],
      ['Empréstimos recebidos', null, realized.length ? loans : null],
      ['Resultado operacional', null, realized.length ? roundCents(income - paid) : null],
      ['Movimento líquido de caixa', null, realized.length ? cash : null],
      ['Parcelas recebidas', null, installments.length ? installmentTotal : null],
      ['Recebimentos com nota emitida', null, invoiceTotal.length ? issuedTotal : null],
      ['Recebimentos com nota pendente', null, invoiceTotal.length ? pendingTotal : null],
      ['Folha e encargos · total conhecido', null, payroll.length ? payrollSum : null],
      ['Tributos pagos', null, tax.length ? taxPaid : null],
      ['Saldo devedor em aberto', null, debtTotals.dividaTotal],
    ] : [['Sem dados', null, null]]) as PackageRow[],
  ], [], [2]);
  return { sheets: [summary, ...sheets], hasData };
}
