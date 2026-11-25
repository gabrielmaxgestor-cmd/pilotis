import {
  Bytes,
  collection,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
  type DocumentReference,
  type Transaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import type {
  ActorRole,
  Allocation,
  Employee,
  CompanySettings,
  ComplianceItem,
  ComplianceFile,
  DailyLog,
  Debt,
  EmployeeOccurrence,
  EmployeeOccurrenceKind,
  FinancialTransaction,
  Installment,
  MarketingPhotoRef,
  PilotisDataState,
  Pop,
  Project,
  ProjectContractKind,
  ProjectFollowUp,
  ProjectStage,
  ProjectType,
  Quote,
  ScheduleBaseline,
  StageStatus,
  WarrantyCall,
} from '../types/pilotis';
import {
  applyFieldStageUpdate,
  type FieldStageUpdate,
  addDaysISO,
  addMonthsISO,
  allocateScheduleBudget,
  calcularCurvaSObra,
  calculateTeamPayroll,
  describeScheduleCycle,
  diffDaysISO,
  getProjectSchedule,
  isPublishedPop,
  linkedPopChecklist,
  getClosureReview,
  getWarrantyWindow,
  isReleasedProject,
  getScheduleBaselineStages,
  planningTodayISO,
  normalizeDelayCategory,
  DEFAULT_WORK_IN_PROGRESS_LIMIT,
  resolveTeamWeek,
  validateStageDelay,
  validateStageWorkflow,
  validateWorkInProgressLimit,
  validateReplanJustification,
  roundCents,
  weekStartingOn,
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  gerarParcelas,
  isValidISODate,
  isActualReceipt,
  normalizeCompetence,
  type InvoiceReceiptTarget,
  validarLancamentoFinanceiro,
  resolverStatusParcela,
  todayISO,
  validarDadosConfirmacaoOrcamento,
} from '../domain';
import { createContractPdf } from '../domain/contractPdf';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

interface FinancialAuditFieldMeta {
  label: string;
  format: 'brl' | 'pct' | 'date' | 'forecast' | 'text';
}

const FINANCIAL_AUDIT_FIELDS: Record<string, FinancialAuditFieldMeta> = {
  amount: { label: 'Valor', format: 'brl' },
  entryKind: { label: 'Tipo', format: 'text' },
  category: { label: 'Categoria', format: 'text' },
  isForecast: { label: 'Natureza', format: 'forecast' },
  invoiceStatus: { label: 'Nota fiscal', format: 'text' },
  dueDate: { label: 'Vencimento', format: 'date' },
  date: { label: 'Data', format: 'date' },
  principalBalance: { label: 'Saldo devedor', format: 'brl' },
  monthlyCost: { label: 'Custo mensal', format: 'brl' },
  remainingInstallments: { label: 'Parcelas restantes', format: 'text' },
  nextDueDate: { label: 'Próximo vencimento', format: 'date' },
  totalValue: { label: 'Valor total', format: 'brl' },
  laborCost: { label: 'Mão de obra', format: 'brl' },
  subcontractCost: { label: 'Empreita', format: 'brl' },
  equipmentCost: { label: 'Equipamentos', format: 'brl' },
  bdiCost: { label: 'BDI', format: 'brl' },
  taxCost: { label: 'Impostos', format: 'brl' },
  downPaymentPct: { label: 'Entrada', format: 'pct' },
  installmentsCount: { label: 'Parcelas', format: 'text' },
  contractValue: { label: 'Valor do contrato', format: 'brl' },
  budgetedLabor: { label: 'Orçamento mão de obra', format: 'brl' },
  budgetedSubcontract: { label: 'Orçamento empreita', format: 'brl' },
  budgetedEquipment: { label: 'Orçamento equipamentos', format: 'brl' },
  budgetedBdi: { label: 'Orçamento BDI', format: 'brl' },
  budgetedTax: { label: 'Orçamento impostos', format: 'brl' },
  budgetedCost: { label: 'Custo orçado', format: 'brl' },
  baseSalary: { label: 'Salário base', format: 'brl' },
  employmentType: { label: 'Vínculo', format: 'text' },
  estimatedValue: { label: 'Valor estimado', format: 'brl' },
  cost: { label: 'Custo', format: 'brl' },
  inssRate: { label: 'INSS', format: 'pct' },
  fgtsRate: { label: 'FGTS', format: 'pct' },
  vacationRate: { label: 'Férias', format: 'pct' },
  thirteenthRate: { label: '13º salário', format: 'pct' },
  targetMarginPct: { label: 'Meta de margem', format: 'pct' },
  addendaTotalValue: { label: 'Total em aditivos', format: 'brl' },
  contractSignStatus: { label: 'Assinatura do contrato', format: 'text' },
  version: { label: 'Versão do orçamento', format: 'text' },
  lossReason: { label: 'Motivo da perda', format: 'text' },
  discardReason: { label: 'Motivo do descarte', format: 'text' },
};

const COLLECTIONS_WITH_STATUS_FINANCIAL_AUDIT = new Set([
  'transactions',
  'debts',
  'quotes',
  'projects',
]);

function formatAuditValue(val: unknown, format: FinancialAuditFieldMeta['format']): string {
  if (val === undefined || val === null || val === '') return '—';
  if (format === 'brl' && typeof val === 'number') return formatBRL(val);
  if (format === 'pct' && typeof val === 'number') return `${val}%`;
  if (format === 'date' && typeof val === 'string') return formatDateBR(val);
  if (format === 'forecast') return val ? 'Previsto' : 'Realizado';
  return String(val);
}

function buildFinancialFieldDiff(
  collectionName: string,
  prevData: Record<string, unknown>,
  nextData: Record<string, unknown>,
): { before: string; after: string } | null {
  const beforeParts: string[] = [];
  const afterParts: string[] = [];

  for (const [key, nextVal] of Object.entries(nextData)) {
    if (nextVal === undefined) continue;
    let meta = FINANCIAL_AUDIT_FIELDS[key];
    if (!meta && key === 'status' && COLLECTIONS_WITH_STATUS_FINANCIAL_AUDIT.has(collectionName)) {
      meta = { label: 'Status', format: 'text' };
    }
    if (!meta) continue;

    const prevVal = prevData[key];
    if (prevVal === nextVal) continue;

    beforeParts.push(`${meta.label}: ${formatAuditValue(prevVal, meta.format)}`);
    afterParts.push(`${meta.label}: ${formatAuditValue(nextVal, meta.format)}`);
  }

  if (beforeParts.length === 0) return null;
  return {
    before: beforeParts.join(' · '),
    after: afterParts.join(' · '),
  };
}

export function generateId(prefix = 'rec'): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${cleanPrefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  }
  return `${cleanPrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribePilotisCollections(
  uid: string,
  onUpdate: (partial: Partial<PilotisDataState>) => void
): () => void {
  const unsubs: Unsubscribe[] = [];

  const settingsRef = doc(db, 'companySettings', uid);
  unsubs.push(
    onSnapshot(
      settingsRef,
      (snap) => {
        onUpdate({
          settings: snap.exists()
            ? ({ id: snap.id, ...snap.data() } as CompanySettings)
            : null,
        });
      },
      (err) => handleFirestoreError(err, OperationType.GET, `companySettings/${uid}`)
    )
  );

  const collectionMappings: Array<{
    colName: string;
    stateKey: keyof Omit<PilotisDataState, 'settings'>;
  }> = [
    { colName: 'clients', stateKey: 'clients' },
    { colName: 'quotes', stateKey: 'quotes' },
    { colName: 'projects', stateKey: 'projects' },
    { colName: 'parcelas', stateKey: 'installments' },
    { colName: 'stages', stateKey: 'stages' },
    { colName: 'projectRisks', stateKey: 'projectRisks' },
    { colName: 'baselines', stateKey: 'baselines' },
    { colName: 'scheduleProgress', stateKey: 'scheduleProgress' },
    { colName: 'dailyLogs', stateKey: 'dailyLogs' },
    { colName: 'transactions', stateKey: 'transactions' },
    { colName: 'debts', stateKey: 'debts' },
    { colName: 'employees', stateKey: 'employees' },
    { colName: 'allocations', stateKey: 'allocations' },
    { colName: 'pops', stateKey: 'pops' },
    { colName: 'popVersions', stateKey: 'popVersions' },
    { colName: 'complianceItems', stateKey: 'complianceItems' },
    { colName: 'tenders', stateKey: 'tenders' },
    { colName: 'warrantyCalls', stateKey: 'warrantyCalls' },
    { colName: 'projectClosures', stateKey: 'projectClosures' },
    { colName: 'projectFollowUps', stateKey: 'projectFollowUps' },
    { colName: 'auditLogs', stateKey: 'auditLogs' },
  ];

  for (const { colName, stateKey } of collectionMappings) {
    const q = query(collection(db, colName), where('ownerUid', '==', uid));
    unsubs.push(
      onSnapshot(
        q,
        (snap) => {
          const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          onUpdate({ [stateKey]: items } as Partial<PilotisDataState>);
        },
        (err) => handleFirestoreError(err, OperationType.LIST, colName)
      )
    );
  }

  return () => {
    for (const u of unsubs) u();
  };
}

export async function createRecord<T extends Record<string, unknown>>(
  collectionName: string,
  uid: string,
  actor: ActorRole,
  payload: T,
  auditSummary: string,
  customId?: string
): Promise<string> {
  const id = customId || generateId(collectionName.slice(0, 4));
  const ref = doc(db, collectionName, id);
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  try {
    const batch = writeBatch(db);
    batch.set(ref, {
      ...payload,
      ownerUid: uid,
      createdBy: actor,
      updatedBy: actor,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(auditRef, {
      ownerUid: uid,
      registeredBy: actor,
      action: 'Criação',
      entityType: clampStr(collectionName, 60),
      summary: clampStr(auditSummary, 240),
      beforeValue: '',
      afterValue: clampStr(auditSummary, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    return id;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${collectionName}/${id}`);
  }
}

