import type {
  CompanySettings,
  ComplianceItem,
  Debt,
  Employee,
  FinancialTransaction,
  PilotisDataState,
  Project,
  ProjectStage,
  Quote,
} from '../types/pilotis';
import { addMonthsISO, diffDaysFromToday, formatMonthLabelBR, monthKey, todayISO } from './formatters';

export interface DashboardMetrics {
  cashBalance: number | null;
  forecastMonthEndCash: number | null;
  receivables30Days: number | null;
  receivables30Count: number;
  overdueReceivablesCount: number;
  monthResult: number | null;
  averageMarginPct: number | null;
  activeProjectsCount: number | null;
  negotiatingQuotesCount: number;
  unissuedInvoicesAmount: number | null;
}

export interface MonthlyCashPoint {
  monthKey: string;
  label: string;
  contractedIn: number;
  funnelWeightedIn: number;
  realizedIn: number;
  outflows: number;
  provisionsIncluded: number;
  projectedBalance: number;
}

export interface SystemAlert {
  id: string;
  level: 'Urgente' | 'Atenção' | 'Info' | 'Neutro';
  text: string;
  module: 'financial' | 'compliance' | 'planning' | 'clients' | 'team';
}

export interface ProjectDre {
  revenueBudgeted: number;
  revenueRealized: number;
  laborBudgeted: number;
  laborRealized: number;
  subcontractBudgeted: number;
  subcontractRealized: number;
  equipmentBudgeted: number;
  equipmentRealized: number;
  taxBudgeted: number;
  taxRealized: number;
  bdiBudgeted: number;
  bdiRealized: number;
  totalDirectBudgeted: number;
  totalDirectRealized: number;
  marginBudgeted: number;
  marginRealized: number;
  marginRealizedPct: number;
  marginBudgetedPct: number;
}

export interface PayrollSummary {
  totalHeadcount: number;
  cltCount: number;
  otherCount: number;
  recurringNonCltCount: number;
  basePayroll: number;
  chargesTotal: number;
  provisionsTotal: number;
  totalMonthlyCost: number;
  paramsConfigured: boolean;
}

export function isSystemEmpty(data: PilotisDataState): boolean {
  return (
    data.transactions.length === 0 &&
    data.clients.length === 0 &&
    data.quotes.length === 0 &&
    data.projects.length === 0 &&
    data.employees.length === 0 &&
    data.debts.length === 0
  );
}

