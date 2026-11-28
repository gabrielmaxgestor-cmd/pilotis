import { AccountingPackageView } from './financial/AccountingPackageView';
import { installmentWhatsAppContext } from '../domain/whatsapp';
import { formatTimestampBR } from '../domain/formatters';
import { WhatsAppShortcut } from '../components/ui/WhatsAppShortcut';
import { useEffect, useMemo, useState } from 'react';
import { ListToolbar, SortHeading, useListFilters } from '../components/ui/ListFilters';
import { useViewParam, useViewTab } from '../hooks/useViewUrl';
import type { ListSchema } from '../domain/listQuery';
import { useToast } from '../components/ui/Toast';
import { canReverseMovement, effectiveTransactions, ledgerSignedAmount } from '../domain/recordLifecycle';
import { projectDreRows } from '../domain/financialCharts';
import { CashFlowChart, ExpenseCompositionChart, ProjectDreChart } from './financial/FinancialCharts';
import { DataList } from '../components/ui/DataList';
import { CompanyPdfHeader } from '../components/ui/CompanyPdfHeader';
import {
  AlertNote,
  EmptySection,
  KpiCard,
  Modal,
  PageHeader,
  ProgressBar,
  RegisteredBySelect,
  SegmentedControl,
  StatusBadge,
  Tabs,
  type BadgeTone,
} from '../components/ui/PilotisUI';
import {
  addDaysISO,
  addMonthsISO,
  calcularDreEmpresa,
  calculateInstallmentProgress,
  calcularDreAtualObra,
  calcularPrevisaoCaixa,
  calcularResumoDividas,
  calcularResumoFinanceiroPeriodo,
  calcularResumoFolhaEquipe,
  clampStr,
  classificarLancamento,
  conciliarExtratoPilotis,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  formatMonthLabelBR,
  formatPercentBR,
  formatShortDateBR,
  getContractCostBudget,
  monthKey,
  parseBankStatement,
  resolverStatusDivida,
  resolverStatusLancamento,
  resolverStatusParcela,
  simulateCommercialCash,
  todayISO,
  planningTodayISO,
  validarLancamentoFinanceiro,
  type ExtratoLinhaConciliada,
  type StatusConciliacaoExtrato,
} from '../domain';
import {
  createRecord,
  importBankStatement,
  recordFinancialTransaction,
  reverseFinancialMovement,
  undoInstallmentReceipt,
  settleFinancialTransaction,
  markInstallmentReceived,
  updateRecord,
} from '../services/pilotisService';
import type {
  ActorRole,
  Debt,
  DebtStatus,
  DebtType,
  FinancialTransaction,
  Installment,
  InvoiceStatus,
  PilotisDataState,
  TransactionKind,
  TransactionStatus,
} from '../types/pilotis';

type ReversalTarget = { id: string; title: string; kind: 'transaction' | 'installment' };

function ReversalDialog({ uid, target, onClose }: { uid: string; target: ReversalTarget; onClose: () => void }) {
  const { showToast } = useToast();
  const [reason, setReason] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const receipt = target.kind === 'installment';
  const action = receipt ? 'Desfazer recebimento' : 'Estornar';
  return <Modal open onClose={onClose} title={action + ' · ' + target.title}>
    <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true); setError('');
      try {
        if (receipt) await undoInstallmentReceipt(uid, actor, target.id, reason);
        else await reverseFinancialMovement(uid, actor, target.id, reason);
        onClose();
        showToast({ tone: 'success', title: receipt ? 'Recebimento desfeito.' : 'Estorno registrado.' });
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
      } finally {
        setSaving(false);
      }
    }}>
      <label className="grid gap-1 text-sm font-semibold">Motivo
        <textarea rows={3} maxLength={200} required value={reason} onChange={(event) => setReason(event.target.value)}
          className="rounded-lg border border-[#E4E1DA] px-3 py-2 font-normal" />
      </label>
      <RegisteredBySelect id="reversal-actor" value={actor} onChange={setActor} />
      {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
      <button type="submit" disabled={saving || !reason.trim()} className="justify-self-end rounded-lg bg-[#1F3A5F] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {saving ? 'Registrando…' : action}
      </button>
    </form>
  </Modal>;
}

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

const FIN_TABS = [
  'Visão geral',
  'A receber',
  'A pagar',
  'Fluxo de caixa',
  'Dívidas e crédito',
  'DRE por obra',
  'Pacote para o contador',
];

const EXPENSE_CATEGORIES = [
  'Folha',
  'Mão de obra',
  'Subempreitada',
  'Equipamentos e EPI',
  'Tributos',
  'Comissão',
  'Juros e tarifas',
  'Retirada de sócio',
  'Outros',
];

const RECONCILIATION_TONE: Record<StatusConciliacaoExtrato, BadgeTone> = {
  Conciliado: 'ok',
  Sugerido: 'info',
  Revisar: 'bad',
  Classificar: 'warn',
};

