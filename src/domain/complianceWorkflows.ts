import { isValidISODate, roundCents } from './formatters';
import type { ComplianceItem, FinancialTransaction, Installment, InvoiceStatus } from '../types/pilotis';

export const OBLIGATION_TYPES = ['Simples Nacional', 'ISS', 'INSS', 'FGTS', 'eSocial', 'DCTFWeb', 'EFD-Reinf'] as const;
export const CERTIFICATE_TYPES = ['Federal', 'Estadual', 'Municipal', 'FGTS', 'Trabalhista'] as const;
export const WORK_DOCUMENT_TYPES = ['Contrato', 'ART/RRT', 'CNO', 'Notas fiscais', 'Responsável técnico'] as const;
export const TENDER_CATEGORIES = ['Regularidade fiscal', 'Regularidade trabalhista', 'Qualificação técnica', 'Econômico-financeira'] as const;

function normalized(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

export function resolveCertificateCategory(item: Pick<ComplianceItem, 'category' | 'title'>) {
  const current = CERTIFICATE_TYPES.find((type) => normalized(type) === normalized(item.category ?? ''));
  return current ?? CERTIFICATE_TYPES.find((type) => new RegExp('\\b' + normalized(type) + '\\b').test(normalized(item.title ?? ''))) ?? 'Outro';
}

export function resolveWorkDocumentCategory(item: Pick<ComplianceItem, 'category' | 'title'>) {
  const current = WORK_DOCUMENT_TYPES.find((type) => normalized(type) === normalized(item.category ?? ''));
  if (current) return current;
  const title = normalized(item.title ?? '');
  if (/\b(?:art|rrt)\b/.test(title)) return 'ART/RRT';
  if (/\bcno\b/.test(title)) return 'CNO';
  if (/\bcontrato\b/.test(title)) return 'Contrato';
  if (/\b(?:nota fiscal|notas fiscais|nf-e|nfs-e)\b/.test(title)) return 'Notas fiscais';
  if (/\bresponsavel\s+tecnico\b/.test(title)) return 'Responsável técnico';
  return 'Outros';
}

export function normalizeTenderCategory(category: string) {
  const label = normalized(category ?? '');
  if (label === 'fiscal' || label === 'regularidade fiscal') return TENDER_CATEGORIES[0];
  if (label === 'trabalhista' || label === 'regularidade trabalhista') return TENDER_CATEGORIES[1];
  if (label === 'qualificacao tecnica' || label === 'tecnica') return TENDER_CATEGORIES[2];
  if (label.includes('economico') || label === 'financeira') return TENDER_CATEGORIES[3];
  return category?.trim() || 'Documentação geral';
}

export function normalizeCompetence(value: string) {
  const short = /^(0[1-9]|1[0-2])\/(\d{4})$/.exec(value.trim());
  const month = short ? short[2] + '-' + short[1] : value.trim();
  return isValidISODate(month + '-01') ? month : '';
}

export type InvoiceReceiptTarget =
  | { transactionId: string; installmentId?: string }
  | { installmentId: string; transactionId?: string };

export interface InvoiceReceipt {
  key: string;
  projectId: string;
  projectName: string;
  description: string;
  date: string;
  amount: number;
  invoiceStatus: InvoiceStatus;
  target: InvoiceReceiptTarget;
}

export function isActualReceipt(row: Pick<FinancialTransaction, 'entryKind' | 'status' | 'isForecast'>) {
  return row.entryKind === 'income' && row.status === 'Recebido' && !row.isForecast;
}

function receiptDate(date: string | undefined) {
  return isValidISODate(date) ? date! : '';
}

export function getInvoiceReceipts(transactions: FinancialTransaction[], installments: Installment[]): InvoiceReceipt[] {
  const installmentsById = new Map(installments.map((item) => [item.id, item]));
  const installmentsByTransaction = new Map(installments.filter((item) => item.transactionId).map((item) => [item.transactionId, item]));
  const receipts = new Map<string, { row: InvoiceReceipt; priority: number }>();
  for (const transaction of transactions.filter(isActualReceipt)) {
    const installment = installmentsById.get(transaction.installmentId ?? '') ?? installmentsByTransaction.get(transaction.id);
    const installmentId = installment?.id || transaction.installmentId;
    const key = installmentId ? 'parcel_' + installmentId : 'transaction_' + transaction.id;
    const priority = installment?.transactionId === transaction.id ? 1 : 0;
    const date = receiptDate(transaction.date || installment?.receivedDate);
    const existing = receipts.get(key);
    if (existing && (existing.priority > priority || (existing.priority === priority && existing.row.date >= date))) continue;
    receipts.set(key, { priority, row: {
      key, projectId: transaction.projectId || installment?.projectId || 'Empresa',
      projectName: transaction.projectName || installment?.projectName || '',
      description: transaction.description, date,
      amount: transaction.amount, invoiceStatus: transaction.invoiceStatus || installment?.invoiceStatus || 'A emitir',
      target: { transactionId: transaction.id, ...(installmentId ? { installmentId } : {}) },
    } });
  }
  for (const installment of installments) {
    const key = 'parcel_' + installment.id;
    if (installment.status !== 'Recebida' || receipts.has(key)) continue;
    receipts.set(key, { priority: 0, row: {
      key, projectId: installment.projectId, projectName: installment.projectName,
      description: (installment.number === 0 ? 'Entrada' : 'Parcela ' + installment.label) + (installment.clientName ? ' · ' + installment.clientName : ''),
      date: receiptDate(installment.receivedDate), amount: installment.amount,
      invoiceStatus: installment.invoiceStatus || 'A emitir', target: { installmentId: installment.id },
    } });
  }
  return [...receipts.values()].map(({ row }) => row).sort((a, b) => b.date.localeCompare(a.date) || a.key.localeCompare(b.key));
}

export function pendingInvoiceReceipts(receipts: InvoiceReceipt[], projectId = '', month = '') {
  return receipts.filter((row) => (!projectId || row.projectId === projectId) && (!month || row.date.slice(0, 7) === month) &&
    (row.invoiceStatus === 'Não emitida' || row.invoiceStatus === 'A emitir'));
}

export function sumPendingInvoices(rows: InvoiceReceipt[]) {
  return roundCents(rows.reduce((sum, row) => sum + row.amount, 0));
}
