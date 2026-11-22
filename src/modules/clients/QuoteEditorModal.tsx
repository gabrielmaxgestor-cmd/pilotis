import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Input,
  Modal,
  Note,
  RegisteredBySelect,
  Select,
  StatusBadge,
  Textarea,
} from '../../components/ui/PilotisUI';
import {
  avaliarMargemContraMeta,
  composicaoOrcamento,
  simularPagamentoOrcamento,
} from '../../domain/orcamentos';
import { createRecord, updateRecord } from '../../services/pilotisService';
import type {
  ActorRole,
  Client,
  CompanySettings,
  Employee,
  ProjectType,
  Quote,
  QuoteStatus,
} from '../../types/pilotis';
import { computeTeamPayrollSummary } from '../../utils/calculations';
import { clampStr, formatBRL, formatDateBR, todayISO } from '../../utils/formatters';
import {
  incrementQuoteVersion,
  parseVersionHistory,
  serializeVersionEntry,
} from './quoteHelpers';

const QUOTE_ORIGINS = [
  'Indicação',
  'Arquiteto parceiro',
  'Instagram',
  'Google',
  'Licitação',
  'Outro',
];

export function QuoteEditorModal({
  open,
  onClose,
  uid,
  editingQuote,
  preselectedClientId,
  clients,
  quotesCount,
  employees,
  settings,
  onSaved,
  onRequestNewClient,
}: {
  open: boolean;
  onClose: () => void;
  uid: string;
  editingQuote: Quote | null;
  preselectedClientId?: string;
  clients: Client[];
  quotesCount: number;
  employees: Employee[];
  settings: CompanySettings | null;
  onSaved: (quoteId: string) => void;
  onRequestNewClient: () => void;
}) {
  const isApprovedLocked = editingQuote?.status === 'Ganho';

  const [clientId, setClientId] = useState('');
  const [origin, setOrigin] = useState('Indicação');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ProjectType>('Casa residencial');
  const [city, setCity] = useState('Valença · RJ');
  const [areaM2, setAreaM2] = useState('240');
  const [estimatedMonths, setEstimatedMonths] = useState('18');
  const [validityDays, setValidityDays] = useState('30');
  const [description, setDescription] = useState('');
  const [laborCost, setLaborCost] = useState('');
  const [subcontractCost, setSubcontractCost] = useState('');
  const [equipmentCost, setEquipmentCost] = useState('');
  const [bdiCost, setBdiCost] = useState('');
  const [taxCost, setTaxCost] = useState('');
  const [totalValue, setTotalValue] = useState('');
  const [downPaymentPct, setDownPaymentPct] = useState('20');
  const [installmentsCount, setInstallmentsCount] = useState('18');
  const [probabilityPct, setProbabilityPct] = useState('60');
  const [status, setStatus] = useState<QuoteStatus>('Em negociação');
  const [lossReason, setLossReason] = useState('');
  const [createNewVersion, setCreateNewVersion] = useState(false);
  const [versionNote, setVersionNote] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editingQuote) {
      setClientId(editingQuote.clientId);
      setOrigin(editingQuote.origin || 'Indicação');
      setTitle(editingQuote.title);
      setType(editingQuote.type);
      setCity(editingQuote.city || settings?.city || 'Valença · RJ');
      setAreaM2(String(editingQuote.areaM2 || 0));
      setEstimatedMonths(String(editingQuote.estimatedMonths || 18));
      setValidityDays(String(editingQuote.validityDays || 30));
      setDescription(editingQuote.description || '');
      setLaborCost(String(editingQuote.laborCost || 0));
      setSubcontractCost(String(editingQuote.subcontractCost || 0));
      setEquipmentCost(String(editingQuote.equipmentCost || 0));
      setBdiCost(String(editingQuote.bdiCost || 0));
      setTaxCost(String(editingQuote.taxCost || 0));
      setTotalValue(String(editingQuote.totalValue || 0));
      setDownPaymentPct(String(editingQuote.downPaymentPct ?? 20));
      setInstallmentsCount(String(editingQuote.installmentsCount ?? 18));
      setProbabilityPct(String(editingQuote.probabilityPct ?? 50));
      setStatus(editingQuote.status === 'Descartado' ? 'Em negociação' : editingQuote.status);
      setLossReason(editingQuote.lossReason || '');
      setCreateNewVersion(false);
      setVersionNote('');
      setActor('Sócio');
      return;
    }

    const initialClient =
      clients.find((c) => c.id === preselectedClientId) || clients[0] || null;
    setClientId(preselectedClientId || '');
    setOrigin(initialClient?.origin || 'Indicação');
    setTitle('');
    setType('Casa residencial');
    setCity(initialClient?.city || settings?.city || 'Valença · RJ');
    setAreaM2('240');
    setEstimatedMonths('18');
    setValidityDays('30');
    setDescription('');
    setLaborCost('');
    setSubcontractCost('');
    setEquipmentCost('');
    setBdiCost('');
    setTaxCost('');
    setTotalValue('');
    setDownPaymentPct('20');
    setInstallmentsCount('18');
    setProbabilityPct('60');
    setStatus('Em negociação');
    setLossReason('');
    setCreateNewVersion(false);
    setVersionNote('');
    setActor('Sócio');
  }, [open, editingQuote, preselectedClientId, clients, settings?.city]);

  // Keep origin & city synced when selecting client during creation
  function handleClientChange(nextClientId: string) {
    setClientId(nextClientId);
    const selected = clients.find((c) => c.id === nextClientId);
    if (selected && !editingQuote) {
      setOrigin(selected.origin || 'Indicação');
      if (selected.city) setCity(selected.city);
    }
  }

  const totalNum = Math.max(0, Number(totalValue) || 0);
  const comp = useMemo(
    () =>
      composicaoOrcamento({
        maoDeObra: Number(laborCost) || 0,
        empreita: Number(subcontractCost) || 0,
        equipamentos: Number(equipmentCost) || 0,
        bdi: Number(bdiCost) || 0,
        impostos: Number(taxCost) || 0,
        valorTotal: totalNum,
      }),
    [laborCost, subcontractCost, equipmentCost, bdiCost, taxCost, totalNum]
  );

  const marginCheck = useMemo(
    () => avaliarMargemContraMeta(comp.margemPct, settings?.targetMarginPct),
    [comp.margemPct, settings?.targetMarginPct]
  );

  const payrollMonthly = useMemo(
    () => computeTeamPayrollSummary(employees, settings).totalMonthlyCost,
    [employees, settings]
  );

  const downPctNum = Math.min(100, Math.max(0, Number(downPaymentPct) || 0));
  const installmentsNum = Math.min(36, Math.max(1, Math.round(Number(installmentsCount) || 13)));

  const paymentSim = useMemo(() => {
    try {
      return simularPagamentoOrcamento({
        valorTotal: totalNum,
        entradaPct: downPctNum,
        nParcelas: installmentsNum,
        dataInicio: todayISO(),
        folhaMensalEstimada: payrollMonthly,
      });
    } catch {
      return null;
    }
  }, [totalNum, downPctNum, installmentsNum, payrollMonthly]);

  const parsedHistory = useMemo(
    () => parseVersionHistory(editingQuote?.versionHistory),
    [editingQuote?.versionHistory]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setError('Selecione ou cadastre um cliente antes de salvar o orçamento.');
      return;
    }
    if (!title.trim()) {
      setError('Informe o nome ou título da obra.');
      return;
    }
    if (totalNum <= 0) {
      setError('Informe um valor total fechado maior que zero.');
      return;
    }
    if (status === 'Perdido' && !lossReason.trim()) {
      setError('Informe o motivo da perda para fechar este orçamento como Perdido.');
      return;
    }
    if (editingQuote && !isApprovedLocked && createNewVersion && !versionNote.trim()) {
      setError('Descreva o que mudou nesta nova versão do orçamento.');
      return;
    }

    const client = clients.find((c) => c.id === clientId);
    if (!client) {
      setError('Cliente não encontrado.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (!editingQuote) {
        const code = `Orç. ${String(quotesCount + 1).padStart(2, '0')}`;
        const initialVersion = 'v1.0';
        const initialHistoryEntry = serializeVersionEntry({
          version: initialVersion,
          dateISO: todayISO(),
          totalValue: totalNum,
          totalCost: comp.custoTotal,
          marginPct: comp.margemPct,
          registeredBy: actor,
          note: status === 'Rascunho' ? 'Rascunho inicial' : 'Versão inicial',
        });

        const id = await createRecord(
          'quotes',
          uid,
          actor,
          {
            code,
            clientId: client.id,
            clientName: clampStr(client.name, 140),
            title: clampStr(title, 160),
            type,
            city: clampStr(city, 80),
            areaM2: Math.max(0, Number(areaM2) || 0),
            estimatedMonths: Math.max(1, Number(estimatedMonths) || 12),
            validityDays: Math.max(1, Number(validityDays) || 30),
            description: clampStr(description, 1500),
            origin: clampStr(origin || client.origin, 80),
            laborCost: Math.max(0, Number(laborCost) || 0),
            subcontractCost: Math.max(0, Number(subcontractCost) || 0),
            equipmentCost: Math.max(0, Number(equipmentCost) || 0),
            bdiCost: Math.max(0, Number(bdiCost) || 0),
            taxCost: Math.max(0, Number(taxCost) || 0),
            totalValue: totalNum,
            downPaymentPct: downPctNum,
            installmentsCount: installmentsNum,
            probabilityPct: status === 'Perdido' ? 0 : Math.min(100, Math.max(0, Number(probabilityPct) || 0)),
            status,
            discardReason: '',
            lossReason: status === 'Perdido' ? clampStr(lossReason, 300) : '',
            version: initialVersion,
            versionHistory: [initialHistoryEntry],
            contractSignStatus: status === 'Ganho' ? 'Aguardando assinatura' : 'Não gerado',
            contractSignedAt: '',
            contractAddenda: [],
            addendaTotalValue: 0,
            projectId: '',
          },
          `Orçamento ${code} (${initialVersion}) · ${title} · ${formatBRL(totalNum)}`
        );
        onSaved(id);
        onClose();
        return;
      }

      if (isApprovedLocked) {
        // Only non-financial metadata / payment schedule preview note can be updated when locked;
        // approved totalValue and cost composition stay frozen by rule & UI.
        await updateRecord(
          'quotes',
          editingQuote.id,
          uid,
          actor,
          {
            description: clampStr(description, 1500),
            city: clampStr(city, 80),
            areaM2: Math.max(0, Number(areaM2) || 0),
            estimatedMonths: Math.max(1, Number(estimatedMonths) || 12),
          },
          `Dados complementares do orçamento aprovado ${editingQuote.code} atualizados`
        );
        onSaved(editingQuote.id);
        onClose();
        return;
      }

      const currentVersion = editingQuote.version || 'v1.0';
      const nextVersion = createNewVersion ? incrementQuoteVersion(currentVersion) : currentVersion;
      const existingHistory = editingQuote.versionHistory ? [...editingQuote.versionHistory] : [];
      if (createNewVersion || existingHistory.length === 0) {
        existingHistory.push(
          serializeVersionEntry({
            version: nextVersion,
            dateISO: todayISO(),
            totalValue: totalNum,
            totalCost: comp.custoTotal,
            marginPct: comp.margemPct,
            registeredBy: actor,
            note: createNewVersion ? versionNote : 'Revisão atualizada',
          })
        );
      }

      await updateRecord(
        'quotes',
        editingQuote.id,
        uid,
        actor,
        {
          clientId: client.id,
          clientName: clampStr(client.name, 140),
          title: clampStr(title, 160),
          type,
          city: clampStr(city, 80),
          areaM2: Math.max(0, Number(areaM2) || 0),
          estimatedMonths: Math.max(1, Number(estimatedMonths) || 12),
          validityDays: Math.max(1, Number(validityDays) || 30),
          description: clampStr(description, 1500),
          origin: clampStr(origin || client.origin, 80),
          laborCost: Math.max(0, Number(laborCost) || 0),
          subcontractCost: Math.max(0, Number(subcontractCost) || 0),
          equipmentCost: Math.max(0, Number(equipmentCost) || 0),
          bdiCost: Math.max(0, Number(bdiCost) || 0),
          taxCost: Math.max(0, Number(taxCost) || 0),
          totalValue: totalNum,
          downPaymentPct: downPctNum,
          installmentsCount: installmentsNum,
          probabilityPct:
            status === 'Perdido'
              ? 0
              : status === 'Ganho'
                ? 100
                : Math.min(100, Math.max(0, Number(probabilityPct) || 0)),
          status,
          lossReason: status === 'Perdido' ? clampStr(lossReason, 300) : '',
          version: nextVersion,
          versionHistory: existingHistory.slice(-30),
          contractSignStatus:
            status === 'Ganho'
              ? editingQuote.contractSignStatus && editingQuote.contractSignStatus !== 'Não gerado'
                ? editingQuote.contractSignStatus
                : 'Aguardando assinatura'
              : editingQuote.contractSignStatus || 'Não gerado',
        },
        `Orçamento ${editingQuote.code} (${nextVersion}) atualizado`
      );
      onSaved(editingQuote.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar orçamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        editingQuote
          ? `${editingQuote.code} · ${editingQuote.version || 'v1.0'} · ${editingQuote.title}`
          : 'Novo orçamento'
      }
      subtitle="Composição de custos, margem contra a meta, versionamento e simulador de pagamento"
      maxWidth="max-w-4xl"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {isApprovedLocked && (
          <Note variant="warning" title="Orçamento aprovado · valor congelado">
            O valor fechado ({formatBRL(editingQuote.totalValue)}) e a composição de custos deste orçamento aprovado ficam congelados. Qualquer alteração de valor só pode ser feita por aditivo contratual.
          </Note>
        )}

        {/* Dados da obra */}
        <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[#14181F]">Dados da obra</h4>
            {editingQuote && <StatusBadge label={editingQuote.status} />}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label htmlFor="quote-client" className="text-[13px] font-semibold text-[#14181F]">
                  Cliente *
                </label>
                {!isApprovedLocked && (
                  <button
                    type="button"
                    onClick={onRequestNewClient}
                    className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                  >
                    + Novo cliente
                  </button>
                )}
              </div>
              <Select
                id="quote-client"
                value={clientId}
                disabled={isApprovedLocked}
                onChange={(e) => handleClientChange(e.target.value)}
                required
              >
                <option value="">Selecione um cliente</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            <Select
              label="Origem do contato"
              value={origin}
              disabled={isApprovedLocked}
              onChange={(e) => setOrigin(e.target.value)}
            >
              {QUOTE_ORIGINS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Nome da obra / orçamento"
              required
              disabled={isApprovedLocked}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Residência Alto da Glória"
            />
            <Input
              label="Localidade"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Valença · RJ"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Select
              label="Tipo de obra"
              value={type}
              disabled={isApprovedLocked}
              onChange={(e) => setType(e.target.value as ProjectType)}
            >
              <option value="Casa residencial">Casa residencial</option>
              <option value="Reforma">Reforma</option>
              <option value="Obra satélite">Obra satélite</option>
            </Select>
            <Input
              label="Área (m²)"
              type="number"
              min={0}
              value={areaM2}
              onChange={(e) => setAreaM2(e.target.value)}
              className="tabular-nums"
            />
            <Input
              label="Prazo (meses)"
              type="number"
              min={1}
              max={48}
              value={estimatedMonths}
              onChange={(e) => setEstimatedMonths(e.target.value)}
              className="tabular-nums"
            />
            <Input
              label="Validade (dias)"
              type="number"
              min={1}
              max={180}
              disabled={isApprovedLocked}
              value={validityDays}
              onChange={(e) => setValidityDays(e.target.value)}
              className="tabular-nums"
            />
            <Select
              label="Status no funil"
              value={status}
              disabled={isApprovedLocked}
              onChange={(e) => setStatus(e.target.value as QuoteStatus)}
            >
              <option value="Rascunho">Rascunho</option>
              <option value="Enviado">Enviado</option>
              <option value="Em negociação">Em negociação</option>
              <option value="Ganho">Ganho (aprovado)</option>
              <option value="Perdido">Perdido</option>
            </Select>
          </div>

          {status === 'Perdido' && (
            <Input
              label="Motivo da perda"
              required
              value={lossReason}
              onChange={(e) => setLossReason(e.target.value)}
              placeholder="Ex.: Preço acima do orçamento do cliente, prazo, concorrência"
            />
          )}

          <Textarea
            label="Descrição da obra / escopo"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descreva padrão construtivo, número de pavimentos e observações técnicas."
          />
        </div>

        {/* Composição de custos + Margem */}
        <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[#14181F]">Composição de custos e valor fechado</h4>
            <span className="text-xs font-medium text-[#5B6472]">
              Custo total calculado: <strong className="text-[#14181F] tabular-nums">{formatBRL(comp.custoTotal)}</strong>
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            <Input
              label="Mão de obra (R$)"
              type="number"
              min={0}
              step="0.01"
              disabled={isApprovedLocked}
              value={laborCost}
              onChange={(e) => setLaborCost(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
            <Input
              label="Subempreitadas (R$)"
              type="number"
              min={0}
              step="0.01"
              disabled={isApprovedLocked}
              value={subcontractCost}
              onChange={(e) => setSubcontractCost(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
            <Input
              label="Equipamentos (R$)"
              type="number"
              min={0}
              step="0.01"
              disabled={isApprovedLocked}
              value={equipmentCost}
              onChange={(e) => setEquipmentCost(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
            <Input
              label="BDI (R$)"
              type="number"
              min={0}
              step="0.01"
              disabled={isApprovedLocked}
              value={bdiCost}
              onChange={(e) => setBdiCost(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
            <Input
              label="Impostos (R$)"
              type="number"
              min={0}
              step="0.01"
              disabled={isApprovedLocked}
              value={taxCost}
              onChange={(e) => setTaxCost(e.target.value)}
              placeholder="0"
              className="tabular-nums"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <Input
              label="Valor total fechado (R$)"
              type="number"
              min={1}
              step="0.01"
              required
              disabled={isApprovedLocked}
              value={totalValue}
              onChange={(e) => setTotalValue(e.target.value)}
              className="font-semibold tabular-nums"
            />
            <Input
              label="Probabilidade de fechamento (%)"
              type="number"
              min={0}
              max={100}
              disabled={isApprovedLocked || status === 'Perdido' || status === 'Ganho'}
              value={status === 'Perdido' ? '0' : status === 'Ganho' ? '100' : probabilityPct}
              onChange={(e) => setProbabilityPct(e.target.value)}
              className="tabular-nums"
            />
            <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-[8px] px-3.5 py-2.5 flex flex-col justify-center min-h-[42px]">
              <span className="text-[11px] text-[#5B6472]">Margem prevista calculada</span>
              <strong
                className={`text-sm tabular-nums ${
                  comp.margemReais < 0 ? 'text-[#B42318]' : 'text-[#14181F]'
                }`}
              >
                {formatBRL(comp.margemReais)} ({comp.margemPct.toFixed(1).replace('.', ',')}%)
              </strong>
            </div>
          </div>

          <Note variant="soft" title="Materiais comprados pelo cliente">
            Os materiais da obra são comprados diretamente pelo cliente, fora do valor fechado deste orçamento.
          </Note>

          {totalNum > 0 && (
            <Note
              variant={
                marginCheck.status === 'acima'
                  ? 'success'
                  : marginCheck.status === 'abaixo'
                    ? 'warning'
                    : 'info'
              }
              title={
                marginCheck.status === 'acima'
                  ? `Margem acima da meta (${marginCheck.metaPct?.toFixed(1).replace('.', ',')}% configurada)`
                  : marginCheck.status === 'abaixo'
                    ? `Margem abaixo da meta (${marginCheck.metaPct?.toFixed(1).replace('.', ',')}% configurada)`
                    : 'Meta de margem não configurada'
              }
            >
              {marginCheck.metaConfigurada
                ? `Diferença em relação à meta da empresa: ${
                    (marginCheck.diferencaPct ?? 0) >= 0 ? '+' : ''
                  }${(marginCheck.diferencaPct ?? 0).toFixed(1).replace('.', ',')} p.p. · Valor aprovado só muda por aditivo.`
                : 'Configure a meta de margem em Configurações › Encargos e metas para comparar automaticamente.'}
            </Note>
          )}
        </div>

        {/* Simulador de pagamento */}
        <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-bold text-[#14181F]">Simulador de pagamento e efeito no caixa</h4>
            <div className="flex items-center gap-1.5">
              {[10, 20, 30].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  disabled={isApprovedLocked}
                  onClick={() => setDownPaymentPct(String(pct))}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border cursor-pointer disabled:opacity-45 ${
                    downPctNum === pct
                      ? 'bg-[#1F3A5F] text-white border-[#1F3A5F]'
                      : 'bg-[#F6F5F2] text-[#5B6472] border-[#E4E1DA]'
                  }`}
                >
                  {pct}% entrada
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Entrada (%)"
              type="number"
              min={0}
              max={100}
              disabled={isApprovedLocked}
              value={downPaymentPct}
              onChange={(e) => setDownPaymentPct(e.target.value)}
              className="tabular-nums"
            />
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[13px] font-semibold text-[#14181F]">
                <label htmlFor="sim-installments">Parcelas (13–24x padrão)</label>
                <span className="tabular-nums text-[#1F3A5F]">{installmentsNum}x</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="sim-installments"
                  type="range"
                  min={1}
                  max={36}
                  disabled={isApprovedLocked}
                  value={installmentsNum}
                  onChange={(e) => setInstallmentsCount(e.target.value)}
                  className="flex-1 accent-[#1F3A5F]"
                />
                <input
                  type="number"
                  min={1}
                  max={36}
                  disabled={isApprovedLocked}
                  value={installmentsNum}
                  onChange={(e) => setInstallmentsCount(e.target.value)}
                  aria-label="Número de parcelas"
                  className="w-20 rounded-[8px] border border-[#E4E1DA] px-2.5 py-2 text-sm tabular-nums text-right"
                />
              </div>
            </div>
          </div>

          {paymentSim && totalNum > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#F6F5F2] rounded-[10px] p-3 text-[13px]">
                <div>
                  <span className="block text-xs text-[#5B6472]">Valor da entrada ({downPctNum}%)</span>
                  <strong className="tabular-nums text-[#14181F]">{formatBRL(paymentSim.valorEntrada)}</strong>
                </div>
                <div>
                  <span className="block text-xs text-[#5B6472]">
                    Parcela mensal ({installmentsNum}x)
                  </span>
                  <strong className="tabular-nums text-[#14181F]">
                    {formatBRL(paymentSim.primeiraParcela)}
                  </strong>
                  {paymentSim.ultimaParcela !== paymentSim.primeiraParcela && (
                    <span className="block text-[11px] text-[#5B6472] tabular-nums">
                      Última parcela: {formatBRL(paymentSim.ultimaParcela)} (ajuste de centavos)
                    </span>
                  )}
                </div>
                <div>
                  <span className="block text-xs text-[#5B6472]">Saldo parcelado</span>
                  <strong className="tabular-nums text-[#14181F]">
                    {formatBRL(paymentSim.saldoParcelado)}
                  </strong>
                </div>
              </div>

              <Note
                variant={
                  paymentSim.efeitoCaixa === 'atencao'
                    ? 'warning'
                    : paymentSim.efeitoCaixa === 'positivo'
                      ? 'success'
                      : 'info'
                }
                title="Efeito no caixa"
              >
                {paymentSim.mensagemCaixa}
              </Note>
            </>
          )}
        </div>

        {/* Versionamento */}
        {editingQuote && (
          <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-[#14181F]">
                Versionamento ({editingQuote.version || 'v1.0'})
              </h4>
              {!isApprovedLocked && (
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-[#1F3A5F] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={createNewVersion}
                    onChange={(e) => setCreateNewVersion(e.target.checked)}
                    className="rounded border-[#E4E1DA]"
                  />
                  Gerar nova versão ({incrementQuoteVersion(editingQuote.version)})
                </label>
              )}
            </div>

            {createNewVersion && !isApprovedLocked && (
              <Input
                label="Motivo ou resumo da nova versão"
                required
                value={versionNote}
                onChange={(e) => setVersionNote(e.target.value)}
                placeholder="Ex.: Ajuste de BDI e redução do parcelamento para 15x"
              />
            )}

            {parsedHistory.length > 0 ? (
              <div className="flex flex-col gap-1.5 text-xs">
                {parsedHistory.map((v, idx) => (
                  <div
                    key={`${v.version}-${idx}`}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F0EEE9] pb-1.5"
                  >
                    <span className="text-[#14181F] font-medium">
                      <strong>{v.version}</strong> · {v.dateISO ? formatDateBR(v.dateISO) : '—'} ·{' '}
                      {v.note}
                    </span>
                    <span className="text-[#5B6472] tabular-nums">
                      {formatBRL(v.totalValue)} · margem {v.marginPct.toFixed(1).replace('.', ',')}% ·{' '}
                      {v.registeredBy}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#5B6472]">Versão inicial registrada.</p>
            )}
          </div>
        )}

        <RegisteredBySelect value={actor} onChange={setActor} id="quote-editor-actor" />

        {error && (
          <Note variant="danger" title="Verifique os dados">
            {error}
          </Note>
        )}

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 pt-1">
          <Button variant="secondary" onClick={onClose}>
            {isApprovedLocked ? 'Fechar' : 'Cancelar'}
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving
              ? 'Salvando...'
              : isApprovedLocked
                ? 'Salvar dados complementares'
                : editingQuote
                  ? createNewVersion
                    ? `Salvar versão ${incrementQuoteVersion(editingQuote.version)}`
                    : 'Salvar alterações'
                  : 'Salvar orçamento'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