export async function updateRecord<T extends Record<string, unknown>>(
  collectionName: string,
  id: string,
  uid: string,
  actor: ActorRole,
  payload: T,
  auditSummary: string,
  beforeValue = '',
  afterValue = ''
): Promise<void> {
  const ref = doc(db, collectionName, id);
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  try {
    let resolvedBefore = beforeValue;
    let resolvedAfter = afterValue || auditSummary;

    const touchesFinancialField = Object.keys(payload).some(
      (key) =>
        Boolean(FINANCIAL_AUDIT_FIELDS[key]) ||
        (key === 'status' && COLLECTIONS_WITH_STATUS_FINANCIAL_AUDIT.has(collectionName)),
    );

    if (touchesFinancialField) {
      const existingSnap = await getDoc(ref);
      if (existingSnap.exists()) {
        const diff = buildFinancialFieldDiff(
          collectionName,
          existingSnap.data() as Record<string, unknown>,
          payload,
        );
        if (diff) {
          resolvedBefore = diff.before;
          resolvedAfter = diff.after;
        }
      }
    }

    const batch = writeBatch(db);
    batch.update(ref, {
      ...payload,
      updatedBy: actor,
      updatedAt: serverTimestamp(),
    });
    batch.set(auditRef, {
      ownerUid: uid,
      registeredBy: actor,
      action: 'Atualização',
      entityType: clampStr(collectionName, 60),
      summary: clampStr(auditSummary, 240),
      beforeValue: clampStr(resolvedBefore, 240),
      afterValue: clampStr(resolvedAfter, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${collectionName}/${id}`);
  }
}

export async function deleteRecord(
  collectionName: string,
  id: string,
  uid: string,
  actor: ActorRole,
  auditSummary: string
): Promise<void> {
  const ref = doc(db, collectionName, id);
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  try {
    const batch = writeBatch(db);
    batch.delete(ref);
    batch.set(auditRef, {
      ownerUid: uid,
      registeredBy: actor,
      action: 'Exclusão',
      entityType: clampStr(collectionName, 60),
      summary: clampStr(auditSummary, 240),
      beforeValue: clampStr(auditSummary, 240),
      afterValue: 'Excluído',
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${collectionName}/${id}`);
  }
}

export async function upsertCompanySettings(
  uid: string,
  actor: ActorRole,
  existing: CompanySettings | null,
  data: Partial<CompanySettings>
): Promise<void> {
  const ref = doc(db, 'companySettings', uid);
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  try {
    const batch = writeBatch(db);
    let beforeValue = '';
    let afterValue = '';
    let summary = 'Configurações da empresa atualizadas';

    if (!existing) {
      const initialSettings = {
        ownerUid: uid,
        companyName: clampStr(data.companyName || 'Pilotis Soluções Construtivas', 120),
        cnpj: clampStr(data.cnpj || '', 24),
        fiscalAddress: clampStr(data.fiscalAddress || '', 240),
        city: clampStr(data.city || 'Valença · RJ', 80),
        email: clampStr(data.email || '', 120),
        phone: clampStr(data.phone || '', 40),
        accentColor: clampStr(data.accentColor || '#9A6212', 20),
        logoDataUrl: clampStr(data.logoDataUrl || '', 200000),
        pdfShowLogo: data.pdfShowLogo ?? true,
        popPdfHeader: clampStr(data.popPdfHeader || '', 120),
        popPdfFooter: clampStr(data.popPdfFooter || '', 120),
        inssRate: data.inssRate ?? 0,
        fgtsRate: data.fgtsRate ?? 0,
        vacationRate: data.vacationRate ?? 0,
        thirteenthRate: data.thirteenthRate ?? 0,
        targetMarginPct: data.targetMarginPct ?? 0,
        taxParamsEffectiveDate: clampStr(data.taxParamsEffectiveDate || '', 20),
        taxParamsSource: clampStr(data.taxParamsSource || '', 120),
        createdBy: actor,
        updatedBy: actor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      batch.set(ref, initialSettings);
      afterValue = `Empresa: ${initialSettings.companyName}`;
    } else {
      const diff = buildFinancialFieldDiff(
        'companySettings',
        existing as unknown as Record<string, unknown>,
        data as Record<string, unknown>,
      );
      if (diff) {
        beforeValue = diff.before;
        afterValue = diff.after;
        summary = 'Parâmetros financeiros e encargos atualizados';
      } else {
        const changedLabels: string[] = [];
        if (data.companyName !== undefined && data.companyName !== existing.companyName) {
          changedLabels.push(`Nome: ${data.companyName}`);
        }
        if (data.accentColor !== undefined && data.accentColor !== existing.accentColor) {
          changedLabels.push(`Cor: ${data.accentColor}`);
        }
        if (data.logoDataUrl !== undefined && data.logoDataUrl !== (existing.logoDataUrl || '')) {
          changedLabels.push(data.logoDataUrl ? 'Logo atualizada' : 'Logo removida');
        }
        beforeValue = existing.companyName || '';
        afterValue =
          changedLabels.length > 0
            ? changedLabels.join(' · ')
            : data.companyName || existing.companyName || summary;
      }
      batch.update(ref, {
        ...data,
        updatedBy: actor,
        updatedAt: serverTimestamp(),
      });
    }

    batch.set(auditRef, {
      ownerUid: uid,
      registeredBy: actor,
      action: existing ? 'Atualização' : 'Criação',
      entityType: 'companySettings',
      summary: clampStr(summary, 240),
      beforeValue: clampStr(beforeValue, 240),
      afterValue: clampStr(afterValue, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `companySettings/${uid}`);
  }
}

export async function logSecurityAudit(
  uid: string,
  actor: ActorRole,
  summary: string,
  beforeValue = '',
  afterValue = ''
): Promise<void> {
  const auditRef = doc(db, 'auditLogs', generateId('aud'));
  try {
    const batch = writeBatch(db);
    batch.set(auditRef, {
      ownerUid: uid,
      registeredBy: actor,
      action: 'Atualização',
      entityType: 'authSecurity',
      summary: clampStr(summary, 240),
      beforeValue: clampStr(beforeValue, 240),
      afterValue: clampStr(afterValue, 240),
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, 'auditLogs/security');
  }
}

interface StageTemplateItem {
  wbsCode: string;
  phase: string;
  name: string;
  responsible: string;
  startWeek: number;
  durationWeeks: number;
  budgetPct: number;
  depWbs: string[];
  deliverable?: string;
  isMilestone?: boolean;
}

export function getStageTemplatesForType(type: ProjectType): StageTemplateItem[] {
  if (type === 'Obra satélite') {
    return [
      { wbsCode: '1.1', phase: '1 · Mobilização', name: 'Preparação e proteção do local', responsible: 'Equipe geral', startWeek: 0, durationWeeks: 1, budgetPct: 0.2, depWbs: [] },
      { wbsCode: '2.1', phase: '2 · Execução', name: 'Serviço principal da obra satélite', responsible: 'Pedreiros', startWeek: 1, durationWeeks: 2, budgetPct: 0.6, depWbs: ['1.1'] },
      { wbsCode: '3.1', phase: '3 · Entrega', deliverable: 'Serviço vistoriado e entregue', name: 'Vistoria e limpeza final', responsible: 'Sócios', startWeek: 3, durationWeeks: 1, budgetPct: 0.2, depWbs: ['2.1'] },
      { wbsCode: '3.2', phase: '3 · Entrega', deliverable: 'Serviço vistoriado e entregue', name: 'Entrega do serviço', responsible: 'Sócios', startWeek: 4, durationWeeks: 0, budgetPct: 0, depWbs: ['3.1'], isMilestone: true },
    ];
  }
  if (type === 'Reforma') {
    return [
      { wbsCode: '1.1', phase: '1 · Demolição e preparo', name: 'Demolição e limpeza inicial', responsible: 'Equipe geral', startWeek: 0, durationWeeks: 2, budgetPct: 0.15, depWbs: [] },
      { wbsCode: '2.1', phase: '2 · Instalações', name: 'Instalações hidráulicas e elétricas', responsible: 'Eletricistas e hidráulica', startWeek: 2, durationWeeks: 3, budgetPct: 0.25, depWbs: ['1.1'] },
      { wbsCode: '3.1', phase: '3 · Revestimentos', name: 'Revestimentos e pisos', responsible: 'Ladrilheiro', startWeek: 5, durationWeeks: 3, budgetPct: 0.3, depWbs: ['2.1'] },
      { wbsCode: '4.1', phase: '4 · Pintura e entrega', deliverable: 'Ambientes acabados e entregues', name: 'Pintura e acabamentos finais', responsible: 'Pintores', startWeek: 8, durationWeeks: 2, budgetPct: 0.2, depWbs: ['3.1'] },
      { wbsCode: '4.2', phase: '4 · Pintura e entrega', deliverable: 'Ambientes acabados e entregues', name: 'Entrega ao cliente', responsible: 'Sócios', startWeek: 10, durationWeeks: 0, budgetPct: 0.1, depWbs: ['4.1'], isMilestone: true },
    ];
  }
  return [
    { wbsCode: '1.1', phase: '1 · Fundação, estrutura e cobertura', deliverable: 'Estrutura coberta', name: 'Fundação e estrutura', responsible: 'Sócios e pedreiros', startWeek: 0, durationWeeks: 8, budgetPct: 0.2, depWbs: [] },
    { wbsCode: '1.2', phase: '1 · Fundação, estrutura e cobertura', deliverable: 'Estrutura coberta', name: 'Cobertura', responsible: 'Equipe de cobertura', startWeek: 8, durationWeeks: 5, budgetPct: 0.1, depWbs: ['1.1'] },
    { wbsCode: '2.1', phase: '2 · Instalações', name: 'Instalações hidráulicas', responsible: 'Hidráulica', startWeek: 9, durationWeeks: 4, budgetPct: 0.08, depWbs: ['1.1'] },
    { wbsCode: '2.2', phase: '2 · Instalações', name: 'Instalações elétricas', responsible: 'Eletricistas', startWeek: 9, durationWeeks: 6, budgetPct: 0.1, depWbs: ['1.1'] },
    { wbsCode: '3.1', phase: '3 · Revestimentos', name: 'Revestimento interno', responsible: 'Ladrilheiro e pedreiros', startWeek: 13, durationWeeks: 6, budgetPct: 0.18, depWbs: ['1.2', '2.1'] },
    { wbsCode: '3.2', phase: '3 · Revestimentos', name: 'Revestimento externo', responsible: 'Pedreiros', startWeek: 13, durationWeeks: 5, budgetPct: 0.1, depWbs: ['1.2'] },
    { wbsCode: '4.1', phase: '4 · Pintura e acabamentos', name: 'Pintura', responsible: 'Pintores', startWeek: 19, durationWeeks: 3, budgetPct: 0.1, depWbs: ['3.1'] },
    { wbsCode: '4.2', phase: '4 · Pintura e acabamentos', name: 'Acabamentos finais', responsible: 'Pedreiros', startWeek: 22, durationWeeks: 2, budgetPct: 0.08, depWbs: ['4.1', '2.2'] },
    { wbsCode: '5.1', phase: '5 · Entrega', deliverable: 'Casa vistoriada e entregue', name: 'Limpeza e vistoria final', responsible: 'Equipe geral', startWeek: 24, durationWeeks: 1, budgetPct: 0.06, depWbs: ['4.2'] },
    { wbsCode: '5.2', phase: '5 · Entrega', deliverable: 'Casa vistoriada e entregue', name: 'Entrega ao cliente', responsible: 'Sócios', startWeek: 25, durationWeeks: 0, budgetPct: 0, depWbs: ['5.1'], isMilestone: true },
  ];
}

export interface ConfirmQuoteParams {
  uid: string;
  actor: ActorRole;
  quoteId: string;
  clientId?: string;
  totalValue: number;
  downPaymentPct: number;
  installmentsCount: number;
  startDate: string;
  contractKind?: ProjectContractKind;
}

export interface ConfirmQuoteResult {
  projectId: string;
  parcelasCount: number;
  checklistCount: number;
}

class ConfirmValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfirmValidationError';
  }
}

class InstallmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InstallmentValidationError';
  }
}

export async function confirmQuoteAndGenerateProject(
  params: ConfirmQuoteParams
): Promise<ConfirmQuoteResult> {
  const { uid, actor, quoteId } = params;
  const projectId = generateId('proj');

  try {
    const result = await runTransaction(db, async (tx) => {
      const quoteRef = doc(db, 'quotes', quoteId);
      const quoteSnap = await tx.get(quoteRef);
      if (!quoteSnap.exists()) {
        throw new ConfirmValidationError('Orçamento não encontrado no banco de dados.');
      }

      const quoteData = quoteSnap.data() as Quote;
      if (quoteData.ownerUid !== uid) {
        throw new ConfirmValidationError('Orçamento não pertence à empresa autenticada.');
      }

      const resolvedClientId = (params.clientId ?? quoteData.clientId ?? '').trim();
      const resolvedTotalValue = quoteData.totalValue;
      if (params.totalValue !== resolvedTotalValue) {
        throw new ConfirmValidationError('O valor do orçamento mudou. Reabra a confirmação e revise os dados.');
      }
      if (quoteData.status === 'Ganho' && (
        resolvedClientId !== quoteData.clientId ||
        (quoteData.downPaymentPct != null && params.downPaymentPct !== quoteData.downPaymentPct) ||
        (quoteData.installmentsCount != null && params.installmentsCount !== quoteData.installmentsCount)
      )) {
        throw new ConfirmValidationError('O cliente e as condições de pagamento aprovadas estão congelados.');
      }

      const validation = validarDadosConfirmacaoOrcamento({
        clienteId: resolvedClientId,
        valorTotal: resolvedTotalValue,
        entradaPct: params.downPaymentPct,
        nParcelas: params.installmentsCount,
        dataInicio: params.startDate,
        status: quoteData.status,
        projectId: quoteData.projectId,
      });

      if (!validation.valido || !validation.dataInicioISO) {
        throw new ConfirmValidationError(validation.erros.join(' '));
      }

      const clientRef = doc(db, 'clients', resolvedClientId);
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists()) {
        throw new ConfirmValidationError('Cliente vinculado não encontrado. Cadastre ou selecione um cliente válido.');
      }
      const clientData = clientSnap.data() as { ownerUid?: string; name?: string };
      if (clientData.ownerUid !== uid) {
        throw new ConfirmValidationError('Cliente vinculado não pertence à empresa autenticada.');
      }

      const resolvedClientName = clampStr(clientData.name || quoteData.clientName, 140);
      const startISO = validation.dataInicioISO;
      const endBaseline = quoteData.estimatedMonths > 0 ? addMonthsISO(startISO, quoteData.estimatedMonths) : '';
      const contractKind: ProjectContractKind =
        params.contractKind || (quoteData.type === 'Obra satélite' ? 'Satélite' : 'Principal');

      const generatedParcelas = gerarParcelas(
        resolvedTotalValue,
        params.downPaymentPct,
        params.installmentsCount,
        startISO
      ).filter((installment) => installment.valor > 0);
      const settingsSnap = await tx.get(doc(db, 'companySettings', uid));
      const contractPdf = Bytes.fromUint8Array(createContractPdf({
        code: quoteData.code,
        companyName: settingsSnap.data()?.companyName || 'Pilotis Soluções Construtivas',
        clientName: resolvedClientName,
        projectName: quoteData.title,
        contractKind,
        city: quoteData.city,
        description: quoteData.description,
        estimatedMonths: quoteData.estimatedMonths,
        totalValue: resolvedTotalValue,
        startDate: startISO,
        installments: generatedParcelas,
      }));

      // 1. Criar a obra (Obra/Contrato) com status "Contratada" e aguardando modelo no Planejamento
      const projectRef = doc(db, 'projects', projectId);
      tx.set(projectRef, {
        ownerUid: uid,
        name: clampStr(quoteData.title, 160),
        quoteId,
        clientId: resolvedClientId,
        clientName: resolvedClientName,
        type: quoteData.type,
        contractKind,
        planningStatus: 'Aguardando modelo de cronograma',
        contractValue: resolvedTotalValue,
        contractPdf,
        downPaymentPct: params.downPaymentPct,
        installmentsCount: params.installmentsCount,
        addendaTotalValue: quoteData.addendaTotalValue || 0,
        budgetedLabor: quoteData.laborCost || 0,
        budgetedSubcontract: quoteData.subcontractCost || 0,
        budgetedEquipment: quoteData.equipmentCost || 0,
        budgetedBdi: quoteData.bdiCost || 0,
        budgetedTax: quoteData.taxCost || 0,
        startDate: startISO,
        baselineEndDate: endBaseline,
        forecastEndDate: endBaseline,
        status: 'Contratada',
        contractSigned:
          quoteData.contractSignStatus === 'Assinado pelo cliente' ||
          quoteData.contractSignStatus === 'Assinado pelas partes',
        warrantyStartDate: '',
        createdBy: actor,
        updatedBy: actor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      // 2. Congelar o orçamento como "Ganho" e vincular à obra
      const nextSignStatus =
        quoteData.contractSignStatus && quoteData.contractSignStatus !== 'Não gerado'
          ? quoteData.contractSignStatus
          : 'Aguardando assinatura';

      const quoteUpdate: Record<string, unknown> = {
        status: 'Ganho',
        probabilityPct: 100,
        projectId,
        clientId: resolvedClientId,
        clientName: resolvedClientName,
        downPaymentPct: params.downPaymentPct,
        installmentsCount: params.installmentsCount,
        contractSignStatus: nextSignStatus,
        updatedBy: actor,
        updatedAt: serverTimestamp(),
      };
      tx.update(quoteRef, quoteUpdate);

      // 3. Atualizar cliente para Ativo
      tx.update(clientRef, {
        status: 'Ativo',
        updatedBy: actor,
        updatedAt: serverTimestamp(),
      });

      // 4. Gerar as parcelas (entrada + saldo) exclusivamente em /parcelas (fonte única das contas a receber)
      // /transactions recebe lançamento realizado somente quando a parcela for efetivamente recebida.
      // O status "Em atraso" nunca é gravado: é calculado dinamicamente na leitura.
      for (const parcela of generatedParcelas) {
        const instId = generateId('par');

        tx.set(doc(db, 'parcelas', instId), {
          ownerUid: uid,
          projectId,
          projectName: clampStr(quoteData.title, 160),
          quoteId,
          clientId: resolvedClientId,
          clientName: resolvedClientName,
          number: parcela.numero,
          label: clampStr(parcela.rotulo, 40),
          dueDate: parcela.vencimento,
          amount: parcela.valor,
          status: 'A vencer',
          invoiceStatus: parcela.notaFiscal,
          receivedDate: '',
          transactionId: '',
          createdBy: actor,
          updatedBy: actor,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // 5. Gerar checklist de documentos da obra
      const requiredDocs = [
        'Contrato assinado',
        'ART/RRT',
        'Matrícula CNO',
      ];
      for (const docTitle of requiredDocs) {
        tx.set(doc(db, 'complianceItems', generateId('cmp')), {
          ownerUid: uid,
          kind: 'Documento de obra',
          title: docTitle,
          category: 'Obra',
          projectId,
          projectName: clampStr(quoteData.title, 160),
          competence: '',
          dueDate: '',
          issuedDate: '',
          fileName: '',
          mandatory: true,
          status: 'Pendente',
          notes: `Checklist obrigatório gerado na confirmação do orçamento ${quoteData.code}.`,
          createdBy: actor,
          updatedBy: actor,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      // 6. Gravar auditoria completa da confirmação transacional
      tx.set(doc(db, 'auditLogs', generateId('aud')), {
        ownerUid: uid,
        registeredBy: actor,
        action: 'Criação',
        entityType: 'quote->project',
        summary: clampStr(
          `Orçamento ${quoteData.code} confirmado (${contractKind}): obra contratada, ${generatedParcelas.length} parcela(s) em /parcelas, contrato em PDF, checklist e envio ao Planejamento.`,
          240
        ),
        beforeValue: clampStr(`Status: ${quoteData.status}`, 240),
        afterValue: clampStr(
          `Contratada (${contractKind}) · ${formatBRL(resolvedTotalValue)}`,
          240
        ),
        createdAt: serverTimestamp(),
      });

      return {
        projectId,
        parcelasCount: generatedParcelas.length,
        checklistCount: requiredDocs.length,
      };
    });

    return result;
  } catch (err) {
    if (err instanceof ConfirmValidationError) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `quotes/${quoteId}`);
  }
}

type StagePayload = Omit<ProjectStage, keyof import('../types/pilotis').AuditMeta | 'id'>;

function validateScheduleInput(date: string, months: number | undefined, budget: number) {
  if (!isValidISODate(date)) throw new Error('Informe uma data de início válida.');
  if (months !== undefined && (!Number.isInteger(months) || months < 1 || months > 120)) {
    throw new Error('Informe um prazo entre 1 e 120 meses ou use a duração do modelo.');
  }
  if (!Number.isFinite(budget) || budget < 0) throw new Error('Informe um custo orçado válido.');
}

function normalizePopTerm(value: string | undefined): string {
  return (value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/^[\d\s·.-]+/, '').trim();
}

function buildScheduleStages(
  uid: string, actor: ActorRole, project: Project, type: ProjectType,
  months: number | undefined, budget: number, pops: Pop[],
) {
  const template = getStageTemplatesForType(type);
  const costs = allocateScheduleBudget(budget, template.map((item) => item.budgetPct));
  const templateWeeks = Math.max(...template.map((item) => item.startWeek + item.durationWeeks));
  const durationWeeks = months === undefined ? (type === 'Casa residencial' ? 52 : templateWeeks)
    : Math.ceil((diffDaysISO(addMonthsISO(project.startDate, months), project.startDate) ?? 0) / 7);
  const scaleWeek = (week: number) => Math.round(week * durationWeeks / templateWeeks);
  const wbsToId = new Map(template.map((item) => [item.wbsCode, generateId('stg')]));
  const currentPops = pops.filter((pop) => poisPublishedPop(p) && (p.status === 'Vigente' || (p.publicationNumber ?? 0) > 0));
  const deliverables = new Map<string, Map<string, number>>();

  const stages: ProjectStage[] = template.map((item, index) => {
    const deliverable = item.deliverable ?? item.name;
    const packages = deliverables.get(item.phase) ?? new Map<string, number>();
    deliverables.set(item.phase, packages);
    const packageNumber = (packages.get(deliverable) ?? 0) + 1;
    packages.set(deliverable, packageNumber);
    const wbsCode = `${item.wbsCode.split('.')[0]}.${[...packages.keys()].indexOf(deliverable) + 1}.${packageNumber}`;
    const phase = normalizePopTerm(item.phase);
    const activity = normalizePopTerm(item.name);
    const linkedPop = currentPops.find((pop) => {
      const service = normalizePopTerm(pop.serviceType);
      return service && activity.includes(service);
    }) ?? currentPops.find((pop) => {
      const linkedPhase = normalizePopTerm(pop.linkedStagePhase);
      return linkedPhase && phase.includes(linkedPhase);
    });
    const startWeek = scaleWeek(item.startWeek);
    const duration = item.isMilestone ? 0 : Math.max(1, scaleWeek(item.startWeek + item.durationWeeks) - startWeek);
    return {
      id: wbsToId.get(item.wbsCode)!,
      ownerUid: uid,
      createdBy: actor,
      updatedBy: actor,
      projectId: project.id,
      wbsCode,
      phase: item.phase,
      deliverable,
      name: item.name,
      responsible: item.responsible,
      startWeek,
      durationWeeks: duration,
      baselineStartWeek: startWeek,
      baselineDurationWeeks: duration,
      baselineBudgetedCost: costs[index],
      progressPct: 0,
      budgetedCost: costs[index],
      popId: linkedPop?.id ?? '',
      dependsOn: item.depWbs.map((code) => wbsToId.get(code)!),
      isMilestone: Boolean(item.isMilestone),
      status: 'A fazer',
      materialExpectedDate: '',
      delayCategory: '',
      delayJustification: '',
      checklistCompleted: [],
    };
  });
  const schedule = getProjectSchedule(project, stages);
  const endDate = schedule.forecastEndDate;
  if (!endDate) throw new Error('Não foi possível calcular o prazo do modelo.');
  return {
    endDate,
    stages: stages.map((stage) => ({
      ...stage, baselineStartWeek: schedule.details.get(stage.id)!.inicioMaisCedo,
    })),
  };
}

function scheduleBaselineRef(projectId: string, version: number) {
  return doc(db, 'baselines', `${projectId}_v${version}`);
}

function scheduleBaselineData(
  projectId: string,
  stages: ScheduleBaseline['stages'],
  endDate: string,
  uid: string,
  actor: ActorRole,
  version = 1,
  justification = '',
): Omit<ScheduleBaseline, 'id'> {
  return {
    ...auditFields(uid, actor), projectId, version, recordedDate: planningTodayISO(),
    endDate, justification, stages,
  };
}

export async function applyScheduleTemplateToProject(params: {
  uid: string;
  actor: ActorRole;
  project: Project;
  templateType: ProjectType;
  startDate: string;
  estimatedMonths?: number;
  pops: Pop[];
}): Promise<void> {
  const { uid, actor, project, templateType, startDate, estimatedMonths, pops } = params;
  const projectRef = doc(db, 'projects', project.id);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(projectRef);
    const current = { ...snapshot.data(), id: project.id } as Project;
    if (!snapshot.exists() || current.ownerUid !== uid) throw new Error('Obra indisponível.');
    if (current.planningStatus === 'Cronograma criado' || current.status !== 'Contratada' || current.scheduleStageIds?.length) {
      throw new Error('A obra já tem cronograma ou não está aguardando um modelo.');
    }
    const budget = roundCents([current.budgetedLabor, current.budgetedSubcontract,
      current.budgetedEquipment, current.budgetedBdi, current.budgetedTax].reduce((sum, value) => sum + (value ?? 0), 0));
    validateScheduleInput(startDate, estimatedMonths, budget);
    const { stages, endDate } = buildScheduleStages(uid, actor, { ...current, startDate }, templateType, estimatedMonths, budget, pops);
    for (const { id, ...stage } of stages) {
      tx.set(doc(db, 'stages', id), { ...stage, ...auditFields(uid, actor) });
    }
    tx.update(projectRef, {
      type: templateType,
      startDate,
      baselineEndDate: endDate,
      forecastEndDate: endDate,
      status: 'Em execução',
      planningStatus: 'Cronograma criado',
      scheduleRevision: (current.scheduleRevision ?? 0) + 1,
      scheduleBaselineVersion: 1,
      scheduleStageIds: stages.map((stage) => stage.id),
      updatedBy: actor,
      updatedAt: serverTimestamp(),
    });
    tx.set(scheduleBaselineRef(project.id, 1), scheduleBaselineData(project.id, getScheduleBaselineStages(stages), endDate, uid, actor));
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'projects',
      summary: clampStr(`Modelo "${templateType}" aplicado à obra ${current.name} (${stages.length} etapas).`, 240),
      createdAt: serverTimestamp(),
    });
  });
}

async function readProjectStages(tx: Transaction, project: Project, knownStages: Pick<ProjectStage, 'id'>[]) {
  const ids = project.scheduleStageIds ?? knownStages.map((stage) => stage.id);
  const snapshots = await Promise.all(ids.map((id) => tx.get(doc(db, 'stages', id))));
  const stages = snapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => (
    { ...snapshot.data(), id: snapshot.id } as ProjectStage
  ));
  if (stages.some((stage) => stage.projectId !== project.id)) throw new Error('Há etapas vinculadas a outra obra.');
  return stages;
}

export async function replanProjectSchedule(params: {
  uid: string;
  actor: ActorRole;
  project: Project;
  knownStages: ProjectStage[];
  justification: string;
}): Promise<void> {
  const { uid, actor, project, knownStages } = params;
  const justification = validateReplanJustification(params.justification);
  const projectRef = doc(db, 'projects', project.id);

  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(projectRef);
    const current = { ...snapshot.data(), id: project.id } as Project;
    if (!snapshot.exists() || current.ownerUid !== uid) throw new Error('Obra indisponível.');
    if (current.status === 'Concluída') throw new Error('O cronograma da obra encerrada está consolidado.');
    if ((current.scheduleRevision ?? 0) !== (project.scheduleRevision ?? 0)) {
      throw new Error('O cronograma foi atualizado. Reabra o replanejamento para revisar as datas.');
    }

    const stages = await readProjectStages(tx, current, knownStages);
    const previousVersion = current.scheduleBaselineVersion ?? 1;
    const previousSnapshot = current.scheduleBaselineVersion ? await tx.get(scheduleBaselineRef(current.id, previousVersion)) : null;
    const previousBaseline = previousSnapshot?.data() as Omit<ScheduleBaseline, 'id'> | undefined;
    const schedule = getProjectSchedule(current, stages);
    const cycle = describeScheduleCycle(stages, schedule.criticalPath);
    if (cycle) throw new Error(cycle);
    const endDate = schedule.forecastEndDate;
    if (!endDate) throw new Error('Cadastre as etapas e a data de início antes de replanejar.');

    if (previousVersion === 1 && !previousBaseline) {
      const startDate = current.startDate;
      const originalStages = getScheduleBaselineStages(stages);
      const originalWeeks = Math.max(0, ...originalStages.map((stage) => stage.startWeek + stage.durationWeeks));
      const originalEndDate = isValidISODate(current.baselineEndDate)
        ? current.baselineEndDate
        : addDaysISO(startDate, Math.ceil(originalWeeks * 7));
      tx.set(scheduleBaselineRef(current.id, 1), scheduleBaselineData(current.id, originalStages, originalEndDate, uid, actor));
    } else if (!previousBaseline) {
      throw new Error('A versão anterior está indisponível. Reabra o cronograma para revisar o histórico.');
    }

    const version = previousVersion + 1;
    tx.set(scheduleBaselineRef(current.id, version), scheduleBaselineData(
      current.id, getScheduleBaselineStages(stages, schedule), endDate, uid, actor, version, justification,
    ));
    tx.update(projectRef, {
      scheduleBaselineVersion: version,
      scheduleRevision: (current.scheduleRevision ?? 0) + 1,
      scheduleStageIds: stages.map((stage) => stage.id),
      forecastEndDate: endDate,
      updatedBy: actor, updatedAt: serverTimestamp(),
    });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'projects',
      summary: clampStr(`Cronograma replanejado · ${current.name} · versão ${version}`, 240),
      beforeValue: formatDateBR(previousBaseline?.endDate ?? current.baselineEndDate),
      afterValue: formatDateBR(endDate), createdAt: serverTimestamp(),
    });
  });
}

