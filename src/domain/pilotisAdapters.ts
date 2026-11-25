import type {
  CompanySettings,
  ComplianceItem,
  Debt,
  Employee,
  FinancialTransaction,
  Installment,
  PilotisDataState,
  Project,
  ProjectStage,
  Quote,
  ScheduleBaseline,
  ScheduleBaselineStage,
  ScheduleProgress,
  TransactionKind,
  WarrantyCall,
} from '../types/pilotis';
import { getInvoiceReceipts, normalizeTenderCategory, pendingInvoiceReceipts, resolveCertificateCategory, sumPendingInvoices } from './complianceWorkflows';
import { alertas, type AlertaDominio } from './alertas';
import { previsaoCaixa, type PrevisaoCaixaResult } from './caixa';
import {
  prontidaoLicitacao,
  prontidaoLicitacaoPorCategoria,
  resumoConformidade,
  type ItemConformidadeEntrada,
  type ProntidaoLicitacaoCategoria,
  type ResumoConformidadeResult,
} from './conformidade';
import {
  dre,
  dreEmpresa,
  type DreEmpresaResult,
  type DreObraResult,
  type ObraDreInput,
} from './dre';
import {
  avaliarValidadeSst,
  calcularEncargos,
  getOnboardingAlert,
  contarPendenciasSegurancaEquipe,
  resumoFolhaEquipe,
  type EncargosColaboradorResult,
  type ResumoFolhaEquipe,
} from './equipe';
import {
  conciliarExtratoBancario,
  resumoDividas,
  resumoFinanceiroPeriodo,
  type ExtratoLinhaConciliada,
  type ExtratoLinhaEntrada,
  type ResumoDividasResult,
  type ResumoFinanceiroPeriodoResult,
  deduplicarReceitasEParcelas,
  isRealizedCashEntry,
  installmentProgress,
  signedCashAmount,
} from './financeiro';
import { addDaysISO, addMonthsISO, diffDaysISO, monthKey, roundCents, todayISO } from './formatters';
import { planMonthlyPayroll } from './teamPlanning';
import {
  indicadoresDashboard,
  type IndicadoresDashboardResult,
} from './indicadores';
import {
  resumoFunilOrcamentos,
  type ResumoFunilOrcamentosResult,
} from './orcamentos';
import {
  caminhoCritico,
  curvaS,
  progressoObra,
  resumoFasesEap,
  type CaminhoCriticoResult,
  type CurvaSResult,
  type ResumoFaseEap,
} from './planejamento';
import type {
  AuditFields,
  BaselineEtapaItem,
  CertidaoRecord,
  ColaboradorRecord,
  DividaRecord,
  EtapaRecord,
  GarantiaRecord,
  LancamentoRecord,
  LancamentoTipo,
  ObrigacaoRecord,
  OrcamentoRecord,
  ParcelaRecord,
  TaxChargeParameters,
} from './types';

const DOMAIN_AUDIT_FALLBACK: AuditFields = {
  createdBy: 'Sócio',
  createdAt: '',
  updatedBy: 'Sócio',
  updatedAt: '',
};

export function mapTransactionKindToDomain(kind: TransactionKind): LancamentoTipo {
  if (kind === 'income') return 'receita';
  if (kind === 'loan') return 'emprestimo';
  return 'despesa';
}

export function toDomainTransactions(
  transactions: FinancialTransaction[],
): LancamentoRecord[] {
  return transactions.map((t) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: t.id,
    data: t.date,
    vencimento: t.dueDate || t.date,
    descricao: t.description,
    tipo: mapTransactionKindToDomain(t.entryKind),
    categoria: t.category,
    obraId: t.projectId,
    valor: t.amount,
    previsto: t.isForecast,
    originalmentePrevisto: t.wasForecast,
    statementKey: t.statementKey,
    payrollPeriod: t.payrollPeriod,
    payrollProvisions: t.payrollProvisions,
    status: t.status,
    notaFiscal: t.invoiceStatus || 'Não se aplica',
    formaPagamento: t.paymentMethod || '',
    origem: t.source || 'manual',
    parcelaId: t.installmentId,
    dividaId: t.debtId,
  }));
}

