import { addMonthsISO, isValidISODate, roundCents } from './formatters';
import { resolveWorkDocumentCategory } from './complianceWorkflows';
import { resolverStatusConformidade } from './conformidade';
import { linkedPopChecklist } from './pops';
import { calcularDreObra } from './pilotisAdapters';
import type { ComplianceItem, FinancialTransaction, Installment, Pop, Project, ProjectStage, WarrantyCall } from '../types/pilotis';

type ClosureData = {
  stages: ProjectStage[];
  pops: Pop[];
  installments: Installment[];
  transactions: FinancialTransaction[];
  complianceItems: ComplianceItem[];
};

const acceptableInvoice = (state: string | undefined) => state === 'Emitida' || state === 'Não se aplica';
const canCountOn = (date: string, cutoff: string) => isValidISODate(date) && date <= cutoff;

export function getClosureReview(project: Project, data: ClosureData, date: string) {
  const stages = data.stages.filter((row) => row.projectId === project.id);
  const installments = data.installments.filter((row) => row.projectId === project.id);
  const entries = data.transactions.filter((row) => row.projectId === project.id && canCountOn(row.date, date));
  const documents = data.complianceItems.filter((row) => row.projectId === project.id && row.kind === 'Documento de obra');
  const quality = stages.filter((stage) => stage.popId).filter((stage) => {
    const pop = data.pops.find((row) => row.id === stage.popId);
    const review = linkedPopChecklist(stage, pop);
    return !review || review.acceptanceCriteria.some((item) => !(stage.checklistCompleted ?? []).includes(item));
  });
  const openStages = stages.filter((row) => row.status !== 'Concluída');
  const payable = installments.filter((row) => row.amount > 0);
  const unpaid = payable.filter((row) => row.status !== 'Recebida' || !canCountOn(row.receivedDate, date));
  const actual = entries.filter((row) => !row.isForecast &&
    ((row.entryKind === 'income' && row.status === 'Recebido') || (row.entryKind === 'expense' && row.status === 'Pago')));
  const invoiceEntries = actual.filter((row) => !acceptableInvoice(row.invoiceStatus));
  const installmentInvoices = payable.filter((row) => {
    const linked = actual.find((entry) => entry.entryKind === 'income' && (entry.id === row.transactionId || entry.installmentId === row.id));
    return !acceptableInvoice(linked?.invoiceStatus ?? row.invoiceStatus);
  });
  const dre = calcularDreObra(project, entries, stages);
  const expected = project.installmentsCount ?? 0;
  const noPaymentStructure = installments.length === 0 && project.contractValue > 0 &&
    (Boolean(project.quoteId) || dre.receita.realizado < project.contractValue);
  const hasEntry = Math.round(Math.round(project.contractValue * 100) * (project.downPaymentPct ?? 0) / 100) > 0;
  const missingInstallments = expected > 0 && (
    Array.from({ length: expected }, (_, index) => index + 1).some((number) => !installments.some((row) => row.number === number))
    || (hasEntry && !installments.some((row) => row.number === 0))
  );
  const missingReceipts = dre.receita.realizado < roundCents(payable.filter((row) => !unpaid.includes(row))
    .reduce((total, row) => total + row.amount, 0));
  const attached = (category: 'ART/RRT' | 'CNO') => documents.some((row) =>
    resolveWorkDocumentCategory(row) === category && Boolean(row.fileName?.trim()) &&
    ['Anexado', 'Válida', 'Em dia'].includes(resolverStatusConformidade({ tipo: row.kind, status: row.status, vencimento: row.dueDate }, date)));
  const items = [
    { id: 'stages', label: 'Etapas concluídas', cleared: stages.length > 0 && !openStages.length,
      detail: stages.length ? (stages.length - openStages.length) + ' de ' + stages.length + ' concluídas' : 'Cadastre e conclua as etapas da obra.' },
    { id: 'quality', label: 'Checklists de qualidade', cleared: stages.length > 0 && !quality.length,
      detail: quality.length ? quality.map((row) => row.name).join(', ') : stages.some((row) => row.popId) ? 'Critérios dos POPs conferidos.' : 'Sem POP vinculado às etapas.' },
    { id: 'installments', label: 'Parcelas recebidas', cleared: !unpaid.length && !missingInstallments && !noPaymentStructure && !missingReceipts,
      detail: missingInstallments || noPaymentStructure || missingReceipts ? 'Confira as parcelas ou os recebimentos registrados no Financeiro.'
        : payable.length ? (payable.length - unpaid.length) + ' de ' + payable.length + ' recebidas' : 'Sem parcelas vinculadas.' },
    { id: 'invoices', label: 'Notas fiscais', cleared: !invoiceEntries.length && !installmentInvoices.length,
      detail: invoiceEntries.length || installmentInvoices.length ? 'Há recebimentos ou despesas com nota pendente no Financeiro.'
        : actual.length || payable.length ? 'Notas emitidas ou marcadas como “Não se aplica”.' : 'Sem lançamentos fiscais para conferir.' },
    { id: 'art', label: 'ART/RRT', cleared: attached('ART/RRT'), detail: 'Documento da obra com arquivo registrado em Conformidade.' },
    { id: 'cno', label: 'CNO', cleared: attached('CNO'), detail: 'Matrícula da obra com arquivo registrado em Conformidade.' },
  ];
  return { items, canClose: project.status === 'Em execução' && items.every((item) => item.cleared), dre };
}

export function getWarrantyWindow(project: Pick<Project, 'status' | 'warrantyStartDate'>, date: string) {
  const start = project.warrantyStartDate;
  if (project.status !== 'Concluída' || !isValidISODate(start)) return null;
  const end = addMonthsISO(start, 12);
  return { start, end, active: isValidISODate(date) && date >= start && date <= end };
}

export function summarizeWarrantyCalls(calls: WarrantyCall[]) {
  return {
    cost: calls.length ? roundCents(calls.reduce((total, row) => total + (row.cost ?? 0), 0)) : null,
    open: calls.filter((row) => row.status !== 'Resolvido').length,
  };
}