export async function saveWorkInProgressLimit(uid: string, actor: ActorRole, projectId: string, limit: number) {
  validateWorkInProgressLimit(limit);
  const ref = doc(db, 'projects', projectId);
  await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    const project = snapshot.data() as Project | undefined;
    if (!project || project.ownerUid !== uid) throw new Error('Obra indisponível.');
    tx.update(ref, { workInProgressLimit: limit, updatedBy: actor, updatedAt: serverTimestamp() });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'projects',
      summary: clampStr(`Limite de etapas em andamento · ${project.name}`, 240),
      beforeValue: String(project.workInProgressLimit ?? DEFAULT_WORK_IN_PROGRESS_LIMIT), afterValue: String(limit), createdAt: serverTimestamp(),
    });
  });
}

export async function saveProjectStage(params: {
  uid: string; actor: ActorRole; project: Pick<Project, 'id' | 'scheduleRevision'>; knownStages: Pick<ProjectStage, 'id'>[];
} & ({ stageId?: string; payload: StagePayload } | { stageId: string; moveTo: StageStatus }
  | { stageId: string; fieldUpdate: FieldStageUpdate; operationId: string })): Promise<void> {
  const { uid, actor, project, knownStages } = params;
  const stageId = params.stageId ?? generateId('stg');
  const projectRef = doc(db, 'projects', project.id);
  const stageRef = doc(db, 'stages', stageId);
  const receiptRef = 'operationId' in params ? doc(db, 'fieldSync', params.operationId) : null;
  await runTransaction(db, async (tx) => {
    if (receiptRef && (await tx.get(receiptRef)).exists()) return;
    const projectSnapshot = await tx.get(projectRef);
    const current = { ...projectSnapshot.data(), id: project.id } as Project;
    if (!projectSnapshot.exists() || current.ownerUid !== uid) {
      throw new Error('Obra indisponível.');
    }
    if (current.status === 'Concluída') throw new Error('As etapas desta obra já foram encerradas.');
    if (!receiptRef && (current.scheduleRevision ?? 0) !== (project.scheduleRevision ?? 0)) {
      throw new Error('O cronograma foi atualizado. Feche e reabra a etapa para revisar a versão atual.');
    }
    const stages = await readProjectStages(tx, current, knownStages);
    const previous = stages.find((stage) => stage.id === stageId);
    if (params.stageId && !previous) throw new Error('Etapa indisponível.');
    let payload: StagePayload;
    if ('fieldUpdate' in params) {
      if (!previous) throw new Error('Etapa indisponível.');
      const next = applyFieldStageUpdate(previous, params.fieldUpdate);
      const { id, ownerUid, createdAt, createdBy, updatedAt, updatedBy, ...fields } = next;
      payload = { ...fields, dependsOn: fields.dependsOn ?? [], checklistCompleted: fields.checklistCompleted ?? [] };
      if (!Number.isFinite(payload.progressPct) || payload.progressPct < 0 || payload.progressPct > 100) {
        throw new Error('Informe um progresso entre 0 e 100.');
      }
      if (payload.materialExpectedDate && !isValidISODate(payload.materialExpectedDate)) {
        throw new Error('Informe uma data válida para o material do cliente.');
      }
    } else if ('moveTo' in params) {
      if (!previous) throw new Error('Etapa indisponível.');
      const { id, ownerUid, createdAt, createdBy, updatedAt, updatedBy, ...fields } = previous;
      payload = { ...fields, status: params.moveTo, dependsOn: fields.dependsOn ?? [], checklistCompleted: fields.checklistCompleted ?? [] };
      if (previous.status === params.moveTo) return;
    } else {
      payload = params.payload;
    }
    const { status } = payload;
    const forecastProgress = status === 'Concluída' ? 100
      : previous?.status === 'Concluída' && payload.progressPct === previous.progressPct ? 0 : payload.progressPct;
    payload = {
      ...payload, progressPct: forecastProgress,
      delayCategory: normalizeDelayCategory(payload.delayCategory ?? ''),
      delayJustification: (payload.delayJustification ?? '').trim(),
    };
    if (payload.projectId !== project.id) throw new Error('A etapa pertence a outra obra.');
    if (!payload.wbsCode || !payload.phase || !payload.name) {
      throw new Error('Preencha o código, a fase e o nome do pacote de trabalho.');
    }
    if (!params.stageId && !payload.deliverable) throw new Error('Informe a entrega do pacote de trabalho.');
    if (![payload.startWeek, payload.durationWeeks].every((value) => Number.isInteger(value) && value >= 0)) {
      throw new Error('Informe semanas de início e de duração inteiras e não negativas.');
    }
    if (payload.dependsOn.length > 10) throw new Error('Selecione até 10 etapas predecessoras.');
    const others = stages.filter((stage) => stage.id !== stageId);
    if (others.some((stage) => stage.wbsCode === payload.wbsCode)) {
      throw new Error('Esse código EAP já existe nesta obra. Informe um código diferente.');
    }
    if (payload.dependsOn.some((id) => !stages.some((stage) => stage.id === id))) {
      throw new Error('Uma etapa predecessora está indisponível. Revise as dependências.');
    }
    const baselineBudgetedCost = previous?.baselineBudgetedCost ?? previous?.budgetedCost ?? payload.budgetedCost;
    const candidate = {
      ...payload, baselineBudgetedCost, id: stageId, ownerUid: uid,
      createdBy: previous?.createdBy ?? actor, updatedBy: actor,
    };
    const nextStages = [...others, candidate];
    const schedule = getProjectSchedule(current, nextStages);
    const cycle = describeScheduleCycle(nextStages, schedule.criticalPath);
    if (cycle) throw new Error(cycle);
    const changedPop = Boolean(candidate.popId && candidate.popId !== previous?.popId);
    const retainedReview = candidate.status === 'Concluída' && previous?.status === 'Concluída' &&
      previous.popReview?.popId === candidate.popId ? previous.popReview : undefined;
    const readLivePop = candidate.popId && (changedPop || (candidate.status === 'Concluída' && !retainedReview));
    const popSnapshot = readLivePop ? await tx.get(doc(db, 'pops', candidate.popId)) : null;
    const livePop = popSnapshot?.exists() ? { ...popSnapshot.data(), id: candidate.popId } as Pop : undefined;
    if (readLivePop && (!livePop || livePop.ownerUid !== uid || !isPublishedPop(livePop))) {
      throw new Error('Vincule um POP publicado para conferir a etapa.');
    }
    const popReview = candidate.status === 'Concluída'
      ? retainedReview ?? linkedPopChecklist({ ...candidate, popReview: null }, livePop) ?? null
      : null;
    validateStageWorkflow(candidate, previous, others, current, popReview ?? undefined);
    if (popReview) payload.checklistCompleted = popReview.acceptanceCriteria.filter((item) => payload.checklistCompleted.includes(item));

    const oldEnd = previous ? getProjectSchedule(current, stages).details.get(stageId)?.terminoMaisCedo : undefined;
    const newEnd = schedule.details.get(stageId)?.terminoMaisCedo;
    const baselineEnd = previous ? (previous.baselineStartWeek ?? previous.startWeek) + (previous.baselineDurationWeeks ?? previous.durationWeeks) : undefined;
    const delayChanged = !previous || payload.delayCategory !== normalizeDelayCategory(previous.delayCategory ?? '') ||
      payload.delayJustification !== (previous.delayJustification ?? '').trim();
    const extended = oldEnd !== undefined && newEnd !== undefined && baselineEnd !== undefined &&
      newEnd > oldEnd && newEnd > baselineEnd;
    if (delayChanged || extended) validateStageDelay(candidate, extended || (
      baselineEnd !== undefined && newEnd !== undefined && newEnd > baselineEnd && delayChanged
    ));

    if (previous) {
      tx.update(stageRef, {
        ...payload, popReview,
        baselineStartWeek: previous.baselineStartWeek ?? previous.startWeek ?? payload.startWeek,
        baselineDurationWeeks: previous.baselineDurationWeeks ?? previous.durationWeeks ?? payload.durationWeeks,
        baselineBudgetedCost,
        updatedBy: actor, updatedAt: serverTimestamp(),
      });
    } else {
      tx.set(stageRef, {
        ...payload, popReview, baselineBudgetedCost: payload.budgetedCost,
        baselineStartWeek: schedule.details.get(stageId)!.inicioMaisCedo,
        ...auditFields(uid, actor),
      });
    }
    if (receiptRef) tx.set(receiptRef, { ...auditFields(uid, actor), projectId: project.id, stageId });
    const scheduleRevision = (current.scheduleRevision ?? 0) + 1;
    if (!previous || candidate.progressPct !== previous.progressPct) {
      const progress = calcularCurvaSObra(nextStages, schedule.referenceWeek, undefined, false);
      if (progress.possuiDados) {
        tx.set(doc(db, 'scheduleProgress', `${project.id}_r${scheduleRevision}`), {
          ...auditFields(uid, actor), projectId: project.id, scheduleRevision,
          date: planningTodayISO(), progressPct: progress.progressoRealizadoPct,
        });
      }
    }
    tx.update(projectRef, {
      forecastEndDate: schedule.forecastEndDate ?? current.forecastEndDate,
      scheduleRevision,
      scheduleStageIds: nextStages.map((stage) => stage.id),
      updatedBy: actor,
      updatedAt: serverTimestamp(),
    });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: previous ? 'Atualização' : 'Criação',
      entityType: 'stages', summary: clampStr(`Etapa ${previous ? 'atualizada' : 'criada'}: ${payload.name}`, 240),
      beforeValue: previous?.status ?? '', afterValue: clampStr([payload.status, payload.delayCategory, payload.delayJustification].filter(Boolean).join(' · '), 240),
      createdAt: serverTimestamp(),
    });
  });
}

