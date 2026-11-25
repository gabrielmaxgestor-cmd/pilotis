import type { Bytes } from 'firebase/firestore';

export type ActorRole = 'Sócio' | 'Responsável administrativo';

export type ModuleKey =
  | 'dashboard'
  | 'ai'
  | 'financial'
  | 'clients'
  | 'planning'
  | 'team'
  | 'pops'
  | 'compliance'
  | 'settings';

export interface AuditMeta {
  ownerUid: string;
  createdBy: ActorRole;
  createdAt?: unknown;
  updatedBy: ActorRole;
  updatedAt?: unknown;
}

export interface CompanySettings extends AuditMeta {
  id: string;
  companyName: string;
  cnpj: string;
  fiscalAddress: string;
  city: string;
  email: string;
  phone: string;
  accentColor: string;
  logoDataUrl?: string;
  pdfShowLogo: boolean;
  inssRate: number;
  fgtsRate: number;
  vacationRate: number;
  thirteenthRate: number;
  targetMarginPct?: number;
  taxParamsEffectiveDate: string;
  taxParamsSource: string;
}

export type ClientStatus = 'Potencial' | 'Ativo' | 'Em garantia' | 'Inativo';

export interface Client extends AuditMeta {
  id: string;
  name: string;
  origin: string;
  referredBy?: string;
  city: string;
  phone: string;
  email: string;
  notes: string;
  status: ClientStatus;
  referralsCount: number;
  testimonialStatus: string;
}

export type ProjectType = 'Casa residencial' | 'Reforma' | 'Obra satélite';
export type QuoteStatus = 'Rascunho' | 'Enviado' | 'Em negociação' | 'Ganho' | 'Perdido' | 'Descartado';
export type ContractSignStatus =
  | 'Não gerado'
  | 'Aguardando assinatura'
  | 'Assinado pelo cliente'
  | 'Assinado pelas partes';

export interface Quote extends AuditMeta {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  title: string;
  type: ProjectType;
  city: string;
  areaM2: number;
  estimatedMonths: number;
  validityDays: number;
  description: string;
  origin: string;
  laborCost: number;
  subcontractCost: number;
  equipmentCost: number;
  bdiCost: number;
  taxCost: number;
  pricingMarginPct?: number;
  totalValue: number;
  downPaymentPct: number;
  installmentsCount: number;
  probabilityPct: number;
  status: QuoteStatus;
  discardReason: string;
  lossReason?: string;
  version?: string;
  versionHistory?: string[];
  contractSignStatus?: ContractSignStatus;
  contractSignedAt?: string;
  contractAddenda?: string[];
  addendaTotalValue?: number;
  projectId: string;
}

export type ProjectStatus = 'Contratada' | 'Em execução' | 'Concluída';
export type ProjectContractKind = 'Principal' | 'Satélite';
export type ProjectPlanningStatus = 'Aguardando modelo de cronograma' | 'Cronograma criado';

export interface Project extends AuditMeta {
  id: string;
  name: string;
  quoteId: string;
  clientId: string;
  clientName: string;
  type: ProjectType;
  contractKind?: ProjectContractKind;
  planningStatus?: ProjectPlanningStatus;
  scheduleRevision?: number;
  workInProgressLimit?: number;
  scheduleBaselineVersion?: number;
  scheduleStageIds?: string[];
  contractValue: number;
  contractPdf?: Bytes;
  downPaymentPct?: number;
  installmentsCount?: number;
  addendaTotalValue?: number;
  budgetedLabor: number;
  budgetedSubcontract: number;
  budgetedEquipment: number;
  budgetedBdi: number;
  budgetedTax: number;
  startDate: string;
  baselineEndDate: string;
  forecastEndDate: string;
  status: ProjectStatus;
  contractSigned: boolean;
  warrantyStartDate: string;
}

export type StageStatus =
  | 'A fazer'
  | 'Em andamento'
  | 'Aguardando material'
  | 'Em conferência'
  | 'Concluída';

