import { useMemo, useState } from 'react';
import {
  AlertNote,
  EmptySection,
  KpiCard,
  Modal,
  PageHeader,
  ProgressBar,
  RegisteredBySelect,
  StatusBadge,
  Tabs,
} from '../components/ui/PilotisUI';
import { createRecord, updateRecord } from '../services/pilotisService';
import type {
  ActorRole,
  ComplianceItem,
  ComplianceKind,
  ComplianceStatus,
  PilotisDataState,
} from '../types/pilotis';
import { computeTenderReadinessPct } from '../utils/calculations';
import {
  clampStr,
  diffDaysFromToday,
  formatBRL,
  formatDateBR,
  todayISO,
} from '../utils/formatters';

const COMP_TABS = [
  'Obrigações',
  'Certidões',
  'Documentos por obra',
  'Notas fiscais',
  'Licitações',
];

export function ComplianceView({
  uid,
  data,
  companyEmail,
}: {
  uid: string;
  data: PilotisDataState;
  companyEmail?: string | null;
}) {
  const [tab, setTab] = useState('Obrigações');
  const [selectedProjectId, setSelectedProjectId] = useState<string>(data.projects[0]?.id || 'ALL');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ComplianceItem | null>(null);
  const [invoiceConfirmTxId, setInvoiceConfirmTxId] = useState<string>('');
  const [invoiceActor, setInvoiceActor] = useState<ActorRole>('Responsável administrativo');

  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad' | 'info'; title: string; text: string } | null>(null);

  // Item form
  const [kind, setKind] = useState<ComplianceKind>('Obrigação');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('Fiscal');
  const [projectId, setProjectId] = useState('');
  const [competence, setCompetence] = useState('');
  const [dueDate, setDueDate] = useState(todayISO());
  const [issuedDate, setIssuedDate] = useState('');
  const [fileName, setFileName] = useState('');
  const [mandatory, setMandatory] = useState(true);
  const [status, setStatus] = useState<ComplianceStatus>('Pendente');
  const [notes, setNotes] = useState('');
  const [actor, setActor] = useState<ActorRole>('Responsável administrativo');

  const obligations = data.complianceItems.filter((c) => c.kind === 'Obrigação');
  const certs = data.complianceItems.filter((c) => c.kind === 'Certidão');
  const workDocs = data.complianceItems.filter((c) => c.kind === 'Documento de obra');
  const tenderDocs = data.complianceItems.filter((c) => c.kind === 'Licitação');

  const filteredWorkDocs = workDocs.filter((d) =>
    selectedProjectId === 'ALL' || !selectedProjectId ? true : d.projectId === selectedProjectId
  );

  const pendingInvoices = useMemo(
    () =>
      data.transactions.filter(
        (t) =>
          t.entryKind === 'income' &&
          (t.invoiceStatus === 'Não emitida' || t.invoiceStatus === 'A emitir')
      ),
    [data.transactions]
  );

  const unissuedInvoiceAmount = useMemo(() => {
    const hasIncome = data.transactions.some((t) => t.entryKind === 'income');
    if (!hasIncome) return null;
    return pendingInvoices.reduce((s, t) => s + t.amount, 0);
  }, [data.transactions, pendingInvoices]);

  const obligationsDueCount = useMemo(() => {
    if (obligations.length === 0) return null;
    return obligations.filter((o) => {
      if (o.status === 'Em atraso' || o.status === 'Pendente' || o.status === 'Vence em breve') return true;
      const days = diffDaysFromToday(o.dueDate);
      return days !== null && days <= 30 && o.status !== 'Em dia';
    }).length;
  }, [obligations]);

  const validCertsCount = useMemo(() => {
    if (certs.length === 0) return null;
    return certs.filter((c) => c.status === 'Válida' || c.status === 'Em dia').length;
  }, [certs]);

  const pendingWorkDocsCount = useMemo(() => {
    if (workDocs.length === 0) return null;
    return workDocs.filter((d) => d.status === 'Pendente' || d.status === 'Parcial').length;
  }, [workDocs]);

  const tenderReadinessPct = computeTenderReadinessPct(data.complianceItems);

  function openNewModal(defaultKind: ComplianceKind) {
    setEditingItem(null);
    setKind(defaultKind);
    setTitle('');
    setCategory(defaultKind === 'Licitação' ? 'Regularidade fiscal' : defaultKind === 'Documento de obra' ? 'Obra' : 'Fiscal');
    setProjectId(defaultKind === 'Documento de obra' ? data.projects[0]?.id || '' : '');
    setCompetence('');
    setDueDate(todayISO());
    setIssuedDate('');
    setFileName('');
    setMandatory(true);
    setStatus(defaultKind === 'Certidão' ? 'Válida' : 'Pendente');
    setNotes('');
    setActor('Responsável administrativo');
    setModalOpen(true);
  }

  function openEditModal(item: ComplianceItem) {
    setEditingItem(item);
    setKind(item.kind);
    setTitle(item.title);
    setCategory(item.category || '');
    setProjectId(item.projectId || '');
    setCompetence(item.competence || '');
    setDueDate(item.dueDate || '');
    setIssuedDate(item.issuedDate || '');
    setFileName(item.fileName || '');
    setMandatory(Boolean(item.mandatory));
    setStatus(item.status);
    setNotes(item.notes || '');
    setActor('Responsável administrativo');
    setModalOpen(true);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const proj = data.projects.find((p) => p.id === projectId);
      const payload = {
        kind,
        title: clampStr(title, 160),
        category: clampStr(category, 80),
        projectId: proj?.id || '',
        projectName: clampStr(proj?.name || '', 160),
        competence: clampStr(competence, 40),
        dueDate,
        issuedDate,
        fileName: clampStr(fileName, 160),
        mandatory,
        status,
        notes: clampStr(notes, 500),
      };

      if (editingItem) {
        await updateRecord(
          'complianceItems',
          editingItem.id,
          uid,
          actor,
          payload,
          `Item de conformidade atualizado: ${payload.title} (${payload.status})`,
          editingItem.status,
          payload.status
        );
        setFeedback({
          tone: 'ok',
          title: 'Registro atualizado',
          text: `${payload.title} atualizado para "${payload.status}".`,
        });
      } else {
        await createRecord(
          'complianceItems',
          uid,
          actor,
          payload,
          `Novo item em Conformidade (${kind}): ${payload.title}`
        );
        setFeedback({
          tone: 'ok',
          title: 'Item registrado',
          text: `${payload.title} salvo em ${kind}.`,
        });
      }
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkInvoiceIssued(e: React.FormEvent) {
    e.preventDefault();
    const tx = data.transactions.find((t) => t.id === invoiceConfirmTxId);
    if (!tx) return;
    setSaving(true);
    try {
      await updateRecord(
        'transactions',
        tx.id,
        uid,
        invoiceActor,
        { invoiceStatus: 'Emitida' },
        `Nota fiscal emitida: ${tx.description}`,
        tx.invoiceStatus,
        'Emitida'
      );
      setInvoiceConfirmTxId('');
      setFeedback({
        tone: 'ok',
        title: 'Nota fiscal marcada como emitida',
        text: `${tx.description} atualizado no Financeiro e na Conformidade.`,
      });
    } finally {
      setSaving(false);
    }
  }

  const defaultKindForTab: ComplianceKind =
    tab === 'Certidões'
      ? 'Certidão'
      : tab === 'Documentos por obra'
      ? 'Documento de obra'
      : tab === 'Licitações'
      ? 'Licitação'
      : 'Obrigação';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Conformidade e Documentos"
        subtitle="Obrigações, certidões, documentos obrigatórios por obra, notas fiscais e licitações"
        companyEmail={companyEmail}
        actions={
          <button
            type="button"
            onClick={() => openNewModal(defaultKindForTab)}
            className="px-4 py-2.5 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold hover:bg-[#182E4C] cursor-pointer"
          >
            {tab === 'Certidões'
              ? 'Registrar certidão'
              : tab === 'Documentos por obra'
              ? 'Registrar documento'
              : tab === 'Licitações'
              ? 'Novo item de habilitação'
              : 'Nova obrigação'}
          </button>
        }
      />

      {feedback && (
        <AlertNote tone={feedback.tone} title={feedback.title}>
          {feedback.text}
        </AlertNote>
      )}

      <Tabs items={COMP_TABS} active={tab} onChange={setTab} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Obrigações a vencer / atraso"
          value={obligationsDueCount !== null ? String(obligationsDueCount) : 'Sem dados'}
          subtext={
            obligations.length > 0
              ? `${obligations.length} obrigação(ões) cadastrada(s)`
              : 'Nenhuma obrigação cadastrada'
          }
          isEmpty={obligationsDueCount === null}
        />
        <KpiCard
          label="Certidões válidas"
          value={validCertsCount !== null ? `${validCertsCount} de ${certs.length}` : 'Sem dados'}
          subtext={certs.length > 0 ? 'Controle de validade' : 'Nenhuma certidão registrada'}
          isEmpty={validCertsCount === null}
        />
        <KpiCard
          label="Receita sem nota emitida"
          value={unissuedInvoiceAmount !== null ? formatBRL(unissuedInvoiceAmount) : 'Sem dados'}
          subtext={
            pendingInvoices.length > 0
              ? `${pendingInvoices.length} lançamento(s) pendente(s)`
              : 'Sincronizado com o Financeiro'
          }
          isEmpty={unissuedInvoiceAmount === null}
        />
        <KpiCard
          label="Documentos de obra pendentes"
          value={pendingWorkDocsCount !== null ? String(pendingWorkDocsCount) : 'Sem dados'}
          subtext={
            workDocs.length > 0
              ? `${workDocs.length} documento(s) monitorado(s)`
              : 'Gerado ao confirmar orçamentos'
          }
          isEmpty={pendingWorkDocsCount === null}
        />
      </div>

      {tab === 'Obrigações' && (
        obligations.length === 0 ? (
          <EmptySection
            title="Nenhuma obrigação cadastrada"
            description="Registre guias mensais, obrigações fiscais e trabalhistas (Simples Nacional, ISS, FGTS, eSocial) para monitorar vencimentos."
            actionLabel="Cadastrar primeira obrigação"
            onAction={() => openNewModal('Obrigação')}
          />
        ) : (
          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <h2 className="text-base font-semibold text-[#14181F]">Obrigações cadastradas</h2>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                    <th className="py-2.5 px-3 rounded-l-lg">Obrigação</th>
                    <th className="py-2.5 px-3">Categoria</th>
                    <th className="py-2.5 px-3">Competência</th>
                    <th className="py-2.5 px-3">Vencimento</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {obligations.map((o) => (
                    <tr key={o.id} className="border-b border-[#E4E1DA] text-[13px]">
                      <td className="py-3 px-3 font-medium text-[#14181F]">{o.title}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{o.category || '—'}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{o.competence || '—'}</td>
                      <td className="py-3 px-3 text-[#14181F] tabular-nums">{formatDateBR(o.dueDate)}</td>
                      <td className="py-3 px-3">
                        <StatusBadge label={o.status} />
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(o)}
                          className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                        >
                          Atualizar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden flex flex-col gap-3">
              {obligations.map((o) => (
                <div key={o.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-[#14181F]">{o.title}</strong>
                    <StatusBadge label={o.status} />
                  </div>
                  <span className="text-xs text-[#5B6472]">
                    Vencimento: {formatDateBR(o.dueDate)} · {o.category}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditModal(o)}
                    className="self-start text-xs font-semibold text-[#1F3A5F] cursor-pointer"
                  >
                    Atualizar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )
      )}

      {tab === 'Certidões' && (
        certs.length === 0 ? (
          <EmptySection
            title="Nenhuma certidão registrada"
            description="Cadastre certidões negativas (RFB/PGFN, Estadual, Municipal, FGTS CRF, CNDT) com data de emissão e validade."
            actionLabel="Registrar primeira certidão"
            onAction={() => openNewModal('Certidão')}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <h2 className="text-base font-semibold text-[#14181F]">Certidões</h2>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <th className="py-2.5 px-3 rounded-l-lg">Certidão</th>
                      <th className="py-2.5 px-3">Emitida em</th>
                      <th className="py-2.5 px-3">Validade</th>
                      <th className="py-2.5 px-3">Situação</th>
                      <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certs.map((c) => {
                      const days = diffDaysFromToday(c.dueDate);
                      const statusDisplay =
                        days !== null && days < 0
                          ? 'Em atraso'
                          : days !== null && days <= 30 && c.status !== 'Em atraso'
                          ? `Vence em ${days}d`
                          : c.status;
                      return (
                        <tr key={c.id} className="border-b border-[#E4E1DA] text-[13px]">
                          <td className="py-3 px-3 font-medium text-[#14181F]">{c.title}</td>
                          <td className="py-3 px-3 text-[#5B6472] tabular-nums">{formatDateBR(c.issuedDate)}</td>
                          <td className="py-3 px-3 text-[#14181F] tabular-nums">{formatDateBR(c.dueDate)}</td>
                          <td className="py-3 px-3">
                            <StatusBadge label={statusDisplay} />
                          </td>
                          <td className="py-3 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => openEditModal(c)}
                              className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                            >
                              Atualizar / renovar
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden flex flex-col gap-3">
                {certs.map((c) => (
                  <div key={c.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-[#14181F]">{c.title}</strong>
                      <StatusBadge label={c.status} />
                    </div>
                    <span className="text-xs text-[#5B6472]">Validade: {formatDateBR(c.dueDate)}</span>
                    <button
                      type="button"
                      onClick={() => openEditModal(c)}
                      className="self-start text-xs font-semibold text-[#1F3A5F] cursor-pointer"
                    >
                      Atualizar
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <AlertNote tone="info" title="Tributos em atraso">
              Pendências fiscais podem impedir a emissão de certidões negativas. Valide parcelamentos com o contador.
            </AlertNote>
          </div>
        )
      )}

      {tab === 'Documentos por obra' && (
        workDocs.length === 0 ? (
          <EmptySection
            title="Nenhum documento de obra registrado"
            description="Ao confirmar um orçamento, o sistema gera o checklist obrigatório da obra (Contrato, ART/RRT, Matrícula CNO, Responsável técnico). Você também pode cadastrar documentos avulsos."
            actionLabel="Registrar documento de obra"
            onAction={() => openNewModal('Documento de obra')}
          />
        ) : (
          <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-[#14181F]">Checklist de documentos por obra</h2>
              <select
                aria-label="Filtrar por obra"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="rounded-lg border border-[#E4E1DA] bg-white px-3 py-1.5 text-sm"
              >
                <option value="ALL">Todas as obras</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="hidden md:block overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                    <th className="py-2.5 px-3 rounded-l-lg">Documento</th>
                    <th className="py-2.5 px-3">Obra</th>
                    <th className="py-2.5 px-3">Obrigatório</th>
                    <th className="py-2.5 px-3">Arquivo</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWorkDocs.map((d) => (
                    <tr key={d.id} className="border-b border-[#E4E1DA] text-[13px]">
                      <td className="py-3 px-3 font-medium text-[#14181F]">{d.title}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{d.projectName || 'Geral'}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{d.mandatory ? 'Sim' : 'Não'}</td>
                      <td className="py-3 px-3 text-[#5B6472]">{d.fileName || '—'}</td>
                      <td className="py-3 px-3">
                        <StatusBadge label={d.status} />
                      </td>
                      <td className="py-3 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditModal(d)}
                          className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                        >
                          Anexar / atualizar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="md:hidden flex flex-col gap-3">
              {filteredWorkDocs.map((d) => (
                <div key={d.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-sm text-[#14181F]">{d.title}</strong>
                    <StatusBadge label={d.status} />
                  </div>
                  <span className="text-xs text-[#5B6472]">
                    {d.projectName || 'Geral'} · {d.fileName || 'Sem arquivo'}
                  </span>
                  <button
                    type="button"
                    onClick={() => openEditModal(d)}
                    className="self-start text-xs font-semibold text-[#1F3A5F] cursor-pointer"
                  >
                    Atualizar
                  </button>
                </div>
              ))}
            </div>
          </section>
        )
      )}

      {tab === 'Notas fiscais' && (
        pendingInvoices.length === 0 ? (
          <EmptySection
            title="Nenhuma nota fiscal pendente"
            description="Todos os recebimentos cadastrados no Financeiro estão com nota emitida ou ainda não há receitas cadastradas."
          />
        ) : (
          <div className="flex flex-col gap-4">
            <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <h2 className="text-base font-semibold text-[#14181F]">Recebimentos sem nota emitida</h2>
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <th className="py-2.5 px-3 rounded-l-lg">Data / vencimento</th>
                      <th className="py-2.5 px-3">Obra</th>
                      <th className="py-2.5 px-3">Descrição / parcela</th>
                      <th className="py-2.5 px-3 text-right">Valor</th>
                      <th className="py-2.5 px-3">Nota fiscal</th>
                      <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingInvoices.map((tx) => (
                      <tr key={tx.id} className="border-b border-[#E4E1DA] text-[13px]">
                        <td className="py-3 px-3 text-[#5B6472] tabular-nums">
                          {formatDateBR(tx.dueDate || tx.date)}
                        </td>
                        <td className="py-3 px-3 font-medium text-[#14181F]">{tx.projectName}</td>
                        <td className="py-3 px-3 text-[#5B6472]">{tx.description}</td>
                        <td className="py-3 px-3 text-right font-semibold text-[#14181F] tabular-nums">
                          {formatBRL(tx.amount)}
                        </td>
                        <td className="py-3 px-3">
                          <StatusBadge label={tx.invoiceStatus} />
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setInvoiceConfirmTxId(tx.id)}
                            className="px-3 py-1 rounded-lg border border-[#E4E1DA] text-xs font-semibold text-[#14181F] hover:bg-[#F0EEE9] cursor-pointer"
                          >
                            Marcar como emitida
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden flex flex-col gap-3">
                {pendingInvoices.map((tx) => (
                  <div key={tx.id} className="border border-[#E4E1DA] rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <strong className="text-sm text-[#14181F]">{tx.projectName}</strong>
                      <StatusBadge label={tx.invoiceStatus} />
                    </div>
                    <span className="text-xs text-[#5B6472]">{tx.description}</span>
                    <div className="flex items-center justify-between">
                      <strong className="text-sm tabular-nums">{formatBRL(tx.amount)}</strong>
                      <button
                        type="button"
                        onClick={() => setInvoiceConfirmTxId(tx.id)}
                        className="px-3 py-1 rounded-lg border border-[#E4E1DA] text-xs font-semibold cursor-pointer"
                      >
                        Marcar emitida
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <AlertNote tone="info" title="Conciliação fiscal">
              Receitas sem nota fiscal emitida exigem atenção contábil para não gerar divergência na apuração tributária.
            </AlertNote>
          </div>
        )
      )}

      {tab === 'Licitações' && (
        tenderDocs.length === 0 ? (
          <EmptySection
            title="Nenhum item de habilitação cadastrado"
            description="Cadastre os requisitos de habilitação (regularidade fiscal, qualificação técnica, acervo e balanço patrimonial) para acompanhar a prontidão da empresa."
            actionLabel="Cadastrar item de habilitação"
            onAction={() => openNewModal('Licitação')}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <section className="lg:col-span-2 bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-4">
              <h2 className="text-base font-semibold text-[#14181F]">Checklist de habilitação</h2>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#F0EEE9] text-left text-xs font-semibold text-[#5B6472]">
                      <th className="py-2.5 px-3 rounded-l-lg">Categoria</th>
                      <th className="py-2.5 px-3">Item</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right rounded-r-lg">Ação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tenderDocs.map((item) => (
                      <tr key={item.id} className="border-b border-[#E4E1DA] text-[13px]">
                        <td className="py-3 px-3 text-[#5B6472]">{item.category || 'Geral'}</td>
                        <td className="py-3 px-3 font-medium text-[#14181F]">{item.title}</td>
                        <td className="py-3 px-3">
                          <StatusBadge label={item.status} />
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => openEditModal(item)}
                            className="text-xs font-semibold text-[#1F3A5F] hover:underline cursor-pointer"
                          >
                            Atualizar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div className="flex flex-col gap-4">
              <section className="bg-white border border-[#E4E1DA] rounded-xl p-5 flex flex-col gap-3">
                <h2 className="text-base font-semibold text-[#14181F]">Prontidão geral</h2>
                <strong className="text-3xl font-bold text-[#14181F] tabular-nums">
                  {tenderReadinessPct !== null ? `${tenderReadinessPct}%` : 'Sem dados'}
                </strong>
                <ProgressBar pct={tenderReadinessPct ?? 0} />
                <span className="text-xs text-[#5B6472]">
                  Percentual calculado automaticamente a partir dos itens concluídos no checklist.
                </span>
              </section>
              <AlertNote tone="info" title="Regularização técnica e contábil">
                Acervo técnico, certidões e balanço patrimonial ficam centralizados aqui e refletem nos editais em Clientes e Orçamentos.
              </AlertNote>
            </div>
          </div>
        )
      )}

      {/* Compliance Item Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingItem ? `Atualizar · ${editingItem.title}` : `Novo registro · ${kind}`}
      >
        <form onSubmit={handleSaveItem} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-kind" className="text-[13px] font-semibold text-[#14181F]">
                Tipo de registro
              </label>
              <select
                id="cmp-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as ComplianceKind)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Obrigação">Obrigação</option>
                <option value="Certidão">Certidão</option>
                <option value="Documento de obra">Documento de obra</option>
                <option value="Licitação">Licitação</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-status" className="text-[13px] font-semibold text-[#14181F]">
                Status
              </label>
              <select
                id="cmp-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as ComplianceStatus)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="Pendente">Pendente</option>
                <option value="Em dia">Em dia</option>
                <option value="Válida">Válida</option>
                <option value="Anexado">Anexado</option>
                <option value="Vence em breve">Vence em breve</option>
                <option value="Em atraso">Em atraso</option>
                <option value="Parcial">Parcial</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cmp-title" className="text-[13px] font-semibold text-[#14181F]">
              Título / documento
            </label>
            <input
              id="cmp-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Certidão Federal (RFB/PGFN), Guia Simples Nacional, ART/RRT"
              className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-cat" className="text-[13px] font-semibold text-[#14181F]">
                Categoria
              </label>
              <input
                id="cmp-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Fiscal, Trabalhista, Qualificação técnica..."
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-proj" className="text-[13px] font-semibold text-[#14181F]">
                Obra vinculada (opcional)
              </label>
              <select
                id="cmp-proj"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="">Empresa (geral)</option>
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-iss" className="text-[13px] font-semibold text-[#14181F]">
                Emitida em
              </label>
              <input
                id="cmp-iss"
                type="date"
                value={issuedDate}
                onChange={(e) => setIssuedDate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-due" className="text-[13px] font-semibold text-[#14181F]">
                Validade / vencimento
              </label>
              <input
                id="cmp-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="cmp-comp" className="text-[13px] font-semibold text-[#14181F]">
                Competência
              </label>
              <input
                id="cmp-comp"
                value={competence}
                onChange={(e) => setCompetence(e.target.value)}
                placeholder="Ex.: 11/2026"
                className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="cmp-file" className="text-[13px] font-semibold text-[#14181F]">
              Referência do arquivo / protocolo
            </label>
            <input
              id="cmp-file"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              placeholder="Ex.: cnd-federal-2026.pdf"
              className="w-full rounded-lg border border-[#E4E1DA] px-3.5 py-2.5 text-sm"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-[#14181F] cursor-pointer">
            <input
              type="checkbox"
              checked={mandatory}
              onChange={(e) => setMandatory(e.target.checked)}
              className="w-4 h-4 rounded border-[#E4E1DA]"
            />
            Item obrigatório
          </label>

          <RegisteredBySelect value={actor} onChange={setActor} id="cmp-actor" />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar registro'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invoice Issued Modal */}
      <Modal
        open={Boolean(invoiceConfirmTxId)}
        onClose={() => setInvoiceConfirmTxId('')}
        title="Confirmar emissão de nota fiscal"
      >
        <form onSubmit={handleMarkInvoiceIssued} className="flex flex-col gap-4">
          <p className="text-sm text-[#5B6472]">
            O status da nota fiscal será atualizado para <strong>Emitida</strong> tanto na Conformidade quanto no Financeiro.
          </p>
          <RegisteredBySelect value={invoiceActor} onChange={setInvoiceActor} id="inv-actor" />
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setInvoiceConfirmTxId('')}
              className="px-4 py-2 rounded-lg border border-[#E4E1DA] text-sm font-semibold text-[#14181F] cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-[#1F3A5F] text-white text-sm font-semibold cursor-pointer disabled:opacity-50"
            >
              {saving ? 'Atualizando...' : 'Confirmar emissão'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