type TransactionPayload = Omit<FinancialTransaction, keyof import('../types/pilotis').AuditMeta | 'id'>;
type LoanDetails = Pick<Debt, 'creditor' | 'debtType'> & Partial<Pick<Debt, 'remainingInstallments' | 'nextDueDate' | 'monthlyCost'>>;

function auditFields(uid: string, actor: ActorRole) {
  return {
    ownerUid: uid, createdBy: actor, updatedBy: actor,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  };
}

function validateTransaction(row: TransactionPayload) {
  const result = validarLancamentoFinanceiro({
    descricao: row.description, categoria: row.category,
    tipoInformado: row.entryKind, obraId: row.projectId, valor: row.amount,
  });
  const error = result.erroEmprestimoComoReceita ?? result.erroCentroCusto ?? result.erroValorOuDescricao;
  if (error) throw new Error(error);
  if (!isValidISODate(row.date) || (row.dueDate && !isValidISODate(row.dueDate))) {
    throw new Error('Informe uma data e um vencimento válidos.');
  }
}

function stageNewTransaction(
  writer: { set(ref: DocumentReference, data: DocumentData): void },
  uid: string,
  actor: ActorRole,
  row: TransactionPayload,
  id: string,
  loan?: LoanDetails,
) {
  const debtRef = row.entryKind === 'loan' ? doc(db, 'debts', 'debt-' + id) : null;
  if (debtRef) {
    writer.set(debtRef, {
      creditor: clampStr(loan?.creditor || row.description, 140),
      debtType: loan?.debtType ?? 'Empréstimo bancário',
      ...(loan?.remainingInstallments != null ? { remainingInstallments: loan.remainingInstallments } : {}),
      ...(loan?.nextDueDate ? { nextDueDate: loan.nextDueDate } : {}),
      ...(loan?.monthlyCost != null ? { monthlyCost: loan.monthlyCost } : {}),
      principalBalance: row.amount,
      status: 'Em uso',
      ...auditFields(uid, actor),
    });
  }
  writer.set(doc(db, 'transactions', id), {
    ...row,
    ...(debtRef ? { debtId: debtRef.id } : {}),
    ...auditFields(uid, actor),
  });
}

