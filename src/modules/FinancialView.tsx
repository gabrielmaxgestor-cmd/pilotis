import { useEffect, useMemo, useState } from 'react';
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
} from '../components/ui/PilotisUI';
import {
  createRecord,
  importTransactionsBatch,
  markInstallmentReceived,
  updateRecord,
} from '../services/pilotisService';
import type {
  ActorRole,
  DebtStatus,
  DebtType,
  FinancialTransaction,
  Installment,
  InvoiceStatus,
  PilotisDataState,
  TransactionKind,
  TransactionStatus,
} from '../types/pilotis';
import {
  computeCashFlowProjection,
  computeDebtSummary,
  computeProjectDre,
  computeTeamPayrollSummary,
} from '../utils/calculations';
import {
  clampStr,
  formatBRL,
  formatDateBR,
  formatShortDateBR,
  monthKey,
  normalizeBRDateToISO,
  todayISO,
} from '../utils/formatters';

const FIN_TABS = [
  'Visão geral',
  'A receber',
  'A pagar',
  'Fluxo de caixa',
  'Dívidas e crédito',
  'DRE por obra',
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

export function FinancialView({
  uid,
  data,
  companyEmail,
  initialTab,
  externalNewTxOpen,
  onCloseExternalNewTx,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  initialTab?: string;
  externalNewTxOpen?: boolean;
  onCloseExternalNewTx?: () => void;
}) {
  const [tab, setTab] = useState(initialTab || 'Visão geral');

  useEffect(() => {
    if (initialTab && FIN_TABS.includes(initialTab)) {
      setTab(initialTab);
    }
  }, [initialTab]);
  const [receivableFilter, setReceivableFilter] = useState('A vencer');
  const [payableFilter, setPayableFilter] = useState('A vencer');
  const [selectedDreProjectId, setSelectedDreProjectId] = useState<string>('');

  // Commercial simulator state (Rule 4: outputs derived)
  const [simValue, setSimValue] = useState('380000');
  const [simDownPct, setSimDownPct] = useState('20');
  const [simParcels, setSimParcels] = useState('18');

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
  const [txPaymentMethod, setTxPaymentMethod] = useState('Transferência');
  const [txActor, setTxActor] = useState<ActorRole>('Sócio');
  const [txSaving, setTxSaving] = useState(false);
  const [txSubmitError, setTxSubmitError] = useState<string | null>(null);

  // New Debt Modal state
  const [debtModalOpen, setDebtModalOpen] = useState(false);
  const [debtCreditor, setDebtCreditor] = useState('');
  const [debtType, setDebtType] = useState<DebtType>('Empréstimo bancário');
  const [debtBalance, setDebtBalance] = useState('');
  const [debtMonthlyCost, setDebtMonthlyCost] = useState('');
  const [debtInstallments, setDebtInstallments] = useState('12');
  const [debtNextDue, setDebtNextDue] = useState(todayISO());
  const [debtStatus, setDebtStatus] = useState<DebtStatus>('Em dia');
  const [debtActor, setDebtActor] = useState<ActorRole>('Sócio');
  const [debtSaving, setDebtSaving] = useState(false);

  // Import Statement Modal state
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importRows, setImportRows] = useState<
    Array<{
      id: string;
      date: string;
      description: string;
      amount: number;
      entryKind: TransactionKind;
      category: string;
      projectId: string;
      flaggedLoan: boolean;
    }>
  >([]);
  const [importActor, setImportActor] = useState<ActorRole>('Sócio');
  const [importError, setImportError] = useState<string | null>(null);
  const [importSaving, setImportSaving] = useState(false);

  // Receive Installment (/parcelas) Confirmation Modal state
  const [receivingInstallment, setReceivingInstallment] = useState<Installment | null>(null);
  const [receivingActor, setReceivingActor] = useState<ActorRole>('Sócio');
  const [receivingSaving, setReceivingSaving] = useState(false);
  const [receivingError, setReceivingError] = useState<string | null>(null);

  const currentMonth = monthKey(todayISO());
  const transactionsSorted = useMemo(
    () => [...data.transactions].sort((a, b) => (b.dueDate || b.date).localeCompare(a.dueDate || a.date)),
    [data.transactions]
  );

  // Rule 6: Loans are NEVER included in income!
  const monthTxs = transactionsSorted.filter(
    (t) => t.entryKind !== 'loan' && monthKey(t.dueDate || t.date) === currentMonth
  );
  const hasTxs = data.transactions.length > 0;
  const monthIncomes = monthTxs.filter((t) => t.entryKind === 'income').reduce((s, t) => s + t.amount, 0);
  const monthExpenses = monthTxs.filter((t) => t.entryKind === 'expense').reduce((s, t) => s + t.amount, 0);
  const monthPayrollExpenses = monthTxs
    .filter((t) => t.entryKind === 'expense' && (t.category === 'Folha' || t.source === 'folha'))
    .reduce((s, t) => s + t.amount, 0);
  const monthResult = monthTxs.length > 0 ? monthIncomes - monthExpenses : null;
  const unissuedInvoicesSum = data.transactions
    .filter((t) => t.entryKind === 'income' && t.invoiceStatus === 'Não emitida')
    .reduce((s, t) => s + t.amount, 0);
  const hasUnissued = data.transactions.some((t) => t.entryKind === 'income');

  // Strict Rule 6 Validation in New Transaction Modal
  const loanInIncomeError = useMemo(() => {
    const lowerDesc = txDesc.toLowerCase();
    const looksLikeLoan =
      lowerDesc.includes('empréstimo') ||
      lowerDesc.includes('emprestimo') ||
      lowerDesc.includes('financiamento') ||
      txCategory === 'Empréstimo';
    if (txKind === 'income' && looksLikeLoan) {
      return 'Empréstimo não pode entrar como receita, porque aumentaria o faturamento. Selecione "Empréstimo" acima para registrar como dívida.';
    }
    return null;
  }, [txKind, txCategory, txDesc]);

  const missingCenterError = !txProjectId ? 'Escolha a obra ou "Empresa" para continuar.' : null;
  const validationErrorsCount = (loanInIncomeError ? 1 : 0) + (missingCenterError ? 1 : 0);

  function closeTxModal() {
    setTxModalOpen(false);
    setTxSubmitError(null);
    onCloseExternalNewTx?.();
  }

  async function handleSaveTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (validationErrorsCount > 0) return;
    const numericAmount = Number(txAmount.replace(',', '.'));
    if (!txDesc.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setTxSubmitError('Preencha a descrição e um valor maior que zero.');
      return;
    }

    setTxSaving(true);
    setTxSubmitError(null);
    try {
      const selectedProj = data.projects.find((p) => p.id === txProjectId);
      const projectName = txProjectId === 'Empresa' ? 'Empresa' : selectedProj?.name || 'Obra';
      const status: TransactionStatus =
        txKind === 'loan'
          ? 'Não é receita'
          : txIsForecast
          ? 'A vencer'
          : txKind === 'income'
          ? 'Recebido'
          : 'Pago';

      await createRecord(
        'transactions',
        uid,
        txActor,
        {
          date: txDate,
          dueDate: txDate,
          description: clampStr(txDesc, 200),
          entryKind: txKind,
          category: txKind === 'loan' ? 'Empréstimo' : txCategory,
          projectId: txProjectId,
          projectName: clampStr(projectName, 160),
          amount: numericAmount,
          isForecast: txKind === 'loan' ? false : txIsForecast,
          status,
          invoiceStatus: txKind === 'income' ? txInvoiceStatus : 'Não se aplica',
          paymentMethod: clampStr(txPaymentMethod, 60),
          installmentLabel: '',
          quoteId: '',
          debtId: '',
          source: 'manual',
        },
        `Lançamento ${txDesc} (${formatBRL(numericAmount)})`
      );

      if (txKind === 'loan') {
        await createRecord(
          'debts',
          uid,
          txActor,
          {
            creditor: clampStr(txDesc, 140),
            debtType: 'Empréstimo bancário',
            principalBalance: numericAmount,
            monthlyCost: 0,
            remainingInstallments: 12,
            nextDueDate: txDate,
            status: 'Em dia',
            notes: 'Registrado via Financeiro (Empréstimo separado de receita)',
          },
          `Dívida registrada: ${txDesc}`
        );
      }

      setTxDesc('');
      setTxAmount('');
      setTxProjectId('');
      closeTxModal();
    } catch (err) {
      setTxSubmitError(err instanceof Error ? err.message : 'Erro ao salvar lançamento.');
    } finally {
      setTxSaving(false);
    }
  }

  async function handleMarkPaidOrReceived(tx: FinancialTransaction, actor: ActorRole = 'Sócio') {
    const newStatus: TransactionStatus = tx.entryKind === 'income' ? 'Recebido' : 'Pago';
    await updateRecord(
      'transactions',
      tx.id,
      uid,
      actor,
      { isForecast: false, status: newStatus },
      `Baixa de lançamento: ${tx.description}`,
      tx.status,
      newStatus
    );
  }

  async function handleSaveDebt(e: React.FormEvent) {
    e.preventDefault();
    const bal = Number(debtBalance.replace(',', '.'));
    const mCost = Number((debtMonthlyCost || '0').replace(',', '.'));
    if (!debtCreditor.trim() || !Number.isFinite(bal) || bal < 0) return;
    setDebtSaving(true);
    try {
      await createRecord(
        'debts',
        uid,
        debtActor,
        {
          creditor: clampStr(debtCreditor, 140),
          debtType,
          principalBalance: bal,
          monthlyCost: Number.isFinite(mCost) ? mCost : 0,
          remainingInstallments: Number(debtInstallments) || 0,
          nextDueDate: debtNextDue,
          status: debtStatus,
          notes: '',
        },
        `Nova dívida: ${debtCreditor}`
      );
      setDebtCreditor('');
      setDebtBalance('');
      setDebtMonthlyCost('');
      setDebtModalOpen(false);
    } finally {
      setDebtSaving(false);
    }
  }

  function handleParseStatementFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed: typeof importRows = [];

      if (file.name.toLowerCase().endsWith('.ofx') || text.includes('<STMTTRN>')) {
        const blocks = text.split('<STMTTRN>').slice(1);
        blocks.forEach((blk, idx) => {
          const dt = /<DTPOSTED>(\d{8})/.exec(blk)?.[1];
          const amtStr = /<TRNAMT>([-\d.]+)/.exec(blk)?.[1];
          const memo = /<MEMO>([^<\r\n]+)/.exec(blk)?.[1] || 'Movimento bancário';
          const amt = Number(amtStr || 0);
          if (!amt) return;
          const iso = dt ? `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}` : todayISO();
          const flaggedLoan =
            memo.toLowerCase().includes('emprest') || memo.toLowerCase().includes('emprést');
          parsed.push({
            id: `imp_${idx}`,
            date: iso,
            description: memo.trim().slice(0, 180),
            amount: Math.abs(amt),
            entryKind: flaggedLoan ? 'loan' : amt > 0 ? 'income' : 'expense',
            category: flaggedLoan ? 'Empréstimo' : amt > 0 ? 'Receita de obra' : 'Outros',
            projectId: 'Empresa',
            flaggedLoan,
          });
        });
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        lines.forEach((line, idx) => {
          if (idx === 0 && /data|descri/i.test(line)) return;
          const sep = line.includes(';') ? ';' : ',';
          const cols = line.split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
          if (cols.length < 3) return;
          const iso = normalizeBRDateToISO(cols[0]);
          const desc = cols[1] || 'Movimento importado';
          const rawVal = Number(cols[2].replace(/\./g, '').replace(',', '.'));
          if (!Number.isFinite(rawVal) || rawVal === 0) return;
          const flaggedLoan =
            desc.toLowerCase().includes('emprest') || desc.toLowerCase().includes('emprést');
          parsed.push({
            id: `imp_${idx}`,
            date: iso,
            description: desc.slice(0, 180),
            amount: Math.abs(rawVal),
            entryKind: flaggedLoan ? 'loan' : rawVal > 0 ? 'income' : 'expense',
            category: flaggedLoan ? 'Empréstimo' : rawVal > 0 ? 'Receita de obra' : 'Outros',
            projectId: 'Empresa',
            flaggedLoan,
          });
        });
      }

      if (parsed.length === 0) {
        setImportError('Nenhuma linha válida encontrada. Use CSV (Data;Descrição;Valor) ou OFX.');
      } else {
        setImportError(null);
        setImportRows(parsed);
      }
    };
    reader.readAsText(file, 'utf-8');
  }

  async function handleConfirmImport() {
    if (importRows.length === 0) return;
    const invalidLoan = importRows.find(
      (r) => r.entryKind === 'income' && r.category === 'Empréstimo'
    );
    if (invalidLoan) {
      setImportError('Reclassifique os movimentos de empréstimo para o tipo "Empréstimo" antes de importar.');
      return;
    }
    setImportSaving(true);
    setImportError(null);
    try {
      await importTransactionsBatch(
        uid,
        importActor,
        importRows.map((r) => ({
          date: r.date,
          dueDate: r.date,
          description: r.description,
          entryKind: r.entryKind,
          category: r.entryKind === 'loan' ? 'Empréstimo' : r.category,
          projectId: r.projectId,
          projectName:
            r.projectId === 'Empresa'
              ? 'Empresa'
              : data.projects.find((p) => p.id === r.projectId)?.name || 'Obra',
          amount: r.amount,
          isForecast: false,
          status:
            r.entryKind === 'loan'
              ? 'Não é receita'
              : r.entryKind === 'income'
              ? 'Recebido'
              : 'Pago',
          invoiceStatus: r.entryKind === 'income' ? 'A emitir' : 'Não se aplica',
          paymentMethod: 'Extrato',
          installmentLabel: '',
          quoteId: '',
          debtId: '',
          source: 'extrato',
        })),
        'extrato bancário'
      );
      setImportRows([]);
      setImportModalOpen(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao importar extrato.');
    } finally {
      setImportSaving(false);
    }
  }

  // Commercial simulator math (Rule 4)
  const simNumVal = Number(simValue) || 0;
  const simNumDown = Math.max(0, Math.min(100, Number(simDownPct) || 0));
  const simNumParcels = Math.max(1, Number(simParcels) || 18);
  const simDownAmount = simNumVal * (simNumDown / 100);
  const simParcelAmount = (simNumVal - simDownAmount) / simNumParcels;
  const payrollSummary = computeTeamPayrollSummary(data.employees, data.settings);
  const quarterlyPayroll = payrollSummary.totalMonthlyCost * 3;
  const quarterlySimulatedInflow = simDownAmount + simParcelAmount * 2;
  const simulatedQuarterGap =
    payrollSummary.totalHeadcount > 0
      ? Math.max(0, quarterlyPayroll - quarterlySimulatedInflow)
      : null;

  const projection = computeCashFlowProjection(data, 5);
  const debtSummary = computeDebtSummary(data.debts);

  // A receber filtering: /parcelas é a fonte principal das parcelas de contrato;
  // lançamentos manuais/extrato sem installmentId complementam sem duplicidade.
  const installmentsSorted = useMemo(
    () =>
      [...data.installments].sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate) || a.number - b.number
      ),
    [data.installments]
  );

  const installmentsFiltered = installmentsSorted.filter((inst) => {
    if (receivableFilter === 'Todas') return true;
    if (receivableFilter === 'Pagas') return inst.status === 'Recebida';
    if (receivableFilter === 'Em atraso') return inst.status === 'Em atraso';
    return inst.status === 'A vencer';
  });

  const receivablesAll = transactionsSorted.filter((t) => t.entryKind === 'income');
  const manualReceivablesAll = receivablesAll.filter((t) => !t.installmentId);
  const manualReceivablesFiltered = manualReceivablesAll.filter((t) => {
    if (receivableFilter === 'Todas') return true;
    if (receivableFilter === 'Pagas') return t.status === 'Recebido';
    if (receivableFilter === 'Em atraso') return t.status === 'Em atraso';
    return t.status === 'A vencer';
  });

  const hasReceivablesData =
    data.installments.length > 0 || manualReceivablesAll.length > 0;
  const openInstallmentsCount =
    data.installments.filter((i) => i.status !== 'Recebida').length +
    manualReceivablesAll.filter((t) => t.status !== 'Recebido').length;
  const openReceivablesSum =
    data.installments
      .filter((i) => i.status === 'A vencer' || i.status === 'Em atraso')
      .reduce((s, i) => s + i.amount, 0) +
    manualReceivablesAll
      .filter((t) => t.status === 'A vencer' || t.status === 'Em atraso')
      .reduce((s, t) => s + t.amount, 0);
  const receivedMonthSum =
    data.installments
      .filter(
        (i) =>
          i.status === 'Recebida' &&
          monthKey(i.receivedDate || i.dueDate) === currentMonth
      )
      .reduce((s, i) => s + i.amount, 0) +
    manualReceivablesAll
      .filter(
        (t) =>
          t.status === 'Recebido' && monthKey(t.dueDate || t.date) === currentMonth
      )
      .reduce((s, t) => s + t.amount, 0);
  const overdueReceivablesSum =
    data.installments
      .filter((i) => i.status === 'Em atraso')
      .reduce((s, i) => s + i.amount, 0) +
    manualReceivablesAll
      .filter((t) => t.status === 'Em atraso')
      .reduce((s, t) => s + t.amount, 0);

  // A pagar filtering
  const payablesAll = transactionsSorted.filter((t) => t.entryKind === 'expense');
  const payablesFiltered = payablesAll.filter((t) => {
    if (payableFilter === 'Todas') return true;
    if (payableFilter === 'Pagas') return t.status === 'Pago';
    if (payableFilter === 'Em atraso') return t.status === 'Em atraso';
    return t.status === 'A vencer';
  });

  const activeDreProject =
    data.projects.find((p) => p.id === selectedDreProjectId) || data.projects[0] || null;
  const activeDre = activeDreProject
    ? computeProjectDre(activeDreProject, data.transactions)
    : null;

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

      {tab === 'Visão geral' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Entradas do mês"
              value={hasTxs ? formatBRL(monthIncomes) : 'Sem dados'}
              subtext="Realizado + previsto (sem empréstimos)"
              isEmpty={!hasTxs}
            />
            <KpiCard
              label="Saídas do mês"
              value={hasTxs ? formatBRL(monthExpenses) : 'Sem dados'}
              subtext={
                monthExpenses > 0
                  ? `Folha: ${Math.round((monthPayrollExpenses / monthExpenses) * 100)}% das despesas`
                  : 'Sem despesas no mês'
              }
              isEmpty={!hasTxs}
            />
            <KpiCard
              label="Resultado do mês"
              value={formatBRL(monthResult)}
              subtext="Entradas menos saídas"
              isEmpty={monthResult === null}
            />
            <KpiCard
              label="Receita sem nota emitida"
              value={hasUnissued ? formatBRL(unissuedInvoicesSum) : 'Sem dados'}
              subtext="Sincronizado com Conformidade"
              isEmpty={!hasUnissued}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#14181F]">Fluxo de caixa mensal</h2>
                <StatusBadge label="Previsto separado do realizado" tone="neutral" />
              </div>

              {projection.length === 0 ? (
                <p className="text-sm text-[#5B6472] py-10 text-center">
                  Sem lançamentos suficientes para exibir o fluxo mensal.
                </p>
              ) : (
                <div className="grid grid-cols-5 gap-3 items-end h-44 pt-3 pb-2 border-b border-[#E4E1DA]">
                  {projection.map((pt) => {
                    const maxV = Math.max(
                      1,
                      ...projection.map((x) => Math.max(x.realizedIn + x.contractedIn, x.outflows))
                    );
                    const inVal = pt.realizedIn + pt.contractedIn;
                    return (
                      <div key={pt.monthKey} className="flex flex-col items-center gap-2">
                        <div className="flex items-end gap-1.5 h-32">
                          <div
                            className="w-5 rounded-t bg-[#1F3A5F]"
                            style={{ height: `${Math.max(3, (inVal / maxV) * 120)}px` }}
                            title={`Entradas: ${formatBRL(inVal)}`}
                          />
                          <div
                            className="w-5 rounded-t bg-[#9A6212]"
                            style={{ height: `${Math.max(3, (pt.outflows / maxV) * 120)}px` }}
                            title={`Saídas: ${formatBRL(pt.outflows)}`}
                          />
                        </div>
                        <span className="text-xs text-[#5B6472] font-medium">{pt.label}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
              <h2 className="text-base font-semibold text-[#14181F]">
                Simulador de condições comerciais
              </h2>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-[#14181F]">Valor da obra (R$)</label>
                <input
                  type="number"
                  min={0}
                  value={simValue}
                  onChange={(e) => setSimValue(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-[#14181F]">Entrada (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={simDownPct}
                    onChange={(e) => setSimDownPct(e.target.value)}
                    className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-semibold text-[#14181F]">Parcelas (13–24x)</label>
                  <input
                    type="number"
                    min={1}
                    max={36}
                    value={simParcels}
                    onChange={(e) => setSimParcels(e.target.value)}
                    className="rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm tabular-nums"
                  />
                </div>
              </div>
              <div className="rounded-xl bg-[#F6E7CC] p-3.5 mt-1">
                <span className="block text-xs text-[#8A5200] font-medium">
                  Parcela simulada: <strong className="tabular-nums">{formatBRL(simParcelAmount)}</strong>
                </span>
                <span className="block text-xs text-[#8A5200] mt-1">
                  Gap frente à folha no 1º trimestre:
                </span>
                <strong className="block text-lg font-bold text-[#14181F] tabular-nums mt-0.5">
                  {simulatedQuarterGap !== null ? formatBRL(simulatedQuarterGap) : 'Cadastre a equipe'}
                </strong>
              </div>
            </section>
          </div>

          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#14181F]">Lançamentos recentes</h2>
              <span className="text-xs text-[#5B6472]">{transactionsSorted.length} registro(s)</span>
            </div>

            {transactionsSorted.length === 0 ? (
              <EmptySection
                title="Nenhum lançamento financeiro cadastrado"
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
                        <th className="py-2.5 px-3 rounded-l-lg">Data</th>
                        <th className="py-2.5 px-3">Descrição</th>
                        <th className="py-2.5 px-3">Obra / centro</th>
                        <th className="py-2.5 px-3">Tipo</th>
                        <th className="py-2.5 px-3">Nota fiscal</th>
                        <th className="py-2.5 px-3 text-right">Valor</th>
                        <th className="py-2.5 px-3 rounded-r-lg">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactionsSorted.slice(0, 15).map((tx) => (
                        <tr key={tx.id} className="border-b border-[#E4E1DA] text-[13px] hover:bg-[#F6F5F2]/60">
                          <td className="py-3 px-3 text-[#14181F] font-medium tabular-nums">
                            {formatShortDateBR(tx.dueDate || tx.date)}
                          </td>
                          <td className="py-3 px-3 text-[#14181F]">{tx.description}</td>
                          <td className="py-3 px-3 text-[#5B6472]">{tx.projectName || tx.projectId}</td>
                          <td className="py-3 px-3 text-[#5B6472]">{tx.category}</td>
                          <td className="py-3 px-3">
                            {tx.invoiceStatus && tx.invoiceStatus !== 'Não se aplica' ? (
                              <StatusBadge label={tx.invoiceStatus} />
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                            {tx.entryKind === 'expense' ? '− ' : ''}
                            {formatBRL(tx.amount)}
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge label={tx.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden flex flex-col gap-2.5">
                  {transactionsSorted.slice(0, 12).map((tx) => (
                    <div
                      key={tx.id}
                      className="border border-[#E4E1DA] rounded-xl p-3.5 flex flex-col gap-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-sm text-[#14181F] truncate">{tx.description}</strong>
                        <StatusBadge label={tx.status} />
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#5B6472]">
                        <span>
                          {formatDateBR(tx.dueDate || tx.date)} · {tx.projectName || tx.projectId}
                        </span>
                        <strong className="text-sm text-[#14181F] tabular-nums">
                          {tx.entryKind === 'expense' ? '− ' : ''}
                          {formatBRL(tx.amount)}
                        </strong>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}

      {tab === 'A receber' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="A receber em aberto"
              value={hasReceivablesData ? formatBRL(openReceivablesSum) : 'Sem dados'}
              subtext={`${openInstallmentsCount} parcela(s) em aberto`}
              isEmpty={!hasReceivablesData}
            />
            <KpiCard
              label="Recebido no mês"
              value={hasReceivablesData ? formatBRL(receivedMonthSum) : 'Sem dados'}
              subtext="Realizado no mês atual"
              isEmpty={!hasReceivablesData}
            />
            <KpiCard
              label="Em atraso"
              value={hasReceivablesData ? formatBRL(overdueReceivablesSum) : 'Sem dados'}
              subtext="Parcelas vencidas"
              isEmpty={!hasReceivablesData}
            />
            <KpiCard
              label="Sem nota emitida"
              value={hasUnissued ? formatBRL(unissuedInvoicesSum) : 'Sem dados'}
              subtext="Recebimentos sem NF"
              isEmpty={!hasUnissued}
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
                <SegmentedControl
                  items={['Todas', 'A vencer', 'Pagas', 'Em atraso']}
                  active={receivableFilter}
                  onChange={setReceivableFilter}
                />
              </div>

              {installmentsFiltered.length === 0 ? (
                <p className="text-sm text-[#5B6472] py-6 text-center">
                  Nenhuma parcela neste filtro. Confirme um orçamento para gerar parcelas em /parcelas automaticamente.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <th className="py-2.5 px-3 rounded-l-lg">Obra · cliente</th>
                        <th className="py-2.5 px-3">Parcela</th>
                        <th className="py-2.5 px-3">Vencimento</th>
                        <th className="py-2.5 px-3 text-right">Valor</th>
                        <th className="py-2.5 px-3">Nota fiscal</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3 rounded-r-lg text-right">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {installmentsFiltered.map((inst) => (
                        <tr key={inst.id} className="border-b border-[#E4E1DA] text-[13px]">
                          <td className="py-3 px-3">
                            <strong className="block font-medium text-[#14181F]">
                              {inst.projectName}
                            </strong>
                            {inst.clientName && (
                              <span className="text-xs text-[#5B6472]">{inst.clientName}</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-[#5B6472] font-medium">{inst.label}</td>
                          <td className="py-3 px-3 text-[#5B6472] tabular-nums">
                            {formatDateBR(inst.dueDate)}
                          </td>
                          <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                            {formatBRL(inst.amount)}
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge label={inst.invoiceStatus || 'A emitir'} />
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge label={inst.status} />
                          </td>
                          <td className="py-3 px-3 text-right">
                            {inst.status !== 'Recebida' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setReceivingInstallment(inst);
                                  setReceivingActor('Sócio');
                                  setReceivingError(null);
                                }}
                                className="px-2.5 py-1 rounded-md border border-[#E4E1DA] text-xs font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] cursor-pointer whitespace-nowrap"
                              >
                                Receber
                              </button>
                            ) : (
                              <span className="text-[11px] text-[#5B6472] tabular-nums">
                                {inst.receivedDate ? formatDateBR(inst.receivedDate) : 'Recebida'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {manualReceivablesFiltered.length > 0 && (
                <div className="border-t border-[#E4E1DA] pt-4 flex flex-col gap-3">
                  <h3 className="text-sm font-semibold text-[#14181F]">
                    Outros recebimentos avulsos
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                          <th className="py-2 px-3 rounded-l-lg">Descrição</th>
                          <th className="py-2 px-3">Vencimento</th>
                          <th className="py-2 px-3 text-right">Valor</th>
                          <th className="py-2 px-3">Status</th>
                          <th className="py-2 px-3 rounded-r-lg text-right">Ação</th>
                        </tr>
                      </thead>
                      <tbody>
                        {manualReceivablesFiltered.map((tx) => (
                          <tr key={tx.id} className="border-b border-[#E4E1DA] text-[13px]">
                            <td className="py-2.5 px-3 font-medium text-[#14181F]">
                              {tx.description}
                            </td>
                            <td className="py-2.5 px-3 text-[#5B6472] tabular-nums">
                              {formatDateBR(tx.dueDate || tx.date)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                              {formatBRL(tx.amount)}
                            </td>
                            <td className="py-2.5 px-3">
                              <StatusBadge label={tx.status} />
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {tx.status !== 'Recebido' && (
                                <button
                                  type="button"
                                  onClick={() => handleMarkPaidOrReceived(tx)}
                                  className="px-2.5 py-1 rounded-md border border-[#E4E1DA] text-xs font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] cursor-pointer whitespace-nowrap"
                                >
                                  Receber
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <h2 className="text-base font-semibold text-[#14181F]">Parcelas pagas por obra</h2>
              {data.projects.length === 0 ? (
                <p className="text-sm text-[#5B6472]">Sem obras cadastradas.</p>
              ) : (
                data.projects.map((proj) => {
                  const projParcels = data.installments.filter(
                    (inst) => inst.projectId === proj.id
                  );
                  const paid = projParcels.filter(
                    (inst) => inst.status === 'Recebida'
                  ).length;
                  const pct =
                    projParcels.length > 0
                      ? Math.round((paid / projParcels.length) * 100)
                      : 0;
                  return (
                    <div key={proj.id} className="flex flex-col gap-1.5">
                      <div className="flex justify-between items-center gap-2 text-xs">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <strong className="text-[#14181F] truncate">{proj.name}</strong>
                          <StatusBadge label={proj.contractKind || 'Principal'} />
                        </div>
                        <span className="text-[#5B6472] tabular-nums shrink-0">
                          {paid} de {projParcels.length}
                        </span>
                      </div>
                      <ProgressBar pct={pct} />
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
        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#14181F]">Contas a pagar</h2>
            <SegmentedControl
              items={['Todas', 'A vencer', 'Pagas', 'Em atraso']}
              active={payableFilter}
              onChange={setPayableFilter}
            />
          </div>

          {payablesFiltered.length === 0 ? (
            <EmptySection
              title="Sem contas a pagar neste filtro"
              description="Cadastre uma despesa prevista ou realizada clicando em Novo lançamento."
              actionLabel="Nova conta a pagar"
              onAction={() => {
                setTxKind('expense');
                setTxCategory('Tributos');
                setTxIsForecast(true);
                setTxModalOpen(true);
              }}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                    <th className="py-2.5 px-3 rounded-l-lg">Vencimento</th>
                    <th className="py-2.5 px-3">Descrição</th>
                    <th className="py-2.5 px-3">Categoria</th>
                    <th className="py-2.5 px-3">Obra / centro</th>
                    <th className="py-2.5 px-3 text-right">Valor</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 rounded-r-lg text-right">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {payablesFiltered.map((tx) => (
                    <tr key={tx.id} className="border-b border-[#E4E1DA] text-[13px]">
                      <td className="py-3 px-3 tabular-nums text-[#14181F] font-medium">
                        {formatDateBR(tx.dueDate || tx.date)}
                      </td>
                      <td className="py-3 px-3 text-[#14181F]">{tx.description}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{tx.category}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{tx.projectName || tx.projectId}</td>
                      <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                        {formatBRL(tx.amount)}
                      </td>
                      <td className="py-3 px-3">
                        <StatusBadge label={tx.status} />
                      </td>
                      <td className="py-3 px-3 text-right">
                        {tx.status !== 'Pago' && (
                          <button
                            type="button"
                            onClick={() => handleMarkPaidOrReceived(tx)}
                            className="px-2.5 py-1 rounded-md border border-[#E4E1DA] text-xs font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] cursor-pointer"
                          >
                            Pagar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'Fluxo de caixa' && (
        <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#14181F]">Projeção de 5 meses</h2>
            <StatusBadge label="Contratado separado do funil" tone="info" />
          </div>

          {projection.length === 0 ? (
            <p className="text-sm text-[#5B6472] py-6">
              Sem registros financeiros, equipe ou orçamentos para projetar fluxo de caixa.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                    <th className="py-2.5 px-3 rounded-l-lg">Mês</th>
                    <th className="py-2.5 px-3 text-right">Realizado</th>
                    <th className="py-2.5 px-3 text-right">Entradas contratadas</th>
                    <th className="py-2.5 px-3 text-right">Funil (ponderado)</th>
                    <th className="py-2.5 px-3 text-right">Saídas + folha</th>
                    <th className="py-2.5 px-3 text-right">Provisões incluídas</th>
                    <th className="py-2.5 px-3 rounded-r-lg text-right">Saldo projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {projection.map((p) => (
                    <tr key={p.monthKey} className="border-b border-[#E4E1DA] text-[13px]">
                      <td className="py-3 px-3 font-medium text-[#14181F]">{p.label}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{formatBRL(p.realizedIn)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">{formatBRL(p.contractedIn)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {p.funnelWeightedIn > 0 ? formatBRL(p.funnelWeightedIn) : '—'}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">{formatBRL(p.outflows)}</td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatBRL(p.provisionsIncluded)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        <StatusBadge
                          label={formatBRL(p.projectedBalance)}
                          tone={p.projectedBalance < 0 ? 'bad' : 'ok'}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'Dívidas e crédito' && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setDebtModalOpen(true)}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
            >
              Nova dívida
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard label="Dívida total" value={formatBRL(debtSummary.totalDebt)} subtext="Bancos, tributos e encargos" />
            <KpiCard label="Custo financeiro" value={formatBRL(debtSummary.monthlyCost)} subtext="Juros e encargos mensais" />
            <KpiCard label="Tributos em atraso" value={formatBRL(debtSummary.overdueTaxes)} subtext="Passivo fiscal" />
            <KpiCard label="Conta garantida" value={formatBRL(debtSummary.guaranteedCredit)} subtext="Limite em uso" />
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
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <th className="py-2.5 px-3 rounded-l-lg">Credor / tipo</th>
                      <th className="py-2.5 px-3">Categoria</th>
                      <th className="py-2.5 px-3 text-right">Saldo devedor</th>
                      <th className="py-2.5 px-3">Parcelas</th>
                      <th className="py-2.5 px-3">Vencimento</th>
                      <th className="py-2.5 px-3 rounded-r-lg">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.debts.map((d) => (
                      <tr key={d.id} className="border-b border-[#E4E1DA] text-[13px]">
                        <td className="py-3 px-3 font-medium text-[#14181F]">{d.creditor}</td>
                        <td className="py-3 px-3 text-[#5B6472]">{d.debtType}</td>
                        <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                          {formatBRL(d.principalBalance)}
                        </td>
                        <td className="py-3 px-3 text-[#5B6472]">{d.remainingInstallments}</td>
                        <td className="py-3 px-3 text-[#5B6472] tabular-nums">
                          {formatDateBR(d.nextDueDate)}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge label={d.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'DRE por obra' && (
        <>
          {data.projects.length === 0 || !activeDreProject || !activeDre ? (
            <EmptySection
              title="Nenhuma obra para calcular DRE"
              description="Confirme um orçamento ou cadastre uma obra para comparar orçamento x realizado e acompanhar a margem real."
            />
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

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Receita da obra"
                  value={formatBRL(activeDre.revenueBudgeted)}
                  subtext="Contrato fechado"
                />
                <KpiCard
                  label="Custos diretos realizados"
                  value={formatBRL(activeDre.totalDirectRealized)}
                  subtext={`Orçado: ${formatBRL(activeDre.totalDirectBudgeted)}`}
                />
                <KpiCard
                  label="Margem real"
                  value={`${activeDre.marginRealizedPct.toFixed(1).replace('.', ',')}%`}
                  subtext={`Prevista: ${activeDre.marginBudgetedPct.toFixed(1).replace('.', ',')}%`}
                />
                <KpiCard
                  label="Resultado acumulado"
                  value={formatBRL(activeDre.marginRealized)}
                  subtext="Receita menos custos lançados"
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
                      ? ` · Meta de margem: ${data.settings.targetMarginPct.toFixed(1).replace('.', ',')}%`
                      : ''}
                  </h2>
                  <StatusBadge
                    label={
                      activeDre.marginRealizedPct < activeDre.marginBudgetedPct
                        ? 'Margem abaixo do previsto'
                        : 'Margem dentro do previsto'
                    }
                    tone={activeDre.marginRealizedPct < activeDre.marginBudgetedPct ? 'warn' : 'ok'}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                        <th className="py-2.5 px-3 rounded-l-lg">Linha</th>
                        <th className="py-2.5 px-3 text-right">Orçado</th>
                        <th className="py-2.5 px-3 text-right">Realizado</th>
                        <th className="py-2.5 px-3 rounded-r-lg">Variação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Receita de obra', activeDre.revenueBudgeted, activeDre.revenueRealized],
                        ['(−) Mão de obra', activeDre.laborBudgeted, activeDre.laborRealized],
                        ['(−) Subempreitadas', activeDre.subcontractBudgeted, activeDre.subcontractRealized],
                        ['(−) Equipamentos e EPI', activeDre.equipmentBudgeted, activeDre.equipmentRealized],
                        ['(−) Tributos', activeDre.taxBudgeted, activeDre.taxRealized],
                        ['(−) BDI e comissões', activeDre.bdiBudgeted, activeDre.bdiRealized],
                      ].map(([label, b, r]) => {
                        const bud = Number(b);
                        const real = Number(r);
                        const diffPct = bud > 0 ? Math.round(((real - bud) / bud) * 100) : 0;
                        const isCost = String(label).startsWith('(−)');
                        const tone =
                          diffPct === 0
                            ? 'neutral'
                            : isCost
                            ? diffPct > 0
                              ? 'bad'
                              : 'ok'
                            : diffPct < 0
                            ? 'bad'
                            : 'ok';
                        return (
                          <tr key={String(label)} className="border-b border-[#E4E1DA] text-[13px]">
                            <td className="py-3 px-3 font-medium text-[#14181F]">{label}</td>
                            <td className="py-3 px-3 text-right tabular-nums">{formatBRL(bud)}</td>
                            <td className="py-3 px-3 text-right tabular-nums">{formatBRL(real)}</td>
                            <td className="py-3 px-3">
                              <StatusBadge
                                label={`${diffPct > 0 ? '+' : ''}${diffPct}%`}
                                tone={tone}
                              />
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="font-bold text-[#14181F] text-[13px]">
                        <td className="py-3 px-3">Margem da obra</td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {formatBRL(activeDre.marginBudgeted)}
                        </td>
                        <td className="py-3 px-3 text-right tabular-nums">
                          {formatBRL(activeDre.marginRealized)}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge
                            label={`${activeDre.marginRealizedPct.toFixed(1)}%`}
                            tone={activeDre.marginRealized >= activeDre.marginBudgeted ? 'ok' : 'warn'}
                          />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {/* Modal: Novo lançamento com validação estrita de Empréstimo != Receita */}
      <Modal open={isTxOpen} onClose={closeTxModal} title="Novo lançamento">
        <form onSubmit={handleSaveTransaction} className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <SegmentedControl
              items={['Receita', 'Despesa', 'Empréstimo']}
              active={txKind === 'income' ? 'Receita' : txKind === 'expense' ? 'Despesa' : 'Empréstimo'}
              onChange={(label) => {
                if (label === 'Receita') {
                  setTxKind('income');
                  setTxCategory('Receita de obra');
                } else if (label === 'Despesa') {
                  setTxKind('expense');
                  setTxCategory('Mão de obra');
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
              <label className="text-[13px] font-semibold text-[#14181F]">Descrição</label>
              <input
                type="text"
                required
                value={txDesc}
                onChange={(e) => setTxDesc(e.target.value)}
                placeholder="Ex.: Parcela 1/18 ou Guia Simples"
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-[#14181F]">Valor (R$)</label>
              <input
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
              <label className="text-[13px] font-semibold text-[#14181F]">Data / Vencimento</label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-[#14181F]">Classificar como</label>
              <select
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
                <span className="text-xs font-medium text-[#B42318]">{loanInIncomeError}</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold text-[#14181F]">Obra ou centro de custo</label>
              <select
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
                <span className="text-xs font-medium text-[#B42318]">{missingCenterError}</span>
              )}
            </div>

            {txKind === 'income' ? (
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-[#14181F]">Nota fiscal</label>
                <select
                  value={txInvoiceStatus}
                  onChange={(e) => setTxInvoiceStatus(e.target.value as InvoiceStatus)}
                  className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm bg-white"
                >
                  <option value="A emitir">A emitir</option>
                  <option value="Emitida">Emitida</option>
                  <option value="Não emitida">Não emitida</option>
                </select>
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label className="text-[13px] font-semibold text-[#14181F]">Forma de pagamento</label>
                <input
                  type="text"
                  value={txPaymentMethod}
                  onChange={(e) => setTxPaymentMethod(e.target.value)}
                  className="rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
                />
              </div>
            )}
          </div>

          <RegisteredBySelect value={txActor} onChange={setTxActor} id="tx-actor" />

          {validationErrorsCount > 0 && (
            <AlertNote tone="warn" title={`${validationErrorsCount} campo(s) precisam de correção`}>
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
              disabled={txSaving || validationErrorsCount > 0}
              className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
            >
              {txSaving ? 'Salvando...' : 'Salvar lançamento'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Nova Dívida */}
      <Modal open={debtModalOpen} onClose={() => setDebtModalOpen(false)} title="Nova dívida ou crédito">
        <form onSubmit={handleSaveDebt} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="flex flex-col gap-1.5">
              <label className="text-[13px] font-semibold">Credor / descrição</label>
              <input
                type="text"
                required
                value={debtCreditor}
                onChange={(e) => setDebtCreditor(e.target.value)}
                placeholder="Ex.: Banco · capital de giro"
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
                <option value="Em atraso">Em atraso</option>
                <option value="A parcelar">A parcelar</option>
              </select>
            </div>
          </div>
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

      {/* Modal: Importar Extrato OFX/CSV */}
      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Importar extrato bancário (OFX ou CSV)"
        maxWidth="max-w-3xl"
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
              Formato CSV esperado: Data;Descrição;Valor (positivo para entrada, negativo para saída) ou arquivo OFX bancário.
            </p>
          </div>

          {importError && (
            <AlertNote tone="bad" title="Atenção na importação">
              {importError}
            </AlertNote>
          )}

          {importRows.length > 0 && (
            <>
              <AlertNote tone="info" title="Empréstimo não vira receita">
                Revise os movimentos detectados abaixo antes de confirmar.
              </AlertNote>
              <div className="overflow-x-auto max-h-64">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-[#5B6472]">
                      <th className="py-2 px-2">Data</th>
                      <th className="py-2 px-2">Descrição</th>
                      <th className="py-2 px-2 text-right">Valor</th>
                      <th className="py-2 px-2">Classificação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importRows.map((row, idx) => (
                      <tr key={row.id} className="border-b border-[#E4E1DA]">
                        <td className="py-2 px-2 tabular-nums">{formatDateBR(row.date)}</td>
                        <td className="py-2 px-2">{row.description}</td>
                        <td className="py-2 px-2 text-right font-semibold tabular-nums">
                          {formatBRL(row.amount)}
                        </td>
                        <td className="py-2 px-2">
                          <select
                            value={row.entryKind}
                            onChange={(e) => {
                              const k = e.target.value as TransactionKind;
                              setImportRows((prev) =>
                                prev.map((r, i) =>
                                  i === idx
                                    ? {
                                        ...r,
                                        entryKind: k,
                                        category: k === 'loan' ? 'Empréstimo' : k === 'income' ? 'Receita de obra' : 'Outros',
                                      }
                                    : r
                                )
                              );
                            }}
                            className="border border-[#E4E1DA] rounded px-2 py-1 bg-white"
                          >
                            <option value="income">Receita</option>
                            <option value="expense">Despesa</option>
                            <option value="loan">Empréstimo (dívida)</option>
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <RegisteredBySelect value={importActor} onChange={setImportActor} id="import-actor" />
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
              disabled={importRows.length === 0 || importSaving}
              onClick={handleConfirmImport}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold disabled:opacity-45 cursor-pointer"
            >
              {importSaving ? 'Importando...' : `Confirmar importação (${importRows.length})`}
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
                await markInstallmentReceived(uid, receivingActor, receivingInstallment);
                setReceivingInstallment(null);
              } catch (err) {
                setReceivingError(
                  err instanceof Error ? err.message : 'Erro ao registrar recebimento da parcela.'
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
    </div>
  );
}
