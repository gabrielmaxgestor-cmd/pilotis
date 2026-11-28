import { ComplianceAttachmentsDialog } from '../../components/ui/ComplianceAttachmentsDialog';
import { PurchasingScheduleButton } from '../../components/ui/PurchasingScheduleButton';
import { getProjectSchedule, planningTodayISO } from '../../domain/pilotisAdapters';
import { useEffect, useMemo, useState } from 'react';
import { CompanyPdfHeader } from '../../components/ui/CompanyPdfHeader';
import {
  Button,
  Input,
  Modal,
  Note,
  RegisteredBySelect,
  Select,
  StatusBadge,
} from '../../components/ui/PilotisUI';
import { simularPagamentoOrcamento } from '../../domain/orcamentos';
import { saveContractSignature, updateRecord } from '../../services/pilotisService';
import type {
  ActorRole,
  CompanySettings,
  ComplianceItem,
  ContractSignStatus,
  CustomerMaterial,
  ProjectStage,
  Project,
  Quote,
} from '../../types/pilotis';
import {
  clampStr,
  formatBRL,
  formatDateBR as domainFormatDateBR,
  todayISO,
} from '../../domain';
import { parseContractAddenda, serializeAddendumEntry } from './quoteHelpers';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

const SIGN_STATUS_OPTIONS: ContractSignStatus[] = [
  'Não gerado',
  'Aguardando assinatura',
  'Assinado pelo cliente',
  'Assinado pelas partes',
];