export async function recordFinancialTransaction(
  uid: string, actor: ActorRole, row: TransactionPayload, receipt?: File, loan?: LoanDetails,
): Promise<void> {
  validateTransaction(row);
  if (!row.paymentMethod.trim()) throw new Error('Informe a forma de pagamento ou recebimento.');
  if (row.entryKind === 'loan' && !loan?.creditor.trim()) throw new Error('Informe o credor do empréstimo.');
  const receiptFile = receipt ? await readReceiptFile(receipt) : undefined;
  const id = generateId('tx');
  const batch = writeBatch(db);
  stageNewTransaction(batch, uid, actor, {
    ...row, ...(receiptFile ? { receiptFile } : {}),
  }, id, loan);
  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid, registeredBy: actor, action: 'Criação', entityType: 'transactions',
    summary: clampStr('Lançamento ' + row.description + ' (' + formatBRL(row.amount) + ')', 240),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

const RECEIPT_MAX_BYTES = 700 * 1024;

async function readReceiptFile(file: File) {
  if (file.size === 0 || file.size > RECEIPT_MAX_BYTES) {
    throw new Error('Anexe um comprovante de até 700 KB.');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';
  const isPng = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const isJpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const mimeType = isPdf ? 'application/pdf' : isPng ? 'image/png' : isJpeg ? 'image/jpeg' : '';
  if (!mimeType) throw new Error('Anexe um comprovante em PDF, PNG ou JPEG.');
  return { name: clampStr(file.name, 160), mimeType, content: Bytes.fromUint8Array(bytes) };
}

async function readInstallmentForReceipt(tx: Transaction, uid: string, installmentId: string) {
  const ref = doc(db, 'parcelas', installmentId);
  const snap = await tx.get(ref);
  if (!snap.exists()) throw new InstallmentValidationError('Parcela não encontrada.');
  const installment = snap.data() as Installment;
  if (installment.ownerUid !== uid || installment.status === 'Recebida') {
    throw new InstallmentValidationError('A parcela já foi recebida ou não pertence à empresa.');
  }

  const previousRef = installment.transactionId ? doc(db, 'transactions', installment.transactionId) : null;
  const previous = previousRef ? (await tx.get(previousRef)).data() as FinancialTransaction | undefined : undefined;
  if (previous && (
    previous.ownerUid !== uid || previous.entryKind !== 'income' ||
    previous.projectId !== installment.projectId ||
    (previous.installmentId && previous.installmentId !== installmentId)
  )) {
    throw new InstallmentValidationError('O lançamento associado à parcela precisa ser revisado.');
  }
  return { ref, installment, previousRef, previous };
}

function stageInstallmentReceipt(
  tx: Transaction,
  uid: string,
  actor: ActorRole,
  installmentId: string,
  context: Awaited<ReturnType<typeof readInstallmentForReceipt>>,
  receipt: { date: string; paymentMethod: string; statementKey?: string },
  newTransactionId = generateId('tx'),
) {
  const { ref, installment, previousRef, previous } = context;
  const txRef = previous && previousRef ? previousRef : doc(db, 'transactions', newTransactionId);
  const movement = {
    date: receipt.date,
    dueDate: installment.dueDate,
    amount: installment.amount,
    installmentId,
    isForecast: false,
    status: 'Recebido',
    invoiceStatus: installment.invoiceStatus || 'A emitir',
    paymentMethod: receipt.paymentMethod,
    ...(receipt.statementKey ? { statementKey: receipt.statementKey } : {}),
    updatedBy: actor,
    updatedAt: serverTimestamp(),
  };
  if (previous && previousRef) {
    tx.update(txRef, movement);
  } else {
    tx.set(txRef, {
      ...auditFields(uid, actor), ...movement,
      entryKind: 'income',
      category: 'Receita de obra',
      description: clampStr('Parcela ' + installment.label + ' · ' + installment.projectName, 200),
      projectId: installment.projectId,
      projectName: installment.projectName || '',
      installmentLabel: installment.label,
      quoteId: installment.quoteId,
      source: 'orcamento',
    });
  }
  tx.update(ref, {
    status: 'Recebida', receivedDate: receipt.date, transactionId: txRef.id,
    updatedBy: actor, updatedAt: serverTimestamp(),
  });
  tx.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'parcelas',
    summary: clampStr('Parcela recebida: ' + installment.label + ' · ' + installment.projectName, 240),
    beforeValue: resolverStatusParcela({ status: installment.status, vencimento: installment.dueDate }, receipt.date),
    afterValue: 'Recebida · ' + formatDateBR(receipt.date) + ' · ' + formatBRL(installment.amount),
    createdAt: serverTimestamp(),
  });
}

