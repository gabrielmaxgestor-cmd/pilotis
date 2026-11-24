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
  TransactionKind,
  WarrantyCall,
} from '../types/pilotis';
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
  calcularEncargos,
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
import { monthKey, roundCents, todayISO } from './formatters';
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
  const totalRate =
    (settings.inssRate || 0) +
    (settings.fgtsRate || 0) +
    (settings.vacationRate || 0) +
    (settings.thirteenthRate || 0);
  if (totalRate <= 0) return null;
  return {
    inssPct: settings.inssRate || 0,
    fgtsPct: settings.fgtsRate || 0,
    feriasPct: settings.vacationRate || 0,
    decimoTerceiroPct: settings.thirteenthRate || 0,
    vigenciaInicio: settings.taxParamsEffectiveDate || referenceDate,
    fonte: settings.taxParamsSource || undefined,
  };
}

export function toDomainProjectDreInput(project: Project): ObraDreInput {
  return {
    id: project.id,
    nome: project.name,
    valorContrato: project.contractValue,
    orcadoMaoDeObra: project.budgetedLabor || 0,
    orcadoEmpreita: project.budgetedSubcontract || 0,
    orcadoEquipamentos: project.budgetedEquipment || 0,
    orcadoImpostos: project.budgetedTax || 0,
    orcadoBdi: project.budgetedBdi || 0,
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
    semanaInicioBaseline: s.baselineStartWeek,
    duracaoBaselineSemanas: s.baselineDurationWeeks,
    custoOrcadoBaseline: s.budgetedCost,
  }));
}

export function toDomainComplianceItems(
  items: ComplianceItem[],
): ItemConformidadeEntrada[] {
  return items.map((c) => ({
    id: c.id,
    tipo: c.kind,
    categoria: c.category,
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
          c.status === 'Em dia' ||
          c.status === 'Vence em breve' ||
          c.status === 'Em atraso' ||
          c.status === 'Pendente'
            ? c.status
            : 'Pendente',
        arquivo: c.fileName || undefined,
      });
    } else if (c.kind === 'Certidão') {
      certidoes.push({
        ...DOMAIN_AUDIT_FALLBACK,
        id: c.id,
        titulo: c.title,
        esfera: 'Outro',
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
  dataReferencia = todayISO(),
): IndicadoresDashboardResult {
  return indicadoresDashboard({
    dataReferencia,
    lancamentos: toDomainTransactions(data.transactions),
    parcelas: toDomainInstallments(data.installments),
    obras: data.projects.map((p) => ({
      ...toDomainProjectDreInput(p),
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
  dataBase = todayISO(),
): PrevisaoCaixaResult {
  return previsaoCaixa(mesesCount, {
    dataBase,
    saldoInicial: calcularSaldoInicialCaixa(data.transactions, dataBase),
    lancamentos: toDomainTransactions(data.transactions),
    parcelas: toDomainInstallments(data.installments),
    orcamentos: toDomainQuotes(data.quotes),
    colaboradores: toDomainEmployees(data.employees),
    parametrosEncargos: toDomainTaxParams(data.settings, dataBase),
  });
}

export function calcularDreObra(
  project: Project,
  transactions: FinancialTransaction[],
): DreObraResult {
  return dre(
    toDomainProjectDreInput(project),
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
    toDomainEmployees(employees),
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
  );
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
): CurvaSResult {
  return curvaS(
    toDomainStages(stages),
    toDomainBaselineFromStages(stages),
    semanaReferencia,
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
  return prontidaoLicitacao(toDomainComplianceItems(items));
}

export function calcularProntidaoLicitacaoPorCategoria(
  items: ComplianceItem[],
): ProntidaoLicitacaoCategoria[] {
  return prontidaoLicitacaoPorCategoria(toDomainComplianceItems(items));
}

export function calcularResumoFunilOrcamentos(
  quotes: Quote[],
): ResumoFunilOrcamentosResult {
  return resumoFunilOrcamentos(toDomainQuotes(quotes));
}

export function calcularResumoConformidade(
  items: ComplianceItem[],
  transactions: FinancialTransaction[],
  dataReferencia = todayISO(),
  installments: Installment[] = [],
): ResumoConformidadeResult {
  return resumoConformidade(
    toDomainComplianceItems(items),
    toDomainTransactions(transactions),
    dataReferencia,
    toDomainInstallments(installments),
  );
}

export function calcularAlertasSistema(
  data: PilotisDataState,
  dataReferencia = todayISO(),
): AlertaDominio[] {
  const { obrigacoes, certidoes } = toDomainComplianceCollections(
    data.complianceItems,
  );
  return alertas(
    {
      config: data.settings
        ? {
            createdBy: 'Sócio',
            createdAt: '',
            updatedBy: 'Sócio',
            updatedAt: '',
            id: data.settings.id,
            nomeEmpresa: data.settings.companyName,
            cnpj: data.settings.cnpj,
            enderecoFiscal: data.settings.fiscalAddress,
            cidade: data.settings.city,
            emailEmpresa: data.settings.email,
            telefone: data.settings.phone,
            corDestaque: data.settings.accentColor,
            exibirEmblemaPdf: data.settings.pdfShowLogo,
            parametrosEncargos: toDomainTaxParams(data.settings, dataReferencia),
          }
        : null,
      lancamentos: toDomainTransactions(data.transactions),
      parcelas: toDomainInstallments(data.installments),
      orcamentos: toDomainQuotes(data.quotes),
      colaboradores: toDomainEmployees(data.employees),
      obrigacoes,
      certidoes,
      etapas: toDomainStages(data.stages),
      garantias: toDomainWarranties(data.warrantyCalls),
    },
    {
      dataReferencia,
      saldoInicialCaixa: calcularSaldoInicialCaixa(
        data.transactions,
        dataReferencia,
      ),
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