export function ContractModal({
  open,
  onClose,
  quote,
  wonQuotes,
  onSelectQuoteId,
  settings,
  uid,
  projects = [],
  complianceItems = [],
  customerMaterials = [],
  stages = [],
  installmentsCountByProject,
  onNavigateToPlanning,
  onNavigateToReceivables,
}: {
  open: boolean;
  onClose: () => void;
  quote: Quote | null;
  wonQuotes: Quote[];
  onSelectQuoteId: (quoteId: string) => void;
  settings: CompanySettings | null;
  uid: string;
  projects?: Project[];
  complianceItems?: ComplianceItem[];
  customerMaterials?: CustomerMaterial[];
  stages?: ProjectStage[];
  installmentsCountByProject?: Map<string, number>;
  onNavigateToPlanning?: (projectId: string) => void;
  onNavigateToReceivables?: () => void;
}) {
  const [signStatus, setSignStatus] = useState<ContractSignStatus>('Aguardando assinatura');
  const [signedAt, setSignedAt] = useState('');
  const [signActor, setSignActor] = useState<ActorRole>('Sócio');
  const [savingSign, setSavingSign] = useState(false);
  const [togglingDocId, setTogglingDocId] = useState<string | null>(null);
  const [attachmentItem, setAttachmentItem] = useState<ComplianceItem | null>(null);

  // Addendum form
  const [addendumModalOpen, setAddendumModalOpen] = useState(false);
  const [addendumDesc, setAddendumDesc] = useState('');
  const [addendumAmount, setAddendumAmount] = useState('');
  const [addendumActor, setAddendumActor] = useState<ActorRole>('Sócio');
  const [savingAddendum, setSavingAddendum] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!quote) return;
    setSignStatus(quote.contractSignStatus || 'Aguardando assinatura');
    setSignedAt(quote.contractSignedAt || '');
    setFeedback(null);
  }, [quote]);

  const parsedAddenda = useMemo(
    () => parseContractAddenda(quote?.contractAddenda),
    [quote?.contractAddenda]
  );

  const addendaTotal =
    quote?.addendaTotalValue ??
    parsedAddenda.reduce((sum, item) => sum + item.amountDelta, 0);
  const currentContractTotal = (quote?.totalValue || 0) + addendaTotal;

  const paymentPreview = useMemo(() => {
    if (!quote || quote.totalValue <= 0 || quote.downPaymentPct == null || quote.installmentsCount == null) {
      return null;
    }
    try {
      return simularPagamentoOrcamento({
        valorTotal: quote.totalValue,
        entradaPct: quote.downPaymentPct,
        nParcelas: quote.installmentsCount,
        dataInicio: todayISO(),
      });
    } catch {
      return null;
    }
  }, [quote]);

  const linkedProject = useMemo(() => {
    if (!quote) return null;
    return (
      projects.find((p) => p.id === quote.projectId || p.quoteId === quote.id) || null
    );
  }, [quote, projects]);

  const purchaseRows = open && linkedProject && customerMaterials.some((item) => item.projectId === linkedProject.id)
    ? getProjectSchedule(linkedProject, stages.filter((stage) => stage.projectId === linkedProject.id),
      planningTodayISO(), customerMaterials).materials.rows : [];
  const projectChecklist = useMemo(() => {
    if (!linkedProject) return [];
    return complianceItems.filter(
      (item) => item.kind === 'Documento de obra' && item.projectId === linkedProject.id
    );
  }, [linkedProject, complianceItems]);

  const checklistDoneCount = projectChecklist.filter(
    (d) => d.status === 'Anexado' || d.status === 'Em dia' || d.status === 'Válida'
  ).length;

  async function handleToggleChecklistDoc(item: ComplianceItem) {
    setTogglingDocId(item.id);
    setFeedback(null);
    try {
      const nextStatus = item.status === 'Anexado' ? 'Pendente' : 'Anexado';
      await updateRecord(
        'complianceItems',
        item.id,
        uid,
        signActor,
        {
          status: nextStatus,
          issuedDate: nextStatus === 'Anexado' ? todayISO() : item.issuedDate || '',
        },
        `Checklist da obra ${linkedProject?.name || ''}: ${item.title} (${nextStatus})`,
        item.status,
        nextStatus
      );
      setFeedback(`Documento "${item.title}" marcado como ${nextStatus}.`);
    } finally {
      setTogglingDocId(null);
    }
  }

  async function handleSaveSignStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!quote) return;
    setSavingSign(true);
    setFeedback(null);
    try {
      const isSigned =
        signStatus === 'Assinado pelo cliente' || signStatus === 'Assinado pelas partes';
      await saveContractSignature(uid, signActor, quote.id, signStatus, isSigned ? signedAt || todayISO() : '');
      setFeedback(`Status de assinatura salvo: ${signStatus}.`);
    } finally {
      setSavingSign(false);
    }
  }

  async function handleSaveAddendum(e: React.FormEvent) {
    e.preventDefault();
    if (!quote || !addendumDesc.trim()) return;
    const delta = Number(addendumAmount);
    if (!Number.isFinite(delta) || delta === 0) return;
    if (currentContractTotal + delta < 0) {
      setFeedback('O valor contratual após o aditivo deve ser maior ou igual a zero.');
      return;
    }

    setSavingAddendum(true);
    setFeedback(null);
    try {
      const nextList = [
        ...(quote.contractAddenda || []),
        serializeAddendumEntry({
          index: (quote.contractAddenda?.length || 0) + 1,
          dateISO: todayISO(),
          amountDelta: delta,
          registeredBy: addendumActor,
          description: clampStr(addendumDesc, 180),
        }),
      ].slice(-30);
      const nextAddendaTotal = Number((addendaTotal + delta).toFixed(2));

      await updateRecord(
        'quotes',
        quote.id,
        uid,
        addendumActor,
        {
          contractAddenda: nextList,
          addendaTotalValue: nextAddendaTotal,
        },
        `Aditivo registrado em ${quote.code}: ${formatBRL(delta)} (${clampStr(addendumDesc, 80)})`
      );
      setAddendumDesc('');
      setAddendumAmount('');
      setAddendumModalOpen(false);
      setFeedback('Aditivo registrado com sucesso na auditoria e no contrato.');
    } finally {
      setSavingAddendum(false);
    }
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={quote ? `Contrato · ${quote.code} · ${quote.title}` : 'Contrato'}
        subtitle="Minuta personalizada em PDF, status de assinatura e aditivos contratuais"
        maxWidth="max-w-5xl"
      >
        {!quote ? (
          <Note variant="info" title="Nenhum orçamento ganho selecionado">
            Marque um orçamento como Ganho para gerar a minuta de contrato e registrar assinatura e aditivos.
          </Note>
        ) : (
          <div className="flex flex-col gap-4">
            {wonQuotes.length > 1 && (
              <div className="no-print">
                <Select
                  label="Selecionar orçamento ganho"
                  value={quote.id}
                  onChange={(e) => onSelectQuoteId(e.target.value)}
                >
                  {wonQuotes.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.title} · {w.clientName} ({formatBRL(w.totalValue)})
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {feedback && (
              <div className="no-print">
                <Note variant="success" title="Atualização salva">
                  {feedback}
                </Note>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Folha A4 imprimível */}
              <div className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-[12px] p-6 sm:p-8 flex flex-col gap-4 print-sheet">
                <CompanyPdfHeader
                  settings={settings}
                  subtitle={`Contrato de prestação de serviços de construção · ${settings?.city || 'Valença · RJ'}`}
                />

                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#5B6472] border-b border-[#F0EEE9] pb-2">
                  <span>
                    Referência: <strong className="text-[#14181F]">{quote.code}</strong> ({quote.version || 'v1.0'})
                  </span>
                  <span>
                    Contratante: <strong className="text-[#14181F]">{quote.clientName}</strong>
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[#14181F] mb-1">
                    Cláusula 1 · Objeto e valor fechado
                  </h4>
                  <p className="text-[13px] text-[#5B6472] leading-relaxed">
                    Execução da obra <strong className="text-[#14181F]">{quote.title}</strong> (
                    {quote.type}
                    {quote.areaM2 ? `, ${quote.areaM2} m²` : ''}
                    {quote.city ? `, em ${quote.city}` : ''}), para o contratante{' '}
                    <strong className="text-[#14181F]">{quote.clientName}</strong>, pelo valor fechado aprovado de{' '}
                    <strong className="text-[#14181F]">{formatBRL(quote.totalValue)}</strong>
                    {addendaTotal !== 0
                      ? `, acrescido/ajustado de aditivos no total de ${formatBRL(addendaTotal)}, perfazendo o valor contratual vigente de ${formatBRL(currentContractTotal)}`
                      : ''}
                    , sem acréscimos posteriores fora de aditivo formal assinado pelas partes.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[#14181F] mb-1">Cláusula 2 · Pagamento</h4>
                  <p className="text-[13px] text-[#5B6472] leading-relaxed">
                    {paymentPreview ? (
                      <>
                        Entrada de {quote.downPaymentPct}% ({formatBRL(paymentPreview.valorEntrada)}) no início da obra.
                        {paymentPreview.saldoParcelado > 0 && (
                          <>
                            {' '}Saldo de {formatBRL(paymentPreview.saldoParcelado)} em {quote.installmentsCount} parcela(s) mensal(is)
                            de {formatBRL(paymentPreview.primeiraParcela)}
                            {paymentPreview.ultimaParcela !== paymentPreview.primeiraParcela
                              ? `, com última parcela de ${formatBRL(paymentPreview.ultimaParcela)}.`
                              : '.'}
                          </>
                        )}
                      </>
                    ) : 'Condições de pagamento não registradas.'}
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[#14181F] mb-1">
                    Cláusula 3 · Materiais de construção
                  </h4>
                  <p className="text-[13px] text-[#5B6472] leading-relaxed">
                    Todos os materiais de construção são adquiridos diretamente pelo contratante, fora do valor fechado deste contrato, conforme cronograma físico e prazos de entrega da obra.
                  </p>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-[#14181F] mb-1">
                    Cláusula 4 · Prazo e garantia contratual
                  </h4>
                  <p className="text-[13px] text-[#5B6472] leading-relaxed">
                    {quote.estimatedMonths > 0 ? `Prazo estimado de execução de ${quote.estimatedMonths} mês(es). ` : ''}
                    Garantia contratual de{' '}
                    <strong className="text-[#14181F]">1 (um) ano</strong> contada da data de conclusão e entrega formal da obra.
                  </p>
                </div>

                {parsedAddenda.length > 0 && (
                  <div className="border-t border-[#E4E1DA] pt-3">
                    <h4 className="text-sm font-bold text-[#14181F] mb-2">
                      Aditivos formalizados ({parsedAddenda.length})
                    </h4>
                    <div className="flex flex-col gap-1.5 text-xs">
                      {parsedAddenda.map((ad, idx) => (
                        <div
                          key={`${ad.label}-${idx}`}
                          className="flex items-center justify-between gap-2 bg-[#F6F5F2] rounded-[8px] px-3 py-2"
                        >
                          <span className="text-[#14181F]">
                            <strong>{ad.label}</strong> ({ad.dateISO ? formatDateBR(ad.dateISO) : '—'}) · {ad.description}
                          </span>
                          <strong className="tabular-nums text-[#14181F] whitespace-nowrap">
                            {ad.amountDelta >= 0 ? '+' : ''}
                            {formatBRL(ad.amountDelta)}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-6 pt-6 mt-2 border-t border-[#E4E1DA] text-xs text-[#5B6472]">
                  <div>
                    <div className="border-t border-[#5B6472] pt-1.5">
                      {settings?.companyName || 'Pilotis Soluções Construtivas'}
                    </div>
                  </div>
                  <div>
                    <div className="border-t border-[#5B6472] pt-1.5">{quote.clientName}</div>
                  </div>
                </div>
              </div>

              {/* Painel lateral: Obra, Checklist de documentos, PDF, assinatura e aditivos */}
              <div className="flex flex-col gap-4 no-print">
                {linkedProject && (
                  <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-[#14181F]">Obra / Contrato</h4>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge
                          label={
                            linkedProject.contractKind ||
                            (linkedProject.type === 'Obra satélite' ? 'Satélite' : 'Principal')
                          }
                        />
                        <StatusBadge label={linkedProject.status} />
                      </div>
                    </div>
                    <div className="text-xs text-[#5B6472] flex flex-col gap-1">
                      <span>
                        Início: <strong className="text-[#14181F]">{formatDateBR(linkedProject.startDate)}</strong> · Previsão:{' '}
                        <strong className="text-[#14181F]">{formatDateBR(linkedProject.forecastEndDate)}</strong>
                      </span>
                      <span>
                        Planejamento:{' '}
                        <strong className="text-[#14181F]">
                          {linkedProject.planningStatus || 'Cronograma criado'}
                        </strong>
                      </span>
                      {installmentsCountByProject && (
                        <span>
                          Parcelas geradas:{' '}
                          <strong className="text-[#14181F] tabular-nums">
                            {installmentsCountByProject.get(linkedProject.id) ?? 0} em /parcelas
                          </strong>
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {onNavigateToPlanning && (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            onClose();
                            onNavigateToPlanning(linkedProject.id);
                          }}
                        >
                          {linkedProject.planningStatus === 'Aguardando modelo de cronograma'
                            ? 'Escolher modelo no Planejamento'
                            : 'Abrir no Planejamento'}
                        </Button>
                      )}
                      {onNavigateToReceivables && (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            onClose();
                            onNavigateToReceivables();
                          }}
                        >
                          Ver parcelas
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {linkedProject && (
                  <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-[#14181F]">
                        Checklist de documentos
                      </h4>
                      <span className="text-xs font-semibold tabular-nums text-[#5B6472]">
                        {checklistDoneCount} de {projectChecklist.length}
                      </span>
                    </div>
                    {projectChecklist.length === 0 ? (
                      <p className="text-xs text-[#5B6472]">
                        Nenhum documento obrigatório vinculado a esta obra ainda.
                      </p>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {projectChecklist.map((docItem) => {
                          const isDone =
                            docItem.status === 'Anexado' ||
                            docItem.status === 'Em dia' ||
                            docItem.status === 'Válida';
                          return (
                            <div
                              key={docItem.id}
                              className="flex items-center justify-between gap-2 bg-[#F6F5F2] rounded-[8px] px-3 py-2 text-xs"
                            >
                              <div className="min-w-0">
                                <strong className="block text-[#14181F] truncate">
                                  {docItem.title}
                                </strong>
                                <span className="text-[11px] text-[#5B6472]">
                                  Prazo: {docItem.dueDate ? formatDateBR(docItem.dueDate) : '—'}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <StatusBadge label={docItem.status} />
                                {docItem.attachmentId && <button type="button"
                                  className="rounded-md border border-[#E4E1DA] bg-white px-2 py-1 text-[11px] font-semibold text-[#1F3A5F]"
                                  onClick={() => setAttachmentItem(docItem)} aria-label={'Anexos de ' + docItem.title}>Anexos</button>}
                                <button
                                  type="button"
                                  disabled={togglingDocId === docItem.id}
                                  onClick={() => handleToggleChecklistDoc(docItem)}
                                  className="px-2 py-1 rounded-md border border-[#E4E1DA] bg-white text-[11px] font-semibold text-[#1F3A5F] hover:bg-[#F0EEE9] cursor-pointer disabled:opacity-50"
                                >
                                  {isDone ? 'Reabrir' : 'Marcar OK'}
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-[#14181F]">Exportação e assinatura</h4>
                    <StatusBadge label={quote.contractSignStatus || 'Aguardando assinatura'} />
                  </div>

                  {linkedProject?.contractPdf && (
                  <Button variant="primary" fullWidth onClick={() => {
                    const bytes = linkedProject.contractPdf?.toUint8Array();
                    if (!bytes) return;
                    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `contrato-${linkedProject.id}.pdf`;
                    link.click();
                    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
                  }}>
                    Baixar PDF da confirmação
                  </Button>
                )}
                <Button variant={linkedProject?.contractPdf ? 'secondary' : 'primary'} fullWidth onClick={() => window.print()}>
                    Imprimir / Salvar PDF
                  </Button>

                  {linkedProject && purchaseRows.length > 0 && <PurchasingScheduleButton rows={purchaseRows}
                    projectId={linkedProject.id} projectName={linkedProject.name} companyName={settings?.companyName} contractCode={quote.code} />}

                  <form onSubmit={handleSaveSignStatus} className="flex flex-col gap-3 pt-2 border-t border-[#F0EEE9]">
                    <Select
                      label="Status da assinatura"
                      value={signStatus}
                      onChange={(e) => setSignStatus(e.target.value as ContractSignStatus)}
                    >
                      {SIGN_STATUS_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                    {(signStatus === 'Assinado pelo cliente' ||
                      signStatus === 'Assinado pelas partes') && (
                      <Input
                        label="Data da assinatura"
                        type="date"
                        value={signedAt || todayISO()}
                        onChange={(e) => setSignedAt(e.target.value)}
                      />
                    )}
                    <RegisteredBySelect
                      value={signActor}
                      onChange={setSignActor}
                      id="contract-sign-actor"
                    />
                    <Button type="submit" variant="secondary" fullWidth disabled={savingSign}>
                      {savingSign ? 'Salvando...' : 'Atualizar status de assinatura'}
                    </Button>
                  </form>
                </div>

                <div className="bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="text-sm font-bold text-[#14181F]">Aditivos contratuais</h4>
                    <span className="text-xs font-semibold tabular-nums text-[#5B6472]">
                      {formatBRL(addendaTotal)}
                    </span>
                  </div>
                  <p className="text-xs text-[#5B6472]">
                    O valor aprovado ({formatBRL(quote.totalValue)}) permanece congelado. Alterações de escopo ou valor devem ser formalizadas aqui.
                  </p>
                  <Button variant="secondary" fullWidth onClick={() => { setFeedback(null); setAddendumModalOpen(true); }}>
                    + Novo aditivo
                  </Button>
                </div>

                <Note variant="info" title="Revisão jurídica">
                  Os modelos de contrato e aditivos devem ser validados por advogado antes da assinatura com o cliente.
                </Note>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Novo Aditivo */}
      <Modal
        open={addendumModalOpen}
        onClose={() => setAddendumModalOpen(false)}
        title="Registrar aditivo contratual"
        subtitle={quote ? `${quote.code} · Valor base congelado: ${formatBRL(quote.totalValue)}` : undefined}
      >
        <form onSubmit={handleSaveAddendum} className="flex flex-col gap-4">
          {feedback && <Note variant="warning" title="Verifique o valor do aditivo">{feedback}</Note>}
          <Input
            label="Descrição e justificativa do aditivo"
            required
            value={addendumDesc}
            onChange={(e) => setAddendumDesc(e.target.value)}
            placeholder="Descreva o aditivo"
          />
          <Input
            label="Valor do aditivo em R$ (positivo acréscimo, negativo redução)"
            type="number"
            step="0.01"
            required
            value={addendumAmount}
            onChange={(e) => setAddendumAmount(e.target.value)}
            className="tabular-nums"
          />
          <RegisteredBySelect
            value={addendumActor}
            onChange={setAddendumActor}
            id="addendum-actor"
          />
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setAddendumModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={savingAddendum}>
              {savingAddendum ? 'Salvando...' : 'Registrar aditivo'}
            </Button>
          </div>
        </form>
        {open && attachmentItem && <ComplianceAttachmentsDialog key={attachmentItem.id} item={attachmentItem}
        onClose={() => setAttachmentItem(null)} />}
    </Modal>
    </>
  );
}