export async function markInstallmentReceived(
  uid: string,
  actor: ActorRole,
  installment: Installment,
  date: string,
  paymentMethod: string,
): Promise<void> {
  if (!isValidISODate(date) || date > todayISO() || !paymentMethod.trim()) {
    throw new InstallmentValidationError('Informe a data efetiva e a forma de recebimento.');
  }
  await runTransaction(db, async (tx) => {
    const context = await readInstallmentForReceipt(tx, uid, installment.id);
    stageInstallmentReceipt(tx, uid, actor, installment.id, context, {
      date, paymentMethod: clampStr(paymentMethod, 60),
    });
  });
}

function stageTransactionSettlement(
  tx: Transaction, uid: string, actor: ActorRole, id: string,
  record: FinancialTransaction, date: string, statementKey?: string,
) {
  if (record.ownerUid !== uid || !record.isForecast || record.installmentId || record.entryKind === 'loan') {
    throw new Error('O lançamento já foi baixado ou deve ser recebido pela parcela.');
  }
  const status = record.entryKind === 'income' ? 'Recebido' : 'Pago';
  tx.update(doc(db, 'transactions', id), {
    date, dueDate: record.dueDate || record.date,
    status, isForecast: false, wasForecast: true,
    updatedBy: actor, updatedAt: serverTimestamp(),
    ...(statementKey ? { statementKey, paymentMethod: 'Extrato' } : {}),
  });
  tx.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'transactions',
    summary: clampStr('Baixa de lançamento: ' + record.description, 240),
    beforeValue: record.status, afterValue: status + ' · ' + formatDateBR(date), createdAt: serverTimestamp(),
  });
}

export async function settleFinancialTransaction(uid: string, actor: ActorRole, id: string, date: string) {
  if (!isValidISODate(date) || date > todayISO()) throw new Error('Informe a data efetiva da baixa.');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(doc(db, 'transactions', id));
    if (!snap.exists()) throw new Error('Lançamento não encontrado.');
    stageTransactionSettlement(tx, uid, actor, id, snap.data() as FinancialTransaction, date);
  });
}

export async function markReceiptInvoiceIssued(uid: string, actor: ActorRole, target: InvoiceReceiptTarget): Promise<void> {
  await runTransaction(db, async (tx) => {
    const readTransaction = async (id: string) => {
      const row = (await tx.get(doc(db, 'transactions', id))).data() as FinancialTransaction | undefined;
      if (!row || row.ownerUid !== uid || !isActualReceipt(row)) throw new Error('O lançamento precisa ser um recebimento realizado.');
      return row;
    };
    const readInstallment = async (id: string) => {
      const row = (await tx.get(doc(db, 'parcelas', id))).data() as Installment | undefined;
      if (!row || row.ownerUid !== uid || row.status !== 'Recebida') throw new Error('A parcela precisa estar recebida no Financeiro.');
      return row;
    };

    let transactionId = target.transactionId ?? '';
    let installmentId = target.installmentId ?? '';
    let transaction = transactionId ? await readTransaction(transactionId) : undefined;
    let installment = installmentId ? await readInstallment(installmentId) : undefined;
    if (!installment && transaction?.installmentId) {
      installmentId = transaction.installmentId;
      installment = await readInstallment(installmentId);
    }
    if (!transaction && installment?.transactionId) {
      transactionId = installment.transactionId;
      transaction = await readTransaction(transactionId);
    }
    if (!transaction && !installment) throw new Error('Selecione um recebimento válido.');
    if (transaction && installment && (
      transaction.projectId !== installment.projectId
      || (transaction.installmentId && transaction.installmentId !== installmentId)
      || (installment.transactionId && installment.transactionId !== transactionId)
      || (transaction.installmentId !== installmentId && installment.transactionId !== transactionId)
    )) throw new Error('Confira o vínculo entre a parcela e o lançamento no Financeiro.');

    const previous = transaction?.invoiceStatus ?? installment?.invoiceStatus;
    if (previous === 'Não se aplica') throw new Error('A nota está registrada como “Não se aplica” no Financeiro.');
    const patch = { invoiceStatus: 'Emitida', updatedBy: actor, updatedAt: serverTimestamp() };
    const changeTransaction = transaction && transaction.invoiceStatus !== 'Emitida';
    const changeInstallment = installment && installment.invoiceStatus !== 'Emitida';
    if (!changeTransaction && !changeInstallment) return;
    if (changeTransaction) tx.update(doc(db, 'transactions', transactionId), patch);
    if (changeInstallment) tx.update(doc(db, 'parcelas', installmentId), patch);
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: installment ? 'parcelas' : 'transactions',
      summary: clampStr('Nota fiscal emitida · ' + (transaction?.description || installment?.label || 'Recebimento'), 240),
      beforeValue: previous || 'A emitir', afterValue: 'Emitida', createdAt: serverTimestamp(),
    });
  });
}

export function markInstallmentInvoiceIssued(uid: string, actor: ActorRole, installment: Installment) {
  return markReceiptInvoiceIssued(uid, actor, { installmentId: installment.id });
}

type CompliancePayload = Omit<ComplianceItem, keyof import('../types/pilotis').AuditMeta | 'id' | 'attachmentId' | 'projectName'>;

export async function saveComplianceItem(
  uid: string, actor: ActorRole, payload: CompliancePayload, itemId?: string, file?: File,
) {
  const title = clampStr(payload.title, 160);
  const competence = normalizeCompetence(payload.competence);
  if (!title) throw new Error('Informe o nome do registro.');
  if (payload.kind === 'Obrigação' && (!competence || !isValidISODate(payload.dueDate))) {
    throw new Error('Informe a competência e o vencimento da obrigação.');
  }
  if (payload.kind === 'Certidão' && (!isValidISODate(payload.issuedDate) || !isValidISODate(payload.dueDate))) {
    throw new Error('Informe a emissão e a validade da certidão.');
  }
  if ((payload.dueDate && !isValidISODate(payload.dueDate)) || (payload.issuedDate && !isValidISODate(payload.issuedDate))
    || (payload.kind !== 'Obrigação' && payload.issuedDate && payload.dueDate && payload.dueDate < payload.issuedDate)) {
    throw new Error('Confira a emissão e a validade. A validade deve ser igual ou posterior à emissão.');
  }
  if (payload.kind === 'Documento de obra' && !payload.projectId) throw new Error('Selecione a obra do documento.');

  const attachment = file ? await readReceiptFile(file) : undefined;
  const id = itemId ?? generateId('cmp');
  const attachmentId = attachment ? generateId('cmpfile') : '';
  const ref = doc(db, 'complianceItems', id);
  await runTransaction(db, async (tx) => {
    const previous = itemId ? (await tx.get(ref)).data() as ComplianceItem | undefined : undefined;
    if (itemId && (!previous || previous.ownerUid !== uid || previous.kind !== payload.kind)) {
      throw new Error('Registro de conformidade indisponível.');
    }
    const project = payload.projectId ? (await tx.get(doc(db, 'projects', payload.projectId))).data() as Project | undefined : undefined;
    if (payload.projectId && (!project || project.ownerUid !== uid)) throw new Error('Obra indisponível.');
    const fileName = attachment?.name ?? (previous?.attachmentId ? previous.fileName : clampStr(payload.fileName, 160));
    if (payload.status === 'Anexado' && !fileName) throw new Error('Anexe um arquivo ou informe a referência do documento.');
    const row = {
      ...payload, title, competence: competence || clampStr(payload.competence, 40),
      category: clampStr(payload.category, 80), notes: clampStr(payload.notes, 500),
      projectName: project?.name ?? '', fileName,
      ...(attachmentId ? { attachmentId } : {}),
    };

    if (previous) tx.update(ref, { ...row, updatedBy: actor, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...row, ...auditFields(uid, actor) });
    if (attachment) tx.set(doc(db, 'complianceFiles', attachmentId), { ...attachment, itemId: id, ...auditFields(uid, actor) });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: previous ? 'Atualização' : 'Criação', entityType: 'complianceItems',
      summary: clampStr('Conformidade · ' + title, 240),
      beforeValue: previous?.status ?? '', afterValue: payload.status, createdAt: serverTimestamp(),
    });
  });
}

export async function readComplianceFile(item: Pick<ComplianceItem, 'id' | 'attachmentId'>): Promise<ComplianceFile> {
  if (!item.attachmentId) throw new Error('Este registro possui somente uma referência de arquivo.');
  const file = (await getDoc(doc(db, 'complianceFiles', item.attachmentId))).data() as ComplianceFile | undefined;
  if (!file || file.itemId !== item.id) throw new Error('Anexo indisponível.');
  return file;
}

export async function createProjectFromTemplate(
  uid: string,
  actor: ActorRole,
  params: {
    name: string;
    clientName: string;
    type: ProjectType;
    contractKind?: ProjectContractKind;
    contractValue: number;
    costBudget: number;
    startDate: string;
    estimatedMonths?: number;
    pops: Pop[];
  }
): Promise<string> {
  if (!params.name.trim() || !Number.isFinite(params.contractValue) || params.contractValue < 0) {
    throw new Error('Informe o nome da obra e um valor de contrato válido.');
  }
  validateScheduleInput(params.startDate, params.estimatedMonths, params.costBudget);
  const projectId = generateId('proj');
  const contractKind = params.contractKind ?? (params.type === 'Obra satélite' ? 'Satélite' : 'Principal');
  const project: Project = {
    id: projectId,
    ...auditFields(uid, actor),
    name: clampStr(params.name, 160),
    quoteId: '',
    clientId: '',
    clientName: clampStr(params.clientName, 140),
    type: params.type,
    contractKind,
    planningStatus: 'Cronograma criado',
    contractValue: roundCents(params.contractValue),
    budgetedLabor: 0,
    budgetedSubcontract: 0,
    budgetedEquipment: 0,
    budgetedBdi: 0,
    budgetedTax: 0,
    startDate: params.startDate,
    baselineEndDate: '',
    forecastEndDate: '',
    status: 'Em execução',
    contractSigned: false,
    warrantyStartDate: '',
  };
  const { stages, endDate } = buildScheduleStages(uid, actor, project, params.type, params.estimatedMonths, params.costBudget, params.pops);
  const { id, ...record } = project;
  const batch = writeBatch(db);
  batch.set(doc(db, 'projects', id), {
    ...record, baselineEndDate: endDate, forecastEndDate: endDate,
    scheduleRevision: 1, scheduleBaselineVersion: 1, scheduleStageIds: stages.map((stage) => stage.id),
  });
  for (const { id, ...stage } of stages) {
    batch.set(doc(db, 'stages', id), { ...stage, ...auditFields(uid, actor) });
  }
  batch.set(scheduleBaselineRef(projectId, 1), scheduleBaselineData(projectId, getScheduleBaselineStages(stages), endDate, uid, actor));
  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid, registeredBy: actor, action: 'Criação', entityType: 'projects',
    summary: clampStr(`Obra (${contractKind}) criada a partir do modelo ${params.type}: ${params.name}`, 240),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
  return projectId;
}