export function toDomainInstallments(
  installments: Installment[],
): ParcelaRecord[] {
  return installments.map((inst) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: inst.id,
    obraId: inst.projectId,
    orcamentoId: inst.quoteId,
    numero: inst.number,
    rotulo: inst.label,
    vencimento: inst.dueDate,
    valor: inst.amount,
    status: inst.status,
    notaFiscal: inst.invoiceStatus || 'A emitir',
    dataRecebimento: inst.receivedDate || undefined,
  }));
}

export function toDomainQuotes(quotes: Quote[]): OrcamentoRecord[] {
  return quotes.map((q) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: q.id,
    codigo: q.code,
    clienteId: q.clientId,
    clienteNome: q.clientName,
    titulo: q.title,
    tipo: q.type,
    cidade: q.city,
    areaM2: q.areaM2,
    prazoMeses: q.estimatedMonths,
    validadeDias: q.validityDays,
    descricao: q.description,
    custoMaoDeObra: q.laborCost,
    custoEmpreita: q.subcontractCost,
    custoEquipamentos: q.equipmentCost,
    custoBdi: q.bdiCost,
    custoImpostos: q.taxCost,
    valorTotal: q.totalValue,
    entradaPct: q.downPaymentPct,
    numeroParcelas: q.installmentsCount,
    probabilidadePct: q.probabilityPct,
    status: q.status,
    motivoDescarte: q.discardReason || undefined,
    obraId: q.projectId || undefined,
  }));
}

export function toDomainEmployees(employees: Employee[]): ColaboradorRecord[] {
  return employees.map((e) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: e.id,
    nome: e.name,
    funcao: e.role,
    vinculo: e.employmentType,
    salarioBase: e.baseSalary,
    paymentFrequency: e.paymentFrequency,
    paymentMonth: e.paymentMonth,
    formaPagamento: e.paymentMethod,
    dataAdmissao: e.startDate,
    obraAtualId: e.currentProjectId || undefined,
    asoValidade: e.asoExpiry || undefined,
    nr18Validade: e.nr18Expiry || undefined,
    nr35Validade: e.nr35Expiry || undefined,
    statusEpi: e.epiStatus,
    statusIntegracao: e.onboardingStatus,
  }));
}

export function toDomainDebts(debts: Debt[]): DividaRecord[] {
  return debts.map((d) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: d.id,
    credor: d.creditor,
    tipo: d.debtType,
    saldoDevedor: d.principalBalance,
    custoMensal: d.monthlyCost || 0,
    parcelasRestantes: d.remainingInstallments || 0,
    proximoVencimento: d.nextDueDate || '',
    status: d.status,
    observacoes: d.notes || undefined,
  }));
}

export function toDomainTaxParams(
  settings: CompanySettings | null | undefined,
  referenceDate = todayISO(),
): TaxChargeParameters | null {
  if (!settings) return null;
  const { inssRate, fgtsRate, vacationRate, thirteenthRate } = settings;
  if (inssRate == null || fgtsRate == null || vacationRate == null || thirteenthRate == null) return null;
  return {
    inssPct: inssRate,
    fgtsPct: fgtsRate,
    feriasPct: vacationRate,
    decimoTerceiroPct: thirteenthRate,
    vigenciaInicio: settings.taxParamsEffectiveDate || referenceDate,
    fonte: settings.taxParamsSource || undefined,
  };
}

export function toDomainProjectDreInput(project: Project, stages: ProjectStage[] = []): ObraDreInput {
  const projectStages = stages.filter((stage) => stage.projectId === project.id);
  return {
    id: project.id,
    nome: project.name,
    valorContrato: project.contractValue,
    orcadoMaoDeObra: project.budgetedLabor || 0,
    orcadoEmpreita: project.budgetedSubcontract || 0,
    orcadoEquipamentos: project.budgetedEquipment || 0,
    orcadoImpostos: project.budgetedTax || 0,
    orcadoBdi: project.budgetedBdi || 0,
    orcadoEap: projectStages.length ? getWorkPackageBudget(projectStages) : undefined,
  };
}

export function toDomainStages(stages: ProjectStage[]): EtapaRecord[] {
  return stages.map((s) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: s.id,
    obraId: s.projectId,
    codigoEap: s.wbsCode,
    fase: s.phase,
    nome: s.name,
    responsavel: s.responsible,
    semanaInicio: s.startWeek,
    duracaoSemanas: s.durationWeeks,
    progressoPct: s.progressPct,
    custoOrcado: s.budgetedCost,
    dependencias: s.dependsOn || [],
    marco: Boolean(s.isMilestone),
    status: s.status,
    popId: s.popId || undefined,
    dataPrevistaMaterial: s.materialExpectedDate || undefined,
    categoriaAtraso: s.delayCategory || undefined,
    justificativaAtraso: s.delayJustification || undefined,
  }));
}

