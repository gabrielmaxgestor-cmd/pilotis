import {
  Bytes,
  collection,
  doc,
  getDoc,
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
  CompanySettings,
  Debt,
  FinancialTransaction,
  Installment,
  PilotisDataState,
  Pop,
  Project,
  ProjectContractKind,
  ProjectType,
  Quote,
} from '../types/pilotis';
import {
  addMonthsISO,
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  gerarParcelas,
  isValidISODate,
  validarLancamentoFinanceiro,
  normalizeBRDateToISO,
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
    { colName: 'dailyLogs', stateKey: 'dailyLogs' },
    { colName: 'transactions', stateKey: 'transactions' },
    { colName: 'debts', stateKey: 'debts' },
    { colName: 'employees', stateKey: 'employees' },
    { colName: 'allocations', stateKey: 'allocations' },
    { colName: 'pops', stateKey: 'pops' },
    { colName: 'complianceItems', stateKey: 'complianceItems' },
    { colName: 'tenders', stateKey: 'tenders' },
    { colName: 'warrantyCalls', stateKey: 'warrantyCalls' },
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
  isMilestone?: boolean;
}

export function getStageTemplatesForType(type: ProjectType): StageTemplateItem[] {
  if (type === 'Obra satélite') {
    return [
      { wbsCode: '1.1', phase: '1 · Mobilização', name: 'Preparação e proteção do local', responsible: 'Equipe geral', startWeek: 0, durationWeeks: 1, budgetPct: 0.2, depWbs: [] },
      { wbsCode: '2.1', phase: '2 · Execução', name: 'Serviço principal da obra satélite', responsible: 'Pedreiros', startWeek: 1, durationWeeks: 2, budgetPct: 0.6, depWbs: ['1.1'] },
      { wbsCode: '3.1', phase: '3 · Entrega', name: 'Vistoria e limpeza final', responsible: 'Sócios', startWeek: 3, durationWeeks: 1, budgetPct: 0.2, depWbs: ['2.1'], isMilestone: true },
    ];
  }
  if (type === 'Reforma') {
    return [
      { wbsCode: '1.1', phase: '1 · Demolição e preparo', name: 'Demolição e limpeza inicial', responsible: 'Equipe geral', startWeek: 0, durationWeeks: 2, budgetPct: 0.15, depWbs: [] },
      { wbsCode: '2.1', phase: '2 · Instalações', name: 'Instalações hidráulicas e elétricas', responsible: 'Eletricistas e hidráulica', startWeek: 2, durationWeeks: 3, budgetPct: 0.25, depWbs: ['1.1'] },
      { wbsCode: '3.1', phase: '3 · Revestimentos', name: 'Revestimentos e pisos', responsible: 'Ladrilheiro', startWeek: 5, durationWeeks: 3, budgetPct: 0.3, depWbs: ['2.1'] },
      { wbsCode: '4.1', phase: '4 · Pintura e entrega', name: 'Pintura e acabamentos finais', responsible: 'Pintores', startWeek: 8, durationWeeks: 2, budgetPct: 0.2, depWbs: ['3.1'] },
      { wbsCode: '4.2', phase: '4 · Pintura e entrega', name: 'Entrega ao cliente', responsible: 'Sócios', startWeek: 10, durationWeeks: 0, budgetPct: 0.1, depWbs: ['4.1'], isMilestone: true },
    ];
  }
  return [
    { wbsCode: '1.1', phase: '1 · Fundação, estrutura e cobertura', name: 'Fundação e estrutura', responsible: 'Sócios e pedreiros', startWeek: 0, durationWeeks: 8, budgetPct: 0.2, depWbs: [] },
    { wbsCode: '1.2', phase: '1 · Fundação, estrutura e cobertura', name: 'Cobertura', responsible: 'Equipe de cobertura', startWeek: 8, durationWeeks: 5, budgetPct: 0.1, depWbs: ['1.1'] },
    { wbsCode: '2.1', phase: '2 · Instalações', name: 'Instalações hidráulicas', responsible: 'Hidráulica', startWeek: 9, durationWeeks: 4, budgetPct: 0.08, depWbs: ['1.1'] },
    { wbsCode: '2.2', phase: '2 · Instalações', name: 'Instalações elétricas', responsible: 'Eletricistas', startWeek: 9, durationWeeks: 6, budgetPct: 0.1, depWbs: ['1.1'] },
    { wbsCode: '3.1', phase: '3 · Revestimentos', name: 'Revestimento interno', responsible: 'Ladrilheiro e pedreiros', startWeek: 13, durationWeeks: 6, budgetPct: 0.18, depWbs: ['1.2', '2.1'] },
    { wbsCode: '3.2', phase: '3 · Revestimentos', name: 'Revestimento externo', responsible: 'Pedreiros', startWeek: 13, durationWeeks: 5, budgetPct: 0.1, depWbs: ['1.2'] },
    { wbsCode: '4.1', phase: '4 · Pintura e acabamentos', name: 'Pintura', responsible: 'Pintores', startWeek: 19, durationWeeks: 3, budgetPct: 0.1, depWbs: ['3.1'] },
    { wbsCode: '4.2', phase: '4 · Pintura e acabamentos', name: 'Acabamentos finais', responsible: 'Pedreiros', startWeek: 22, durationWeeks: 2, budgetPct: 0.08, depWbs: ['4.1', '2.2'] },
    { wbsCode: '5.1', phase: '5 · Entrega', name: 'Limpeza e vistoria final', responsible: 'Equipe geral', startWeek: 24, durationWeeks: 1, budgetPct: 0.06, depWbs: ['4.2'] },
    { wbsCode: '5.2', phase: '5 · Entrega', name: 'Entrega ao cliente', responsible: 'Sócios', startWeek: 25, durationWeeks: 0, budgetPct: 0, depWbs: ['5.1'], isMilestone: true },
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

export async function applyScheduleTemplateToProject(params: {
  uid: string;
  actor: ActorRole;
  project: Project;
  templateType: ProjectType;
  startDate: string;
  estimatedMonths: number;
  pops: Pop[];
}): Promise<void> {
  const { uid, actor, project, templateType, startDate, estimatedMonths, pops } = params;
  const directBudget =
    (project.budgetedLabor || 0) +
    (project.budgetedSubcontract || 0) +
    (project.budgetedEquipment || 0) +
    (project.budgetedBdi || 0) +
    (project.budgetedTax || 0);
  const effectiveBudget = directBudget > 0 ? directBudget : Math.round(project.contractValue * 0.78);
  const normalizedStart = normalizeBRDateToISO(startDate);
  const endBaseline = addMonthsISO(normalizedStart, Math.max(1, estimatedMonths));

  const batch = writeBatch(db);
  const tpl = getStageTemplatesForType(templateType);
  const wbsToId = new Map<string, string>();
  for (const item of tpl) wbsToId.set(item.wbsCode, generateId('stg'));

  for (const item of tpl) {
    const stgId = wbsToId.get(item.wbsCode)!;
    const matchedPop = pops.find(
      (p) =>
        p.status === 'Vigente' &&
        (item.phase.toLowerCase().includes(p.linkedStagePhase.toLowerCase()) ||
          item.name.toLowerCase().includes(p.serviceType.toLowerCase()))
    );
    batch.set(doc(db, 'stages', stgId), {
      ownerUid: uid,
      projectId: project.id,
      wbsCode: item.wbsCode,
      phase: clampStr(item.phase, 100),
      name: clampStr(item.name, 140),
      responsible: clampStr(item.responsible, 120),
      durationWeeks: item.durationWeeks,
      startWeek: item.startWeek,
      baselineStartWeek: item.startWeek,
      baselineDurationWeeks: item.durationWeeks,
      progressPct: 0,
      budgetedCost: Math.round(effectiveBudget * item.budgetPct),
      popId: matchedPop?.id || '',
      dependsOn: item.depWbs.map((w) => wbsToId.get(w)!).filter(Boolean),
      isMilestone: Boolean(item.isMilestone),
      status: 'A fazer',
      materialExpectedDate: '',
      delayCategory: '',
      delayJustification: '',
      checklistCompleted: [],
      createdBy: actor,
      updatedBy: actor,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'projects', project.id), {
    type: templateType,
    startDate,
    baselineEndDate: endBaseline,
    forecastEndDate: endBaseline,
    status: project.status === 'Concluída' ? 'Concluída' : 'Em execução',
    planningStatus: 'Cronograma criado',
    updatedBy: actor,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid,
    registeredBy: actor,
    action: 'Atualização',
    entityType: 'projects',
    summary: clampStr(
      `Modelo de cronograma "${templateType}" aplicado à obra ${project.name} (${tpl.length} etapas).`,
      240
    ),
    beforeValue: clampStr(project.planningStatus || 'Aguardando modelo de cronograma', 240),
    afterValue: clampStr(`Cronograma criado · Em execução (${templateType})`, 240),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `projects/${project.id}`);
  }
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

export async function markInstallmentInvoiceIssued(
  uid: string,
  actor: ActorRole,
  installment: Installment
): Promise<void> {
  const parcelaRef = doc(db, 'parcelas', installment.id);

  try {
    await runTransaction(db, async (tx) => {
      const parcelaSnap = await tx.get(parcelaRef);
      if (!parcelaSnap.exists()) {
        throw new InstallmentValidationError('Parcela não encontrada no banco de dados.');
      }
      const instData = parcelaSnap.data() as Installment;
      if (instData.ownerUid !== uid) {
        throw new InstallmentValidationError('Parcela não pertence à empresa autenticada.');
      }

      const linkedTxId = (instData.transactionId || '').trim();
      const linkedTxRef = linkedTxId ? doc(db, 'transactions', linkedTxId) : null;
      const linkedTxSnap = linkedTxRef ? await tx.get(linkedTxRef) : null;

      const patch: Record<string, unknown> = {
        invoiceStatus: 'Emitida',
        updatedBy: actor,
        updatedAt: serverTimestamp(),
      };
      if (instData.status !== 'Recebida' && instData.status !== 'A vencer') {
        patch.status = 'A vencer';
      }
      tx.update(parcelaRef, patch);

      if (linkedTxSnap && linkedTxSnap.exists()) {
        tx.update(linkedTxRef!, {
          invoiceStatus: 'Emitida',
          updatedBy: actor,
          updatedAt: serverTimestamp(),
        });
      }

      tx.set(doc(db, 'auditLogs', generateId('aud')), {
        ownerUid: uid,
        registeredBy: actor,
        action: 'Atualização',
        entityType: 'parcelas',
        summary: clampStr(
          `Nota fiscal emitida: ${instData.label} · ${instData.projectName}`,
          240
        ),
        beforeValue: clampStr(`Nota fiscal: ${instData.invoiceStatus || 'A emitir'}`, 240),
        afterValue: 'Nota fiscal: Emitida',
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof InstallmentValidationError) {
      throw err;
    }
    handleFirestoreError(err, OperationType.WRITE, `parcelas/${installment.id}`);
  }
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
    startDate: string;
    estimatedMonths: number;
    pops: Pop[];
  }
): Promise<string> {
  const projectId = generateId('proj');
  const normalizedStart = normalizeBRDateToISO(params.startDate);
  const endBaseline = addMonthsISO(normalizedStart, Math.max(1, params.estimatedMonths));
  const contractKind: ProjectContractKind =
    params.contractKind || (params.type === 'Obra satélite' ? 'Satélite' : 'Principal');
  const batch = writeBatch(db);

  const projectRef = doc(db, 'projects', projectId);
  batch.set(projectRef, {
    ownerUid: uid,
    name: clampStr(params.name, 160),
    quoteId: '',
    clientId: '',
    clientName: clampStr(params.clientName, 140),
    type: params.type,
    contractKind,
    planningStatus: 'Cronograma criado',
    contractValue: params.contractValue,
    budgetedLabor: Math.round(params.contractValue * 0.45),
    budgetedSubcontract: Math.round(params.contractValue * 0.15),
    budgetedEquipment: Math.round(params.contractValue * 0.08),
    budgetedBdi: Math.round(params.contractValue * 0.1),
    budgetedTax: Math.round(params.contractValue * 0.08),
    startDate: params.startDate,
    baselineEndDate: endBaseline,
    forecastEndDate: endBaseline,
    status: 'Em execução',
    contractSigned: true,
    warrantyStartDate: '',
    createdBy: actor,
    updatedBy: actor,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const tpl = getStageTemplatesForType(params.type);
  const wbsToId = new Map<string, string>();
  for (const item of tpl) wbsToId.set(item.wbsCode, generateId('stg'));

  for (const item of tpl) {
    const stgId = wbsToId.get(item.wbsCode)!;
    const matchedPop = params.pops.find(
      (p) =>
        p.status === 'Vigente' &&
        (item.phase.toLowerCase().includes(p.linkedStagePhase.toLowerCase()) ||
          item.name.toLowerCase().includes(p.serviceType.toLowerCase()))
    );
    batch.set(doc(db, 'stages', stgId), {
      ownerUid: uid,
      projectId,
      wbsCode: item.wbsCode,
      phase: clampStr(item.phase, 100),
      name: clampStr(item.name, 140),
      responsible: clampStr(item.responsible, 120),
      durationWeeks: item.durationWeeks,
      startWeek: item.startWeek,
      baselineStartWeek: item.startWeek,
      baselineDurationWeeks: item.durationWeeks,
      progressPct: 0,
      budgetedCost: Math.round(params.contractValue * 0.78 * item.budgetPct),
      popId: matchedPop?.id || '',
      dependsOn: item.depWbs.map((w) => wbsToId.get(w)!).filter(Boolean),
      isMilestone: Boolean(item.isMilestone),
      status: 'A fazer',
      materialExpectedDate: '',
      delayCategory: '',
      delayJustification: '',
      checklistCompleted: [],
      createdBy: actor,
      updatedBy: actor,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'auditLogs', generateId('aud')), {
    ownerUid: uid,
    registeredBy: actor,
    action: 'Criação',
    entityType: 'projects',
    summary: clampStr(`Obra (${contractKind}) criada a partir do modelo ${params.type}: ${params.name}`, 240),
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return projectId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `projects/${projectId}`);
  }
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