export async function importTransactionsBatch(
  uid: string,
  actor: ActorRole,
  rows: Array<Omit<FinancialTransaction, 'id' | 'ownerUid' | 'createdBy' | 'createdAt' | 'updatedBy' | 'updatedAt'>>,
  sourceLabel: string
): Promise<void> {
  const batch = writeBatch(db);
  for (const row of rows) {
    validateTransaction(row);
    stageNewTransaction(batch, uid, actor, row, generateId('tx'));
  }
  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid,
    registeredBy: actor,
    action: 'Importação',
    entityType: 'transactions',
    summary: clampStr(`${rows.length} movimento(s) importado(s) via ${sourceLabel}`, 240),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'transactions/import');
  }
}

interface StatementImportRow {
  movement: TransactionPayload;
  installmentId?: string;
  settleTransactionId?: string;
}

export async function importBankStatement(uid: string, actor: ActorRole, rows: StatementImportRow[]) {
  const ids = new Set<string>();
  const targets = new Set<string>();
  if (!rows.length) return;
  const prepared = await Promise.all(rows.map(async ({ movement, installmentId, settleTransactionId }) => {
    validateTransaction(movement);
    if (!movement.statementKey || movement.date > todayISO()) throw new Error('Revise a data e a identificação no extrato.');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(movement.statementKey));
    const id = 'stmt-' + Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const target = installmentId ? 'installment/' + installmentId : settleTransactionId ? 'movement/' + settleTransactionId : '';
    if (ids.has(id) || (target && targets.has(target))) throw new Error('Existem movimentos ou vínculos duplicados na seleção.');
    ids.add(id);
    if (target) targets.add(target);
    return { movement, installmentId, settleTransactionId, id };
  }));

  await runTransaction(db, async (tx) => {
    const existing = await Promise.all(prepared.map(async (row) => {
      if (row.installmentId) {
        return { installment: await readInstallmentForReceipt(tx, uid, row.installmentId) };
      }
      if (row.settleTransactionId) {
        const snap = await tx.get(doc(db, 'transactions', row.settleTransactionId));
        if (!snap.exists()) throw new Error('O lançamento previsto não está disponível.');
        return { transaction: snap.data() as FinancialTransaction };
      }
      return {};
    }));

    prepared.forEach(({ movement, installmentId, settleTransactionId, id }, index) => {
      const { installment, transaction } = existing[index];
      if (installmentId && installment) {
        const record = installment.installment;
        if (movement.entryKind !== 'income' || movement.amount !== record.amount || movement.projectId !== record.projectId) {
          throw new Error('A parcela mudou ou não corresponde ao movimento do extrato.');
        }
        stageInstallmentReceipt(tx, uid, actor, installmentId, installment, {
          date: movement.date, paymentMethod: 'Extrato', statementKey: movement.statementKey,
        }, id);
      } else if (settleTransactionId && transaction) {
        if (movement.entryKind !== transaction.entryKind || movement.amount !== transaction.amount ||
            movement.projectId !== transaction.projectId) {
          throw new Error('O lançamento previsto mudou. Revise a conciliação.');
        }
        stageTransactionSettlement(tx, uid, actor, settleTransactionId, transaction, movement.date, movement.statementKey);
      } else {
        stageNewTransaction(tx, uid, actor, movement, id);
      }
    });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Importação', entityType: 'transactions',
      summary: prepared.length + ' movimento(s) conciliado(s) ou importado(s) via extrato.',
      createdAt: serverTimestamp(),
    });
  });
}

export function subscribeEmployeeOccurrences(
  uid: string, employeeId: string, onChange: (rows: EmployeeOccurrence[]) => void, onError: () => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, 'employees', employeeId, 'occurrences'), where('ownerUid', '==', uid)),
    (snapshot) => onChange(snapshot.docs.map((item) => ({ ...item.data(), id: item.id }) as EmployeeOccurrence)
      .sort((a, b) => b.date.localeCompare(a.date))),
    onError,
  );
}