export function toDomainBaselineFromStages(
  stages: ProjectStage[],
): BaselineEtapaItem[] {
  return stages.map((s) => ({
    etapaId: s.id,
    semanaInicioBaseline: s.baselineStartWeek ?? s.startWeek,
    duracaoBaselineSemanas: s.baselineDurationWeeks ?? s.durationWeeks,
    custoOrcadoBaseline: s.baselineBudgetedCost ?? s.budgetedCost,
  }));
}

export function toDomainComplianceItems(
  items: ComplianceItem[],
): ItemConformidadeEntrada[] {
  return items.map((c) => ({
    id: c.id,
    tipo: c.kind,
    categoria: c.kind === 'Licitação' ? normalizeTenderCategory(c.category) : c.category,
    status: c.status,
    vencimento: c.dueDate || undefined,
  }));
}

export function toDomainComplianceCollections(items: ComplianceItem[]): {
  obrigacoes: ObrigacaoRecord[];
  certidoes: CertidaoRecord[];
} {
  const obrigacoes: ObrigacaoRecord[] = [];
  const certidoes: CertidaoRecord[] = [];

  for (const c of items) {
    if (c.kind === 'Obrigação') {
      obrigacoes.push({
        ...DOMAIN_AUDIT_FALLBACK,
        id: c.id,
        titulo: c.title,
        categoria: c.category,
        competencia: c.competence,
        vencimento: c.dueDate,
        status:
          c.status === 'Em dia' || c.status === 'Válida' || c.status === 'Anexado' ? 'Em dia'
            : c.status === 'Vence em breve' || c.status === 'Em atraso' ? c.status : 'Pendente',
        arquivo: c.fileName || undefined,
      });
    } else if (c.kind === 'Certidão') {
      certidoes.push({
        ...DOMAIN_AUDIT_FALLBACK,
        id: c.id,
        titulo: c.title,
        esfera: resolveCertificateCategory(c),
        dataEmissao: c.issuedDate || undefined,
        dataValidade: c.dueDate,
        status:
          c.status === 'Válida' ||
          c.status === 'Vence em breve' ||
          c.status === 'Pendente'
            ? c.status
            : c.status === 'Em atraso'
            ? 'Vencida'
            : 'Válida',
        arquivo: c.fileName || undefined,
      });
    }
  }

  return { obrigacoes, certidoes };
}

export function toDomainWarranties(calls: WarrantyCall[]): GarantiaRecord[] {
  return calls.map((w) => ({
    ...DOMAIN_AUDIT_FALLBACK,
    id: w.id,
    obraId: w.projectId,
    descricao: w.description,
    dataAbertura: w.openedDate,
    prazoAtendimento: w.deadlineDate,
    custo: w.cost,
    status: w.status,
  }));
}

export function calcularSaldoInicialCaixa(
  transactions: FinancialTransaction[],
  dataBase = todayISO(),
): number | undefined {
  const baseMonth = monthKey(dataBase);
  const { lancamentosUnicos } = deduplicarReceitasEParcelas(toDomainTransactions(transactions), []);
  const priorRealizedTxs = lancamentosUnicos.filter(
    (entry) => isRealizedCashEntry(entry) && monthKey(entry.data) < baseMonth,
  );
  if (priorRealizedTxs.length === 0) return undefined;
  return roundCents(
    priorRealizedTxs.reduce(
      (sum, entry) => sum + signedCashAmount(entry),
      0,
    ),
  );
}

export function calcularIndicadoresDashboard(
  data: PilotisDataState,
  dataReferencia = planningTodayISO(),
): IndicadoresDashboardResult {
  return indicadoresDashboard({
    dataReferencia,
    lancamentos: toDomainTransactions(data.transactions),
    parcelas: toDomainInstallments(data.installments),
    obras: data.projects.map((p) => ({
      ...toDomainProjectDreInput(p, data.stages),
      status: p.status,
    })),
    orcamentos: data.quotes.map((q) => ({ status: q.status })),
    clientesCount: data.clients.length,
    colaboradores: data.employees.map((e) => ({ id: e.id })),
    dividas: data.debts.map((d) => ({ id: d.id })),
  });
}

