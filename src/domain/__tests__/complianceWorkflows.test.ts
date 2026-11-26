import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calcularAlertasSistema, calcularResumoConformidade, getInvoiceReceipts, normalizeCompetence,
  pendingInvoiceReceipts, prontidaoLicitacaoPorCategoria, resolveWorkDocumentCategory,
  resolverStatusConformidade, toDomainComplianceItems,
} from '..';
import type { ComplianceItem, FinancialTransaction, Installment, PilotisDataState } from '../../types/pilotis';

const reference = '2026-11-25';
const audit = {
  ownerUid: 'company',
  createdBy: 'Sócio' as const,
  updatedBy: 'Sócio' as const,
  createdAt: '',
  updatedAt: '',
};

function compliance(id: string, fields: Partial<ComplianceItem>): ComplianceItem {
  return {
    ...audit, id, kind: 'Obrigação', title: id, category: 'ISS', projectId: '', projectName: '',
    competence: '2026-11', dueDate: '', issuedDate: '', fileName: '', mandatory: true,
    status: 'Pendente', notes: '', ...fields,
  };
}

function transaction(id: string, fields: Partial<FinancialTransaction>): FinancialTransaction {
  return {
    ...audit, id, entryKind: 'income', description: id, projectId: 'obra', projectName: 'Obra',
    category: 'Recebimentos', amount: 200, date: '2026-11-20', dueDate: '2026-10-25', isForecast: false,
    status: 'Recebido', invoiceStatus: 'A emitir', paymentMethod: '', receiptRef: '', installmentLabel: '',
    quoteId: '', debtId: '', source: 'manual', ...fields,
  };
}

function installment(id: string, fields: Partial<Installment>): Installment {
  return {
    ...audit, id, projectId: 'obra', projectName: 'Obra', quoteId: 'quote', clientId: 'client',
    clientName: '', number: 1, label: '01/02', dueDate: '2026-10-25', amount: 200,
    invoiceStatus: 'A emitir', status: 'Recebida', receivedDate: '2026-11-20', transactionId: '', ...fields,
  };
}

test('recebimentos previstos não entram no painel de notas de recebimentos', () => {
  const transactions = [
    transaction('linked', { installmentId: 'a' }),
    transaction('reverse', { amount: 150, invoiceStatus: 'Não emitida' }),
    transaction('duplicate', { installmentId: 'a', amount: 1, date: '2026-11-23' }),
    transaction('forecast', { isForecast: true }),
    transaction('open', { status: 'A vencer' }),
    transaction('loan', { entryKind: 'loan' }),
    transaction('other-month', { date: '2026-10-25' }),
    transaction('emitted', { invoiceStatus: 'Emitida' }),
    transaction('not-applicable', { invoiceStatus: 'Não se aplica' }),
  ];
  const installments = [
    installment('a', { transactionId: 'linked' }),
    installment('b', { transactionId: 'reverse' }),
    installment('legacy', { amount: 70, receivedDate: '2026-11-12' }),
    installment('open', { status: 'A vencer' }),
  ];
  const receipts = getInvoiceReceipts(transactions, installments);
  const pending = pendingInvoiceReceipts(receipts, 'obra', '2026-11');
  assert.deepEqual(pending.map((row) => row.key), ['parcel_a', 'parcel_b', 'parcel_legacy']);
  assert.deepEqual(pending.map((row) => row.amount), [200, 150, 70]);
  assert.equal(calcularResumoConformidade([], transactions, reference, installments).receitaSemNotaPendente, 620);
  assert.equal(calcularResumoConformidade([], [transactions[3]], reference).receitaSemNotaPendente, null);
});

test('gera alertas de obrigações e certidões sem outros dados no sistema', () => {
  const complianceItems = [
    compliance('due', { dueDate: '2026-12-02' }),
    compliance('late', { dueDate: '2026-11-24' }),
    compliance('fulfilled', { dueDate: '2026-11-22', status: 'Em dia' }),
    compliance('certificate-due', { kind: 'Certidão', status: 'Válida', dueDate: '2026-12-25' }),
    compliance('certificate-expired', { kind: 'Certidão', status: 'Válida', dueDate: '2026-11-20' }),
    compliance('future', { dueDate: '2026-12-03' }),
  ];
  const data: PilotisDataState = {
    settings: null, clients: [], quotes: [], projects: [], installments: [], stages: [], dailyLogs: [],
    transactions: [], debts: [], employees: [], allocations: [], pops: [], complianceItems,
    tenders: [], warrantyCalls: [], auditLogs: [],
  };
  const alerts = calcularAlertasSistema(data, reference).filter((row) => row.modulo === 'compliance');
  assert.deepEqual(new Map(alerts.map((row) => [row.referenciaId, row.nivel])), new Map([
    ['due', 'Atenção'], ['late', 'Urgente'], ['certificate-due', 'Atenção'], ['certificate-expired', 'Urgente'],
  ]));
  const summary = calcularResumoConformidade(complianceItems, [], reference);
  assert.equal(summary.obrigacoesAVencerOuAtrasadas, 2);
  assert.equal(summary.certidoesValidas, 1);
  assert.equal(resolverStatusConformidade({ tipo: 'Certidão', status: 'Válida', vencimento: '2026-11-24' }, reference), 'Em atraso');
});

test('agrupa categorias legadas e exclui itens vencidos da prontidão', () => {
  const items = [
    compliance('one', { kind: 'Licitação', category: 'Fiscal', status: 'Anexado', dueDate: '2026-11-24' }),
    compliance('two', { kind: 'Licitação', category: 'Regularidade fiscal', status: 'Anexado', dueDate: '2026-11-25' }),
    compliance('three', { kind: 'Licitação', category: 'Trabalhista', status: 'Pendente' }),
  ];
  const readiness = prontidaoLicitacaoPorCategoria(toDomainComplianceItems(items), reference);
  assert.deepEqual(readiness.map((row) => [row.categoria, row.pct]), [['Regularidade fiscal', 50], ['Regularidade trabalhista', 0]]);
  assert.equal(calcularResumoConformidade(items, [], reference).prontidaoLicitacoesPct, 33);
  assert.equal(normalizeCompetence('11/2026'), '2026-11');
  assert.equal(normalizeCompetence('2026-13'), '');
  assert.equal(resolveWorkDocumentCategory({ title: 'CNO da obra', category: 'Cadastral' }), 'CNO');
});