export async function recordEmployeeOccurrence(
  uid: string, employeeId: string, actor: ActorRole, kind: EmployeeOccurrenceKind, date: string, description: string,
) {
  if (!isValidISODate(date) || date > todayISO() || !description.trim()) {
    throw new Error('Informe a data e a descrição da ocorrência.');
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'employees', employeeId, 'occurrences', generateId('occ')), {
    ...auditFields(uid, actor), kind, date, description: clampStr(description, 1000),
  });
  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid, registeredBy: actor, action: 'Criação', entityType: 'employee-occurrence',
    summary: 'Ocorrência registrada: ' + kind + ' em ' + formatDateBR(date), createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function submitTeamPayroll(
  uid: string, actor: ActorRole, data: PilotisDataState, month: string, dueDate: string,
) {
  if (!isValidISODate(dueDate) || dueDate < month + '-01') {
    throw new Error('Informe um vencimento válido a partir do mês de referência.');
  }
  if (data.transactions.some((transaction) => transaction.source === 'folha' &&
    (transaction.payrollPeriod || transaction.installmentLabel || transaction.date.slice(0, 7)) === month)) {
    throw new Error('A folha deste mês já foi enviada ao Financeiro.');
  }
  const payroll = calculateTeamPayroll(data, month);
  if (!payroll.configured) throw new Error('Encargos não configurados para a competência selecionada.');
  if (payroll.conflicts.length) throw new Error('Resolva os conflitos de alocação deste mês antes de enviar.');
  if (payroll.lines.length === 0) throw new Error('Sem valores de folha para esta competência.');
  if (payroll.lines.some((line) => !line.paymentMethod.trim())) {
    throw new Error('Informe a forma de pagamento dos colaboradores incluídos nesta folha.');
  }
  if (payroll.lines.length >= 500) throw new Error('Esta folha excede o limite de lançamentos por envio.');
  const batch = writeBatch(db);
  for (const line of payroll.lines) {
    const payload: TransactionPayload = {
      date: dueDate, dueDate, description: clampStr(line.category + ' · ' + line.employeeName + (line.vacation ? ' · Férias' : ''), 200),
      entryKind: 'expense', category: line.category, projectId: line.projectId, projectName: line.projectName,
      amount: line.amount, isForecast: true, status: 'A vencer', invoiceStatus: 'Não se aplica',
      paymentMethod: line.paymentMethod, installmentLabel: month, quoteId: '', debtId: '', source: 'folha',
      payrollEmployeeId: line.employeeId, payrollPeriod: month, payrollBase: line.base,
      payrollCharges: line.charges ?? 0, payrollProvisions: line.provisions ?? 0,
    };
    stageNewTransaction(batch, uid, actor, payload, generateId('tx'));
  }
  // Audit records are create-only. This key prevents duplicate sends even across sessions.
  batch.set(doc(db, 'auditLogs', 'payroll-' + uid + '-' + month), {
    ownerUid: uid, registeredBy: actor, action: 'Criação', entityType: 'payroll',
    summary: 'Folha ' + month + ' enviada: ' + payroll.lines.length + ' lançamento(s) · ' + formatBRL(payroll.totalKnown),
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function saveWeeklyAllocation(
  uid: string, actor: ActorRole, employee: Employee, week: string,
  target: { status: Allocation['status']; projectId: string; projectName: string; stageId?: string },
  allocations: Allocation[],
  preventConflictingAssignment = false,
) {
  if (!isValidISODate(week) || weekStartingOn(week) !== week) {
    throw new Error('Escolha a segunda-feira de início da semana.');
  }
  const canonicalId = 'alloc-' + employee.id + '-' + week;
  const legacyIds = allocations.filter((item) => item.id !== canonicalId &&
    item.ownerUid === uid && item.employeeId === employee.id && item.weekStart === week).map((item) => item.id);
  const ref = doc(db, 'allocations', canonicalId);
  await runTransaction(db, async (tx) => {
    const rows = await Promise.all([canonicalId, ...new Set(legacyIds)].map(async (id) => {
      const snapshot = await tx.get(doc(db, 'allocations', id));
      return snapshot.exists() ? { ...snapshot.data(), id } as Allocation : null;
    }));
    const existing = rows.filter((row): row is Allocation => row !== null);
    const [previous, ...duplicates] = existing;
    const weekEnd = addDaysISO(week, 6);
    const projectIds = [...new Set([target.projectId, employee.currentProjectId, ...existing.map((item) => item.projectId)]
      .filter((id) => /^[a-zA-Z0-9_-]+$/.test(id)))];
    const projects = await readClosureRows<Project>(tx, projectIds.map((id) => doc(db, 'projects', id)));
    const locate = (id: string) => projects.find((project) => project.id === id);
    const targetProject = locate(target.projectId);
    if (targetProject && isReleasedProject(targetProject, weekEnd)) throw new Error('Esta obra está encerrada nesta semana.');
    const activeRows = existing.filter((item) => {
      const project = locate(item.projectId);
      return item.status === 'Férias' || !project || !isReleasedProject(project, weekEnd);
    });
    const recordedBeforeClosure = existing.filter((item) => {
      if (item.status !== 'Obra') return false;
      const project = locate(item.projectId);
      const closed = project?.closureDate || project?.warrantyStartDate;
      return Boolean(project?.status === 'Concluída' && closed && closed > (item.effectiveFrom || week) && closed <= weekEnd);
    });
    const defaultProject = existing.length === 0 ? locate(employee.currentProjectId) : undefined;
    const effectiveFrom = [previous?.effectiveFrom ?? week,
      ...recordedBeforeClosure.map((item) => locate(item.projectId)?.closureDate || locate(item.projectId)?.warrantyStartDate || week),
      defaultProject?.status === 'Concluída' ? (defaultProject.closureDate || defaultProject.warrantyStartDate) : '',
    ].filter((date) => date && date <= weekEnd).sort().at(-1) ?? week;
    const stageId = target.status === 'Obra' ? target.stageId ?? '' : '';
    let stage: ProjectStage | undefined;
    if (stageId) {
      const liveEmployee = (await tx.get(doc(db, 'employees', employee.id))).data() as Employee | undefined;
      stage = (await tx.get(doc(db, 'stages', stageId))).data() as ProjectStage | undefined;
      if (!liveEmployee || liveEmployee.ownerUid !== uid) throw new Error('Colaborador indisponível.');
      if (!stage || stage.ownerUid !== uid || stage.projectId !== target.projectId) throw new Error('Escolha uma etapa desta obra.');
      const availability = resolveTeamWeek(liveEmployee, week, { employees: [liveEmployee], allocations: [], projects: [] });
      if (!availability.started || availability.vacation || (preventConflictingAssignment && activeRows.some((row) => row.status === 'Férias'))) {
        throw new Error('O colaborador está indisponível nesta semana. Confira a alocação e as férias em Equipe.');
      }
      if (preventConflictingAssignment && activeRows.some((row) =>
        (row.projectId !== target.projectId && row.projectId !== 'Sem obra') || (row.stageId && row.stageId !== stageId),
      )) throw new Error('Conflito de alocação nesta semana. Resolva a atribuição existente na aba Equipe.');
    }
    const historical = recordedBeforeClosure.find((item) => item.id === canonicalId);
    if (historical) {
      const { id, ownerUid, createdBy, createdAt, updatedAt, updatedBy, ...snapshot } = historical;
      tx.set(doc(db, 'allocations', generateId('alloc_history')), { ...snapshot, ...auditFields(uid, actor) });
    }
    const row = { ...target, stageId, effectiveFrom, employeeId: employee.id, employeeName: employee.name, weekStart: week };
    if (previous?.id === canonicalId) {
      tx.update(ref, { ...row, updatedBy: actor, updatedAt: serverTimestamp() });
    } else {
      tx.set(ref, { ...row, ...auditFields(uid, actor) });
      if (previous && !recordedBeforeClosure.includes(previous)) tx.delete(doc(db, 'allocations', previous.id));
    }
    for (const duplicate of duplicates) {
      if (!recordedBeforeClosure.includes(duplicate)) tx.delete(doc(db, 'allocations', duplicate.id));
    }
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: previous ? 'Atualização' : 'Criação', entityType: 'allocations',
      summary: clampStr('Alocação de ' + employee.name + ' na semana de ' + formatDateBR(week), 240),
      beforeValue: clampStr(existing.map((item) => [item.projectName, item.stageId].filter(Boolean).join(' · ')).join(' / '), 240),
      afterValue: clampStr([target.projectName, stage?.name].filter(Boolean).join(' · '), 240), createdAt: serverTimestamp(),
    });
  });
}

function workDocuments(uid: string, projectId: string, name: string) {
  return getDocsFromServer(query(collection(db, name), where('ownerUid', '==', uid), where('projectId', '==', projectId)));
}

async function readClosureRows<T>(tx: Transaction, refs: DocumentReference[]): Promise<T[]> {
  const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
  return snapshots.filter((row) => row.exists()).map((row) => ({ ...row.data(), id: row.id } as T));
}

const newFollowUp = {
  testimonialRequestedAt: '', referralRequestedAt: '', testimonial: '', referrals: '',
  marketingPhotos: [], authorizationNote: '',
};

async function verifyMarketingPhotos(
  tx: Transaction, uid: string, projectId: string, photos: MarketingPhotoRef[], authorizationNote: string,
) {
  if (photos.length > 100 || authorizationNote.trim().length > 500 || (photos.length && !authorizationNote.trim())) {
    throw new Error('Registre a autorização para as fotos selecionadas (até 100).');
  }
  const logIds = [...new Set(photos.map((photo) => photo.logId))];
  const logs = await readClosureRows<DailyLog>(tx, logIds.map((id) => doc(db, 'dailyLogs', id)));
  if (photos.some((photo) => !logs.some((log) => log.id === photo.logId && log.ownerUid === uid &&
      log.projectId === projectId && log.photoIds?.includes(photo.photoId)))) {
    throw new Error('Uma das fotos selecionadas está indisponível nesta obra.');
  }
}

export async function closeProject(
  uid: string, actor: ActorRole, projectId: string,
  marketingPhotos: MarketingPhotoRef[] = [], authorizationNote = '',
) {
  const [stages, installments, transactions, documents] = await Promise.all(
    ['stages', 'parcelas', 'transactions', 'complianceItems'].map((name) => workDocuments(uid, projectId, name)),
  );
  const projectRef = doc(db, 'projects', projectId);
  const date = planningTodayISO();
  return runTransaction(db, async (tx) => {
    const project = (await tx.get(projectRef)).data() as Omit<Project, 'id'> | undefined;
    if (!project || project.ownerUid !== uid) throw new Error('Obra indisponível.');
    const current = { ...project, id: projectId };
    if (current.status !== 'Em execução') throw new Error('A obra precisa estar em execução para ser encerrada.');

    const refs = (snapshots: typeof stages) => snapshots.docs.map((item) => item.ref);
    const stageRefs = current.scheduleStageIds?.map((id) => doc(db, 'stages', id)) ?? refs(stages);
    const [currentStages, currentInstallments, currentTransactions, currentDocuments, client] = await Promise.all([
      readClosureRows<ProjectStage>(tx, stageRefs),
      readClosureRows<Installment>(tx, refs(installments)),
      readClosureRows<FinancialTransaction>(tx, refs(transactions)),
      readClosureRows<ComplianceItem>(tx, refs(documents)),
      current.clientId ? tx.get(doc(db, 'clients', current.clientId)) : Promise.resolve(null),
    ]);
    if (currentStages.length !== stageRefs.length) throw new Error('Há etapas indisponíveis. Revise o cronograma antes de encerrar.');
    const popIds = [...new Set(currentStages.filter((stage) => stage.popReview?.popId !== stage.popId).map((stage) => stage.popId).filter(Boolean))];
    const pops = await readClosureRows<Pop>(tx, popIds.map((id) => doc(db, 'pops', id)));
    const review = getClosureReview(current, {
      stages: currentStages, installments: currentInstallments, transactions: currentTransactions,
      complianceItems: currentDocuments, pops,
    }, date);
    if (!review.canClose) {
      throw new Error('Conclua a conferência: ' + review.items.filter((item) => !item.cleared).map((item) => item.label).join(', ') + '.');
    }

    await verifyMarketingPhotos(tx, uid, projectId, marketingPhotos, authorizationNote);
    tx.set(doc(db, 'projectClosures', projectId), { ...auditFields(uid, actor), projectId, date, dre: review.dre });
    tx.set(doc(db, 'projectFollowUps', projectId), {
      ...auditFields(uid, actor), projectId, ...newFollowUp, marketingPhotos, authorizationNote: authorizationNote.trim(),
    });
    tx.update(projectRef, {
      status: 'Concluída', closureDate: date, warrantyStartDate: date,
      updatedBy: actor, updatedAt: serverTimestamp(),
    });
    if (client?.exists() && client.data().ownerUid === uid) {
      tx.update(client.ref, { status: 'Em garantia', updatedBy: actor, updatedAt: serverTimestamp() });
    }
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: 'Atualização', entityType: 'projects',
      summary: clampStr('Encerramento da obra ' + current.name, 240),
      beforeValue: current.status, afterValue: 'Concluída · Garantia iniciada', createdAt: serverTimestamp(),
    });
    return review.dre;
  });
}

type FollowUpPayload = Omit<ProjectFollowUp, keyof import('../types/pilotis').AuditMeta | 'id' | 'projectId'>;

export async function saveProjectFollowUp(uid: string, actor: ActorRole, projectId: string, payload: FollowUpPayload) {
  const { testimonial, referrals, authorizationNote, marketingPhotos, testimonialRequestedAt, referralRequestedAt } = payload;
  if (testimonial.trim().length > 3000 || referrals.trim().length > 2000 || authorizationNote.trim().length > 500) {
    throw new Error('Confira o tamanho dos textos antes de salvar.');
  }
  const today = planningTodayISO();
  if (![testimonialRequestedAt, referralRequestedAt].every((date) => !date || (isValidISODate(date) && date <= today))) {
    throw new Error('Informe datas válidas para os pedidos enviados.');
  }
  const ref = doc(db, 'projectFollowUps', projectId);
  await runTransaction(db, async (tx) => {
    const [projectSnapshot, previous] = await Promise.all([tx.get(doc(db, 'projects', projectId)), tx.get(ref)]);
    const project = projectSnapshot.data() as Project | undefined;
    if (!project || project.ownerUid !== uid || project.status !== 'Concluída') throw new Error('Selecione uma obra encerrada.');
    await verifyMarketingPhotos(tx, uid, projectId, marketingPhotos, authorizationNote);
    const client = project.clientId && (testimonial.trim() || testimonialRequestedAt)
      ? await tx.get(doc(db, 'clients', project.clientId)) : null;
    const row = {
      ...payload, testimonial: testimonial.trim(), referrals: referrals.trim(),
      authorizationNote: authorizationNote.trim(), projectId,
    };
    if (previous.exists()) tx.update(ref, { ...row, updatedBy: actor, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...row, ...auditFields(uid, actor) });
    if (client?.exists() && client.data().ownerUid === uid) {
      const currentStatus = String(client.data().testimonialStatus ?? '');
      if (testimonial.trim() || !currentStatus.startsWith('Recebido')) {
        tx.update(client.ref, { testimonialStatus: testimonial.trim() ? 'Recebido' : 'Solicitado',
          updatedBy: actor, updatedAt: serverTimestamp() });
      }
    }
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: previous.exists() ? 'Atualização' : 'Criação', entityType: 'projectFollowUps',
      summary: clampStr('Pós-obra atualizado · ' + project.name, 240), createdAt: serverTimestamp(),
    });
  });
}

type WarrantyPayload = Pick<WarrantyCall, 'description' | 'openedDate' | 'deadlineDate' | 'cost' | 'status'>;

export async function saveWarrantyCall(uid: string, actor: ActorRole, projectId: string, payload: WarrantyPayload, callId?: string) {
  const today = planningTodayISO();
  if (!payload.description.trim() || !isValidISODate(payload.openedDate) || !isValidISODate(payload.deadlineDate) ||
      payload.openedDate > today || payload.deadlineDate < payload.openedDate ||
      !Number.isFinite(payload.cost) || payload.cost < 0) {
    throw new Error('Confira a descrição, as datas e o custo do chamado.');
  }
  const ref = doc(db, 'warrantyCalls', callId ?? generateId('war'));
  await runTransaction(db, async (tx) => {
    const project = (await tx.get(doc(db, 'projects', projectId))).data() as Project | undefined;
    const before = callId ? (await tx.get(ref)).data() as WarrantyCall | undefined : undefined;
    if (!project || project.ownerUid !== uid) throw new Error('Obra indisponível.');
    if (callId && (!before || before.ownerUid !== uid || before.projectId !== projectId)) {
      throw new Error('Chamado indisponível.');
    }
    if ((!before || payload.openedDate !== before.openedDate) && !getWarrantyWindow(project, payload.openedDate)?.active) {
      throw new Error('A abertura precisa estar dentro do período de garantia da obra.');
    }
    const row = {
      ...payload, description: clampStr(payload.description.trim(), 400), cost: roundCents(payload.cost),
      projectId, projectName: project.name,
    };
    if (before) tx.update(ref, { ...row, updatedBy: actor, updatedAt: serverTimestamp() });
    else tx.set(ref, { ...row, ...auditFields(uid, actor) });
    tx.set(doc(db, 'auditLogs', generateId('aud')), {
      ownerUid: uid, registeredBy: actor, action: before ? 'Atualização' : 'Criação', entityType: 'warrantyCalls',
      summary: clampStr('Chamado de garantia · ' + project.name, 240),
      beforeValue: before?.status ?? '', afterValue: payload.status, createdAt: serverTimestamp(),
    });
  });
}