export function calcularResumoFinanceiroPeriodo(
  data: PilotisDataState,
  dataReferencia = todayISO(),
): ResumoFinanceiroPeriodoResult {
  return resumoFinanceiroPeriodo(
    toDomainTransactions(data.transactions),
    toDomainInstallments(data.installments),
    dataReferencia,
  );
}

export function calcularPrevisaoCaixa(
  data: PilotisDataState,
  mesesCount = 5,
  dataBase = planningTodayISO(),
): PrevisaoCaixaResult {
  return previsaoCaixa(mesesCount, {
    dataBase,
    saldoInicial: calcularSaldoInicialCaixa(data.transactions, dataBase),
    lancamentos: toDomainTransactions(data.transactions),
    parcelas: toDomainInstallments(data.installments),
    orcamentos: toDomainQuotes(data.quotes),
    colaboradores: toDomainEmployees(data.employees),
    parametrosEncargos: toDomainTaxParams(data.settings, dataBase),
    payrollByMonth: new Map(Array.from({ length: mesesCount }, (_, index) => {
      const month = monthKey(addMonthsISO(dataBase, index));
      const payroll = calculateTeamPayroll(data, month);
      return [month, { amount: payroll.totalKnown, provisions: payroll.provisions ?? 0 }] as const;
    })),
  });
}

export function calcularDreObra(
  project: Project,
  transactions: FinancialTransaction[],
  stages: ProjectStage[] = [],
): DreObraResult {
  return dre(
    toDomainProjectDreInput(project, stages),
    toDomainTransactions(transactions),
  );
}

export function calcularDreEmpresa(
  data: PilotisDataState,
  dataInicio: string,
  dataFim: string,
): DreEmpresaResult {
  return dreEmpresa(
    { dataInicio, dataFim },
    {
      lancamentos: toDomainTransactions(data.transactions),
      parcelas: toDomainInstallments(data.installments),
    },
  );
}

export function calcularEncargosColaborador(
  employee: Pick<Employee, 'employmentType' | 'baseSalary'>,
  settings: CompanySettings | null | undefined,
  dataReferencia = todayISO(),
): EncargosColaboradorResult {
  return calcularEncargos(
    {
      vinculo: employee.employmentType,
      salarioBase: employee.baseSalary,
    },
    toDomainTaxParams(settings, dataReferencia),
    dataReferencia,
  );
}

export function calcularResumoFolhaEquipe(
  employees: Employee[],
  settings: CompanySettings | null | undefined,
  dataReferencia = todayISO(),
): ResumoFolhaEquipe {
  return resumoFolhaEquipe(
    toDomainEmployees(employees.filter((employee) =>
      (!employee.startDate || employee.startDate <= dataReferencia) &&
      (employee.paymentFrequency !== 'oneOff' || employee.paymentMonth === monthKey(dataReferencia)),
    )),
    toDomainTaxParams(settings, dataReferencia),
    dataReferencia,
  );
}

export function calcularPendenciasSegurancaEquipe(
  employees: Employee[],
  dataReferencia = todayISO(),
): number {
  return contarPendenciasSegurancaEquipe(
    toDomainEmployees(employees),
    dataReferencia,
  ) + employees.filter((employee) => avaliarValidadeSst(employee.epiExpiry, dataReferencia).expiredOrSoon).length
    + employees.filter((employee) =>
      getOnboardingAlert(employee.onboardingStart, employee.startDate, employee.onboardingStatus, dataReferencia) === 'Integração em atraso',
    ).length;
}

export function calcularResumoDividas(debts: Debt[]): ResumoDividasResult {
  const summary = resumoDividas(toDomainDebts(debts));
  const hasUnknownCost = debts.some((debt) => debt.status !== 'Quitada' && debt.monthlyCost == null);
  return hasUnknownCost ? { ...summary, custoMensal: null } : summary;
}

export function calcularCaminhoCriticoObra(
  stages: ProjectStage[],
): CaminhoCriticoResult {
  return caminhoCritico(toDomainStages(stages));
}