export interface ProjectStage extends AuditMeta {
  id: string;
  projectId: string;
  wbsCode: string;
  phase: string;
  deliverable?: string;
  name: string;
  responsible: string;
  durationWeeks: number;
  startWeek: number;
  baselineStartWeek: number;
  baselineDurationWeeks: number;
  baselineBudgetedCost?: number;
  progressPct: number;
  budgetedCost: number;
  popId: string;
  dependsOn: string[];
  isMilestone: boolean;
  status: StageStatus;
  materialExpectedDate: string;
  delayCategory: string;
  delayJustification: string;
  checklistCompleted: string[];
}

export interface ScheduleBaselineStage {
  stageId: string;
  startWeek: number;
  durationWeeks: number;
  budgetedCost: number;
}

export interface ScheduleBaseline extends AuditMeta {
  id: string;
  projectId: string;
  version: number;
  recordedDate: string;
  endDate: string;
  justification: string;
  stages: ScheduleBaselineStage[];
}

export interface ScheduleProgress extends AuditMeta {
  id: string;
  projectId: string;
  scheduleRevision: number;
  date: string;
  progressPct: number;
}

export type WeatherType = 'Sol' | 'Chuva fraca' | 'Chuva forte';

export interface DailyLog extends AuditMeta {
  id: string;
  projectId: string;
  date: string;
  presentCount: number;
  weather: WeatherType;
  activities: string;
  occurrences: string;
  photoNotes: string[];
}

export type TransactionKind = 'income' | 'expense' | 'loan';
export type TransactionStatus = 'Recebido' | 'Pago' | 'A vencer' | 'Em atraso' | 'Não é receita';
export type InvoiceStatus = 'Emitida' | 'A emitir' | 'Não emitida' | 'Não se aplica';
export type TransactionSource = 'manual' | 'orcamento' | 'planilha' | 'extrato' | 'folha';

export type InstallmentStatus = 'A vencer' | 'Recebida' | 'Em atraso';

export interface Installment extends AuditMeta {
  id: string;
  projectId: string;
  projectName: string;
  quoteId: string;
  clientId: string;
  clientName: string;
  number: number;
  label: string;
  dueDate: string;
  amount: number;
  status: InstallmentStatus;
  invoiceStatus: InvoiceStatus;
  receivedDate: string;
  transactionId: string;
}

export interface FinancialTransaction extends AuditMeta {
  id: string;
  date: string;
  dueDate: string;
  description: string;
  entryKind: TransactionKind;
  category: string;
  projectId: string;
  projectName: string;
  amount: number;
  isForecast: boolean;
  wasForecast?: boolean;
  statementKey?: string;
  payrollEmployeeId?: string;
  payrollPeriod?: string;
  payrollBase?: number;
  payrollCharges?: number;
  payrollProvisions?: number;
  status: TransactionStatus;
  invoiceStatus: InvoiceStatus;
  paymentMethod: string;
  receiptRef?: string;
  receiptFile?: { name: string; mimeType: string; content: Bytes };
  installmentLabel: string;
  installmentId?: string;
  quoteId: string;
  debtId: string;
  source: TransactionSource;
}

export type DebtType =
  | 'Empréstimo bancário'
  | 'Conta garantida'
  | 'Tributo em atraso'
  | 'Encargos trabalhistas'
  | 'Outro';
export type DebtStatus = 'Em dia' | 'Em uso' | 'Em atraso' | 'A parcelar' | 'Quitada';

export interface Debt extends AuditMeta {
  id: string;
  creditor: string;
  debtType: DebtType;
  principalBalance: number;
  monthlyCost: number;
  remainingInstallments: number;
  nextDueDate: string;
  status: DebtStatus;
  notes: string;
}

export type EmploymentType = 'CLT' | 'PJ' | 'Autônomo' | 'Freelancer' | 'Diarista' | 'Informal' | 'Sócio';
export type EmployeeOccurrenceKind = 'Elogio' | 'Registro' | 'Advertência' | 'Acidente' | 'Quase acidente';
export interface EmployeeOccurrence extends AuditMeta {
  id: string;
  kind: EmployeeOccurrenceKind;
  date: string;
  description: string;
}
export type EpiStatus = 'Em dia' | 'A repor' | 'Pendente';
export type OnboardingStatus = 'Concluída' | 'Em andamento' | 'Pendente';

