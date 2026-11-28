import { WhatsAppHistory } from './clients/WhatsAppHistory';
import { RecordLifecycleButton } from '../components/ui/ArchivedRecords';
import { useMemo, useState } from 'react';
import { ListToolbar, useListFilters } from '../components/ui/ListFilters';
import { recordDay, type ListSchema } from '../domain/listQuery';
import { useViewParam, useViewTab } from '../hooks/useViewUrl';
import { PostConstructionView } from './ProjectClosureView';
import { DataList, type DataListColumn } from '../components/ui/DataList';
import {
  Button,
  Card,
  EmptyState,
  Input,
  KpiCard,
  Modal,
  Note,
  PageHeader,
  ProgressBar,
  RegisteredBySelect,
  ScrollableChips,
  SegmentedControl,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from '../components/ui/PilotisUI';
import { useToast } from '../components/ui/Toast';
import {
  avaliarMargemContraMeta,
  calcularProntidaoLicitacao,
  calcularProntidaoLicitacaoPorCategoria,
  calcularResumoFolhaEquipe,
  calcularResumoFunilOrcamentos,
  clampStr,
  composicaoOrcamento,
  formatBRL,
  formatBRLCompact,
  formatDateBR as domainFormatDateBR,
  simularPagamentoOrcamento,
  todayISO,
} from '../domain';
import { createRecord, updateRecord } from '../services/pilotisService';
import type {
  ActorRole,
  Client,
  ClientStatus,
  PilotisDataState,
  Quote,
  QuoteStatus,
  Tender,
  TenderStatus,
} from '../types/pilotis';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');
import { ConfirmQuoteModal } from './clients/ConfirmQuoteModal';
import { ContractModal } from './clients/ContractModal';
import { QuoteEditorModal } from './clients/QuoteEditorModal';
import { parseContractAddenda, parseVersionHistory } from './clients/quoteHelpers';

const CLIENT_TABS = [
  'Funil',
  'Orçamentos',
  'Clientes',
  'Pós-obra',
  'Licitações',
  'Rascunhos descartados',
];

const CLIENT_ORIGINS = [
  'Indicação',
  'Instagram',
  'Google',
  'Arquiteto parceiro',
  'Licitação',
  'Outro',
];

const FUNNEL_COLUMNS: QuoteStatus[] = [
  'Rascunho',
  'Enviado',
  'Em negociação',
  'Ganho',
  'Perdido',
];

export function ClientsQuotesView({
  uid,
  data,
  companyEmail,
  initialTab,
  externalNewQuoteOpen,
  onCloseExternalNewQuote,
  onProjectCreated,
  onNavigateToReceivables,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
  initialTab?: string;
  externalNewQuoteOpen?: boolean;
  onCloseExternalNewQuote?: () => void;
  onProjectCreated?: (projectId: string) => void;
  onNavigateToReceivables?: () => void;
}) {
  const { showToast } = useToast();

  const [tab, setTab] = useViewTab('clients', CLIENT_TABS, initialTab);
  const [selectedQuoteId, setSelectedQuoteId] = useViewParam('clients.orcamento');
  const [selectedClientId, setSelectedClientId] = useViewParam('clients.cliente');
  const [recordId, setRecordId] = useViewParam('registro');
  const linkedQuote = data.quotes.find((quote) => quote.id === recordId);
  const linkedDiscardedQuote = linkedQuote?.status === 'Descartado' ? linkedQuote : undefined;
  const linkedEditableQuote = linkedDiscardedQuote ? undefined : linkedQuote;

  // Quote Editor Modal (Create / Edit / Nova versão)
  const [quoteModalOpen, setQuoteModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [preselectedQuoteClientId, setPreselectedQuoteClientId] = useState<string>('');
  const isQuoteModalOpen = Boolean(linkedEditableQuote) || quoteModalOpen || Boolean(externalNewQuoteOpen);

  // Contract Modal
  const [confirmingQuoteId, setConfirmingQuoteId] = useState<string | null>(null);
  const confirmingQuote = data.quotes.find((quote) => quote.id === confirmingQuoteId) ?? null;
  const [contractModalQuoteId, setContractModalQuoteId] = useState<string | null>(null);

  // Move stage in Funnel modal
  const [stageModalQuote, setStageModalQuote] = useState<Quote | null>(null);
  const [stageNextStatus, setStageNextStatus] = useState<QuoteStatus>('Enviado');
  const [stageNextProb, setStageNextProb] = useState('50');
  const [stageLossReason, setStageLossReason] = useState('');
  const [stageActor, setStageActor] = useState<ActorRole>('Sócio');
  const [stageSaving, setStageSaving] = useState(false);

  // Discard quote modal
  const [discardQuote, setDiscardQuote] = useState<Quote | null>(null);
  const [discardReason, setDiscardReason] = useState('');
  const [discardActor, setDiscardActor] = useState<ActorRole>('Sócio');
  const [discardSaving, setDiscardSaving] = useState(false);

  // Reactivate discarded quote modal
  const [reactivateQuote, setReactivateQuote] = useState<Quote | null>(null);
  const [reactivateStatus, setReactivateStatus] = useState<'Rascunho' | 'Em negociação'>(
    'Em negociação'
  );
  const [reactivateActor, setReactivateActor] = useState<ActorRole>('Sócio');
  const [reactivateSaving, setReactivateSaving] = useState(false);

  // Client Modal (Create / Edit)
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [cName, setCName] = useState('');
  const [cOrigin, setCOrigin] = useState('');
  const [cReferredBy, setCReferredBy] = useState('');
  const [cCity, setCCity] = useState('');
  const [cPhone, setCPhone] = useState('');
  const [cEmail, setCEmail] = useState('');
  const [cNotes, setCNotes] = useState('');
  const [cStatus, setCStatus] = useState<ClientStatus>('Potencial');
  const [cActor, setCActor] = useState<ActorRole>('Sócio');
  const [cSaving, setCSaving] = useState(false);

  // Client Referrals & Testimonial Modal
  const [referralModalClient, setReferralModalClient] = useState<Client | null>(null);
  const [rCount, setRCount] = useState('0');
  const [rTestimonial, setRTestimonial] = useState('Aguardando conclusão');
  const [rActor, setRActor] = useState<ActorRole>('Sócio');
  const [rSaving, setRSaving] = useState(false);

  // Tender Modal (Create / Edit)
  const [tenderModalOpen, setTenderModalOpen] = useState(false);
  const [editingTender, setEditingTender] = useState<Tender | null>(null);
  const [tAgency, setTAgency] = useState('');
  const [tObject, setTObject] = useState('');
  const [tDate, setTDate] = useState('');
  const [tValue, setTValue] = useState('');
  const [tStatus, setTStatus] = useState<TenderStatus>('Em preparo');
  const [tNotes, setTNotes] = useState('');
  const [tActor, setTActor] = useState<ActorRole>('Sócio');
  const [tSaving, setTSaving] = useState(false);

  const [postInitialProjectId, setPostInitialProjectId] = useState('');

  // Derived Funnel Metrics (Rule 4: always calculated, never typed)
  const openQuotes = useMemo(
    () =>
      data.quotes.filter(
        (q) =>
          q.status === 'Rascunho' ||
          q.status === 'Enviado' ||
          q.status === 'Em negociação'
      ),
    [data.quotes]
  );

  const funnelSummary = useMemo(
    () => calcularResumoFunilOrcamentos(data.quotes),
    [data.quotes]
  );
  const funnelTotal = funnelSummary.valorFunil;
  const weightedFunnel = funnelSummary.previsaoPonderada;
  const closedQuotesCount = funnelSummary.fechadosCount;
  const wonQuotes = useMemo(
    () => data.quotes.filter((q) => q.status === 'Ganho'),
    [data.quotes]
  );
  const conversionRate = funnelSummary.taxaConversaoPct;

  const { topOrigin, digitalOriginSummary } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data.clients) {
      counts.set(c.origin, (counts.get(c.origin) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const digitalCount =
      (counts.get('Instagram') ?? 0) + (counts.get('Google') ?? 0);
    return {
      topOrigin: sorted[0]?.[0] || null,
      digitalOriginSummary: digitalCount,
    };
  }, [data.clients]);

  const activeQuote =
    data.quotes.find((q) => q.id === selectedQuoteId) ||
    openQuotes[0] ||
    data.quotes.find((q) => q.status !== 'Descartado') ||
    null;

  const activeClient = useMemo(
    () => data.clients.find((c) => c.id === selectedClientId) || null,
    [data.clients, selectedClientId]
  );

  const payrollMonthly = useMemo(() => {
    const res = calcularResumoFolhaEquipe(data.employees, data.settings);
    return res.custoTotalMensal ?? res.folhaBase;
  }, [data.employees, data.settings]);

  const tenderReadiness = calcularProntidaoLicitacao(data.complianceItems);

  const tenderReadinessByCategory = useMemo(
    () => calcularProntidaoLicitacaoPorCategoria(data.complianceItems),
    [data.complianceItems]
  );

  const quoteComposition = (row: Quote) => composicaoOrcamento({
    maoDeObra: row.laborCost || 0,
    empreita: row.subcontractCost || 0,
    equipamentos: row.equipmentCost || 0,
    bdi: row.bdiCost || 0,
    impostos: row.taxCost || 0,
    valorTotal: row.totalValue,
  });
  const quoteSchema: ListSchema<Quote> = {
    text: (row) => [row.code, row.title, row.clientName, row.description, row.city, row.discardReason],
    status: (row) => row.status, projects: (row) => row.projectId, dates: (row) => recordDay(row.createdAt),
    columns: [
      { key: 'code', label: 'Orçamento', value: (row) => row.code },
      { key: 'client', label: 'Cliente', value: (row) => row.clientName },
      { key: 'type', label: 'Tipo', value: (row) => row.type },
      { key: 'value', label: 'Valor', value: (row) => row.totalValue + (row.addendaTotalValue ?? 0) },
      { key: 'margin', label: 'Margem prevista', value: (row) => quoteComposition(row).margemPct },
      { key: 'status', label: 'Situação', value: (row) => row.status },
      { key: 'date', label: 'Cadastro', value: (row) => recordDay(row.createdAt) },
    ],
  };
  const quotes = useListFilters('orcamentos', data.quotes.filter((row) => row.status !== 'Descartado'), quoteSchema);
  const funnel = useListFilters('funil', data.quotes.filter((row) => FUNNEL_COLUMNS.includes(row.status)), quoteSchema);
  const discarded = useListFilters('rascunhos', data.quotes.filter((row) => row.status === 'Descartado'), {
    ...quoteSchema,
    columns: [
      { key: 'quote', label: 'Orçamento', value: (row) => row.code },
      { key: 'client', label: 'Cliente', value: (row) => row.clientName },
      { key: 'value', label: 'Valor', value: (row) => row.totalValue },
      { key: 'reason', label: 'Motivo', value: (row) => row.discardReason },
      { key: 'date', label: 'Cadastro', value: (row) => recordDay(row.createdAt) },
    ],
  });
  const clients = useListFilters('clientes', data.clients, {
    text: (row) => [row.name, row.phone, row.email, row.origin, row.city, row.id],
    status: (row) => row.status,
    projects: (row) => data.projects.filter((project) =>
      project.clientId === row.id || (!project.clientId && project.clientName === row.name)).map((project) => project.id),
    dates: (row) => recordDay(row.createdAt),
    columns: [
      { key: 'name', label: 'Cliente', value: (row) => row.name },
      { key: 'origin', label: 'Origem', value: (row) => row.origin },
      { key: 'city', label: 'Localidade', value: (row) => row.city },
      { key: 'status', label: 'Situação', value: (row) => row.status },
      { key: 'date', label: 'Cadastro', value: (row) => recordDay(row.createdAt) },
    ],
  });
  const tenders = useListFilters('editais', data.tenders, {
    text: (row) => [row.agency, row.objectTitle, row.notes, row.id],
    status: (row) => row.status, dates: (row) => row.openingDate,
    columns: [
      { key: 'agency', label: 'Órgão', value: (row) => row.agency },
      { key: 'object', label: 'Objeto', value: (row) => row.objectTitle },
      { key: 'openingDate', label: 'Abertura', value: (row) => row.openingDate },
      { key: 'estimatedValue', label: 'Valor estimado', value: (row) => row.estimatedValue },
      { key: 'status', label: 'Situação', value: (row) => row.status },
    ],
  });

  const contractQuote = useMemo(() => {
    if (!contractModalQuoteId) return null;
    return (
      data.quotes.find((q) => q.id === contractModalQuoteId) ||
      wonQuotes[0] ||
      null
    );
  }, [contractModalQuoteId, data.quotes, wonQuotes]);

  const installmentsCountByProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const inst of data.installments) {
      map.set(inst.projectId, (map.get(inst.projectId) ?? 0) + 1);
    }
    return map;
  }, [data.installments]);

  const checklistCountByProject = useMemo(() => {
    const map = new Map<string, { ready: number; total: number }>();
    for (const item of data.complianceItems) {
      if (item.kind !== 'Documento de obra' || !item.projectId) continue;
      const cur = map.get(item.projectId) ?? { ready: 0, total: 0 };
      cur.total += 1;
      if (
        item.status === 'Anexado' ||
        item.status === 'Em dia' ||
        item.status === 'Válida'
      ) {
        cur.ready += 1;
      }
      map.set(item.projectId, cur);
    }
    return map;
  }, [data.complianceItems]);

  function openNewQuote(preClientId = '') {
    setEditingQuote(null);
    setPreselectedQuoteClientId(preClientId);
    setQuoteModalOpen(true);
  }

  function openEditQuote(quote: Quote) {
    setEditingQuote(quote);
    setPreselectedQuoteClientId(quote.clientId);
    setQuoteModalOpen(true);
  }

  function closeQuoteModal() {
    if (recordId) setRecordId('');
    setQuoteModalOpen(false);
    setEditingQuote(null);
    setPreselectedQuoteClientId('');
    onCloseExternalNewQuote?.();
  }

  function openNewClientModal() {
    setEditingClient(null);
    setCName('');
    setCOrigin('');
    setCReferredBy('');
    setCCity('');
    setCPhone('');
    setCEmail('');
    setCNotes('');
    setCStatus('Potencial');
    setCActor('Sócio');
    setClientModalOpen(true);
  }

  function openEditClientModal(client: Client) {
    setEditingClient(client);
    setCName(client.name);
    setCOrigin(client.origin || '');
    setCReferredBy(client.referredBy || '');
    setCCity(client.city || '');
    setCPhone(client.phone || '');
    setCEmail(client.email || '');
    setCNotes(client.notes || '');
    setCStatus(client.status);
    setCActor('Sócio');
    setClientModalOpen(true);
  }

  async function handleSaveClient(e: React.FormEvent) {
    e.preventDefault();
    if (!cName.trim() || !cOrigin) return;
    setCSaving(true);
    try {
      const payload = {
        name: clampStr(cName, 140),
        origin: clampStr(cOrigin, 80),
        referredBy: clampStr(cReferredBy, 140),
        city: clampStr(cCity, 80),
        phone: clampStr(cPhone, 40),
        email: clampStr(cEmail, 120),
        notes: clampStr(cNotes, 1000),
        status: cStatus,
      };
      if (editingClient) {
        await updateRecord(
          'clients',
          editingClient.id,
          uid,
          cActor,
          payload,
          `Cliente atualizado: ${payload.name}`
        );
        showToast({ tone: 'success', title: 'Cliente atualizado com sucesso.' });
      } else {
        const id = await createRecord(
          'clients',
          uid,
          cActor,
          {
            ...payload,
            referralsCount: 0,
            testimonialStatus: 'Aguardando conclusão',
          },
          `Novo cliente: ${payload.name}`
        );
        if (isQuoteModalOpen) {
          setPreselectedQuoteClientId(id);
        }
        showToast({ tone: 'success', title: 'Cliente cadastrado com sucesso.' });
      }
      setClientModalOpen(false);
    } finally {
      setCSaving(false);
    }
  }

  function openStageModal(quote: Quote) {
    setStageModalQuote(quote);
    setStageNextStatus(quote.status === 'Descartado' ? 'Em negociação' : quote.status);
    setStageNextProb(String(quote.probabilityPct ?? ''));
    setStageLossReason(quote.lossReason || '');
    setStageActor('Sócio');
  }

  async function handleSaveStageTransition(e: React.FormEvent) {
    e.preventDefault();
    if (!stageModalQuote) return;
    if (stageNextStatus === 'Perdido' && !stageLossReason.trim()) return;
    if (stageNextStatus === 'Ganho' && stageModalQuote.totalValue <= 0) {
      showToast({ tone: 'danger', title: 'Edite o orçamento e registre um valor válido antes de marcar como ganho.' });
      return;
    }

    setStageSaving(true);
    try {
      const prob =
        stageNextStatus === 'Perdido'
          ? 0
          : stageNextStatus === 'Ganho'
            ? 100
            : Math.min(100, Math.max(0, Number(stageNextProb) || 0));

      const nextContractSignStatus =
        stageNextStatus === 'Ganho'
          ? stageModalQuote.contractSignStatus &&
            stageModalQuote.contractSignStatus !== 'Não gerado'
            ? stageModalQuote.contractSignStatus
            : 'Aguardando assinatura'
          : stageModalQuote.contractSignStatus || 'Não gerado';

      await updateRecord(
        'quotes',
        stageModalQuote.id,
        uid,
        stageActor,
        {
          status: stageNextStatus,
          probabilityPct: prob,
          lossReason:
            stageNextStatus === 'Perdido' ? clampStr(stageLossReason, 300) : '',
          contractSignStatus: nextContractSignStatus,
        },
        `Status de ${stageModalQuote.code} alterado para ${stageNextStatus}`
      );
      showToast({
        tone: 'success',
        title:
          stageNextStatus === 'Ganho'
            ? `${stageModalQuote.code} aprovado e valor congelado. Contrato disponível!`
            : `Status atualizado para ${stageNextStatus}.`,
      });
      setStageModalQuote(null);
    } finally {
      setStageSaving(false);
    }
  }

  async function handleDiscardQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!discardQuote || !discardReason.trim()) return;
    setDiscardSaving(true);
    try {
      await updateRecord(
        'quotes',
        discardQuote.id,
        uid,
        discardActor,
        {
          status: 'Descartado',
          discardReason: clampStr(discardReason, 300),
        },
        `Orçamento descartado: ${discardQuote.code}`
      );
      showToast({
        tone: 'info',
        title: 'Orçamento movido para rascunhos descartados.',
      });
      setDiscardQuote(null);
      setDiscardReason('');
    } finally {
      setDiscardSaving(false);
    }
  }

  async function handleReactivateQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!reactivateQuote) return;
    setReactivateSaving(true);
    try {
      await updateRecord(
        'quotes',
        reactivateQuote.id,
        uid,
        reactivateActor,
        {
          status: reactivateStatus,
        },
        `Orçamento reativado: ${reactivateQuote.code} (${reactivateStatus})`
      );
      showToast({
        tone: 'success',
        title: `${reactivateQuote.code} reativado no funil.`,
      });
      setReactivateQuote(null);
    } finally {
      setReactivateSaving(false);
    }
  }

  function openNewTenderModal() {
    setEditingTender(null);
    setTAgency('');
    setTObject('');
    setTDate('');
    setTValue('');
    setTStatus('Em preparo');
    setTNotes('');
    setTActor('Sócio');
    setTenderModalOpen(true);
  }

  function openEditTenderModal(tender: Tender) {
    setEditingTender(tender);
    setTAgency(tender.agency);
    setTObject(tender.objectTitle);
    setTDate(tender.openingDate || '');
    setTValue(String(tender.estimatedValue || 0));
    setTStatus(tender.status);
    setTNotes(tender.notes || '');
    setTActor('Sócio');
    setTenderModalOpen(true);
  }

  async function handleSaveTender(e: React.FormEvent) {
    e.preventDefault();
    if (!tAgency.trim() || !tObject.trim() || !tDate || !tValue.trim()) return;
    setTSaving(true);
    try {
      const payload = {
        agency: clampStr(tAgency, 140),
        objectTitle: clampStr(tObject, 200),
        openingDate: tDate,
        estimatedValue: Math.max(0, Number(tValue) || 0),
        status: tStatus,
        notes: clampStr(tNotes, 500),
      };
      if (editingTender) {
        await updateRecord(
          'tenders',
          editingTender.id,
          uid,
          tActor,
          payload,
          `Edital atualizado: ${payload.agency} (${payload.status})`
        );
        showToast({ tone: 'success', title: 'Edital atualizado.' });
      } else {
        await createRecord(
          'tenders',
          uid,
          tActor,
          payload,
          `Edital cadastrado: ${payload.agency}`
        );
        showToast({ tone: 'success', title: 'Edital cadastrado.' });
      }
      setTenderModalOpen(false);
    } finally {
      setTSaving(false);
    }
  }

  // Table Columns Definitions for DataList (Desktop Table + Mobile Cards)
  const quoteColumns: DataListColumn<Quote>[] = [
    {
      key: 'code',
      header: 'Orçamento',
      render: (q) => (
        <div>
          <strong className="text-[#14181F] block">
            {q.code} · {q.version || 'v1.0'}
          </strong>
          <span className="text-xs text-[#5B6472]">{q.title}</span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente / Origem',
      render: (q) => (
        <div>
          <span className="block text-[#14181F]">{q.clientName}</span>
          <span className="text-xs text-[#5B6472]">
            {q.origin || 'Direto'}
            {q.city ? ` · ${q.city}` : ''}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Tipo / Área',
      render: (q) => (
        <span className="text-[#5B6472]">
          {q.type}
          {q.areaM2 ? ` · ${q.areaM2} m²` : ''}
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Valor fechado',
      align: 'right',
      numeric: true,
      render: (q) => {
        const addenda = q.addendaTotalValue || 0;
        return (
          <div>
            <strong className="text-[#14181F] block tabular-nums">
              {formatBRL(q.totalValue + addenda)}
            </strong>
            {q.status === 'Ganho' && (
              <span className="text-[11px] text-[#1D6849] font-medium">
                {addenda !== 0 ? `Base + ${formatBRL(addenda)} aditivo` : 'Valor congelado'}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'margin',
      header: 'Margem prevista',
      align: 'right',
      numeric: true,
      render: (q) => {
        const comp = quoteComposition(q);
        const check = avaliarMargemContraMeta(
          comp.margemPct,
          data.settings?.targetMarginPct
        );
        return (
          <div>
            <span className="tabular-nums font-semibold">
              {comp.margemPct.toFixed(1).replace('.', ',')}%
            </span>
            {check.metaConfigurada && (
              <span
                className={`block text-[11px] ${
                  check.status === 'acima' ? 'text-[#1D6849]' : 'text-[#8A5200]'
                }`}
              >
                {check.status === 'acima' ? 'Acima da meta' : 'Abaixo da meta'}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status / Obra',
      render: (q) => {
        const linkedProj = q.projectId
          ? data.projects.find((p) => p.id === q.projectId)
          : undefined;
        const docs = q.projectId ? checklistCountByProject.get(q.projectId) : undefined;
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge
              label={
                q.status === 'Perdido' && q.lossReason
                  ? `Perdido · ${q.lossReason}`
                  : q.status
              }
              tone={q.status === 'Perdido' ? 'bad' : undefined}
            />
            {linkedProj && (
              <span className="text-[11px] text-[#5B6472]">
                {linkedProj.contractKind || 'Principal'} · {linkedProj.status}
                {docs ? ` · Docs ${docs.ready}/${docs.total}` : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'actions',
      header: 'Ações',
      align: 'right',
      render: (q) => (
        <div
          className="flex flex-wrap items-center justify-end gap-1.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openEditQuote(q)}
          >
            {q.status === 'Ganho' ? 'Detalhes' : 'Editar / Versão'}
          </Button>
          <RecordLifecycleButton uid={uid} record={{ entity: 'quotes', id: q.id, title: q.title }} />
          {!q.projectId && q.status !== 'Perdido' && q.status !== 'Descartado' && (
            <Button size="sm" variant="primary" onClick={() => setConfirmingQuoteId(q.id)}>
              Confirmar orçamento
            </Button>
          )}
          {(q.status === 'Ganho' || q.projectId) && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setContractModalQuoteId(q.id)}
            >
              {q.projectId ? 'Contrato e checklist' : 'Contrato'}
            </Button>
          )}
          {q.projectId && onProjectCreated && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => onProjectCreated(q.projectId!)}
            >
              Planejamento
            </Button>
          )}
        </div>
      ),
    },
  ];

  const clientColumns: DataListColumn<Client>[] = [
    {
      key: 'name',
      header: 'Cliente',
      render: (c) => (
        <div>
          <strong className="text-[#1F3A5F] block">{c.name}</strong>
          {c.phone && <span className="text-xs text-[#5B6472]">{c.phone}</span>}
        </div>
      ),
    },
    {
      key: 'origin',
      header: 'Origem / Indicação',
      render: (c) => (
        <div>
          <span className="text-[#14181F] block">{c.origin}</span>
          {c.referredBy && (
            <span className="text-xs text-[#5B6472]">Por: {c.referredBy}</span>
          )}
        </div>
      ),
    },
    {
      key: 'city',
      header: 'Localidade',
      render: (c) => <span className="text-[#5B6472]">{c.city || '—'}</span>,
    },
    {
      key: 'counts',
      header: 'Obras / Orçamentos',
      align: 'right',
      numeric: true,
      render: (c) => {
        const qCount = data.quotes.filter((q) => q.clientId === c.id).length;
        const pCount = data.projects.filter(
          (p) => p.clientId === c.id || p.clientName === c.name
        ).length;
        return (
          <span className="tabular-nums text-[#14181F]">
            {pCount} obra(s) · {qCount} orç.
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Situação',
      render: (c) => <StatusBadge label={c.status} />,
    },
  ];

  const tenderColumns: DataListColumn<Tender>[] = [
    {
      key: 'agency',
      header: 'Órgão',
      render: (t) => <strong className="text-[#14181F]">{t.agency}</strong>,
    },
    {
      key: 'object',
      header: 'Objeto',
      render: (t) => <span className="text-[#5B6472]">{t.objectTitle}</span>,
    },
    {
      key: 'openingDate',
      header: 'Abertura',
      numeric: true,
      render: (t) => (
        <span className="tabular-nums">{formatDateBR(t.openingDate)}</span>
      ),
    },
    {
      key: 'estimatedValue',
      header: 'Valor estimado',
      align: 'right',
      numeric: true,
      render: (t) => (
        <strong className="tabular-nums">{formatBRL(t.estimatedValue)}</strong>
      ),
    },
    {
      key: 'readiness',
      header: 'Habilitação',
      align: 'right',
      numeric: true,
      render: () => (
        <span className="tabular-nums text-[#5B6472]">
          {tenderReadiness !== null ? `${tenderReadiness}%` : 'Sem dados'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (t) => <StatusBadge label={t.status} />,
    },
    {
      key: 'actions',
      header: 'Ação',
      align: 'right',
      render: (t) => (
        <div
          className="flex justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openEditTenderModal(t)}
          >
            Editar / Status
          </Button>
        </div>
      ),
    },
  ];

  const discardedColumns: DataListColumn<Quote>[] = [
    {
      key: 'quote',
      header: 'Orçamento',
      render: (q) => (
        <div>
          <strong className="text-[#14181F] block">
            {q.code} · {q.title}
          </strong>
          <span className="text-xs text-[#5B6472]">{q.version || 'v1.0'}</span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      render: (q) => <span className="text-[#14181F]">{q.clientName}</span>,
    },
    {
      key: 'value',
      header: 'Valor',
      align: 'right',
      numeric: true,
      render: (q) => (
        <span className="tabular-nums font-medium">{formatBRL(q.totalValue)}</span>
      ),
    },
    {
      key: 'reason',
      header: 'Motivo do descarte',
      render: (q) => <span className="text-[#5B6472]">{q.discardReason || '—'}</span>,
    },
    {
      key: 'action',
      header: 'Ação',
      align: 'right',
      render: (q) => (
        <div className="flex flex-wrap justify-end gap-2">
          <RecordLifecycleButton uid={uid} record={{ entity: 'quotes', id: q.id, title: q.title }} />
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setReactivateQuote(q);
              setReactivateStatus('Em negociação');
              setReactivateActor('Sócio');
            }}
          >
            Reativar
          </Button>
        </div>
      ),
    },
  ];

  // Derived activeQuote details for Funnel panel
  const activeQuoteComp = useMemo(() => {
    if (!activeQuote) return null;
    return composicaoOrcamento({
      maoDeObra: activeQuote.laborCost || 0,
      empreita: activeQuote.subcontractCost || 0,
      equipamentos: activeQuote.equipmentCost || 0,
      bdi: activeQuote.bdiCost || 0,
      impostos: activeQuote.taxCost || 0,
      valorTotal: activeQuote.totalValue,
    });
  }, [activeQuote]);

  const activeQuoteMarginCheck = useMemo(() => {
    if (!activeQuoteComp) return null;
    return avaliarMargemContraMeta(
      activeQuoteComp.margemPct,
      data.settings?.targetMarginPct
    );
  }, [activeQuoteComp, data.settings?.targetMarginPct]);

  const activeQuoteSim = useMemo(() => {
    if (!activeQuote || activeQuote.totalValue <= 0 || activeQuote.downPaymentPct == null || activeQuote.installmentsCount == null) return null;
    try {
      return simularPagamentoOrcamento({
        valorTotal: activeQuote.totalValue,
        entradaPct: activeQuote.downPaymentPct,
        nParcelas: activeQuote.installmentsCount,
        dataInicio: todayISO(),
        folhaMensalEstimada: payrollMonthly,
      });
    } catch {
      return null;
    }
  }, [activeQuote, payrollMonthly]);

  const activeQuoteVersions = useMemo(
    () => parseVersionHistory(activeQuote?.versionHistory),
    [activeQuote?.versionHistory]
  );

  // Active client detail derived lists
  const clientQuotes = useMemo(
    () =>
      activeClient
        ? data.quotes.filter((q) => q.clientId === activeClient.id)
        : [],
    [activeClient, data.quotes]
  );
  const clientProjects = useMemo(
    () =>
      activeClient
        ? data.projects.filter(
            (p) => p.clientId ? p.clientId === activeClient.id : p.clientName === activeClient.name
          )
        : [],
    [activeClient, data.projects]
  );
  const clientWarrantyCalls = useMemo(() => {
    if (clientProjects.length === 0) return [];
    const projIds = new Set(clientProjects.map((p) => p.id));
    return data.warrantyCalls.filter((w) => projIds.has(w.projectId));
  }, [clientProjects, data.warrantyCalls]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Clientes e Orçamentos"
        subtitle="Funil comercial, composição de orçamentos, contratos e licitações"
        companyEmail={companyEmail}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {wonQuotes.length > 0 && (
              <Button
                variant="secondary"
                onClick={() => setContractModalQuoteId(wonQuotes[0].id)}
              >
                Contratos ({wonQuotes.length})
              </Button>
            )}
            <Button variant="secondary" onClick={openNewClientModal}>
              Novo cliente
            </Button>
            <Button variant="primary" onClick={() => openNewQuote('')}>
              Novo orçamento
            </Button>
          </div>
        }
      />

      {/* Abas desktop + Chips roláveis mobile */}
      <div className="hidden md:block">
        <Tabs items={CLIENT_TABS} active={tab} onChange={setTab} />
      </div>
      <div className="md:hidden">
        <ScrollableChips
          items={CLIENT_TABS}
          active={tab}
          onChange={setTab}
          ariaLabel="Abas de Clientes e Orçamentos"
        />
      </div>

      {tab === 'Funil' && <ListToolbar label="orçamentos no funil" list={funnel} projects={data.projects} />}
      {tab === 'Orçamentos' && <ListToolbar label="orçamentos" list={quotes} projects={data.projects} />}
      {tab === 'Clientes' && !activeClient && <ListToolbar label="clientes" list={clients} projects={data.projects} />}
      {tab === 'Licitações' && <ListToolbar label="editais" list={tenders} />}
      {tab === 'Rascunhos descartados' && <ListToolbar label="rascunhos descartados" list={discarded} projects={data.projects} />}

      {/* ABA 1: FUNIL */}
      {tab === 'Funil' && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              label="Valor no funil"
              value={openQuotes.length > 0 ? formatBRLCompact(funnelTotal) : 'Sem dados'}
              subtext={`${openQuotes.length} orçamento(s) aberto(s)`}
              isEmpty={openQuotes.length === 0}
            />
            <KpiCard
              label="Previsão ponderada"
              value={openQuotes.length > 0 ? formatBRLCompact(weightedFunnel) : 'Sem dados'}
              subtext="Por probabilidade de fechamento"
              isEmpty={openQuotes.length === 0}
            />
            <KpiCard
              label="Taxa de conversão"
              value={conversionRate !== null ? `${conversionRate}%` : 'Sem dados'}
              subtext={`${wonQuotes.length} ganho(s) de ${closedQuotesCount} encerrado(s)`}
              isEmpty={conversionRate === null}
            />
            <KpiCard
              label="Origem principal"
              value={topOrigin || 'Sem dados'}
              subtext={
                data.clients.length > 0
                  ? `${data.clients.length} cliente(s) · Instagram/Google: ${digitalOriginSummary}`
                  : 'Nenhum cliente cadastrado'
              }
              isEmpty={!topOrigin}
            />
          </div>

          {data.quotes.filter((q) => q.status !== 'Descartado').length === 0 ? (
            <EmptyState
              title="Funil comercial vazio"
              description="Cadastre seu primeiro cliente e orçamento para acompanhar o funil comercial, simular parcelas e comparar a margem contra a meta."
              actionLabel="Novo orçamento"
              onAction={() => openNewQuote('')}
              secondaryActionLabel="Novo cliente"
              onSecondaryAction={openNewClientModal}
            />
          ) : (
            <>
              {/* Quadro Kanban: horizontal scroll no celular, 5 colunas no desktop */}
              <div className="flex md:grid md:grid-cols-5 gap-3 overflow-x-auto pb-2 snap-x">
                {FUNNEL_COLUMNS.map((colStatus) => {
                  const colQuotes = funnel.rows.filter((q) => q.status === colStatus);
                  return (
                    <div
                      key={colStatus}
                      className="min-w-[248px] md:min-w-0 snap-start bg-[#F0EEE9] rounded-[12px] p-3 flex flex-col gap-2.5 min-h-[150px]"
                    >
                      <div className="flex items-center justify-between px-1">
                        <strong className="text-xs font-bold text-[#14181F]">
                          {colStatus}
                        </strong>
                        <span className="text-xs text-[#5B6472] font-semibold tabular-nums">
                          {colQuotes.length}
                        </span>
                      </div>

                      {colQuotes.length === 0 ? (
                        <p className="text-xs text-[#5B6472] px-1 py-3">
                          Sem orçamentos nesta coluna.
                        </p>
                      ) : (
                        colQuotes.map((q) => {
                          const addenda = q.addendaTotalValue || 0;
                          const isSelected = activeQuote?.id === q.id;
                          return (
                            <button
                              key={q.id}
                              type="button"
                              onClick={() => setSelectedQuoteId(q.id)}
                              className={`text-left bg-white rounded-[12px] p-3 border transition-colors flex flex-col gap-1.5 cursor-pointer ${
                                isSelected
                                  ? 'border-[#1F3A5F] ring-1 ring-[#1F3A5F]'
                                  : 'border-[#E4E1DA] hover:border-[#5B6472]'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-1.5">
                                <strong className="text-[13px] text-[#14181F] leading-snug">
                                  {q.code} · {q.title}
                                </strong>
                                <span className="text-[10px] font-semibold text-[#5B6472] shrink-0">
                                  {q.version || 'v1.0'}
                                </span>
                              </div>
                              <span className="text-xs text-[#5B6472]">
                                {q.clientName} · {formatBRLCompact(q.totalValue + addenda)}
                              </span>
                              <div className="flex flex-wrap items-center justify-between gap-1 pt-1">
                                {q.status === 'Perdido' ? (
                                  <StatusBadge
                                    label={q.lossReason || 'Perdido'}
                                    tone="bad"
                                  />
                                ) : q.status === 'Ganho' ? (
                                  (() => {
                                    const linkedProj = q.projectId
                                      ? data.projects.find((p) => p.id === q.projectId)
                                      : undefined;
                                    return (
                                      <StatusBadge
                                        label={
                                          linkedProj
                                            ? `${linkedProj.status} · ${linkedProj.contractKind || 'Principal'}`
                                            : q.contractSignStatus &&
                                                q.contractSignStatus !== 'Não gerado'
                                              ? q.contractSignStatus
                                              : 'Contrato pronto'
                                        }
                                        tone="ok"
                                      />
                                    );
                                  })()
                                ) : (
                                  <StatusBadge
                                    label={q.origin || 'Direto'}
                                    tone={
                                      q.origin === 'Arquiteto parceiro'
                                        ? 'warn'
                                        : 'info'
                                    }
                                  />
                                )}
                                <span className="text-[11px] font-semibold text-[#5B6472] tabular-nums">
                                  {q.status === 'Perdido' ? '0%' : `${q.probabilityPct}%`}
                                </span>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Painel de composição, status e versões do orçamento selecionado */}
              {activeQuote && activeQuoteComp && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <Card
                    className="lg:col-span-2"
                    title={`${activeQuote.code} (${activeQuote.version || 'v1.0'}) · ${activeQuote.title}`}
                    subtitle={`${activeQuote.clientName} · ${activeQuote.type}${
                      activeQuote.city ? ` · ${activeQuote.city}` : ''
                    }${activeQuote.areaM2 ? ` · ${activeQuote.areaM2} m²` : ''}`}
                    actions={<StatusBadge label={activeQuote.status} />}
                  >
                    {activeQuote.status === 'Ganho' && (
                      <Note variant="warning" title="Valor aprovado congelado">
                        O valor fechado de {formatBRL(activeQuote.totalValue)} está congelado. Alterações de valor exigem aditivo no contrato.
                      </Note>
                    )}

                    {activeQuote.status === 'Perdido' && activeQuote.lossReason && (
                      <Note variant="danger" title="Motivo da perda">
                        {activeQuote.lossReason}
                      </Note>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2 text-[13px]">
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Mão de obra</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuote.laborCost)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Impostos</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuote.taxCost)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Subempreitadas</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuote.subcontractCost)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Custo total previsto</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuoteComp.custoTotal)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Equipamentos e outros</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuote.equipmentCost)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Valor total fechado</span>
                        <strong className="tabular-nums text-[#14181F]">
                          {formatBRL(activeQuote.totalValue)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">BDI (despesas indiretas)</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuote.bdiCost)}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Margem prevista</span>
                        <strong className="tabular-nums">
                          {formatBRL(activeQuoteComp.margemReais)} (
                          {activeQuoteComp.margemPct.toFixed(1).replace('.', ',')}%)
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Condições de pagamento</span>
                        <strong className="tabular-nums">
                          {activeQuote.downPaymentPct}% + {activeQuote.installmentsCount}x{' '}
                          {activeQuoteSim
                            ? formatBRL(activeQuoteSim.primeiraParcela)
                            : ''}
                        </strong>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[#5B6472]">Materiais da obra</span>
                        <strong>Comprados pelo cliente</strong>
                      </div>
                    </div>

                    {activeQuoteMarginCheck && (
                      <Note
                        variant={
                          activeQuoteMarginCheck.status === 'acima'
                            ? 'success'
                            : activeQuoteMarginCheck.status === 'abaixo'
                              ? 'warning'
                              : 'info'
                        }
                        title={
                          activeQuoteMarginCheck.status === 'acima'
                            ? `Margem ${activeQuoteMarginCheck.diferencaPct === 0 ? 'na' : 'acima da'} meta (${activeQuoteMarginCheck.metaPct?.toFixed(1).replace('.', ',')}%)`
                            : activeQuoteMarginCheck.status === 'abaixo'
                              ? `Margem abaixo da meta (${activeQuoteMarginCheck.metaPct?.toFixed(1).replace('.', ',')}%)`
                              : 'Meta de margem não configurada'
                        }
                      >
                        {activeQuoteMarginCheck.metaConfigurada
                          ? 'Valores fechados não sofrem acréscimos fora de aditivo formal.'
                          : 'Configure a meta de margem em Configurações › Encargos e metas.'}
                      </Note>
                    )}

                    {activeQuote.projectId && (
                      (() => {
                        const linkedProj = data.projects.find(
                          (p) => p.id === activeQuote.projectId
                        );
                        const instCount =
                          installmentsCountByProject.get(activeQuote.projectId) ?? 0;
                        const docs = checklistCountByProject.get(activeQuote.projectId);
                        return (
                          <div className="bg-[#F6F5F2] border border-[#E4E1DA] rounded-[10px] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2">
                              <strong className="text-[#14181F]">
                                Obra/Contrato vinculada:
                              </strong>
                              <StatusBadge
                                label={linkedProj?.contractKind || 'Principal'}
                              />
                              <StatusBadge
                                label={linkedProj?.status || 'Contratada'}
                              />
                              <span className="text-[#5B6472]">
                                {instCount} parcela(s) em /parcelas
                                {docs ? ` · Checklist ${docs.ready}/${docs.total}` : ''}
                                {linkedProj?.planningStatus
                                  ? ` · ${linkedProj.planningStatus}`
                                  : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })()
                    )}

                    <div className="flex flex-wrap gap-2.5 pt-1">
                      <Button
                        variant="secondary"
                        onClick={() => openEditQuote(activeQuote)}
                      >
                        {activeQuote.status === 'Ganho'
                          ? 'Ver detalhes e versões'
                          : 'Editar / Nova versão & Simulador'}
                      </Button>


                      {!activeQuote.projectId && activeQuote.status !== 'Perdido' && activeQuote.status !== 'Descartado' && (
                        <Button variant="primary" onClick={() => setConfirmingQuoteId(activeQuote.id)}>
                          Confirmar orçamento
                        </Button>
                      )}
                      {activeQuote.status !== 'Ganho' && (
                        <Button
                          variant={activeQuote.projectId ? 'primary' : 'secondary'}
                          onClick={() => openStageModal(activeQuote)}
                        >
                          Mover no funil
                        </Button>
                      )}

                      {(activeQuote.status === 'Ganho' || activeQuote.projectId) && (
                        <Button
                          variant="primary"
                          onClick={() => setContractModalQuoteId(activeQuote.id)}
                        >
                          {activeQuote.projectId
                            ? 'Contrato (PDF) e checklist'
                            : 'Abrir contrato (PDF e aditivos)'}
                        </Button>
                      )}

                      {activeQuote.projectId && onProjectCreated && (
                        <Button
                          variant="secondary"
                          onClick={() => onProjectCreated(activeQuote.projectId!)}
                        >
                          Ver no Planejamento
                        </Button>
                      )}

                      {activeQuote.status !== 'Ganho' &&
                        activeQuote.status !== 'Descartado' && (
                          <Button
                            variant="text"
                            onClick={() => {
                              setDiscardQuote(activeQuote);
                              setDiscardReason('');
                              setDiscardActor('Sócio');
                            }}
                          >
                            Descartar e salvar rascunho
                          </Button>
                        )}
                    </div>
                  </Card>

                  <Card
                    title="Versões e efeito no caixa"
                    subtitle={`Prazo estimado: ${activeQuote.estimatedMonths ? `${activeQuote.estimatedMonths} meses` : 'Sem dados'} · Validade: ${
                      activeQuote.validityDays ? `${activeQuote.validityDays} dias` : 'Sem dados'
                    }`}
                  >
                    {activeQuoteSim && (
                      <div className="flex flex-col gap-2 text-[13px]">
                        <div className="flex justify-between">
                          <span className="text-[#5B6472]">Entrada ({activeQuote.downPaymentPct}%)</span>
                          <strong className="tabular-nums">
                            {formatBRL(activeQuoteSim.valorEntrada)}
                          </strong>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[#5B6472]">
                            Parcela mensal ({activeQuote.installmentsCount}x)
                          </span>
                          <strong className="tabular-nums">
                            {formatBRL(activeQuoteSim.primeiraParcela)}
                          </strong>
                        </div>
                        <Note
                          variant={
                            activeQuoteSim.efeitoCaixa === 'atencao'
                              ? 'warning'
                              : activeQuoteSim.efeitoCaixa === 'positivo'
                                ? 'success'
                                : 'info'
                          }
                          title="Simulação frente à folha"
                        >
                          {activeQuoteSim.mensagemCaixa}
                        </Note>
                      </div>
                    )}

                    <div className="border-t border-[#F0EEE9] pt-3 flex flex-col gap-2">
                      <strong className="text-xs font-bold text-[#14181F]">
                        Histórico de versões ({activeQuoteVersions.length || 1})
                      </strong>
                      {activeQuoteVersions.length > 0 ? (
                        <div className="flex flex-col gap-1.5 text-xs">
                          {activeQuoteVersions.slice(-4).map((v, idx) => (
                            <div
                              key={`${v.version}-${idx}`}
                              className="flex items-center justify-between gap-2 text-[#5B6472]"
                            >
                              <span>
                                <strong className="text-[#14181F]">{v.version}</strong> ·{' '}
                                {v.dateISO ? formatDateBR(v.dateISO) : '—'} · {v.note}
                              </span>
                              <span className="tabular-nums font-medium text-[#14181F] shrink-0">
                                {formatBRLCompact(v.totalValue)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-[#5B6472]">
                          {activeQuote.version || 'v1.0'} · Versão inicial
                        </span>
                      )}
                    </div>

                    {parseContractAddenda(activeQuote.contractAddenda).length > 0 && (
                      <div className="border-t border-[#F0EEE9] pt-3 text-xs flex justify-between">
                        <span className="text-[#5B6472]">Aditivos contratuais</span>
                        <strong className="tabular-nums text-[#14181F]">
                          {formatBRL(activeQuote.addendaTotalValue || 0)}
                        </strong>
                      </div>
                    )}
                  </Card>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ABA 2: ORÇAMENTOS */}
      {tab === 'Orçamentos' && (
        <Card
          title="Lista de orçamentos"
          subtitle="Composição, margem prevista comparada à meta, versionamento e status"
        >
          <DataList
            columns={quoteColumns}
            rows={quotes.rows} sort={quotes.sort}
            keyExtractor={(q) => q.id}
            onRowClick={(q) => openEditQuote(q)}
            emptyTitle="Nenhum orçamento nesta visualização"
            emptyDescription="Crie um orçamento com composição de custos, margem contra a meta e simulador de parcelas."
            emptyActionLabel="Novo orçamento"
            onEmptyAction={() => openNewQuote('')}
          />
        </Card>
      )}

      {/* ABA 3: CLIENTES */}
      {tab === 'Clientes' && (
        <>
          {activeClient ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-[#14181F]">
                    {activeClient.name}
                  </h2>
                  <p className="text-xs text-[#5B6472]">
                    {activeClient.origin}
                    {activeClient.referredBy
                      ? ` · Indicado por ${activeClient.referredBy}`
                      : ''}{' '}
                    · {activeClient.city || 'Valença · RJ'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setSelectedClientId('')}
                  >
                    Voltar à lista
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => openEditClientModal(activeClient)}
                  >
                    Editar cliente
                  </Button>
                  <RecordLifecycleButton uid={uid} record={{ entity: 'clients', id: activeClient.id, title: activeClient.name }}
                    onSaved={() => setSelectedClientId('')} />
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => openNewQuote(activeClient.id)}
                  >
                    Novo orçamento
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card title="Contato e origem">
                  <div className="flex flex-col gap-2 text-[13px]">
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5B6472]">Origem</span>
                      <strong>{activeClient.origin}</strong>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5B6472]">Quem indicou</span>
                      <strong>{activeClient.referredBy || '—'}</strong>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5B6472]">Localidade</span>
                      <strong>{activeClient.city || '—'}</strong>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5B6472]">Telefone</span>
                      <strong>{activeClient.phone || '—'}</strong>
                    </div>
                    <div className="flex justify-between gap-2">
                      <span className="text-[#5B6472]">E-mail</span>
                      <strong className="truncate">{activeClient.email || '—'}</strong>
                    </div>
                    <div className="flex justify-between items-center gap-2 pt-1">
                      <span className="text-[#5B6472]">Situação</span>
                      <StatusBadge label={activeClient.status} />
                    </div>
                    {activeClient.notes && (
                      <div className="pt-2 border-t border-[#F0EEE9] text-xs text-[#5B6472]">
                        {activeClient.notes}
                      </div>
                    )}
                  </div>
                </Card>

                <Card
                  className="lg:col-span-2"
                  title="Orçamentos e obras vinculadas"
                  subtitle={`${clientQuotes.length} orçamento(s) · ${clientProjects.length} obra(s)`}
                >
                  {clientQuotes.length === 0 && clientProjects.length === 0 ? (
                    <EmptyState
                      title="Nenhum orçamento ou obra vinculada"
                      description="Crie o primeiro orçamento para este cliente."
                      actionLabel="Novo orçamento"
                      onAction={() => openNewQuote(activeClient.id)}
                    />
                  ) : (
                    <div className="flex flex-col gap-2">
                      {clientQuotes.map((q) => (
                        <div
                          key={q.id}
                          className="flex flex-wrap items-center justify-between gap-2 border border-[#E4E1DA] rounded-[10px] px-3.5 py-2.5 text-[13px]"
                        >
                          <div>
                            <strong className="text-[#14181F]">
                              {q.code} ({q.version || 'v1.0'}) · {q.title}
                            </strong>
                            <span className="block text-xs text-[#5B6472]">
                              Orçamento · {q.type}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="tabular-nums">
                              {formatBRL(q.totalValue + (q.addendaTotalValue || 0))}
                            </strong>
                            <StatusBadge
                              label={
                                q.status === 'Perdido' && q.lossReason
                                  ? `Perdido · ${q.lossReason}`
                                  : q.status
                              }
                            />
                            {q.status !== 'Descartado' && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => openEditQuote(q)}
                              >
                                Abrir
                              </Button>
                            )}
                            {(q.status === 'Ganho' || q.projectId) && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => setContractModalQuoteId(q.id)}
                              >
                                {q.projectId ? 'Contrato e checklist' : 'Contrato'}
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}

                      {clientProjects.map((p) => (
                        <div
                          key={p.id}
                          className="flex flex-wrap items-center justify-between gap-2 bg-[#F6F5F2] border border-[#E4E1DA] rounded-[10px] px-3.5 py-2.5 text-[13px]"
                        >
                          <div>
                            <strong className="text-[#14181F]">{p.name}</strong>
                            <span className="block text-xs text-[#5B6472]">
                              Obra {p.contractKind || 'Principal'} · {p.type} · Previsão: {formatDateBR(p.forecastEndDate)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="tabular-nums">
                              {formatBRL(p.contractValue)}
                            </strong>
                            <StatusBadge label={p.status} />
                            {onProjectCreated && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => onProjectCreated(p.id)}
                              >
                                Planejamento
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              <WhatsAppHistory key={activeClient.id} clientId={activeClient.id} projects={clientProjects} />
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card
                  title="Garantia (1 ano pós-conclusão)"
                  actions={
                    clientProjects.some((project) => project.status === 'Concluída') ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          const project = clientProjects.find((row) => row.status === 'Concluída');
                          setPostInitialProjectId(project?.id ?? '');
                          setTab('Pós-obra');
                        }}
                      >
                        Abrir pós-obra
                      </Button>
                    ) : undefined
                  }
                >
                  <div className="flex flex-col gap-2 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-[#5B6472]">Início da garantia</span>
                      <strong>
                        {clientProjects.find((p) => p.warrantyStartDate)
                          ?.warrantyStartDate
                          ? formatDateBR(
                              clientProjects.find((p) => p.warrantyStartDate)!
                                .warrantyStartDate
                            )
                          : 'Na conclusão da obra'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5B6472]">Chamados abertos</span>
                      <strong className="tabular-nums">
                        {
                          clientWarrantyCalls.filter(
                            (w) => w.status !== 'Resolvido'
                          ).length
                        }
                      </strong>
                    </div>
                    {clientWarrantyCalls.length > 0 && (
                      <div className="flex flex-col gap-2 pt-2 border-t border-[#F0EEE9]">
                        {clientWarrantyCalls.map((w) => (
                          <div
                            key={w.id}
                            className="flex flex-wrap items-center justify-between gap-2 bg-[#F6F5F2] rounded-[8px] px-3 py-2 text-xs"
                          >
                            <div>
                              <strong className="text-[#14181F] block">
                                {w.projectName}
                              </strong>
                              <span className="text-[#5B6472]">
                                {w.description} · Prazo {formatDateBR(w.deadlineDate)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <StatusBadge label={w.status} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>

                <Card
                  title="Indicações e depoimento"
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setReferralModalClient(activeClient);
                        setRCount(String(activeClient.referralsCount ?? 0));
                        setRTestimonial(
                          activeClient.testimonialStatus || 'Aguardando conclusão'
                        );
                        setRActor('Sócio');
                      }}
                    >
                      Atualizar
                    </Button>
                  }
                >
                  <div className="flex flex-col gap-2 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-[#5B6472]">Depoimento e fotos</span>
                      <strong>
                        {activeClient.testimonialStatus || 'Aguardando conclusão'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5B6472]">
                        Indicações recebidas deste cliente
                      </span>
                      <strong className="tabular-nums">
                        {activeClient.referralsCount ?? 0}
                      </strong>
                    </div>
                    <Note variant="soft" title="Pós-obra">
                      Ao concluir a obra, registre o pedido de depoimento, fotos autorizadas e novas indicações geradas.
                    </Note>
                  </div>
                </Card>
              </div>
            </div>
          ) : (
            <Card
              title="Clientes cadastrados"
              subtitle="Clique em um cliente para ver contato, indicações, orçamentos, obras e garantia"
            >
              <DataList
                columns={clientColumns}
                rows={clients.rows} sort={clients.sort}
                keyExtractor={(c) => c.id}
                onRowClick={(c) => setSelectedClientId(c.id, { push: true })}
                emptyTitle="Nenhum cliente nesta visualização"
                emptyDescription="Cadastre seu primeiro cliente informando origem do contato e quem indicou."
                emptyActionLabel="Novo cliente"
                onEmptyAction={openNewClientModal}
              />
            </Card>
          )}
        </>
      )}

      {/* ABA 4: LICITAÇÕES */}
      {tab === 'Pós-obra' && <PostConstructionView key={postInitialProjectId} uid={uid} data={data} initialProjectId={postInitialProjectId} />}

      {tab === 'Licitações' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card
            className="lg:col-span-2"
            title="Editais acompanhados"
            subtitle="Órgão, objeto, abertura, valor estimado e status"
            actions={
              <Button size="sm" variant="primary" onClick={openNewTenderModal}>
                Novo edital
              </Button>
            }
          >
            <DataList
              columns={tenderColumns}
              rows={tenders.rows} sort={tenders.sort}
              keyExtractor={(t) => t.id}
              onRowClick={(t) => openEditTenderModal(t)}
              emptyTitle="Nenhum edital cadastrado"
              emptyDescription="Registre editais públicos para acompanhar abertura, valores e prontidão de habilitação."
              emptyActionLabel="Novo edital"
              onEmptyAction={openNewTenderModal}
            />
          </Card>

          <Card
            title="Prontidão para licitar"
            subtitle="Calculada pelos itens em Conformidade › Licitações"
          >
            <strong className="text-2xl font-bold tabular-nums text-[#14181F]">
              {tenderReadiness !== null ? `${tenderReadiness}%` : 'Sem dados'}
            </strong>
            <ProgressBar pct={tenderReadiness ?? 0} />

            {tenderReadinessByCategory.length === 0 ? (
              <Note variant="info" title="Sem itens de habilitação cadastrados">
                Cadastre certidões, acervos e balanços em Conformidade › Licitações para calcular a prontidão por categoria.
              </Note>
            ) : (
              <div className="flex flex-col gap-3 pt-1">
                {tenderReadinessByCategory.map((cat) => (
                  <div key={cat.categoria} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-[#14181F]">{cat.categoria}</span>
                      <span className="text-[#5B6472] tabular-nums">
                        {cat.statusRotulo} ({cat.prontos}/{cat.total})
                      </span>
                    </div>
                    <ProgressBar
                      pct={cat.pct}
                      tone={
                        cat.pct === 100
                          ? 'success'
                          : cat.pct === 0
                            ? 'danger'
                            : 'warning'
                      }
                    />
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ABA 5: RASCUNHOS DESCARTADOS */}
      {tab === 'Rascunhos descartados' && (
        <Card
          title="Rascunhos descartados"
          subtitle="Orçamentos descartados ficam registrados com o motivo e podem ser reativados a qualquer momento"
        >
          <DataList
            columns={discardedColumns}
            rows={discarded.rows} sort={discarded.sort}
            keyExtractor={(q) => q.id}
            emptyTitle="Nenhum rascunho descartado"
            emptyDescription="Quando um orçamento for descartado no funil, ele ficará salvo aqui com o motivo registrado."
          />
        </Card>
      )}

      {/* MODAL: CLIENTE (Novo / Editar) */}
      <Modal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={editingClient ? `Editar · ${editingClient.name}` : 'Novo cliente'}
      >
        <form onSubmit={handleSaveClient} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Nome do cliente"
              required
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              placeholder="Nome completo ou razão social"
            />
            <Select
              label="Origem do contato"
              required
              value={cOrigin}
              onChange={(e) => setCOrigin(e.target.value)}
            >
              <option value="" disabled>Selecione a origem</option>
              {CLIENT_ORIGINS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </Select>
          </div>

          <Input
            label="Quem indicou"
            value={cReferredBy}
            onChange={(e) => setCReferredBy(e.target.value)}
            placeholder="Nome de quem fez a indicação"
            help="Preencha quando houver indicação ou parceria."
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Input
              label="Localidade / Cidade"
              value={cCity}
              onChange={(e) => setCCity(e.target.value)}
            />
            <Input
              label="Telefone"
              value={cPhone}
              onChange={(e) => setCPhone(e.target.value)}
              placeholder="(24) 99999-9999"
            />
            <Select
              label="Situação"
              value={cStatus}
              onChange={(e) => setCStatus(e.target.value as ClientStatus)}
            >
              <option value="Potencial">Potencial</option>
              <option value="Ativo">Ativo</option>
              <option value="Em garantia">Em garantia</option>
              <option value="Inativo">Inativo</option>
            </Select>
          </div>

          <Input
            label="E-mail"
            type="email"
            value={cEmail}
            onChange={(e) => setCEmail(e.target.value)}
            placeholder="E-mail do cliente"
          />

          <Textarea
            label="Observações"
            rows={2}
            value={cNotes}
            onChange={(e) => setCNotes(e.target.value)}
          />

          <RegisteredBySelect value={cActor} onChange={setCActor} id="client-actor" />

          <div className="flex justify-end gap-2.5 pt-1">
            <Button variant="secondary" onClick={() => setClientModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={cSaving}>
              {cSaving ? 'Salvando...' : editingClient ? 'Salvar alterações' : 'Salvar cliente'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(linkedDiscardedQuote)} onClose={() => setRecordId('')}
        title={linkedDiscardedQuote?.title ?? 'Rascunho descartado'}>
        {linkedDiscardedQuote && <div className="grid gap-3 text-sm">
          <p>{linkedDiscardedQuote.code} · {linkedDiscardedQuote.clientName}</p>
          <StatusBadge label="Descartado" />
          <p>Valor · {formatBRL(linkedDiscardedQuote.totalValue)}</p>
          <p className="break-words">Motivo · {linkedDiscardedQuote.discardReason || 'Sem dados'}</p>
          <Button variant="secondary" onClick={() => {
            setRecordId('');
            setReactivateQuote(linkedDiscardedQuote);
            setReactivateStatus('Em negociação');
            setReactivateActor('Sócio');
          }}>Reativar orçamento</Button>
        </div>}
      </Modal>

      {/* MODAL: ORÇAMENTO (Novo / Editar / Nova versão / Simulador) */}
      <QuoteEditorModal
        open={isQuoteModalOpen}
        onClose={closeQuoteModal}
        uid={uid}
        editingQuote={linkedEditableQuote ?? editingQuote}
        preselectedClientId={preselectedQuoteClientId}
        clients={data.clients}
        quotesCount={data.quotes.length}
        employees={data.employees}
        settings={data.settings}
        onSaved={(id) => {
          setSelectedQuoteId(id);
          showToast({
            tone: 'success',
            title: (linkedEditableQuote || editingQuote) ? 'Orçamento atualizado.' : 'Orçamento criado.',
          });
        }}
        onRequestNewClient={openNewClientModal}
      />

      <ConfirmQuoteModal
        open={confirmingQuote !== null}
        onClose={() => setConfirmingQuoteId(null)}
        quote={confirmingQuote}
        uid={uid}
        clients={data.clients}
        onConfirmed={(quoteId, result) => {
          setSelectedQuoteId(quoteId);
          setContractModalQuoteId(quoteId);
          showToast({
            tone: 'success',
            title: `Obra contratada com ${result.parcelasCount} parcela(s), PDF e checklist.`,
          });
        }}
      />

      {/* MODAL: CONTRATO (PDF + Status + Checklist + Aditivos) */}
      <ContractModal
        open={Boolean(contractModalQuoteId)}
        onClose={() => setContractModalQuoteId(null)}
        quote={contractQuote}
        wonQuotes={wonQuotes}
        onSelectQuoteId={(id) => setContractModalQuoteId(id)}
        settings={data.settings}
        uid={uid}
        projects={data.projects}
        complianceItems={data.complianceItems}
        customerMaterials={data.customerMaterials}
        stages={data.stages}
        installmentsCountByProject={installmentsCountByProject}
        onNavigateToPlanning={onProjectCreated}
        onNavigateToReceivables={onNavigateToReceivables}
      />

      {/* MODAL: MOVER NO FUNIL (com motivo obrigatório quando Perdido) */}
      <Modal
        open={Boolean(stageModalQuote)}
        onClose={() => setStageModalQuote(null)}
        title={
          stageModalQuote
            ? `Mover ${stageModalQuote.code} no funil`
            : 'Mover orçamento'
        }
      >
        <form onSubmit={handleSaveStageTransition} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Select
              label="Novo status"
              value={stageNextStatus}
              onChange={(e) => setStageNextStatus(e.target.value as QuoteStatus)}
            >
              <option value="Rascunho">Rascunho</option>
              <option value="Enviado">Enviado</option>
              <option value="Em negociação">Em negociação</option>
              <option value="Ganho">Ganho (congela valor aprovado)</option>
              <option value="Perdido">Perdido</option>
            </Select>
            <Input
              label="Probabilidade (%)"
              type="number"
              min={0}
              max={100}
              step="0.01"
              required={stageNextStatus === 'Enviado' || stageNextStatus === 'Em negociação'}
              disabled={stageNextStatus === 'Ganho' || stageNextStatus === 'Perdido'}
              value={
                stageNextStatus === 'Perdido'
                  ? '0'
                  : stageNextStatus === 'Ganho'
                    ? '100'
                    : stageNextProb
              }
              onChange={(e) => setStageNextProb(e.target.value)}
              className="tabular-nums"
            />
          </div>

          {stageNextStatus === 'Perdido' && (
            <Input
              label="Motivo da perda"
              required
              value={stageLossReason}
              onChange={(e) => setStageLossReason(e.target.value)}
              placeholder="Motivo da perda"
            />
          )}

          {stageNextStatus === 'Ganho' && (
            <Note variant="warning" title="Congelamento ao aprovar">
              Ao marcar como Ganho, o valor fechado ({formatBRL(stageModalQuote?.totalValue ?? 0)}) e a composição de custos ficam congelados e só mudam por aditivo no contrato.
            </Note>
          )}

          <RegisteredBySelect
            value={stageActor}
            onChange={setStageActor}
            id="stage-transition-actor"
          />

          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setStageModalQuote(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={stageSaving}>
              {stageSaving ? 'Salvando...' : 'Confirmar mudança'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: DESCARTAR ORÇAMENTO */}
      <Modal
        open={Boolean(discardQuote)}
        onClose={() => setDiscardQuote(null)}
        title="Descartar orçamento"
      >
        <form onSubmit={handleDiscardQuote} className="flex flex-col gap-4">
          <Input
            label="Motivo do descarte"
            required
            value={discardReason}
            onChange={(e) => setDiscardReason(e.target.value)}
            placeholder="Motivo do descarte"
          />
          <RegisteredBySelect
            value={discardActor}
            onChange={setDiscardActor}
            id="discard-actor"
          />
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setDiscardQuote(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={discardSaving}>
              {discardSaving ? 'Movendo...' : 'Mover para descartados'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: REATIVAR RASCUNHO DESCARTADO */}
      <Modal
        open={Boolean(reactivateQuote)}
        onClose={() => setReactivateQuote(null)}
        title={
          reactivateQuote
            ? `Reativar ${reactivateQuote.code}`
            : 'Reativar orçamento'
        }
      >
        <form onSubmit={handleReactivateQuote} className="flex flex-col gap-4">
          <Select
            label="Retornar para qual coluna do funil?"
            value={reactivateStatus}
            onChange={(e) =>
              setReactivateStatus(e.target.value as 'Rascunho' | 'Em negociação')
            }
          >
            <option value="Rascunho">Rascunho</option>
            <option value="Em negociação">Em negociação</option>
          </Select>
          <RegisteredBySelect
            value={reactivateActor}
            onChange={setReactivateActor}
            id="reactivate-actor"
          />
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setReactivateQuote(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={reactivateSaving}>
              {reactivateSaving ? 'Reativando...' : 'Reativar orçamento'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: EDITAL (Novo / Editar) */}
      <Modal
        open={tenderModalOpen}
        onClose={() => setTenderModalOpen(false)}
        title={editingTender ? 'Editar edital' : 'Novo edital'}
      >
        <form onSubmit={handleSaveTender} className="flex flex-col gap-4">
          <Input
            label="Órgão"
            required
            value={tAgency}
            onChange={(e) => setTAgency(e.target.value)}
            placeholder="Órgão responsável"
          />
          <Input
            label="Objeto"
            required
            value={tObject}
            onChange={(e) => setTObject(e.target.value)}
            placeholder="Objeto do edital"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Data de abertura"
              type="date"
              required
              value={tDate}
              onChange={(e) => setTDate(e.target.value)}
            />
            <Input
              label="Valor estimado (R$)"
              type="number"
              min={0}
              step="0.01"
              required
              value={tValue}
              onChange={(e) => setTValue(e.target.value)}
              className="tabular-nums"
            />
            <Select
              label="Status"
              value={tStatus}
              onChange={(e) => setTStatus(e.target.value as TenderStatus)}
            >
              <option value="Acompanhando">Acompanhando</option>
              <option value="Em preparo">Em preparo</option>
              <option value="Documentos pendentes">Documentos pendentes</option>
              <option value="Enviado">Enviado</option>
              <option value="Encerrado">Encerrado</option>
            </Select>
          </div>
          <Textarea
            label="Observações"
            rows={2}
            value={tNotes}
            onChange={(e) => setTNotes(e.target.value)}
          />
          <RegisteredBySelect
            value={tActor}
            onChange={setTActor}
            id="tender-actor"
          />
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setTenderModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={tSaving}>
              {tSaving ? 'Salvando...' : editingTender ? 'Salvar edital' : 'Cadastrar edital'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: INDICAÇÕES E DEPOIMENTO DO CLIENTE */}
      <Modal
        open={Boolean(referralModalClient)}
        onClose={() => setReferralModalClient(null)}
        title="Indicações e depoimento"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!referralModalClient) return;
            setRSaving(true);
            try {
              await updateRecord(
                'clients',
                referralModalClient.id,
                uid,
                rActor,
                {
                  referralsCount: Math.max(0, Number(rCount) || 0),
                  testimonialStatus: clampStr(rTestimonial, 60),
                },
                `Indicações/depoimento atualizados: ${referralModalClient.name}`
              );
              showToast({ tone: 'success', title: 'Indicações e depoimento salvos.' });
              setReferralModalClient(null);
            } finally {
              setRSaving(false);
            }
          }}
          className="flex flex-col gap-4"
        >
          <Input
            label="Quantidade de indicações recebidas"
            type="number"
            min={0}
            value={rCount}
            onChange={(e) => setRCount(e.target.value)}
            className="tabular-nums"
          />
          <Select
            label="Situação do depoimento"
            value={rTestimonial}
            onChange={(e) => setRTestimonial(e.target.value)}
          >
            <option value="Aguardando conclusão">Aguardando conclusão</option>
            <option value="Solicitado">Solicitado</option>
            <option value="Recebido">Recebido</option>
            <option value="Recebido · fotos autorizadas">
              Recebido · fotos autorizadas
            </option>
          </Select>
          <RegisteredBySelect
            value={rActor}
            onChange={setRActor}
            id="referral-actor"
          />
          <div className="flex justify-end gap-2.5">
            <Button variant="secondary" onClick={() => setReferralModalClient(null)}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={rSaving}>
              {rSaving ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </Modal>

    </div>
  );
}