export function calcularCurvaSObra(
  stages: ProjectStage[],
  semanaReferencia?: number,
  baseline?: ScheduleBaseline,
  includePoints = true,
): CurvaSResult {
  const schedule = calcularCaminhoCriticoObra(stages);
  const starts = new Map(schedule.detalhes.map((item) => [item.etapaId, item.inicioMaisCedo]));
  return curvaS(
    toDomainStages(stages).map((stage) => ({
      ...stage, semanaInicio: starts.get(stage.id) ?? stage.semanaInicio,
    })),
    baseline ? baseline.stages.map((stage) => ({
      etapaId: stage.stageId,
      semanaInicioBaseline: stage.startWeek,
      duracaoBaselineSemanas: stage.durationWeeks,
      custoOrcadoBaseline: stage.budgetedCost,
    })) : toDomainBaselineFromStages(stages),
    semanaReferencia,
    includePoints,
    Boolean(baseline),
  );
}

export function calcularProgressoObra(
  projectId: string,
  stages: ProjectStage[],
): number | null {
  const projectStages = stages.filter((s) => s.projectId === projectId);
  return progressoObra(toDomainStages(projectStages));
}

export function calcularResumoFasesEap(
  stages: ProjectStage[],
): ResumoFaseEap[] {
  return resumoFasesEap(toDomainStages(stages));
}

export function calcularProntidaoLicitacao(
  items: ComplianceItem[],
): number | null {
  return prontidaoLicitacao(toDomainComplianceItems(items), planningTodayISO());
}

export function calcularProntidaoLicitacaoPorCategoria(
  items: ComplianceItem[],
): ProntidaoLicitacaoCategoria[] {
  return prontidaoLicitacaoPorCategoria(toDomainComplianceItems(items), planningTodayISO());
}

export function calcularResumoFunilOrcamentos(
  quotes: Quote[],
): ResumoFunilOrcamentosResult {
  return resumoFunilOrcamentos(toDomainQuotes(quotes));
}

export function calcularResumoConformidade(
  items: ComplianceItem[],
  transactions: FinancialTransaction[],
  dataReferencia = planningTodayISO(),
  installments: Installment[] = [],
): ResumoConformidadeResult {
  const summary = resumoConformidade(toDomainComplianceItems(items), [], dataReferencia);
  const receipts = getInvoiceReceipts(transactions, installments);
  return { ...summary, receitaSemNotaPendente: receipts.length ? sumPendingInvoices(pendingInvoiceReceipts(receipts)) : null };
}

export function calcularAlertasSistema(
  data: PilotisDataState,
  dataReferencia = planningTodayISO(),
  options: { forecast?: PrevisaoCaixaResult; lateStages?: ReadonlyMap<string, number> } = {},
): AlertaDominio[] {
  const { obrigacoes, certidoes } = toDomainComplianceCollections(
    data.complianceItems,
  );
  return alertas(
    {
      lancamentos: toDomainTransactions(data.transactions),
      parcelas: toDomainInstallments(data.installments),
      dividas: toDomainDebts(data.debts),
      colaboradores: toDomainEmployees(data.employees),
      obrigacoes,
      certidoes,
      etapas: toDomainStages(data.stages),
      garantias: toDomainWarranties(data.warrantyCalls),
    },
    {
      dataReferencia,
      forecast: options.forecast ?? calcularPrevisaoCaixa(data, 5, dataReferencia),
      lateStages: options.lateStages,
    },
  );
}

export function conciliarExtratoPilotis(
  data: PilotisDataState,
  linhas: ExtratoLinhaEntrada[],
): ExtratoLinhaConciliada[] {
  return conciliarExtratoBancario(
    linhas,
    toDomainTransactions(data.transactions),
    toDomainInstallments(data.installments),
    data.projects.map((p) => ({ id: p.id, nome: p.name })),
  );
}

export function calculateInstallmentProgress(installments: Installment[], projectId: string) {
  return installmentProgress(toDomainInstallments(installments), projectId);
}

export function calculateTeamPayroll(data: Pick<PilotisDataState, 'employees' | 'allocations' | 'projects' | 'settings'>, month: string) {
  return planMonthlyPayroll(data, month, toDomainTaxParams(data.settings, month + '-01'));
}

export function getWorkPackageBudget(stages: Pick<ProjectStage, 'budgetedCost'>[]): number {
  return roundCents(stages.reduce((sum, stage) => sum + (stage.budgetedCost ?? 0), 0));
}