export interface Employee extends AuditMeta {
  id: string;
  name: string;
  role: string;
  employmentType: EmploymentType;
  baseSalary: number;
  paymentFrequency?: 'monthly' | 'oneOff';
  paymentMonth?: string;
  paymentMethod: string;
  startDate: string;
  currentProjectId: string;
  currentProjectName: string;
  asoExpiry: string;
  nr18Expiry: string;
  nr35Expiry: string;
  epiStatus: EpiStatus;
  onboardingStatus: OnboardingStatus;
  onboardingStart?: string;
  epiExpiry?: string;
  vacationStart?: string;
  vacationEnd?: string;
  vacationPeriod: string;
  vacationScheduled: string;
  occurrencesNote: string;
}

export interface Allocation extends AuditMeta {
  id: string;
  employeeId: string;
  employeeName: string;
  projectId: string;
  projectName: string;
  weekStart: string;
  stageId?: string;
  status: 'Obra' | 'Férias';
}

export type ProjectRiskCategory = 'Chuva' | 'Material do cliente' | 'Equipe' | 'Retrabalho' | 'Projeto' | 'Dependência' | 'Outros';
export type ProjectRiskImpact = 'Baixo' | 'Médio' | 'Alto';
export type ProjectRiskStatus = 'Aberto' | 'Monitorado' | 'Resolvido';

export interface ProjectRisk extends AuditMeta {
  id: string;
  projectId: string;
  stageId: string;
  category: ProjectRiskCategory;
  description: string;
  impact: ProjectRiskImpact;
  status: ProjectRiskStatus;
}

export type PopStatus = 'Vigente' | 'Em revisão';

export interface Pop extends AuditMeta {
  id: string;
  title: string;
  serviceType: string;
  version: string;
  linkedStagePhase: string;
  objective: string;
  materialsAndEpi: string;
  steps: string[];
  acceptanceCriteria: string[];
  status: PopStatus;
  usedInOnboarding: boolean;
}

export type ComplianceKind = 'Obrigação' | 'Certidão' | 'Documento de obra' | 'Licitação';
export type ComplianceStatus =
  | 'Em dia'
  | 'Válida'
  | 'Anexado'
  | 'Vence em breve'
  | 'Em atraso'
  | 'Pendente'
  | 'Parcial';

export interface ComplianceItem extends AuditMeta {
  id: string;
  kind: ComplianceKind;
  title: string;
  category: string;
  projectId: string;
  projectName: string;
  competence: string;
  dueDate: string;
  issuedDate: string;
  fileName: string;
  mandatory: boolean;
  status: ComplianceStatus;
  notes: string;
}

export type TenderStatus =
  | 'Acompanhando'
  | 'Em preparo'
  | 'Documentos pendentes'
  | 'Enviado'
  | 'Encerrado';

export interface Tender extends AuditMeta {
  id: string;
  agency: string;
  objectTitle: string;
  openingDate: string;
  estimatedValue: number;
  status: TenderStatus;
  notes: string;
}

export type WarrantyStatus = 'Aberto' | 'Em atendimento' | 'Resolvido';

export interface WarrantyCall extends AuditMeta {
  id: string;
  projectId: string;
  projectName: string;
  description: string;
  openedDate: string;
  deadlineDate: string;
  cost: number;
  status: WarrantyStatus;
}

export interface AuditLog {
  id: string;
  ownerUid: string;
  registeredBy: ActorRole;
  action: 'Criação' | 'Atualização' | 'Exclusão' | 'Importação';
  entityType: string;
  summary: string;
  beforeValue?: string;
  afterValue?: string;
  createdAt?: unknown;
}

export interface PilotisDataState {
  settings: CompanySettings | null;
  clients: Client[];
  quotes: Quote[];
  projects: Project[];
  installments: Installment[];
  stages: ProjectStage[];
  projectRisks?: ProjectRisk[];
  baselines?: ScheduleBaseline[];
  scheduleProgress?: ScheduleProgress[];
  dailyLogs: DailyLog[];
  transactions: FinancialTransaction[];
  debts: Debt[];
  employees: Employee[];
  allocations: Allocation[];
  pops: Pop[];
  complianceItems: ComplianceItem[];
  tenders: Tender[];
  warrantyCalls: WarrantyCall[];
  auditLogs: AuditLog[];
}
