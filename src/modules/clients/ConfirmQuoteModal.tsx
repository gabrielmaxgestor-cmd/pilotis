import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Note,
  RegisteredBySelect,
  Select,
  StatusBadge,
} from '../../components/ui/PilotisUI';
import {
  gerarParcelas,
  validarDadosConfirmacaoOrcamento,
} from '../../domain/orcamentos';
import {
  confirmQuoteAndGenerateProject,
  type ConfirmQuoteResult,
} from '../../services/pilotisService';
import type {
  ActorRole,
  Client,
  ProjectContractKind,
  Quote,
} from '../../types/pilotis';
import { formatBRL, formatDateBR, todayISO } from '../../utils/formatters';

export function ConfirmQuoteModal({
  open,
  onClose,
  quote,
  clients,
  uid,
  onConfirmed,
}: {
  open: boolean;
  onClose: () => void;
  quote: Quote | null;
  clients: Client[];
  uid: string;
  onConfirmed: (quoteId: string, result: ConfirmQuoteResult) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [contractKind, setContractKind] = useState<ProjectContractKind>('Principal');
  const [totalValueStr, setTotalValueStr] = useState('');
  const [downPctStr, setDownPctStr] = useState('20');
  const [installmentsStr, setInstallmentsStr] = useState('18');
  const [startDate, setStartDate] = useState(todayISO());
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !quote) return;
    setClientId(quote.clientId || '');
    setContractKind(quote.type === 'Obra satélite' ? 'Satélite' : 'Principal');
    setTotalValueStr(String(quote.totalValue || 0));
    setDownPctStr(String(quote.downPaymentPct ?? 20));
    setInstallmentsStr(String(quote.installmentsCount || 18));
    setStartDate(todayISO());
    setActor('Sócio');
    setSubmitError(null);
  }, [open, quote]);

  const numericTotal = quote?.status === 'Ganho'
    ? quote.totalValue
    : Number(totalValueStr.replace(',', '.'));
  const numericDownPct = Number(downPctStr.replace(',', '.'));
  const numericInstallments = Number(installmentsStr);

  const validation = useMemo(() => {
    if (!quote) return { valido: false, erros: ['Selecione um orçamento.'], dataInicioISO: null };
    return validarDadosConfirmacaoOrcamento({
      clienteId: clientId,
      valorTotal: numericTotal,
      entradaPct: numericDownPct,
      nParcelas: numericInstallments,
      dataInicio: startDate,
      status: quote.status,
      projectId: quote.projectId,
    });
  }, [quote, clientId, numericTotal, numericDownPct, numericInstallments, startDate]);

  const previewParcelas = useMemo(() => {
    if (!validation.valido || !validation.dataInicioISO) return [];
    try {
      return gerarParcelas(
        numericTotal,
        numericDownPct,
        numericInstallments,
        validation.dataInicioISO
      );
    } catch {
      return [];
    }
  }, [validation, numericTotal, numericDownPct, numericInstallments]);

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;

    if (!validation.valido) {
      setSubmitError(validation.erros.join(' '));
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await confirmQuoteAndGenerateProject({
        uid,
        actor,
        quoteId: quote.id,
        clientId,
        totalValue: numericTotal,
        downPaymentPct: numericDownPct,
        installmentsCount: numericInstallments,
        startDate: validation.dataInicioISO || startDate,
        contractKind,
      });
      onConfirmed(quote.id, result);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Não foi possível confirmar o orçamento. Nenhum dado foi gravado.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  const downItem = previewParcelas.find((p) => p.numero === 0) || null;
  const monthlyItems = previewParcelas.filter((p) => p.numero > 0);
  const firstMonthly = monthlyItems[0]?.valor ?? 0;
  const lastMonthly = monthlyItems[monthlyItems.length - 1]?.valor ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={quote ? `Confirmar orçamento · ${quote.code}` : 'Confirmar orçamento'}
      subtitle="Transação atômica: cria a obra, gera parcelas em /parcelas, contrato em PDF, checklist e envia ao Planejamento"
      maxWidth="max-w-3xl"
    >
      {!quote ? null : (
        <form onSubmit={handleConfirm} className="flex flex-col gap-4">
          {submitError && (
            <Note variant="danger" title="Confirmação não concluída — nada foi gravado">
              {submitError}
            </Note>
          )}

          {quote.status === 'Ganho' && !quote.projectId && (
            <Note variant="warning" title="Orçamento aprovado com valor congelado">
              O valor fechado de {formatBRL(quote.totalValue)} está congelado e não pode ser alterado nesta confirmação.
            </Note>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select
              label="Cliente"
              required
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">Selecione o cliente</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.status})
                </option>
              ))}
            </Select>

            <Select
              label="Tipo de Obra / Contrato"
              required
              value={contractKind}
              onChange={(e) => setContractKind(e.target.value as ProjectContractKind)}
              help="Obra principal de construção/reforma ou obra satélite vinculada."
            >
              <option value="Principal">Obra Principal</option>
              <option value="Satélite">Obra Satélite</option>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5">
            <Input
              label="Valor fechado (R$)"
              type="number"
              min={0.01}
              step="0.01"
              required
              disabled={quote.status === 'Ganho'}
              value={quote.status === 'Ganho' ? String(quote.totalValue) : totalValueStr}
              onChange={(e) => setTotalValueStr(e.target.value)}
              className="tabular-nums"
            />
            <Input
              label="Entrada (%)"
              type="number"
              min={0}
              max={100}
              step="0.5"
              required
              value={downPctStr}
              onChange={(e) => setDownPctStr(e.target.value)}
              className="tabular-nums"
            />
            <Input
              label="Parcelas (1 a 36)"
              type="number"
              min={1}
              max={36}
              step={1}
              required
              value={installmentsStr}
              onChange={(e) => setInstallmentsStr(e.target.value)}
              className="tabular-nums"
            />
            <Input
              label="Data de início"
              type="date"
              required
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          {previewParcelas.length > 0 && (
            <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-xs font-bold text-[#14181F]">
                  Prévia das parcelas a gravar em /parcelas ({previewParcelas.length} lançamento(s))
                </strong>
                <StatusBadge label={`Obra ${contractKind} · Contratada`} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="bg-white border border-[#E4E1DA] rounded-[8px] px-3 py-2">
                  <span className="block text-[#5B6472]">Entrada ({numericDownPct}%)</span>
                  <strong className="text-sm text-[#14181F] tabular-nums">
                    {downItem ? `${formatBRL(downItem.valor)} · ${downItem.vencimentoBR}` : 'Sem entrada'}
                  </strong>
                </div>
                <div className="bg-white border border-[#E4E1DA] rounded-[8px] px-3 py-2">
                  <span className="block text-[#5B6472]">Parcelas ({monthlyItems.length}x)</span>
                  <strong className="text-sm text-[#14181F] tabular-nums">
                    {formatBRL(firstMonthly)}
                    {lastMonthly !== firstMonthly ? ` (última ${formatBRL(lastMonthly)})` : ''}
                  </strong>
                </div>
                <div className="bg-white border border-[#E4E1DA] rounded-[8px] px-3 py-2">
                  <span className="block text-[#5B6472]">1ª e última parcela</span>
                  <strong className="text-sm text-[#14181F] tabular-nums">
                    {monthlyItems[0]?.vencimentoBR || '—'} →{' '}
                    {monthlyItems[monthlyItems.length - 1]?.vencimentoBR || '—'}
                  </strong>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-1.5 text-xs text-[#5B6472]">
            <strong className="text-xs font-bold text-[#14181F] mb-0.5">
              Ao confirmar, em uma única transação atômica, o sistema:
            </strong>
            <span>1. Cria a Obra/Contrato ({contractKind}) com status “Contratada” e congela o orçamento como “Ganho”;</span>
            <span>2. Gera {previewParcelas.length || numericInstallments} parcela(s) (entrada + saldo) em /parcelas e no Financeiro, iniciando em {startDate ? formatDateBR(startDate) : '—'};</span>
            <span>3. Gera o contrato em PDF e abre o checklist obrigatório (Contrato assinado, ART/RRT, Matrícula CNO e RT);</span>
            <span>4. Envia a obra ao Planejamento como “Aguardando modelo de cronograma”;</span>
            <span>5. Grava o registro completo na trilha de auditoria. Se qualquer passo falhar, nada é gravado.</span>
          </div>

          <RegisteredBySelect
            value={actor}
            onChange={setActor}
            id="confirm-quote-actor"
          />

          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !validation.valido}
            >
              {submitting ? 'Confirmando transação...' : 'Confirmar orçamento'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