export function computeDashboardMetrics(data: PilotisDataState): DashboardMetrics {
  const nowIso = todayISO();
  const currentMonth = monthKey(nowIso);

  const realizedTransactions = data.transactions.filter(
    (t) => !t.isForecast && t.entryKind !== 'loan' && (t.status === 'Recebido' || t.status === 'Pago')
  );

  let cashBalance: number | null = null;
  if (realizedTransactions.length > 0) {
    cashBalance = realizedTransactions.reduce(
      (sum, t) => (t.entryKind === 'income' ? sum + t.amount : sum - t.amount),
      0
    );
  }

  const currentMonthTx = data.transactions.filter(
    (t) => t.entryKind !== 'loan' && monthKey(t.dueDate || t.date) === currentMonth
  );

  let forecastMonthEndCash: number | null = null;
  if (cashBalance !== null || currentMonthTx.length > 0) {
    const pendingInMonth = currentMonthTx
      .filter((t) => t.isForecast || t.status === 'A vencer' || t.status === 'Em atraso')
      .reduce((sum, t) => (t.entryKind === 'income' ? sum + t.amount : sum - t.amount), 0);
    forecastMonthEndCash = (cashBalance ?? 0) + pendingInMonth;
  }

  const receivables30 = data.transactions.filter((t) => {
    if (t.entryKind !== 'income') return false;
    if (t.status !== 'A vencer' && t.status !== 'Em atraso') return false;
    const diff = diffDaysFromToday(t.dueDate || t.date);
    return diff !== null && diff <= 30;
  });

  const overdueReceivablesCount = receivables30.filter((t) => {
    const d = diffDaysFromToday(t.dueDate || t.date);
    return t.status === 'Em atraso' || (d !== null && d < 0);
  }).length;

  const hasAnyReceivables = data.transactions.some((t) => t.entryKind === 'income');
  const receivables30Days = hasAnyReceivables
    ? receivables30.reduce((sum, t) => sum + t.amount, 0)
    : null;

  const monthIncome = currentMonthTx
    .filter((t) => t.entryKind === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const monthExpense = currentMonthTx
    .filter((t) => t.entryKind === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);
  const monthResult = currentMonthTx.length > 0 ? monthIncome - monthExpense : null;

  const activeProjects = data.projects.filter(
    (p) => p.status === 'Em execução' || p.status === 'Contratada'
  );
  let averageMarginPct: number | null = null;
  if (data.projects.length > 0) {
    const dres = data.projects.map((p) => computeProjectDre(p, data.transactions));
    const totalRev = dres.reduce((s, d) => s + d.revenueBudgeted, 0);
    const totalMargin = dres.reduce((s, d) => s + d.marginRealized, 0);
    averageMarginPct = totalRev > 0 ? Math.round((totalMargin / totalRev) * 100) : null;
  }

  const negotiatingQuotesCount = data.quotes.filter(
    (q) => q.status === 'Em negociação' || q.status === 'Enviado'
  ).length;

  const pendingInvoiceTx = data.transactions.filter(
    (t) => t.entryKind === 'income' && (t.invoiceStatus === 'Não emitida' || t.invoiceStatus === 'A emitir')
  );
  const unissuedInvoicesAmount =
    pendingInvoiceTx.length > 0
      ? pendingInvoiceTx
          .filter((t) => t.invoiceStatus === 'Não emitida')
          .reduce((s, t) => s + t.amount, 0)
      : null;

  return {
    cashBalance,
    forecastMonthEndCash,
    receivables30Days,
    receivables30Count: receivables30.length,
    overdueReceivablesCount,
    monthResult,
    averageMarginPct,
    activeProjectsCount: data.projects.length > 0 ? activeProjects.length : null,
    negotiatingQuotesCount,
    unissuedInvoicesAmount,
  };
}

export function computeCashFlowProjection(
  data: PilotisDataState,
  monthsCount = 5
): MonthlyCashPoint[] {
  const baseDate = todayISO();
  const hasAnyData = data.transactions.length > 0 || data.quotes.some((q) => q.status === 'Enviado' || q.status === 'Em negociação') || data.employees.length > 0;
  if (!hasAnyData) return [];

  const openFunnelQuotes = data.quotes.filter(
    (q) => q.status === 'Enviado' || q.status === 'Em negociação'
  );

  // Funnel weighted monthly inflow distributed across open quotes' installments
  const funnelWeightedByMonth = new Map<string, number>();
  for (const q of openFunnelQuotes) {
    const prob = (q.probabilityPct || 0) / 100;
    if (prob <= 0 || q.totalValue <= 0) continue;
    const weightedTotal = q.totalValue * prob;
    const count = Math.max(1, q.installmentsCount || 13);
    const down = weightedTotal * ((q.downPaymentPct || 20) / 100);
    const parcel = (weightedTotal - down) / count;
    const m1 = monthKey(addMonthsISO(baseDate, 1));
    funnelWeightedByMonth.set(m1, (funnelWeightedByMonth.get(m1) ?? 0) + down);
    for (let i = 1; i <= Math.min(count, monthsCount); i++) {
      const mk = monthKey(addMonthsISO(baseDate, i + 1));
      funnelWeightedByMonth.set(mk, (funnelWeightedByMonth.get(mk) ?? 0) + parcel);
    }
  }

  const payroll = computeTeamPayrollSummary(data.employees, data.settings);

  const metrics = computeDashboardMetrics(data);
  let runningBalance = metrics.cashBalance ?? 0;

  const points: MonthlyCashPoint[] = [];
  for (let i = 0; i < monthsCount; i++) {
    const mk = monthKey(addMonthsISO(baseDate, i));
    const monthTxs = data.transactions.filter(
      (t) => t.entryKind !== 'loan' && monthKey(t.dueDate || t.date) === mk
    );

    const realizedIn = monthTxs
      .filter((t) => t.entryKind === 'income' && !t.isForecast)
      .reduce((s, t) => s + t.amount, 0);

    const contractedIn = monthTxs
      .filter((t) => t.entryKind === 'income' && t.isForecast)
      .reduce((s, t) => s + t.amount, 0);

    const explicitExpenses = monthTxs
      .filter((t) => t.entryKind === 'expense')
      .reduce((s, t) => s + t.amount, 0);

    const hasPayrollInMonth = monthTxs.some(
      (t) => t.entryKind === 'expense' && (t.category === 'Folha' || t.source === 'folha')
    );

    const provisionsIncluded =
      !hasPayrollInMonth && payroll.totalHeadcount > 0 ? payroll.provisionsTotal : 0;
    const projectedMonthlyOutflow =
      explicitExpenses +
      (!hasPayrollInMonth && payroll.totalHeadcount > 0 ? payroll.totalMonthlyCost : 0);

    const funnelWeightedIn = funnelWeightedByMonth.get(mk) ?? 0;
    const totalIn = realizedIn + contractedIn;
    runningBalance = runningBalance + totalIn - projectedMonthlyOutflow;

    points.push({
      monthKey: mk,
      label: formatMonthLabelBR(mk),
      contractedIn,
      funnelWeightedIn,
      realizedIn,
      outflows: projectedMonthlyOutflow,
      provisionsIncluded,
      projectedBalance: runningBalance,
    });
  }
  return points;
}

export function computeProjectProgress(
  projectId: string,
  stages: ProjectStage[]
): number | null {
  const projectStages = stages.filter((s) => s.projectId === projectId && !s.isMilestone);
  if (projectStages.length === 0) return null;
  const totalWeight = projectStages.reduce((s, st) => s + Math.max(1, st.budgetedCost || st.durationWeeks || 1), 0);
  const completedWeight = projectStages.reduce(
    (s, st) => s + Math.max(1, st.budgetedCost || st.durationWeeks || 1) * (st.progressPct / 100),
    0
  );
  return Math.round((completedWeight / totalWeight) * 100);
}

export function computeProjectDre(
  project: Project,
  transactions: FinancialTransaction[]
): ProjectDre {
  const projTxs = transactions.filter(
    (t) => t.projectId === project.id && t.entryKind !== 'loan'
  );
  const realizedIncomes = projTxs
    .filter((t) => t.entryKind === 'income' && !t.isForecast)
    .reduce((s, t) => s + t.amount, 0);

  const sumExpense = (cats: string[]) =>
    projTxs
      .filter((t) => t.entryKind === 'expense' && cats.includes(t.category))
      .reduce((s, t) => s + t.amount, 0);

  const laborRealized = sumExpense(['Folha', 'Mão de obra']);
  const subcontractRealized = sumExpense(['Subempreitada', 'Subempreitadas']);
  const equipmentRealized = sumExpense(['Equipamentos e EPI']);
  const taxRealized = sumExpense(['Tributos']);
  const bdiRealized = sumExpense(['Comissão', 'BDI', 'Outros']);

  const laborBudgeted = project.budgetedLabor || 0;
  const subcontractBudgeted = project.budgetedSubcontract || 0;
  const equipmentBudgeted = project.budgetedEquipment || 0;
  const taxBudgeted = project.budgetedTax || 0;
  const bdiBudgeted = project.budgetedBdi || 0;

  const totalDirectBudgeted =
    laborBudgeted + subcontractBudgeted + equipmentBudgeted + taxBudgeted + bdiBudgeted;
  const totalDirectRealized =
    laborRealized + subcontractRealized + equipmentRealized + taxRealized + bdiRealized;

  const revenueBudgeted = project.contractValue;
  const revenueRealized = realizedIncomes > 0 ? realizedIncomes : project.contractValue;
  const marginBudgeted = revenueBudgeted - totalDirectBudgeted;
  const marginRealized = revenueBudgeted - totalDirectRealized;

  return {
    revenueBudgeted,
    revenueRealized,
    laborBudgeted,
    laborRealized,
    subcontractBudgeted,
    subcontractRealized,
    equipmentBudgeted,
    equipmentRealized,
    taxBudgeted,
    taxRealized,
    bdiBudgeted,
    bdiRealized,
    totalDirectBudgeted,
    totalDirectRealized,
    marginBudgeted,
    marginRealized,
    marginBudgetedPct: revenueBudgeted > 0 ? (marginBudgeted / revenueBudgeted) * 100 : 0,
    marginRealizedPct: revenueBudgeted > 0 ? (marginRealized / revenueBudgeted) * 100 : 0,
  };
}

export function computeTeamPayrollSummary(
  employees: Employee[],
  settings: CompanySettings | null
): PayrollSummary {
  const cltEmployees = employees.filter((e) => e.employmentType === 'CLT');
  const otherEmployees = employees.filter((e) => e.employmentType !== 'CLT');
  const cltSalaries = cltEmployees.reduce((s, e) => s + e.baseSalary, 0);
  const otherSalaries = otherEmployees.reduce((s, e) => s + e.baseSalary, 0);
  const basePayroll = cltSalaries + otherSalaries;

  const inssRate = settings?.inssRate ?? 0;
  const fgtsRate = settings?.fgtsRate ?? 0;
  const vacationRate = settings?.vacationRate ?? 0;
  const thirteenthRate = settings?.thirteenthRate ?? 0;
  const paramsConfigured = inssRate + fgtsRate + vacationRate + thirteenthRate > 0;

  const chargesTotal = cltSalaries * ((inssRate + fgtsRate) / 100);
  const provisionsTotal = cltSalaries * ((vacationRate + thirteenthRate) / 100);
  const totalMonthlyCost = basePayroll + chargesTotal + provisionsTotal;

  const recurringNonCltCount = employees.filter(
    (e) => e.employmentType === 'Autônomo' && e.baseSalary > 0
  ).length;

  return {
    totalHeadcount: employees.length,
    cltCount: cltEmployees.length,
    otherCount: otherEmployees.length,
    recurringNonCltCount,
    basePayroll,
    chargesTotal,
    provisionsTotal,
    totalMonthlyCost,
    paramsConfigured,
  };
}

export function computeCriticalPathIds(stages: ProjectStage[]): Set<string> {
  if (stages.length === 0) return new Set();
  const byId = new Map(stages.map((s) => [s.id, s]));
  const earliestFinish = new Map<string, number>();

  const getEF = (id: string, visited = new Set<string>()): number => {
    if (earliestFinish.has(id)) return earliestFinish.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const st = byId.get(id);
    if (!st) return 0;
    const deps = st.dependsOn || [];
    const maxDepEF = deps.reduce((m, depId) => Math.max(m, getEF(depId, new Set(visited))), 0);
    const start = Math.max(st.startWeek || 0, maxDepEF);
    const ef = start + (st.durationWeeks || 0);
    earliestFinish.set(id, ef);
    return ef;
  };

  let projectDuration = 0;
  for (const st of stages) {
    projectDuration = Math.max(projectDuration, getEF(st.id));
  }

  const critical = new Set<string>();
  const latestStart = new Map<string, number>();

  const getLS = (id: string, visited = new Set<string>()): number => {
    if (latestStart.has(id)) return latestStart.get(id)!;
    if (visited.has(id)) return projectDuration;
    visited.add(id);
    const st = byId.get(id);
    if (!st) return projectDuration;
    const successors = stages.filter((other) => (other.dependsOn || []).includes(id));
    const lf =
      successors.length === 0
        ? projectDuration
        : successors.reduce((min, suc) => Math.min(min, getLS(suc.id, new Set(visited))), projectDuration);
    const ls = lf - (st.durationWeeks || 0);
    latestStart.set(id, ls);
    return ls;
  };

  for (const st of stages) {
    const ef = getEF(st.id);
    const es = ef - (st.durationWeeks || 0);
    const ls = getLS(st.id);
    if (Math.abs(ls - es) < 0.01 && (st.durationWeeks > 0 || st.isMilestone)) {
      critical.add(st.id);
    }
  }
  return critical;
}

export function hasStageCycle(
  allStages: ProjectStage[],
  stageId: string,
  candidateDependsOn: string[]
): boolean {
  const graph = new Map<string, string[]>();
  for (const st of allStages) {
    graph.set(st.id, st.id === stageId ? candidateDependsOn : st.dependsOn || []);
  }
  if (!graph.has(stageId)) {
    graph.set(stageId, candidateDependsOn);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const dfs = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const dep of graph.get(node) || []) {
      if (dfs(dep)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  return dfs(stageId);
}

export function computeSystemAlerts(data: PilotisDataState): SystemAlert[] {
  const alerts: SystemAlert[] = [];
  const projection = computeCashFlowProjection(data, 5);
  const negativePoint = projection.find((p) => p.projectedBalance < 0);
  if (negativePoint) {
    alerts.push({
      id: 'cash-negative',
      level: 'Urgente',
      text: `Caixa projetado negativo em ${negativePoint.label}`,
      module: 'financial',
    });
  }

  const overdueCompliance = data.complianceItems.filter((c) => c.status === 'Em atraso');
  for (const c of overdueCompliance.slice(0, 2)) {
    alerts.push({
      id: `comp-overdue-${c.id}`,
      level: 'Atenção',
      text: `${c.title} em atraso`,
      module: 'compliance',
    });
  }

  const expiringCerts = data.complianceItems.filter((c) => {
    if (c.kind !== 'Certidão') return false;
    const days = diffDaysFromToday(c.dueDate);
    return days !== null && days >= 0 && days <= 30;
  });
  for (const cert of expiringCerts.slice(0, 2)) {
    const days = diffDaysFromToday(cert.dueDate);
    alerts.push({
      id: `cert-exp-${cert.id}`,
      level: 'Atenção',
      text: `${cert.title} vence em ${days} dia(s)`,
      module: 'compliance',
    });
  }

  const delayedStages = data.stages.filter(
    (s) => s.delayJustification && s.status !== 'Concluída'
  );
  for (const st of delayedStages.slice(0, 2)) {
    alerts.push({
      id: `stage-delay-${st.id}`,
      level: 'Info',
      text: `Etapa "${st.name}" com atraso registrado (${st.delayCategory || 'Justificado'})`,
      module: 'planning',
    });
  }

  const openWarranty = data.warrantyCalls.filter((w) => w.status !== 'Resolvido');
  if (openWarranty.length > 0) {
    alerts.push({
      id: 'warranty-open',
      level: 'Neutro',
      text: `Garantia: ${openWarranty.length} chamado(s) em aberto`,
      module: 'clients',
    });
  }

  return alerts;
}

export function computeTenderReadinessPct(items: ComplianceItem[]): number | null {
  const tenderItems = items.filter((i) => i.kind === 'Licitação');
  if (tenderItems.length === 0) return null;
  const ready = tenderItems.filter(
    (i) => i.status === 'Em dia' || i.status === 'Válida' || i.status === 'Anexado'
  ).length;
  return Math.round((ready / tenderItems.length) * 100);
}

export function computeDebtSummary(debts: Debt[]) {
  const active = debts.filter((d) => d.status !== 'Quitada');
  if (debts.length === 0) {
    return {
      totalDebt: null,
      monthlyCost: null,
      overdueTaxes: null,
      guaranteedCredit: null,
    };
  }
  return {
    totalDebt: active.reduce((s, d) => s + d.principalBalance, 0),
    monthlyCost: active.reduce((s, d) => s + (d.monthlyCost || 0), 0),
    overdueTaxes: active
      .filter((d) => d.debtType === 'Tributo em atraso')
      .reduce((s, d) => s + d.principalBalance, 0),
    guaranteedCredit: active
      .filter((d) => d.debtType === 'Conta garantida')
      .reduce((s, d) => s + d.principalBalance, 0),
  };
}
