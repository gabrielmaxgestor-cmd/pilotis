import type { DreObraResult } from './dre';
import { roundCents } from './formatters';
import type { LancamentoRecord } from './types';

const expenseLabels = {
  payroll: 'Folha',
  taxes: 'Tributos',
  interest: 'Juros e tarifas',
  other: 'Outras despesas',
} as const;

type ExpenseGroup = keyof typeof expenseLabels;

function expenseGroup(entry: Pick<LancamentoRecord, 'categoria' | 'origem'>): ExpenseGroup {
  const category = entry.categoria.trim().toLocaleLowerCase('pt-BR');
  if (category === 'folha' || entry.origem === 'folha') return 'payroll';
  if (category === 'tributos' || category === 'impostos') return 'taxes';
  if (category === 'juros e tarifas' || category === 'juros' || category === 'tarifas') return 'interest';
  return 'other';
}

export function paidExpenseComposition(paidExpenses: readonly LancamentoRecord[]) {
  const totals: Record<ExpenseGroup, number> = { payroll: 0, taxes: 0, interest: 0, other: 0 };
  for (const entry of paidExpenses) totals[expenseGroup(entry)] += entry.valor;
  const total = roundCents(paidExpenses.reduce((sum, entry) => sum + entry.valor, 0));
  const rows = (Object.keys(expenseLabels) as ExpenseGroup[]).map((key) => {
    const amount = roundCents(totals[key]);
    return { key, label: expenseLabels[key], amount, percent: total > 0 ? roundCents(amount / total * 100) : null };
  });
  return { hasData: paidExpenses.length > 0, total, rows };
}

export type PaidExpenseComposition = ReturnType<typeof paidExpenseComposition>;

export function projectDreRows(dre: DreObraResult, hasCostBudget: boolean) {
  const lines = [
    ['Receita de obra', dre.receita],
    ['(−) Mão de obra', dre.maoDeObra],
    ['(−) Subempreitadas', dre.empreita],
    ['(−) Equipamentos e EPI', dre.equipamentos],
    ['(−) Tributos', dre.impostos],
    ['(−) BDI e comissões', dre.bdi],
    ['(−) Ajuste do orçamento pela EAP', dre.ajusteEap],
    ['Resultado / margem da obra', dre.resultado],
  ] as const;
  return lines
    .filter(([, line]) => line !== dre.ajusteEap || line.orcado !== 0)
    .map(([label, line]) => ({
      label,
      line,
      budget: line === dre.receita || hasCostBudget ? line.orcado : null,
      actual: dre.possuiRealizado && line !== dre.ajusteEap ? line.realizado : null,
    }));
}

export type ProjectDreChartRow = ReturnType<typeof projectDreRows>[number];