export function describeScheduleCycle(stages: ProjectStage[], schedule = calcularCaminhoCriticoObra(stages)): string | null {
  if (!schedule.cicloDetectado) return null;
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const cycle = (schedule.primeiroCiclo ?? schedule.nosEmCiclo).map((id) => {
    const stage = byId.get(id);
    return stage ? `${stage.wbsCode} ${stage.name}` : id;
  });
  return `Dependência circular: ${cycle.join(' → ')}. Remova uma das ligações para salvar.`;
}

const planningDateFormatter = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function planningTodayISO(date = new Date()): string {
  return planningDateFormatter.format(date);
}

export function getProjectSchedule(project: Project, stages: ProjectStage[], referenceDate = planningTodayISO()) {
  const criticalPath = calcularCaminhoCriticoObra(stages);
  const details = new Map(criticalPath.detalhes.map((detail) => [detail.etapaId, detail]));
  const ordered = [...stages].sort((a, b) =>
    (details.get(a.id)?.inicioMaisCedo ?? a.startWeek) - (details.get(b.id)?.inicioMaisCedo ?? b.startWeek)
    || a.wbsCode.localeCompare(b.wbsCode, 'pt-BR', { numeric: true }));
  const pending = ordered.filter((stage) => stage.status !== 'Concluída');
  const byId = new Map(stages.map((stage) => [stage.id, stage]));
  const nextStage = pending.find((stage) => stage.status === 'Em andamento')
    ?? pending.find((stage) => (stage.dependsOn ?? []).every((id) => byId.get(id)?.status === 'Concluída'))
    ?? pending[0];
  const elapsedDays = diffDaysISO(referenceDate, project.startDate);
  const forecastEndDate = stages.length && !criticalPath.cicloDetectado && elapsedDays !== null
    ? addDaysISO(project.startDate, Math.ceil(criticalPath.duracaoTotal * 7))
    : null;
  const milestones = pending.filter((stage) => stage.isMilestone && details.has(stage.id)).map((stage) => ({
    stage,
    date: elapsedDays === null ? null : addDaysISO(project.startDate, Math.ceil(details.get(stage.id)!.terminoMaisCedo * 7)),
  })).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const todayWeek = elapsedDays === null ? null : elapsedDays / 7;
  return { criticalPath, details, nextStage, milestones, forecastEndDate, todayWeek, referenceWeek: Math.max(0, todayWeek ?? 0) };
}

export function getScheduleBaselineStages(
  stages: ProjectStage[],
  schedule?: ReturnType<typeof getProjectSchedule>,
): ScheduleBaselineStage[] {
  return stages.map((stage) => {
    const detail = schedule?.details.get(stage.id);
    return {
      stageId: stage.id,
      startWeek: detail?.inicioMaisCedo ?? stage.baselineStartWeek ?? stage.startWeek,
      durationWeeks: detail?.duracaoSemanas ?? stage.baselineDurationWeeks ?? stage.durationWeeks,
      budgetedCost: (schedule ? stage.budgetedCost : (stage.baselineBudgetedCost ?? stage.budgetedCost)) ?? 0,
    };
  });
}

export function validateReplanJustification(value: string): string {
  const justification = value.trim();
  if (!justification) throw new Error('Informe a justificativa para registrar o replanejamento.');
  if (justification.length > 500) throw new Error('A justificativa pode ter até 500 caracteres.');
  return justification;
}

export function scheduleDeliveryVariance(endDate: string, baselineEndDate: string): number | null {
  return diffDaysISO(endDate, baselineEndDate);
}

export function getRecordedScheduleProgress(
  project: Project,
  records: ScheduleProgress[],
  referenceDate: string,
  progressToday: number,
) {
  const byDate = new Map<string, ScheduleProgress>();
  for (const record of records) {
    if (record.projectId !== project.id || record.date >= referenceDate) continue;
    if ((byDate.get(record.date)?.scheduleRevision ?? -1) < record.scheduleRevision) byDate.set(record.date, record);
  }
  return [
    ...[...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
    { date: referenceDate, progressPct: progressToday },
  ].flatMap(({ date, progressPct }) => {
    const days = diffDaysISO(date, project.startDate);
    return days === null || days < 0 ? [] : [{ week: days / 7, progressPct, date }];
  });
}