function downloadReceipt(file: NonNullable<FinancialTransaction['receiptFile']>) {
  const content = new Uint8Array(file.content.toUint8Array());
  const url = URL.createObjectURL(new Blob([content], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function domainKindToPilotis(
  tipo: 'receita' | 'despesa' | 'emprestimo',
): TransactionKind {
  if (tipo === 'receita') return 'income';
  if (tipo === 'emprestimo') return 'loan';
  return 'expense';
}

export function FinancialView({
  uid,
  data,
  companyEmail,
  initialTab,
  externalNewTxOpen,
  onCloseExternalNewTx,
  accountingLoadState,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  initialTab?: string;
  externalNewTxOpen?: boolean;
  onCloseExternalNewTx?: () => void;
  accountingLoadState?: 'loading' | 'failed' | 'ready';
}) {
  const [tab, setTab] = useViewTab('financial', FIN_TABS, initialTab);
  const [recordId, setRecordId] = useViewParam('registro');
  const selectedRecord = data.transactions.find((row) => row.id === recordId);
  const linkedInstallment = !selectedRecord && tab === 'A receber' ? data.installments.find((row) => row.id === recordId) : undefined;
  const linkedDebt = !selectedRecord && tab === 'Dívidas e crédito' ? data.debts.find((row) => row.id === recordId) : undefined;
  const selectedInstallment = selectedRecord && data.installments.find((row) =>
    row.status === 'Recebida' && (row.transactionId === selectedRecord.id || row.id === selectedRecord.installmentId));
  const [reversalTarget, setReversalTarget] = useState<ReversalTarget | null>(null);
  const [visibleTransactions, setVisibleTransactions] = useState(15);

  useEffect(() => {
    if (initialTab !== 'Simulador' || tab !== 'Visão geral') return;
    const simulator = document.getElementById('financial-commercial-simulator');
    simulator?.scrollIntoView({ block: 'start' });
    simulator?.focus({ preventScroll: true });
  }, [initialTab, tab]);

  const [selectedDreProjectId, setSelectedDreProjectId] = useState<string>('');

  // DRE da empresa (período)
  const todayStr = planningTodayISO();
  const clientById = useMemo(() => new Map(data.clients.map((client) => [client.id, client])), [data.clients]);
  const projectsById = useMemo(() => new Map(data.projects.map((project) => [project.id, project])), [data.projects]);

  function renderInstallmentReminder(row: Installment) {
    const context = installmentWhatsAppContext(row, todayStr);
    const project = projectsById.get(row.projectId);
    return <>
      {context && project && <WhatsAppShortcut uid={uid} client={clientById.get(row.clientId)}
        templates={data.settings?.whatsappTemplates} label="Lembrete pelo WhatsApp"
        target={{ model: context.model, projectId: row.projectId, sourceId: row.id }}
        values={{ ...context.values, obra: project.name }} />}
      {row.reminderSentAt ? <p className="text-xs text-[#424D5D]">Lembrete enviado em {formatTimestampBR(row.reminderSentAt)}</p> : null}
    </>;
  }
  const [drePeriodStart, setDrePeriodStart] = useState(`${monthKey(todayStr)}-01`);
  const [drePeriodEnd, setDrePeriodEnd] = useState(addDaysISO(addMonthsISO(`${monthKey(todayStr)}-01`, 1), -1));

  // Commercial simulator state (Rule 4: outputs derived via src/domain)
  const [simValue, setSimValue] = useState('');
  const [simDownPct, setSimDownPct] = useState('');
  const [simParcels, setSimParcels] = useState('');

  // New Transaction Modal state
  const [txModalOpen, setTxModalOpen] = useState(false);
  const isTxOpen = txModalOpen || Boolean(externalNewTxOpen);
  const [txKind, setTxKind] = useState<TransactionKind>('income');
  const [txDesc, setTxDesc] = useState('');
  const [txAmount, setTxAmount] = useState('');
  const [txDate, setTxDate] = useState(todayISO());
  const [txCategory, setTxCategory] = useState('Receita de obra');
  const [txProjectId, setTxProjectId] = useState('');
  const [txIsForecast, setTxIsForecast] = useState(false);
  const [txInvoiceStatus, setTxInvoiceStatus] = useState<InvoiceStatus>('A emitir');
  const [txPaymentMethod, setTxPaymentMethod] = useState('');
  const [txReceiptRef, setTxReceiptRef] = useState('');
  const [txReceiptFile, setTxReceiptFile] = useState<File>();
  const [loanType, setLoanType] = useState<DebtType>('Empréstimo bancário');
  const [loanCreditor, setLoanCreditor] = useState('');
  const [loanInstallments, setLoanInstallments] = useState('');
  const [loanNextDue, setLoanNextDue] = useState('');
  const [txActor, setTxActor] = useState<ActorRole>('Sócio');
  const [txSaving, setTxSaving] = useState(false);
  const [txSubmitError, setTxSubmitError] = useState<string | null>(null);

  // New Debt Modal state
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [debtCreditor, setDebtCreditor] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('Empréstimo bancário');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtMonthlyCost, setDebtMonthlyCost] = useState('');
  const [debtInstallments, setDebtInstallments] = useState('');
  const [debtNextDue, setDebtNextDue] = useState('');
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);
  const [debtError, setDebtError] = useState<string | null>(null);
  const [debtStatus, setDebtStatus] = useState<DebtStatus>('Em dia');
  const [debtActor, setDebtActor] = useState<ActorRole>('Sócio');
  const [debtSaving, setDebtSaving] = useState(false);

  // Import Statement Modal state (OFX / CSV with assisted reconciliation from src/domain)
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<ExtratoLinhaConciliada[]>([]);
  const [importActor, setImportActor] = useState<ActorRole>('Sócio');
  const [invalidStatementRows, setInvalidStatementRows] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSaving, setImportSaving] = useState(false);

  // Receive Installment (/parcelas) Confirmation Modal state
  const [receivingInstallment, setReceivingInstallment] = useState<Installment | null>(null);
  const [receivingDate, setReceivingDate] = useState(todayISO());
  const [receivingMethod, setReceivingMethod] = useState('');
  const [receivingActor, setReceivingActor] = useState<ActorRole>('Sócio');
  const [receivingSaving, setReceivingSaving] = useState(false);
  const [receivingError, setReceivingError] = useState<string | null>(null);

  // Confirm Pay / Receive Standalone Transaction Modal state
  const [settlingTx, setSettlingTx] = useState<FinancialTransaction | null>(null);
  const [settlingDate, setSettlingDate] = useState(todayISO());
  const [settlingActor, setSettlingActor] = useState<ActorRole>('Sócio');
  const [settlingSaving, setSettlingSaving] = useState(false);
  const [settlingError, setSettlingError] = useState<string | null>(null);

  // Confirm Settle Debt Modal state
  const [settlingDebt, setSettlingDebt] = useState<Debt | null>(null);
  const [settlingDebtActor, setSettlingDebtActor] = useState<ActorRole>('Sócio');
  const [settlingDebtSaving, setSettlingDebtSaving] = useState(false);

  const parcelaIdsSet = useMemo(
    () => new Set(data.installments.map((inst) => inst.id)),
    [data.installments],
  );

  const transactionsSorted = useMemo(
    () =>
      data.transactions
        .filter(
          (t) =>
            !(
              t.entryKind === 'income' &&
              t.isForecast &&
              t.installmentId &&
              parcelaIdsSet.has(t.installmentId)
            ),
        )
        .sort((a, b) =>
          (b.dueDate || b.date).localeCompare(a.dueDate || a.date),
        ),
    [data.transactions, parcelaIdsSet],
  );

  // Derived metrics from src/domain
  const periodSummary = useMemo(
    () => calcularResumoFinanceiroPeriodo(data, todayStr),
    [data, todayStr],
  );
  const cashForecast = useMemo(
    () => calcularPrevisaoCaixa(data, 5, todayStr),
    [data, todayStr],
  );
  const projection = cashForecast.meses;
  const debtSummary = useMemo(() => calcularResumoDividas(data.debts), [data.debts]);
  const payrollSummary = useMemo(
    () => calcularResumoFolhaEquipe(data.employees, data.settings, todayStr),
    [data.employees, data.settings, todayStr],
  );

  // Strict Rule 6 & Cost-Center Validation in New Transaction Modal via src/domain
  const parsedNumericAmount = Number(txAmount.replace(',', '.'));
  const txValidation = useMemo(
    () =>
      validarLancamentoFinanceiro({
        descricao: txDesc,
        categoria: txCategory,
        tipoInformado: txKind,
        obraId: txProjectId,
        valor: Number.isFinite(parsedNumericAmount) ? parsedNumericAmount : 0,
      }),
    [txDesc, txCategory, txKind, txProjectId, parsedNumericAmount],
  );
  const loanInIncomeError = txValidation.erroEmprestimoComoReceita;
  const missingCenterError = txValidation.erroCentroCusto;
  const formRulesErrorCount = (loanInIncomeError ? 1 : 0) + (missingCenterError ? 1 : 0);

  function closeTxModal() {
    setTxModalOpen(false);
    setTxSubmitError(null);
    setTxReceiptFile(undefined);
    onCloseExternalNewTx?.();
  }

  async function handleSaveTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (formRulesErrorCount > 0) return;
    if (txValidation.erroValorOuDescricao) {
      setTxSubmitError(txValidation.erroValorOuDescricao);
      return;
    }

    const classified = classificarLancamento({
      descricao: txDesc,
      categoria: txCategory,
      tipoInformado: txKind,
      valor: parsedNumericAmount,
      previsto: txIsForecast,
    });

    if (classified.rejeitadoComoReceita) {
      setTxSubmitError(
        classified.motivo || 'Empréstimo não pode ser lançado como receita.',
      );
      return;
    }

    if ((txKind === 'loan' || !txIsForecast) && txDate > todayStr) {
      setTxSubmitError('Informe uma data efetiva até hoje ou marque o lançamento como previsto.');
      return;
    }
    setTxSaving(true);
    setTxSubmitError(null);
    try {
      const finalKind = domainKindToPilotis(classified.tipo);
      const selectedProj = data.projects.find((p) => p.id === txProjectId);
      const projectName = txProjectId === 'Empresa' ? 'Empresa' : selectedProj?.name || 'Obra';
      const status: TransactionStatus = classified.status;

      await recordFinancialTransaction(
        uid,
        txActor,
        {
          date: txDate,
          dueDate: txDate,
          description: clampStr(txDesc, 200),
          entryKind: finalKind,
          category: classified.categoria,
          projectId: txProjectId,
          projectName: clampStr(projectName, 160),
          amount: classified.valor,
          isForecast: finalKind === 'loan' ? false : txIsForecast,
          status,
          invoiceStatus: finalKind === 'loan' ? 'Não se aplica' : txInvoiceStatus,
          paymentMethod: clampStr(txPaymentMethod, 60),
          receiptRef: clampStr(txReceiptRef, 160),
          installmentLabel: '',
          quoteId: '',
          debtId: '',
          source: 'manual',
        },
        txReceiptFile,
        finalKind === 'loan' ? {
          creditor: loanCreditor,
          debtType: loanType,
          remainingInstallments: loanInstallments ? Number(loanInstallments) : undefined,
          nextDueDate: loanNextDue || undefined,
        } : undefined,
      );

      setTxDesc('');
      setTxAmount('');
      setTxProjectId('');
      setTxReceiptRef('');
      setTxReceiptFile(undefined);
      setTxPaymentMethod('');
      setLoanCreditor('');
      setLoanInstallments('');
      setLoanNextDue('');
      closeTxModal();
    } catch (err) {
      setTxSubmitError(err instanceof Error ? err.message : 'Erro ao salvar lançamento.');
    } finally {
      setTxSaving(false);
    }
  }

  async function handleConfirmSettleTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!settlingTx) return;
    setSettlingSaving(true);
    setSettlingError(null);
    try {
      await settleFinancialTransaction(uid, settlingActor, settlingTx.id, settlingDate);
      setSettlingTx(null);
    } catch (err) {
      setSettlingError(err instanceof Error ? err.message : 'Erro ao registrar baixa.');
    } finally {
      setSettlingSaving(false);
    }
  }

  async function handleConfirmSettleDebt(e: React.FormEvent) {
    e.preventDefault();
    if (!settlingDebt) return;
    setSettlingDebtSaving(true);
    try {
      await updateRecord(
        'debts',
        settlingDebt.id,
        uid,
        settlingDebtActor,
        { status: 'Quitada', principalBalance: 0, remainingInstallments: 0 },
        `Dívida quitada: ${settlingDebt.creditor}`,
        `${settlingDebt.status} · ${formatBRL(settlingDebt.principalBalance)}`,
        'Quitada · R$ 0,00',
      );
      setSettlingDebt(null);
    } finally {
      setSettlingDebtSaving(false);
    }
  }

  function openDebtModal(debt?: Debt) {
    setEditingDebt(debt ?? null);
    setDebtError(null);
    setDebtCreditor(debt?.creditor ?? '');
    setDebtType(debt?.debtType ?? 'Empréstimo bancário');
    setDebtBalance(String(debt?.principalBalance ?? ''));
    setDebtMonthlyCost(String(debt?.monthlyCost ?? ''));
    setDebtInstallments(String(debt?.remainingInstallments ?? ''));
    setDebtNextDue(debt?.nextDueDate ?? '');
    setDebtStatus(debt?.status === 'Em atraso' ? 'Em dia' : debt?.status ?? 'Em dia');
    setDebtModalOpen(true);
  }

  async function handleSaveDebt(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(debtBalance.replace(',', '.'));
    if (!debtCreditor.trim() || !debtBalance.trim() || !Number.isFinite(amount) || amount < 0) return;
    setDebtSaving(true);
    setDebtError(null);
    try {
      const payload = {
        creditor: clampStr(debtCreditor, 140),
        debtType,
        principalBalance: amount,
        ...(debtMonthlyCost ? { monthlyCost: Number(debtMonthlyCost.replace(',', '.')) } : {}),
        ...(debtInstallments ? { remainingInstallments: Number(debtInstallments) } : {}),
        nextDueDate: debtNextDue,
        status: debtStatus,
      };
      if (editingDebt) {
        await updateRecord('debts', editingDebt.id, uid, debtActor, payload, 'Dívida atualizada: ' + payload.creditor);
      } else {
        await createRecord('debts', uid, debtActor, { ...payload, notes: '' }, 'Nova dívida: ' + payload.creditor);
      }
      setDebtModalOpen(false);
    } catch (err) {
      setDebtError(err instanceof Error ? err.message : 'Erro ao salvar dívida.');
    } finally {
      setDebtSaving(false);
    }
  }

  async function handleParseStatementFile(file: File) {
    setImportRows([]);
    setImportError(null);
    setInvalidStatementRows(0);
    try {
      const bytes = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder('windows-1252').decode(bytes);
      }
      const { rows, invalidCount } = parseBankStatement(text, file.name);
      setInvalidStatementRows(invalidCount);
      if (rows.length === 0) throw new Error('Nenhum movimento válido encontrado. Use OFX ou CSV com Data, Descrição e Valor.');
      setImportRows(conciliarExtratoPilotis(data, rows));
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Não foi possível ler o extrato.');
    }
  }

  const selectedImportRows = importRows.filter((r) => r.incluirNaImportacao);

  async function handleConfirmImport() {
    if (selectedImportRows.length === 0) return;

    const invalidLoan = selectedImportRows.find((r) => {
      const check = validarLancamentoFinanceiro({
        descricao: r.descricao,
        categoria: r.categoria,
        tipoInformado: r.tipo,
        obraId: r.obraId,
        valor: r.valor,
      });
      return Boolean(check.erroEmprestimoComoReceita);
    });
    if (invalidLoan) {
      setImportError(
        `Reclassifique "${invalidLoan.descricao}" para o tipo "Empréstimo (dívida)" antes de importar.`,
      );
      return;
    }

    const missingCenter = selectedImportRows.find((r) => !r.obraId);
    if (missingCenter) {
      setImportError('Selecione uma obra ou "Empresa" em todas as linhas marcadas para importação.');
      return;
    }

    setImportSaving(true);
    setImportError(null);
    try {
      await importBankStatement(
        uid,
        importActor,
        selectedImportRows.map((r) => {
          const entryKind = domainKindToPilotis(r.tipo);
          return {
            installmentId: r.parcelaSugeridaId,
            settleTransactionId: r.settleTransactionId,
            movement: {
              statementKey: r.statementKey,
              date: r.data,
              dueDate: r.data,
              description: r.descricao,
              entryKind,
              category: entryKind === 'loan' ? 'Empréstimo' : r.categoria,
              projectId: r.obraId,
              projectName:
                r.obraId === 'Empresa'
                  ? 'Empresa'
                  : data.projects.find((p) => p.id === r.obraId)?.name || 'Obra',
              amount: r.valor,
              isForecast: false,
              status:
                entryKind === 'loan'
                  ? 'Não é receita'
                  : entryKind === 'income'
                  ? 'Recebido'
                  : 'Pago',
              invoiceStatus: entryKind === 'income' ? 'A emitir' : 'Não se aplica',
              paymentMethod: 'Extrato',
              receiptRef: '',
              installmentLabel: '',
              quoteId: '',
              debtId: '',
              source: 'extrato',
            },
          };
        }),
      );
      setImportRows([]);
      setImportModalOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao importar extrato.');
    } finally {
      setImportSaving(false);
    }
  }

  // Commercial simulator backed by src/domain/orcamentos.ts
  const simNumVal = Number(simValue);
  const simNumDown = Number(simDownPct);
  const simNumParcels = Number(simParcels);
  const effectivePayrollMonthly = payrollSummary.custoTotalMensal ?? payrollSummary.folhaBase;
  const simulatorResult = simNumVal > 0 && simDownPct.trim() && simNumDown >= 0 && simNumDown <= 100 &&
    Number.isInteger(simNumParcels) && simNumParcels >= 1 && simNumParcels <= 36
    ? simulateCommercialCash({
        valorTotal: simNumVal,
        entradaPct: simNumDown,
        nParcelas: simNumParcels,
        dataInicio: todayStr,
        folhaMensalEstimada: effectivePayrollMonthly,
      })
    : null;

  const centers = [{ id: 'Empresa', name: 'Empresa' }, ...data.projects];
  function txStatus(row: FinancialTransaction) {
    return resolverStatusLancamento({
      tipo: row.entryKind === 'income' ? 'receita' : row.entryKind === 'loan' ? 'emprestimo' : 'despesa',
      status: row.status, previsto: row.isForecast, data: row.date, vencimento: row.dueDate || row.date,
    }, todayStr);
  }
  const txDateKey = (row: FinancialTransaction) => row.dueDate || row.date;
  const txSchema: ListSchema<FinancialTransaction> = {
    text: (row) => [row.description, row.projectName, row.category, row.receiptRef, row.id],
    status: txStatus, projects: (row) => row.projectId, dates: txDateKey,
    columns: [
      { key: 'date', label: 'Data', value: txDateKey },
      { key: 'description', label: 'Descrição', value: (row) => row.description },
      { key: 'center', label: 'Obra / centro', value: (row) => row.projectName || row.projectId },
      { key: 'category', label: 'Categoria', value: (row) => row.category },
      { key: 'invoice', label: 'Nota fiscal', value: (row) => row.invoiceStatus },
      { key: 'receipt', label: 'Comprovante', value: (row) => row.receiptFile?.name || row.receiptRef },
      { key: 'amount', label: 'Valor', value: (row) => row.amount },
      { key: 'status', label: 'Situação', value: txStatus },
    ],
  };
  const transactions = useListFilters('lancamentos', transactionsSorted, txSchema);
  const installmentsSorted = useMemo(() => [...data.installments].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number), [data.installments]);
  const installmentStatus = (row: Installment) => {
    const status = resolverStatusParcela({ status: row.status, vencimento: row.dueDate }, todayStr);
    return status === 'Recebida' ? 'Recebido' : status;
  };
  const installments = useListFilters('receber', installmentsSorted, {
    text: (row) => [row.projectName, row.clientName, row.label, row.id],
    status: installmentStatus, projects: (row) => row.projectId, dates: (row) => row.dueDate,
    columns: [
      { key: 'center', label: 'Obra · cliente', value: (row) => [row.projectName, row.clientName].filter(Boolean).join(' · ') },
      { key: 'description', label: 'Parcela / descrição', value: (row) => row.number },
      { key: 'date', label: 'Vencimento', value: (row) => row.dueDate },
      { key: 'amount', label: 'Valor', value: (row) => row.amount },
      { key: 'invoice', label: 'Nota fiscal', value: (row) => row.invoiceStatus },
      { key: 'status', label: 'Situação', value: installmentStatus },
      { key: 'receipt', label: 'Recebimento', value: (row) => row.receivedDate },
    ],
  });
  const manualReceivables = useListFilters('receber', effectiveTransactions(transactionsSorted).filter((row) =>
    row.entryKind === 'income' && !row.installmentId), txSchema);
  const payables = useListFilters('pagar', effectiveTransactions(transactionsSorted).filter((row) => row.entryKind === 'expense'),
    { ...txSchema, columns: txSchema.columns.filter(({ key }) => key !== 'receipt' && key !== 'invoice') });
  const installmentsFiltered = installments.rows;
  const manualReceivablesFiltered = manualReceivables.rows;
  const payablesFiltered = payables.rows;

  function openInstallmentReceipt(row: Installment) {
    setReceivingInstallment(row);
    setReceivingDate(todayStr);
    setReceivingMethod('');
    setReceivingActor('Sócio');
    setReceivingError(null);
  }

  const activeDreProject =
    data.projects.find((p) => p.id === selectedDreProjectId) || data.projects[0] || null;
  const dreCorrected = data.transactions.some((row) => row.projectId === activeDreProject?.id && row.status === 'Estornado' && !row.isForecast);
  const consolidatedDre = data.projectClosures?.find((row) => row.projectId === activeDreProject?.id);
  const activeDre = useMemo(
    () => activeDreProject ? calcularDreAtualObra(activeDreProject, data) : null,
    [activeDreProject, data],
  );

  const hasActiveCostBudget = Boolean(activeDreProject && (
    getContractCostBudget(activeDreProject) !== null || (activeDre?.custosTotais.orcado ?? 0) > 0
  ));

  const dreRows = activeDre ? projectDreRows(activeDre, hasActiveCostBudget) : [];

  const companyDre = useMemo(
    () => calcularDreEmpresa(data, drePeriodStart, drePeriodEnd),
    [data, drePeriodStart, drePeriodEnd],
  );
  const companyDreCategories = Object.entries(companyDre.despesasPorCategoria);
  const companyDreHasData =
    companyDre.possuiRealizado ||
    companyDre.receitas.orcado > 0 ||
    companyDre.receitas.realizado > 0 ||
    companyDreCategories.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Financeiro"
        subtitle="Entradas, saídas, dívidas, previsão de caixa e DRE por obra"
        companyEmail={companyEmail}
        actions={
          <>
            <button
              type="button"
              onClick={() => setImportModalOpen(true)}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Importar extrato
            </button>
            <button
              type="button"
              onClick={() => setTxModalOpen(true)}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Novo lançamento
            </button>
          </>
        }
      />

      <Tabs items={FIN_TABS} active={tab} onChange={setTab} />
      {tab === 'Pacote para o contador' && <AccountingPackageView uid={uid} data={data} loadState={accountingLoadState} />}
      {tab === 'Visão geral' && <ListToolbar label="lançamentos" list={transactions} projects={centers} />}
      {tab === 'A receber' && <ListToolbar label="recebimentos" list={{
        ...installments, statuses: [...new Set([...installments.statuses, ...manualReceivables.statuses])],
      }} projects={centers} />}
      {tab === 'A pagar' && <ListToolbar label="contas a pagar" list={payables} projects={centers} />}

      {tab === 'Visão geral' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard label="Saldo de caixa" value={formatBRL(periodSummary.saldoRealizadoCaixa)}
              subtext="Movimentos realizados, incluindo financiamentos" isEmpty={periodSummary.saldoRealizadoCaixa === null} />
            <KpiCard
              label="Receitas recebidas no mês"
              value={periodSummary.possuiMovimentoRealizadoNoMes ? formatBRL(periodSummary.entradasMes) : 'Sem dados'}
              subtext="Receita recebida no mês"
              isEmpty={!periodSummary.possuiMovimentoRealizadoNoMes}
            />
            <KpiCard
              label="Despesas pagas no mês"
              value={periodSummary.possuiMovimentoRealizadoNoMes ? formatBRL(periodSummary.saidasMes) : 'Sem dados'}
              subtext={
                periodSummary.folhaParticipacaoPct !== null
                  ? `Folha: ${periodSummary.folhaParticipacaoPct}% das despesas`
                  : 'Sem despesas no mês'
              }
              isEmpty={!periodSummary.possuiMovimentoRealizadoNoMes}
            />
            <KpiCard
              label="Resultado do mês"
              value={formatBRL(periodSummary.resultadoMes)}
              subtext="Receitas recebidas menos despesas pagas"
              isEmpty={periodSummary.resultadoMes === null}
            />
            <KpiCard
              label="Receita sem nota emitida"
              value={
                periodSummary.possuiReceitasComNf
                  ? formatBRL(periodSummary.receitaSemNota)
                  : 'Sem dados'
              }
              subtext="Sincronizado com Conformidade"
              isEmpty={!periodSummary.possuiReceitasComNf}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="min-w-0 lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-base font-semibold text-[#14181F]">Fluxo de caixa mensal</h2>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {cashForecast.mesesNegativos.length > 0 && (
                    <StatusBadge
                      label={`${cashForecast.mesesNegativos.length} mês(es) negativo(s)`}
                      tone="bad"
                    />
                  )}
                  <StatusBadge label="Previsto separado do realizado" tone="neutral" />
                </div>
              </div>

              <CashFlowChart forecast={cashForecast} />
            </section>

            <section id="financial-commercial-simulator" tabIndex={-1} aria-label="Simulador de condições comerciais" className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
              <h2 className="text-base font-semibold text-[#14181F]">
                Simulador de condições comerciais
              </h2>
              <div className="flex flex-col gap-1">
                <label htmlFor="sim-value" className="text-xs font-semibold text-[#14181F]">Valor da obra (R$)</label>
                <input
                  id="sim-value"
                  type="number"
                  min={0}
                  value={simValue}
                  onChange={(e) => setSimValue(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label htmlFor="sim-entry" className="text-xs font-semibold text-[#14181F]">Entrada (%)</label>
                  <input
                    id="sim-entry"
                    type="number"
                    min={0}
                    max={100}
                    value={simDownPct}
                    onChange={(e) => setSimDownPct(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="sim-installments" className="text-xs font-semibold text-[#14181F]">Parcelas (13–24x)</label>
                  <input
                    id="sim-installments"
                    type="number"
                    min={1}
                    max={36}
                    value={simParcels}
                    onChange={(e) => setSimParcels(e.target.value)}
                    className="w-full min-w-0 rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div className="rounded-xl bg-[#F6E7CC] p-3.5 mt-1 flex flex-col gap-1">
                <div className="flex justify-between text-xs text-[#8A5200]">
                  <span>Valor da entrada</span>
                  <strong className="tabular-nums">{formatBRL(simulatorResult?.valorEntrada)}</strong>
                </div>
                <div className="flex justify-between text-xs text-[#8A5200]">
                  <span>Parcela mensal média</span>
                  <strong className="tabular-nums">
                    {formatBRL(simulatorResult?.parcelaMensalMedia)}
                  </strong>
                </div>
                <span className="block text-xs text-[#8A5200] mt-1">
                  Valor que falta para cobrir a folha nos três primeiros meses
                </span>
                <strong className="block text-lg font-bold text-[#14181F] tabular-nums">
                  {formatBRL(simulatorResult?.quarterGap)}
                </strong>
                <span className="text-[11px] text-[#8A5200] leading-snug">
                  {simulatorResult?.mensagemCaixa}
                </span>
              </div>
            </section>
          </div>

          <section className="min-w-0 rounded-xl border border-[#E4E1DA] bg-white p-5">
            <ExpenseCompositionChart composition={periodSummary.composicaoDespesas} period={formatMonthLabelBR(monthKey(todayStr))} />
          </section>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#14181F]">Lançamentos recentes</h2>
              <span className="text-xs text-[#5B6472]">{transactions.rows.length} registro(s)</span>
            </div>

            {transactions.rows.length === 0 ? (
              <EmptySection
                title={transactionsSorted.length ? 'Nenhum lançamento neste filtro' : 'Nenhum lançamento financeiro cadastrado'}
                description="Registre o primeiro lançamento ou importe seu extrato/planilha para calcular saldos e projeções."
                actionLabel="Novo lançamento"
                onAction={() => setTxModalOpen(true)}
              />
            ) : (
              <>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <SortHeading column="date" label="Data" sort={transactions.sort} className="py-2.5 px-3 rounded-l-lg" />
                        <SortHeading column="description" label="Descrição" sort={transactions.sort} className="py-2.5 px-3" />
                        <SortHeading column="center" label="Obra / centro" sort={transactions.sort} className="py-2.5 px-3" />
                        <SortHeading column="category" label="Categoria" sort={transactions.sort} className="py-2.5 px-3" />
                        <SortHeading column="invoice" label="Nota fiscal" sort={transactions.sort} className="py-2.5 px-3" />
                        <SortHeading column="receipt" label="Comprovante" sort={transactions.sort} className="py-2.5 px-3" />
                        <SortHeading column="amount" label="Valor" sort={transactions.sort} className="py-2.5 px-3 text-right" />
                        <SortHeading column="status" label="Status" sort={transactions.sort} className="py-2.5 px-3 rounded-r-lg" />
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.rows.slice(0, visibleTransactions).map((tx) => (
                        <tr
                          key={tx.id}
                          className="border-b border-[#E4E1DA] text-[13px] hover:bg-[#F6F5F2]/60"
                        >
                          <td className="py-3 px-3 text-[#14181F] font-medium tabular-nums">
                            {formatShortDateBR(tx.dueDate || tx.date)}
                          </td>
                          <td className="py-3 px-3 text-[#14181F]"><button type="button" className="min-w-0 break-words text-left font-semibold text-[#1F3A5F] underline" onClick={() => setRecordId(tx.id, { push: true })}>{tx.description}</button></td>
                          <td className="py-3 px-3 text-[#5B6472]">
                            {tx.projectName || tx.projectId}
                          </td>
                          <td className="py-3 px-3 text-[#5B6472]">{tx.category}</td>
                          <td className="py-3 px-3">
                            {tx.invoiceStatus && tx.invoiceStatus !== 'Não se aplica' ? (
                              <StatusBadge label={tx.invoiceStatus} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-3 text-xs text-[#5B6472]">
                            {tx.receiptFile ? (
                              <button type="button" onClick={() => tx.receiptFile && downloadReceipt(tx.receiptFile)} className="text-[#1F3A5F] underline">
                                Baixar {tx.receiptFile.name}
                              </button>
                            ) : tx.receiptRef ? (
                              <StatusBadge label={tx.receiptRef} tone="neutral" />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                            {formatBRL(ledgerSignedAmount(tx))}
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge
                              label={resolverStatusLancamento(
                                {
                                  tipo:
                                    tx.entryKind === 'income'
                                      ? 'receita'
                                      : tx.entryKind === 'loan'
                                      ? 'emprestimo'
                                      : 'despesa',
                                  status: tx.status,
                                  previsto: tx.isForecast,
                                  vencimento: tx.dueDate || tx.date,
                                  data: tx.date,
                                },
                                todayStr,
                              )}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden flex flex-col gap-2.5">
                  {transactions.rows.slice(0, visibleTransactions).map((tx) => (
                    <div
                      key={tx.id}
                      className="border border-[#E4E1DA] rounded-xl p-3.5 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" className="min-w-0 break-words text-left font-semibold text-[#1F3A5F] underline" onClick={() => setRecordId(tx.id, { push: true })}>{tx.description}</button>
                        <StatusBadge
                          label={resolverStatusLancamento(
                            {
                              tipo:
                                tx.entryKind === 'income'
                                  ? 'receita'
                                  : tx.entryKind === 'loan'
                                  ? 'emprestimo'
                                  : 'despesa',
                              status: tx.status,
                              previsto: tx.isForecast,
                              vencimento: tx.dueDate || tx.date,
                              data: tx.date,
                            },
                            todayStr,
                          )}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#5B6472]">
                        <span>
                          {formatDateBR(tx.dueDate || tx.date)} · {tx.projectName || tx.projectId}
                        </span>
                        <strong className="text-sm text-[#14181F] tabular-nums">
                          {formatBRL(ledgerSignedAmount(tx))}
                        </strong>
                      </div>
                      {tx.invoiceStatus && tx.invoiceStatus !== 'Não se aplica' && (
                        <div className="flex items-center gap-2 text-xs text-[#5B6472]">
                          Nota fiscal <StatusBadge label={tx.invoiceStatus} />
                        </div>
                      )}
                      {tx.receiptFile ? (
                        <button type="button" onClick={() => tx.receiptFile && downloadReceipt(tx.receiptFile)}
                          className="self-start text-sm text-[#1F3A5F] underline">Baixar {tx.receiptFile.name}</button>
                      ) : tx.receiptRef && <span className="text-xs text-[#5B6472]">{tx.receiptRef}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
            {transactions.rows.length > visibleTransactions && <button type="button"
              className="self-start rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-semibold text-[#1F3A5F]"
              onClick={() => setVisibleTransactions((current) => current + 15)}>Mostrar mais lançamentos</button>}
          </section>
        </>
      )}

      {tab === 'A receber' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="A receber em aberto"
              value={
                periodSummary.possuiRecebiveis
                  ? formatBRL(periodSummary.recebiveisEmAbertoValor)
                  : 'Sem dados'
              }
              subtext={`${periodSummary.recebiveisEmAbertoQtd} parcela(s) em aberto`}
              isEmpty={!periodSummary.possuiRecebiveis}
            />
            <KpiCard
              label="Recebido no mês"
              value={
                periodSummary.possuiRecebiveis
                  ? formatBRL(periodSummary.recebidosNoMesValor)
                  : 'Sem dados'
              }
              subtext="Realizado no mês atual"
              isEmpty={!periodSummary.possuiRecebiveis}
            />
            <KpiCard
              label="Em atraso"
              value={
                periodSummary.possuiRecebiveis
                  ? formatBRL(periodSummary.recebiveisEmAtrasoValor)
                  : 'Sem dados'
              }
              subtext="Parcelas vencidas"
              isEmpty={!periodSummary.possuiRecebiveis}
            />
            <KpiCard
              label="Sem nota emitida"
              value={
                periodSummary.possuiReceitasComNf
                  ? formatBRL(periodSummary.receitaSemNota)
                  : 'Sem dados'
              }
              subtext="Recebimentos sem NF"
              isEmpty={!periodSummary.possuiReceitasComNf}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-semibold text-[#14181F]">
                    Parcelas a receber (/parcelas)
                  </h2>
                  <p className="text-xs text-[#5B6472]">
                    Entrada e parcelas geradas na confirmação do orçamento
                  </p>
                </div>

              </div>

              {installmentsFiltered.length === 0 ? (
                <p className="text-sm text-[#5B6472] py-6 text-center">
                  Nenhuma parcela neste filtro. Confirme um orçamento para gerar parcelas em /parcelas automaticamente.
                </p>
              ) : (
                <DataList
                  rows={installmentsFiltered}
                  sort={installments.sort}
                  keyExtractor={(row) => row.id}
                  columns={[
                    { key: 'center', header: 'Obra · cliente', render: (row) => [row.projectName, row.clientName].filter(Boolean).join(' · ') },
                    { key: 'description', header: 'Parcela', render: (row) => row.label },
                    { key: 'date', header: 'Vencimento', render: (row) => formatDateBR(row.dueDate) },
                    { key: 'amount', header: 'Valor', numeric: true, align: 'right', render: (row) => formatBRL(row.amount) },
                    { key: 'invoice', header: 'Nota fiscal', render: (row) => <StatusBadge label={row.invoiceStatus || 'A emitir'} /> },
                    { key: 'status', header: 'Status', render: (row) => <StatusBadge label={resolverStatusParcela({ status: row.status, vencimento: row.dueDate }, todayStr)} /> },
                    { key: 'receipt', header: 'Recebimento', render: (row) => <div className="grid justify-items-start gap-1">
                      {row.status === 'Recebida' ? <>
                        <span>{formatDateBR(row.receivedDate)}</span>
                        <button type="button" className="text-left text-sm font-semibold text-[#1F3A5F] underline"
                          onClick={() => setReversalTarget({ id: row.id, title: row.label, kind: 'installment' })}>Desfazer recebimento</button>
                      </> : <button type="button" className="text-sm font-semibold text-[#1F3A5F] underline" onClick={() => openInstallmentReceipt(row)}>Receber</button>}
                      {renderInstallmentReminder(row)}
                    </div> },
                  ]}
                />
              )}

              {manualReceivablesFiltered.length > 0 && (
                <div className="border-t border-[#E4E1DA] pt-4 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-[#14181F]">
                    Outros recebimentos avulsos
                  </h3>
                  <DataList caption="Outros recebimentos avulsos" rows={manualReceivablesFiltered} sort={manualReceivables.sort} onRowClick={(row) => setRecordId(row.id, { push: true })} keyExtractor={(tx) => tx.id}
                    columns={[
                      { key: 'description', header: 'Descrição', render: (tx) => tx.description },
                      { key: 'date', header: 'Vencimento', render: (tx) => formatDateBR(tx.dueDate || tx.date) },
                      { key: 'amount', header: 'Valor', align: 'right', numeric: true, render: (tx) => formatBRL(tx.amount) },
                      { key: 'status', header: 'Situação', render: (tx) => <StatusBadge label={resolverStatusLancamento({
                        tipo: 'receita', status: tx.status, previsto: tx.isForecast, vencimento: tx.dueDate || tx.date, data: tx.date,
                      }, todayStr)} /> },
                      { key: 'action', header: 'Ação', render: (tx) => tx.status !== 'Recebido' && <button type="button"
                          className="rounded-md border border-[#E4E1DA] px-2.5 py-1 text-xs font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9]"
                          onClick={() => {
                            setSettlingTx(tx);
                            setSettlingDate(todayStr);
                            setSettlingActor('Sócio');
                            setSettlingError(null);
                          }}>Receber</button> },
                    ]} />
                </div>
              )}
            </section>

            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <h2 className="text-base font-semibold text-[#14181F]">Parcelas pagas por obra</h2>
              {data.projects.length === 0 ? (
                <p className="text-sm text-[#5B6472]">Sem dados de obras cadastradas.</p>
              ) : (
                data.projects.map((proj) => {
                  const progress = calculateInstallmentProgress(data.installments, proj.id);
                  return (
                    <div key={proj.id} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <strong className="text-[#14181F] truncate">{proj.name}</strong>
                          <StatusBadge label={proj.contractKind || 'Principal'} />
                        </div>
                        <span className="text-[#5B6472] tabular-nums shrink-0">
                          {progress.total ? `${progress.received} de ${progress.total}` : 'Sem dados'}
                        </span>
                      </div>
                      {progress.percentage !== null && <ProgressBar pct={progress.percentage} />}
                    </div>
                  );
                })
              )}
              <p className="text-xs text-[#5B6472]">
                As parcelas são geradas em /parcelas automaticamente na confirmação do orçamento.
              </p>
            </section>
          </div>
        </>
      )}

      {tab === 'A pagar' && (
        <div className="flex flex-col gap-4">
          {periodSummary.tributosEmAtrasoQtd > 0 && (
            <AlertNote tone="bad" title="Tributos em atraso em destaque">
              Há <strong>{periodSummary.tributosEmAtrasoQtd}</strong> guia(s) de tributos em
              atraso somando <strong>{formatBRL(periodSummary.tributosEmAtrasoValor)}</strong>.
              Priorize a regularização para preservar certidões negativas e evitar multas.
            </AlertNote>
          )}

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold text-[#14181F]">Contas a pagar</h2>
            </div>

            {payablesFiltered.length === 0 ? (
              <EmptySection
                title="Sem contas a pagar neste filtro"
                description="Cadastre uma despesa prevista ou realizada clicando em Novo lançamento."
                actionLabel="Nova conta a pagar"
                onAction={() => {
                  setTxKind('expense');
                  setTxCategory('Outros');
                  setTxInvoiceStatus('Não se aplica');
                  setTxIsForecast(true);
                  setTxModalOpen(true);
                }}
              />
            ) : (
              <DataList
                rows={payablesFiltered}
                sort={payables.sort} onRowClick={(row) => setRecordId(row.id, { push: true })}
                keyExtractor={(row) => row.id}
                columns={[
                  { key: 'description', header: 'Descrição', render: (row) => row.description },
                  { key: 'date', header: 'Vencimento', render: (row) => formatDateBR(row.dueDate || row.date) },
                  { key: 'category', header: 'Categoria', render: (row) => row.category },
                  { key: 'center', header: 'Obra / centro', render: (row) => row.projectName || row.projectId },
                  { key: 'amount', header: 'Valor', numeric: true, align: 'right', render: (row) => formatBRL(row.amount) },
                  { key: 'status', header: 'Status', render: (row) => {
                      const status = resolverStatusLancamento({
                        tipo: 'despesa', status: row.status, previsto: row.isForecast, data: row.date, vencimento: row.dueDate || row.date,
                      }, todayStr);
                      const overdueTax = status === 'Em atraso' && row.category.toLowerCase() === 'tributos';
                      return <StatusBadge label={overdueTax ? 'Tributo em atraso' : status} tone={status === 'Em atraso' ? 'bad' : undefined} />;
                    } },
                  { key: 'payment', header: 'Pagamento', render: (row) => row.status === 'Pago'
                    ? formatDateBR(row.date)
                    : <button type="button" className="text-sm font-semibold text-[#1F3A5F] underline" onClick={() => {
                        setSettlingTx(row);
                        setSettlingDate(todayStr);
                        setSettlingActor('Sócio');
                        setSettlingError(null);
                      }}>Pagar</button> },
                ]}
              />
            )}
          </section>
        </div>
      )}

      {tab === 'Fluxo de caixa' && (
        <div className="flex flex-col gap-4">
          {cashForecast.mesesNegativos.length > 0 && (
            <AlertNote tone="bad" title="Alerta de caixa negativo projetado">
              Saldo projetado negativo nos meses:{' '}
              <strong>
                {cashForecast.mesesNegativos.map(formatMonthLabelBR).join(', ')}
              </strong>
              . Avalie antecipar entradas, ajustar parcelas ou conter saídas antes do vencimento.
            </AlertNote>
          )}

          {cashForecast.possuiDados && !cashForecast.encargosConfigurados && data.employees.length > 0 && (
            <AlertNote tone="warn" title="Encargos trabalhistas não configurados">
              A projeção considera apenas o salário-base da equipe até que INSS, FGTS, férias e 13º
              sejam configurados em Configurações.
            </AlertNote>
          )}

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-base font-semibold text-[#14181F]">Projeção de 5 meses</h2>
              <StatusBadge label="Contratado separado do funil" tone="info" />
            </div>

            <CashFlowChart forecast={cashForecast} />

            {!cashForecast.possuiDados || projection.length === 0 ? (
              <EmptySection
                title="Sem dados para projetar fluxo de caixa"
                description="Cadastre lançamentos, parcelas, orçamentos no funil ou colaboradores para projetar os próximos 5 meses."
              />
            ) : (
              <DataList
                caption="Projeção mensal do caixa"
                keyboardScroll
                rows={projection}
                keyExtractor={(row) => row.mesKey}
                columns={[
                  { key: 'month', header: 'Mês', render: (row) => row.rotulo },
                  { key: 'income', header: 'Receita recebida', render: (row) => formatBRL(row.realizadoEntradas) },
                  { key: 'credit', header: 'Crédito recebido', render: (row) => formatBRL(row.emprestimosNaoReceita) },
                  { key: 'contracted', header: 'Entradas contratadas', render: (row) => formatBRL(row.contratadoEntradas) },
                  { key: 'funnel', header: 'Funil ponderado', render: (row) => formatBRL(row.funilPonderadoEntradas) },
                  { key: 'paid', header: 'Saídas pagas', render: (row) => formatBRL(row.saidasRealizadas) },
                  { key: 'forecast', header: 'Saídas previstas', render: (row) => formatBRL(row.saidasPrevistas) },
                  { key: 'provisions', header: 'Provisões incluídas', render: (row) => formatBRL(row.provisoesFolhaIncluidas) },
                  { key: 'balance', header: 'Saldo projetado', render: (row) => (
                      <StatusBadge label={formatBRL(row.saldoProjetado)} tone={row.negativo ? 'bad' : 'ok'} />
                    ) },
                  { key: 'withFunnel', header: 'Saldo com funil', render: (row) => formatBRL(row.saldoProjetadoComFunil) },
                ]}
              />
            )}
          </section>
        </div>
      )}

      {tab === 'Dívidas e crédito' && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => openDebtModal()}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
            >
              Nova dívida
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Dívida total"
              value={debtSummary.dividaTotal !== null ? formatBRL(debtSummary.dividaTotal) : 'Sem dados'}
              subtext={
                debtSummary.proximoVencimento
                  ? `Próximo vencimento: ${formatDateBR(debtSummary.proximoVencimento)}`
                  : 'Bancos, tributos e encargos'
              }
              isEmpty={debtSummary.dividaTotal === null}
            />
            <KpiCard
              label="Custo financeiro"
              value={
                debtSummary.custoMensal !== null ? formatBRL(debtSummary.custoMensal) : 'Sem dados'
              }
              subtext="Juros e encargos mensais"
              isEmpty={debtSummary.custoMensal === null}
            />
            <KpiCard
              label="Tributos em atraso"
              value={
                debtSummary.tributosEmAtraso !== null
                  ? formatBRL(debtSummary.tributosEmAtraso)
                  : 'Sem dados'
              }
              subtext="Passivo fiscal"
              isEmpty={debtSummary.tributosEmAtraso === null}
            />
            <KpiCard
              label="Conta garantida"
              value={
                debtSummary.contaGarantida !== null
                  ? formatBRL(debtSummary.contaGarantida)
                  : 'Sem dados'
              }
              subtext="Limite em uso"
              isEmpty={debtSummary.contaGarantida === null}
            />
          </div>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-[#14181F]">Dívidas registradas</h2>
            {data.debts.length === 0 ? (
              <EmptySection
                title="Nenhuma dívida registrada"
                description="Empréstimos bancários, conta garantida e tributos parcelados aparecem aqui — nunca como receita."
                actionLabel="Registrar dívida"
                onAction={() => setDebtModalOpen(true)}
              />
            ) : (
              <DataList
                rows={data.debts}
                keyExtractor={(row) => row.id}
                columns={[
                  { key: 'creditor', header: 'Credor', render: (row) => row.creditor },
                  { key: 'type', header: 'Tipo', render: (row) => row.debtType },
                  { key: 'balance', header: 'Saldo devedor', render: (row) => formatBRL(row.principalBalance) },
                  { key: 'installments', header: 'Parcelas restantes', render: (row) => row.remainingInstallments ?? 'Sem dados' },
                  { key: 'due', header: 'Próximo vencimento', render: (row) => row.nextDueDate ? formatDateBR(row.nextDueDate) : 'Sem dados' },
                  { key: 'status', header: 'Status', render: (row) => (
                      <StatusBadge label={resolverStatusDivida({ status: row.status, proximoVencimento: row.nextDueDate }, todayStr)} />
                    ) },
                  { key: 'actions', header: 'Ações', render: (row) => (
                    <span className="flex flex-wrap justify-end gap-3">
                      <button type="button" onClick={() => openDebtModal(row)} className="text-sm text-[#1F3A5F] underline">Editar</button>
                      {row.status !== 'Quitada' && (
                        <button type="button" onClick={() => { setSettlingDebt(row); setSettlingDebtActor('Sócio'); }}
                          className="text-sm text-[#1F3A5F] underline">Quitar</button>
                      )}
                    </span>
                  ) },
                ]}
              />
            )}
          </section>
        </>
      )}

      {tab === 'DRE por obra' && (
        <div className="flex flex-col gap-6">
          {data.projects.length === 0 || !activeDreProject || !activeDre ? (
            <>
              <EmptySection
                title="Nenhuma obra para calcular DRE"
                description="Confirme um orçamento ou cadastre uma obra para comparar orçamento x realizado e acompanhar a margem real."
              />
              <section className="min-w-0 rounded-xl border border-[#E4E1DA] bg-white p-5">
                <ProjectDreChart rows={[]} />
              </section>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <SegmentedControl
                  items={data.projects.map((p) => p.name)}
                  active={activeDreProject.name}
                  onChange={(name) => {
                    const found = data.projects.find((p) => p.name === name);
                    if (found) setSelectedDreProjectId(found.id);
                  }}
                />
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer no-print"
                >
                  Exportar PDF
                </button>
              </div>

              {consolidatedDre && <p className="text-sm font-semibold text-[#1F3A5F]">{dreCorrected ? 'DRE atual com estornos · encerramento em ' : 'DRE consolidado no encerramento em '}{formatDateBR(consolidatedDre.date)}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Receita realizada"
                  value={formatBRL(activeDre.possuiRealizado ? activeDre.receita.realizado : null)}
                  subtext={`Contrato fechado: ${formatBRL(activeDre.receita.orcado)}`}
                />
                <KpiCard
                  label="Custos diretos realizados"
                  value={formatBRL(activeDre.possuiRealizado ? activeDre.custosTotais.realizado : null)}
                  subtext={`Orçado: ${formatBRL(hasActiveCostBudget ? activeDre.custosTotais.orcado : null)}`}
                />
                <KpiCard
                  label="Margem real"
                  value={formatPercentBR(activeDre.receita.realizado > 0 ? activeDre.margemRealizadaPct : null)}
                  subtext={`Prevista: ${formatPercentBR(hasActiveCostBudget ? activeDre.margemOrcadaPct : null)}`}
                />
                <KpiCard
                  label="Resultado acumulado"
                  value={formatBRL(activeDre.possuiRealizado ? activeDre.resultado.realizado : null)}
                  subtext="Receita recebida menos custos pagos"
                />
              </div>

              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4 print-sheet">
                <CompanyPdfHeader
                  settings={data.settings}
                  subtitle={`Demonstrativo de Resultado por Obra · ${activeDreProject.name}`}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-[#14181F]">
                    DRE · {activeDreProject.name}
                    {data.settings?.targetMarginPct && data.settings.targetMarginPct > 0
                      ? ` · Meta de margem: ${formatPercentBR(data.settings.targetMarginPct)}`
                      : ''}
                  </h2>
                  {hasActiveCostBudget && activeDre.receita.realizado > 0 && (
                    <StatusBadge
                      label={activeDre.margemRealizadaPct < activeDre.margemOrcadaPct
                        ? 'Margem abaixo do previsto' : 'Margem dentro do previsto'}
                      tone={activeDre.margemRealizadaPct < activeDre.margemOrcadaPct ? 'warn' : 'ok'}
                    />
                  )}
                </div>

                <div className="no-print min-w-0">
                  <ProjectDreChart rows={dreRows} projectName={activeDreProject.name} />
                </div>

                <DataList caption="DRE por obra" keyboardScroll keyExtractor={(row) => row.label}
                  rows={dreRows}
                  columns={[
                    { key: 'label', header: 'Linha', render: (row) => row.label },
                    { key: 'budget', header: 'Orçado', numeric: true, align: 'right', render: (row) => formatBRL(row.budget) },
                    { key: 'actual', header: 'Realizado', numeric: true, align: 'right', render: (row) => formatBRL(row.actual) },
                    { key: 'variance', header: 'Variação / margem', render: ({ label, line }) => {
                      if (!activeDre.possuiRealizado || line === activeDre.ajusteEap) return 'Sem dados';
                      if (!hasActiveCostBudget && line !== activeDre.receita) {
                        return line === activeDre.resultado && activeDre.receita.realizado > 0
                          ? formatPercentBR(activeDre.margemRealizadaPct)
                          : 'Sem dados';
                      }
                      const pct = line === activeDre.resultado ? activeDre.margemRealizadaPct : line.variacaoPct;
                      const tone: BadgeTone = line === activeDre.resultado ? (line.realizado >= line.orcado ? 'ok' : 'warn')
                        : !pct ? 'neutral' : (pct > 0) === label.startsWith('(−)') ? 'bad' : 'ok';
                      return <StatusBadge label={formatPercentBR(pct)} tone={tone} />;
                    } },
                  ]} />
              </section>
            </>
          )}

          {/* DRE da empresa (período) via src/domain dreEmpresa */}
          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#14181F]">
                  DRE da empresa (período)
                </h2>
                <p className="text-xs text-[#5B6472]">
                  Consolidado de obras e centro &ldquo;Empresa&rdquo; · empréstimos excluídos
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  aria-label="Início do período da DRE"
                  value={drePeriodStart}
                  onChange={(e) => setDrePeriodStart(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] px-2.5 py-1.5 text-xs"
                />
                <span className="text-xs text-[#5B6472]">até</span>
                <input
                  type="date"
                  aria-label="Fim do período da DRE"
                  value={drePeriodEnd}
                  onChange={(e) => setDrePeriodEnd(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] px-2.5 py-1.5 text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    setDrePeriodStart(`${monthKey(todayStr)}-01`);
                    setDrePeriodEnd(todayStr);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                >
                  Mês atual
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDrePeriodStart(addMonthsISO(todayStr, -12));
                    setDrePeriodEnd(todayStr);
                  }}
                  className="px-2.5 py-1.5 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                >
                  Últimos 12 meses
                </button>
              </div>
            </div>

            {!companyDreHasData ? (
              <p className="text-sm text-[#5B6472] py-6 text-center">
                Sem dados financeiros no período selecionado.
              </p>
            ) : (
              <DataList caption="DRE da empresa" keyExtractor={(row) => row.label}
                rows={[
                  { label: 'Receitas operacionais', line: companyDre.receitas },
                  ...companyDreCategories.map(([category, line]) => ({ label: '(−) ' + category, line })),
                  { label: 'Resultado da empresa', line: companyDre.resultado },
                ]}
                columns={[
                  { key: 'label', header: 'Categoria', render: (row) => row.label },
                  { key: 'budget', header: 'Previsto / orçado', numeric: true, align: 'right', render: ({ line }) => formatBRL(line.orcado) },
                  { key: 'actual', header: 'Realizado', numeric: true, align: 'right', render: ({ line }) => formatBRL(companyDre.possuiRealizado ? line.realizado : null) },
                  { key: 'variance', header: 'Variação / margem', numeric: true, align: 'right', render: ({ line }) => {
                    if (!companyDre.possuiRealizado) return 'Sem dados';
                    return line === companyDre.resultado
                      ? <StatusBadge label={formatPercentBR(companyDre.receitas.realizado > 0 ? companyDre.margemRealizadaPct : null)}
                          tone={line.realizado >= 0 ? 'ok' : 'bad'} />
                      : formatBRL(line.variacao);
                  } },
                ]} />
            )}
          </section>
        </div>
      )}

      <Modal open={Boolean(linkedInstallment)} onClose={() => setRecordId('')}
        title={linkedInstallment ? 'Parcela · ' + linkedInstallment.label : 'Parcela'}>
        {linkedInstallment && <div className="grid gap-3 text-sm">
          <StatusBadge label={resolverStatusParcela({ status: linkedInstallment.status, vencimento: linkedInstallment.dueDate }, todayStr)} />
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Vencimento</dt><dd>{formatDateBR(linkedInstallment.dueDate)}</dd></div>
            <div><dt>Valor</dt><dd>{formatBRL(linkedInstallment.amount)}</dd></div>
            <div><dt>Obra</dt><dd>{linkedInstallment.projectName || 'Sem dados'}</dd></div>
            <div><dt>Cliente</dt><dd>{linkedInstallment.clientName || 'Sem dados'}</dd></div>
            {linkedInstallment.receivedDate && <div><dt>Recebida em</dt><dd>{formatDateBR(linkedInstallment.receivedDate)}</dd></div>}
          </dl>
          {linkedInstallment.status !== 'Recebida' && <button type="button"
            className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => { setRecordId(''); openInstallmentReceipt(linkedInstallment); }}>Receber parcela</button>}
          <div className="grid justify-items-start gap-1">{renderInstallmentReminder(linkedInstallment)}</div>
        </div>}
      </Modal>
      <Modal open={Boolean(linkedDebt)} onClose={() => setRecordId('')}
        title={linkedDebt ? 'Dívida · ' + linkedDebt.creditor : 'Dívida'}>
        {linkedDebt && <div className="grid gap-3 text-sm">
          <StatusBadge label={resolverStatusDivida({ status: linkedDebt.status, proximoVencimento: linkedDebt.nextDueDate }, todayStr)} />
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Tipo</dt><dd>{linkedDebt.debtType}</dd></div>
            <div><dt>Próximo vencimento</dt><dd>{formatDateBR(linkedDebt.nextDueDate)}</dd></div>
            <div><dt>Saldo em aberto</dt><dd>{formatBRL(linkedDebt.principalBalance)}</dd></div>
          </dl>
          <button type="button" className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => { setRecordId(''); openDebtModal(linkedDebt); }}>Editar dívida</button>
        </div>}
      </Modal>
      <Modal open={Boolean(selectedRecord)} onClose={() => setRecordId('')} title={selectedRecord?.description || 'Lançamento'}>
        {selectedRecord && <div className="grid gap-3 text-sm">
          <StatusBadge label={txStatus(selectedRecord)} />
          <dl className="grid grid-cols-2 gap-3">
            <div><dt>Valor</dt><dd className="font-semibold">{formatBRL(ledgerSignedAmount(selectedRecord))}</dd></div>
            <div><dt>Data</dt><dd>{formatDateBR(selectedRecord.date)}</dd></div>
            <div><dt>Vencimento</dt><dd>{formatDateBR(selectedRecord.dueDate)}</dd></div>
            <div><dt>Obra / centro</dt><dd>{selectedRecord.projectName || selectedRecord.projectId || 'Sem dados'}</dd></div>
            <div><dt>Categoria</dt><dd>{selectedRecord.category}</dd></div>
            <div><dt>Nota fiscal</dt><dd>{selectedRecord.invoiceStatus || 'Sem dados'}</dd></div>
            <div><dt>Forma</dt><dd>{selectedRecord.paymentMethod || 'Sem dados'}</dd></div>
          </dl>
          {selectedRecord.receiptFile ? <button type="button" className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => selectedRecord.receiptFile && downloadReceipt(selectedRecord.receiptFile)}>Baixar comprovante</button>
            : selectedRecord.receiptRef && <p>Comprovante · {selectedRecord.receiptRef}</p>}
          {selectedRecord.reversalReason && <p className="break-words">Motivo do estorno · {selectedRecord.reversalReason}</p>}
          {(selectedRecord.reversalId || selectedRecord.reversalOfId) && <button type="button"
            className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => setRecordId(selectedRecord.reversalId || selectedRecord.reversalOfId || '', { push: true })}>
            {selectedRecord.reversalOfId ? 'Ver lançamento original' : 'Ver lançamento inverso'}
          </button>}
          {selectedInstallment && selectedRecord.status === 'Recebido' && <button type="button"
            className="justify-self-start font-semibold text-[#1F3A5F] underline"
            onClick={() => setReversalTarget({ id: selectedInstallment.id, title: selectedInstallment.label, kind: 'installment' })}>Desfazer recebimento</button>}
          {!selectedInstallment && canReverseMovement(selectedRecord) && <button type="button"
            className="justify-self-start font-semibold text-[#B42318] underline"
            onClick={() => setReversalTarget({ id: selectedRecord.id, title: selectedRecord.description, kind: 'transaction' })}>Estornar</button>}
        </div>}
      </Modal>

      {reversalTarget && <ReversalDialog uid={uid} target={reversalTarget} onClose={() => setReversalTarget(null)} />}

      {/* Modal: Novo lançamento com validação estrita de Empréstimo != Receita e comprovante */}
      <Modal open={isTxOpen} onClose={closeTxModal} title="Novo lançamento">
        <form onSubmit={handleSaveTransaction} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SegmentedControl
              items={['Receita', 'Despesa', 'Empréstimo']}
              active={
                txKind === 'income'
                  ? 'Receita'
                  : txKind === 'expense'
                  ? 'Despesa'
                  : 'Empréstimo'
              }
              onChange={(label) => {
                if (label === 'Receita') {
                  setTxKind('income');
                  setTxCategory('Receita de obra');
                  setTxInvoiceStatus('A emitir');
                } else if (label === 'Despesa') {
                  setTxKind('expense');
                  setTxCategory('Mão de obra');
                  setTxInvoiceStatus('Não se aplica');
                } else {
                  setTxKind('loan');
                  setTxCategory('Empréstimo');
                }
              }}
            />

            {txKind !== 'loan' && (
              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#14181F] cursor-pointer">
                <input
                  type="checkbox"
                  checked={txIsForecast}
                  onChange={(e) => setTxIsForecast(e.target.checked)}
                  className="rounded border-[#E4E1DA]"
                />
                Lançamento previsto (a vencer)
              </label>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-description" className="text-[13px] font-semibold text-[#14181F]">Descrição</label>
              <input
                id="tx-description"
                type="text"
                required
                value={txDesc}
                onChange={(e) => setTxDesc(e.target.value)}
                placeholder="Descrição do lançamento"
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-amount" className="text-[13px] font-semibold text-[#14181F]">Valor (R$)</label>
              <input
                id="tx-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                placeholder="0,00"
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-date" className="text-[13px] font-semibold text-[#14181F]">Data / Vencimento</label>
              <input
                id="tx-date"
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-category" className="text-[13px] font-semibold text-[#14181F]">Classificar como</label>
              <select
                id="tx-category"
                aria-describedby={loanInIncomeError ? 'tx-category-error' : undefined}
                value={txCategory}
                onChange={(e) => setTxCategory(e.target.value)}
                aria-invalid={Boolean(loanInIncomeError)}
                className={`rounded-lg border px-3.5 py-2.5 text-sm bg-white ${
                  loanInIncomeError ? 'border-[#B42318] ring-2 ring-[#FDECEA]' : 'border-[#E4E1DA]'
                }`}
              >
                {txKind === 'income' && (
                  <>
                    <option value="Receita de obra">Receita de obra</option>
                    <option value="Empréstimo">Empréstimo</option>
                  </>
                )}
                {txKind === 'expense' &&
                  EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                {txKind === 'loan' && <option value="Empréstimo">Empréstimo (dívida)</option>}
              </select>
              {loanInIncomeError && (
                <span id="tx-category-error" className="text-xs font-medium text-[#B42318]">{loanInIncomeError}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-center" className="text-[13px] font-semibold text-[#14181F]">
                Obra ou centro de custo
              </label>
              <select
                id="tx-center"
                aria-describedby={missingCenterError ? 'tx-center-error' : undefined}
                value={txProjectId}
                onChange={(e) => setTxProjectId(e.target.value)}
                aria-invalid={Boolean(missingCenterError)}
                className={`rounded-lg border px-3.5 py-2.5 text-sm bg-white ${
                  missingCenterError ? 'border-[#B42318] ring-2 ring-[#FDECEA]' : 'border-[#E4E1DA]'
                }`}
              >
                <option value="">Selecione uma opção</option>
                <option value="Empresa">Empresa (despesa ou caixa geral)</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {missingCenterError && (
                <span id="tx-center-error" className="text-xs font-medium text-[#B42318]">{missingCenterError}</span>
              )}
            </div>

            {txKind !== 'loan' && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="tx-invoice" className="text-[13px] font-semibold text-[#14181F]">Nota fiscal</label>
                <select
                  id="tx-invoice"
                  value={txInvoiceStatus}
                  onChange={(e) => setTxInvoiceStatus(e.target.value as InvoiceStatus)}
                  className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm bg-white"
                >
                  <option value="A emitir">A emitir</option>
                  <option value="Emitida">Emitida</option>
                  <option value="Não emitida">Não emitida</option>
                  {txKind === 'expense' && <option value="Não se aplica">Não se aplica</option>}
                </select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              {txKind === 'expense' ? 'Forma de pagamento' : 'Forma de recebimento'}
              <input type="text" required maxLength={60} value={txPaymentMethod}
                onChange={(e) => setTxPaymentMethod(e.target.value)} className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm font-normal" />
            </label>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tx-receipt-ref" className="text-[13px] font-semibold text-[#14181F]">
                Comprovante (arquivo ou NSU)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  id="tx-receipt-ref"
                  value={txReceiptRef}
                  onChange={(e) => setTxReceiptRef(e.target.value)}
                  placeholder="Referência ou NSU"
                  className="min-w-0 flex-1 rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
                />
                <label className="px-3 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-xs font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] focus-within:ring-2 focus-within:ring-[#2455A4] cursor-pointer whitespace-nowrap">
                  Anexar
                  <input
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    className="sr-only"
                    onChange={(e) => {
                      setTxReceiptFile(e.target.files?.[0]);
                    }}
                  />
                </label>
              </div>
            </div>
          </div>

          {txReceiptFile && (
            <p className="text-xs text-[#5B6472] break-all">Arquivo selecionado: {txReceiptFile.name}</p>
          )}
          {txKind === 'loan' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-sm">Credor
                <input required maxLength={140} value={loanCreditor} onChange={(e) => setLoanCreditor(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">Tipo de crédito
                <select value={loanType} onChange={(e) => setLoanType(e.target.value as DebtType)}
                  className="rounded-lg border border-[#E4E1DA] p-2">
                  <option>Empréstimo bancário</option><option>Conta garantida</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">Parcelas restantes
                <input type="number" min={0} step={1} value={loanInstallments}
                  onChange={(e) => setLoanInstallments(e.target.value)} className="rounded-lg border border-[#E4E1DA] p-2" />
              </label>
              <label className="flex flex-col gap-1 text-sm">Próximo vencimento
                <input type="date" value={loanNextDue} onChange={(e) => setLoanNextDue(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] p-2" />
              </label>
            </div>
          )}
          <RegisteredBySelect value={txActor} onChange={setTxActor} id="tx-actor" />

          {formRulesErrorCount > 0 && (
            <AlertNote tone="warn" title={`${formRulesErrorCount} campo(s) precisam de correção`}>
              Corrija os campos marcados para salvar o lançamento.
            </AlertNote>
          )}
          {txSubmitError && (
            <AlertNote tone="bad" title="Não foi possível salvar">
              {txSubmitError}
            </AlertNote>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={closeTxModal}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={txSaving || formRulesErrorCount > 0}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
            >
              {txSaving ? 'Salvando...' : 'Salvar lançamento'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Nova Dívida */}
      <Modal
        open={debtModalOpen}
        onClose={() => setDebtModalOpen(false)}
        title={editingDebt ? 'Editar dívida' : 'Nova dívida ou crédito'}
      >
        <form onSubmit={handleSaveDebt} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Credor / descrição</label>
              <input
                type="text"
                required
                value={debtCreditor}
                onChange={(e) => setDebtCreditor(e.target.value)}
                placeholder="Nome do credor"
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Tipo</label>
              <select
                value={debtType}
                onChange={(e) => setDebtType(e.target.value as DebtType)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm bg-white"
              >
                <option value="Empréstimo bancário">Empréstimo bancário</option>
                <option value="Conta garantida">Conta garantida</option>
                <option value="Tributo em atraso">Tributo em atraso</option>
                <option value="Encargos trabalhistas">Encargos trabalhistas</option>
                <option value="Outro">Outro</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Saldo devedor (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={debtBalance}
                onChange={(e) => setDebtBalance(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Custo mensal (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={debtMonthlyCost}
                onChange={(e) => setDebtMonthlyCost(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Parcelas restantes</label>
              <input
                type="number"
                min="0"
                value={debtInstallments}
                onChange={(e) => setDebtInstallments(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm tabular-nums"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Próximo vencimento</label>
              <input
                type="date"
                value={debtNextDue}
                onChange={(e) => setDebtNextDue(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Status</label>
              <select
                value={debtStatus}
                onChange={(e) => setDebtStatus(e.target.value as DebtStatus)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm bg-white"
              >
                <option value="Em dia">Em dia</option>
                <option value="Em uso">Em uso</option>
                <option value="A parcelar">A parcelar</option>
              </select>
            </div>
          </div>
          {debtError && <AlertNote tone="bad" title="Não foi possível salvar a dívida">{debtError}</AlertNote>}
          <RegisteredBySelect value={debtActor} onChange={setDebtActor} id="debt-actor" />
          <div className="flex justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => setDebtModalOpen(false)}
              className="px-4 py-2.5 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={debtSaving}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer"
            >
              {debtSaving ? 'Salvando...' : 'Salvar dívida'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Importar Extrato OFX/CSV com conciliação assistida */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Importar extrato bancário (OFX ou CSV)"
        maxWidth="max-w-4xl"
      >
        <div className="flex flex-col gap-4">
          <div className="border-2 border-dashed border-[#E4E1DA] rounded-xl p-6 text-center bg-[#F6F5F2]">
            <input
              type="file"
              accept=".csv,.ofx,.txt"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleParseStatementFile(file);
              }}
              className="text-sm text-[#14181F]"
            />
            <p className="text-xs text-[#5B6472] mt-2">
              Formato CSV esperado: Data;Descrição;Valor (positivo para entrada, negativo para saída)
              ou arquivo OFX bancário.
            </p>
          </div>

          {importError && (
            <AlertNote tone="bad" title="Atenção na importação">
              {importError}
            </AlertNote>
          )}

          {importRows.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {(['Conciliado', 'Sugerido', 'Revisar', 'Classificar'] as const).map(
                    (st) => {
                      const count = importRows.filter((r) => r.statusConciliacao === st).length;
                      return (
                        <StatusBadge
                          key={st}
                          label={`${st}: ${count}`}
                          tone={RECONCILIATION_TONE[st]}
                        />
                      );
                    },
                  )}
                </div>
                <span className="text-xs text-[#5B6472]">
                  {selectedImportRows.length} selecionado(s) para importar
                </span>
              </div>

              {invalidStatementRows > 0 && (
                <AlertNote tone="warn" title="Revise o arquivo">
                  {invalidStatementRows} movimento(s) com data, descrição ou valor inválido ficaram fora da seleção.
                </AlertNote>
              )}
              <AlertNote tone="info" title="Conciliação assistida">
                Movimentos já lançados aparecem como <strong>Conciliado</strong> e vêm desmarcados
                para evitar duplicidade. Marque as sugestões de baixa somente após conferir o vínculo.
              </AlertNote>

              <div className="overflow-x-auto max-h-72">
                <table className="block md:table w-full border-collapse text-xs">
                  <thead className="hidden md:table-header-group">
                    <tr className="bg-[#F0EEE9] text-left text-[#5B6472]">
                      <th className="py-2 px-2">Importar</th>
                      <th className="py-2 px-2">Data</th>
                      <th className="py-2 px-2">Descrição e conciliação</th>
                      <th className="py-2 px-2 text-right">Valor</th>
                      <th className="py-2 px-2">Situação</th>
                      <th className="py-2 px-2">Tipo</th>
                      <th className="py-2 px-2">Categoria</th>
                      <th className="py-2 px-2">Obra / centro</th>
                    </tr>
                  </thead>
                  <tbody className="grid gap-2 md:table-row-group">
                    {importRows.map((row, idx) => (
                      <tr key={row.id} className="grid gap-1 rounded-lg border border-[#E4E1DA] p-2 md:table-row md:rounded-none md:border-0 md:border-b md:p-0">
                        <td className="py-2 px-2 text-center">
                          <input
                            type="checkbox"
                            checked={row.incluirNaImportacao}
                            aria-label={`Selecionar ${row.descricao}`}
                            disabled={row.statusConciliacao === 'Conciliado'}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setImportRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx ? { ...r, incluirNaImportacao: checked } : r,
                                ),
                              );
                            }}
                          />
                        </td>
                        <td className="py-2 px-2 tabular-nums whitespace-nowrap">
                          {formatDateBR(row.data)}
                        </td>
                        <td className="py-2 px-2">
                          <strong className="block text-[#14181F]">{row.descricao}</strong>
                          <span className="text-[11px] text-[#5B6472]">
                            {row.motivoConciliacao}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">
                          {formatBRL(row.valor)}
                        </td>
                        <td className="py-2 px-2">
                          <StatusBadge
                            label={row.statusConciliacao}
                            tone={RECONCILIATION_TONE[row.statusConciliacao]}
                          />
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={row.tipo}
                            aria-label="Tipo de movimento"
                            disabled={row.statusConciliacao === 'Conciliado' || !!row.parcelaSugeridaId || !!row.settleTransactionId}
                            onChange={(e) => {
                              const t = e.target.value as 'receita' | 'despesa' | 'emprestimo';
                              setImportRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        tipo: t,
                                        categoria:
                                          t === 'emprestimo'
                                            ? 'Empréstimo'
                                            : t === 'receita'
                                            ? 'Receita de obra'
                                            : r.categoria === 'Receita de obra' ||
                                              r.categoria === 'Empréstimo'
                                            ? 'Outros'
                                            : r.categoria,
                                        statusConciliacao:
                                          r.alertaEmprestimo && t === 'receita'
                                            ? 'Revisar'
                                            : r.statusConciliacao === 'Revisar' &&
                                              t === 'emprestimo'
                                            ? 'Sugerido'
                                            : r.statusConciliacao,
                                      }
                                    : r,
                                ),
                              );
                            }}
                            className="border border-[#E4E1DA] rounded px-2 py-1 bg-white"
                          >
                            <option value="receita">Receita</option>
                            <option value="despesa">Despesa</option>
                            <option value="emprestimo">Empréstimo (dívida)</option>
                          </select>
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={row.categoria}
                            aria-label="Categoria"
                            disabled={row.tipo === 'emprestimo' || row.statusConciliacao === 'Conciliado' || !!row.parcelaSugeridaId || !!row.settleTransactionId}
                            onChange={(e) => {
                              const cat = e.target.value;
                              setImportRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, categoria: cat } : r)),
                              );
                            }}
                            className="border border-[#E4E1DA] rounded px-2 py-1 bg-white disabled:opacity-60"
                          >
                            {row.tipo === 'receita' && (
                              <option value="Receita de obra">Receita de obra</option>
                            )}
                            {row.tipo === 'despesa' &&
                              EXPENSE_CATEGORIES.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            {row.tipo === 'emprestimo' && (
                              <option value="Empréstimo">Empréstimo</option>
                            )}
                          </select>
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={row.obraId}
                            aria-label="Obra ou centro de custo"
                            disabled={row.statusConciliacao === 'Conciliado' || !!row.parcelaSugeridaId || !!row.settleTransactionId}
                            onChange={(e) => {
                              const oid = e.target.value;
                              setImportRows((prev) =>
                                prev.map((r, i) => (i === idx ? { ...r, obraId: oid } : r)),
                              );
                            }}
                            className="border border-[#E4E1DA] rounded px-2 py-1 bg-white"
                          >
                            <option value="">Selecione</option>
                            <option value="Empresa">Empresa</option>
                            {data.projects.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RegisteredBySelect
                value={importActor}
                onChange={setImportActor}
                id="import-actor"
              />
            </>
          )}

          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setImportModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={selectedImportRows.length === 0 || importSaving}
              onClick={handleConfirmImport}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
            >
              {importSaving
                ? 'Importando...'
                : `Confirmar importação (${selectedImportRows.length})`}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Confirmar Recebimento de Parcela (/parcelas) */}
      <Modal
        open={Boolean(receivingInstallment)}
        onClose={() => setReceivingInstallment(null)}
        title={
          receivingInstallment
            ? `Confirmar recebimento · ${receivingInstallment.label}`
            : 'Receber parcela'
        }
      >
        {receivingInstallment && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setReceivingSaving(true);
              setReceivingError(null);
              try {
                await markInstallmentReceived(uid, receivingActor, receivingInstallment, receivingDate, receivingMethod);
                setReceivingInstallment(null);
              } catch (err) {
                setReceivingError(
                  err instanceof Error
                    ? err.message
                    : 'Erro ao registrar recebimento da parcela.',
                );
              } finally {
                setReceivingSaving(false);
              }
            }}
            className="flex flex-col gap-4"
          >
            <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Obra</span>
                <strong className="text-[#14181F]">{receivingInstallment.projectName}</strong>
              </div>
              {receivingInstallment.clientName && (
                <div className="flex justify-between gap-2">
                  <span className="text-[#5B6472]">Cliente</span>
                  <strong className="text-[#14181F]">{receivingInstallment.clientName}</strong>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Vencimento</span>
                <strong className="tabular-nums text-[#14181F]">
                  {formatDateBR(receivingInstallment.dueDate)}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Valor</span>
                <strong className="tabular-nums text-[#14181F]">
                  {formatBRL(receivingInstallment.amount)}
                </strong>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Data do recebimento
              <input type="date" required max={todayStr} value={receivingDate}
                onChange={(e) => setReceivingDate(e.target.value)} className="rounded-lg border border-[#E4E1DA] p-2" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Forma do recebimento
              <input required maxLength={60} value={receivingMethod}
                onChange={(e) => setReceivingMethod(e.target.value)} className="rounded-lg border border-[#E4E1DA] p-2" />
            </label>
            <RegisteredBySelect
              value={receivingActor}
              onChange={setReceivingActor}
              id="receive-installment-actor"
            />

            {receivingError && (
              <AlertNote tone="bad" title="Erro ao confirmar recebimento">
                {receivingError}
              </AlertNote>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setReceivingInstallment(null)}
                disabled={receivingSaving}
                className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={receivingSaving}
                className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
              >
                {receivingSaving ? 'Registrando...' : 'Confirmar recebimento'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Confirmar Baixa de Lançamento (A pagar / Recebimento avulso) */}
      <Modal
        open={Boolean(settlingTx)}
        onClose={() => setSettlingTx(null)}
        title={
          settlingTx?.entryKind === 'income'
            ? 'Confirmar recebimento'
            : 'Confirmar pagamento'
        }
      >
        {settlingTx && (
          <form onSubmit={handleConfirmSettleTransaction} className="flex flex-col gap-4">
            <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Descrição</span>
                <strong className="text-[#14181F]">{settlingTx.description}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Vencimento</span>
                <strong className="tabular-nums text-[#14181F]">
                  {formatDateBR(settlingTx.dueDate || settlingTx.date)}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Valor</span>
                <strong className="tabular-nums text-[#14181F]">
                  {formatBRL(settlingTx.amount)}
                </strong>
              </div>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              Data efetiva da baixa
              <input type="date" required max={todayStr} value={settlingDate}
                onChange={(e) => setSettlingDate(e.target.value)} className="rounded-lg border border-[#E4E1DA] p-2" />
            </label>
            <RegisteredBySelect
              value={settlingActor}
              onChange={setSettlingActor}
              id="settle-tx-actor"
            />

            {settlingError && (
              <AlertNote tone="bad" title="Erro ao registrar baixa">
                {settlingError}
              </AlertNote>
            )}

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSettlingTx(null)}
                disabled={settlingSaving}
                className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={settlingSaving}
                className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
              >
                {settlingSaving
                  ? 'Registrando...'
                  : settlingTx.entryKind === 'income'
                  ? 'Confirmar recebimento'
                  : 'Confirmar pagamento'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Modal: Quitar Dívida */}
      <Modal
        open={Boolean(settlingDebt)}
        onClose={() => setSettlingDebt(null)}
        title="Confirmar quitação de dívida"
      >
        {settlingDebt && (
          <form onSubmit={handleConfirmSettleDebt} className="flex flex-col gap-4">
            <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-xl p-3.5 text-xs flex flex-col gap-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Credor</span>
                <strong className="text-[#14181F]">{settlingDebt.creditor}</strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-[#5B6472]">Saldo informado</span>
                <strong className="tabular-nums text-[#14181F]">
                  {formatBRL(settlingDebt.principalBalance)}
                </strong>
              </div>
            </div>

            <RegisteredBySelect
              value={settlingDebtActor}
              onChange={setSettlingDebtActor}
              id="settle-debt-actor"
            />

            <div className="flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSettlingDebt(null)}
                disabled={settlingDebtSaving}
                className="px-4 py-2 rounded-lg border border-[#E4E1DA] bg-white text-sm font-semibold cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={settlingDebtSaving}
                className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
              >
                {settlingDebtSaving ? 'Quitando...' : 'Confirmar quitação'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
