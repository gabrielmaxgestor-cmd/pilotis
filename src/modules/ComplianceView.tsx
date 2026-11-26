import { useEffect, useState } from 'react';
import { DataList, type DataListColumn } from '../components/ui/DataList';
import { AlertNote, KpiCard, Modal, PageHeader, ProgressBar, RegisteredBySelect, StatusBadge, Tabs } from '../components/ui/PilotisUI';
import {
  addDaysISO, addMonthsISO, calcularResumoConformidade, CERTIFICATE_TYPES, formatBRL, formatDateBR,
  formatMonthLabelBR, getInvoiceReceipts, normalizeCompetence, normalizeTenderCategory, OBLIGATION_TYPES,
  pendingInvoiceReceipts, planningTodayISO, prontidaoLicitacaoPorCategoria, resolveCertificateCategory,
  resolverStatusConformidade, resolveWorkDocumentCategory, sumPendingInvoices, TENDER_CATEGORIES,
  toDomainComplianceItems, WORK_DOCUMENT_TYPES, type InvoiceReceipt,
} from '../domain';
import { markReceiptInvoiceIssued, readComplianceFile, saveComplianceItem } from '../services/pilotisService';
import type { ActorRole, ComplianceItem, ComplianceKind, ComplianceStatus, PilotisDataState } from '../types/pilotis';

const tabs = ['Obrigações', 'Certidões', 'Documentos por obra', 'Notas fiscais', 'Licitações'];
const panel = 'grid min-w-0 gap-3 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const primary = 'rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const button = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const field = 'w-full rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const label = 'grid gap-1 text-sm font-semibold';
const note = 'text-sm text-[#5B6472]';

const kindByTab: Record<string, ComplianceKind> = {
  Obrigações: 'Obrigação', Certidões: 'Certidão', 'Documentos por obra': 'Documento de obra', Licitações: 'Licitação',
};
const actionByKind: Record<ComplianceKind, string> = {
  Obrigação: 'Nova obrigação', Certidão: 'Registrar certidão', 'Documento de obra': 'Registrar documento', Licitação: 'Novo item de habilitação',
};
const fieldsByKind: Record<ComplianceKind, readonly string[]> = {
  Obrigação: OBLIGATION_TYPES, Certidão: CERTIFICATE_TYPES, 'Documento de obra': WORK_DOCUMENT_TYPES, Licitação: TENDER_CATEGORIES,
};
const statusesByKind: Record<ComplianceKind, ComplianceStatus[]> = {
  Obrigação: ['Pendente', 'Parcial', 'Em dia'], Certidão: ['Pendente', 'Parcial', 'Válida'],
  'Documento de obra': ['Pendente', 'Parcial', 'Anexado', 'Em dia'], Licitação: ['Pendente', 'Parcial', 'Anexado', 'Válida', 'Em dia'],
};
type Draft = Pick<ComplianceItem, 'kind' | 'title' | 'category' | 'projectId' | 'competence' | 'dueDate' | 'issuedDate' | 'fileName' | 'mandatory' | 'status' | 'notes'>;
type OptionActions = { onEdit: (item: ComplianceItem) => void; onFile: (item: ComplianceItem) => void };

const statusOf = (row: ComplianceItem, today: string) =>
  resolverStatusConformidade({ tipo: row.kind, status: row.status, vencimento: row.dueDate }, today);
const isReady = (status: ComplianceStatus) => status === 'Anexado' || status === 'Em dia' || status === 'Válida';
const categoryOf = (item: ComplianceItem) => item.kind === 'Certidão' ? resolveCertificateCategory(item)
  : item.kind === 'Documento de obra' ? resolveWorkDocumentCategory(item)
  : item.kind === 'Licitação' ? normalizeTenderCategory(item.category)
  : item.category || 'Outra obrigação';

function ComplianceStatusBadge({ status, kind }: { status: ComplianceStatus; kind: ComplianceKind }) {
  return <StatusBadge label={kind === 'Certidão' && status === 'Em atraso' ? 'Vencida' : status}
    tone={status === 'Em atraso' ? 'bad' : status === 'Vence em breve' || status === 'Pendente' || status === 'Parcial' ? 'warn' : 'ok'} />;
}

function Records({ rows, kind, today, onEdit, onFile }: OptionActions & { rows: ComplianceItem[]; kind: ComplianceKind; today: string }) {
  const columns: DataListColumn<ComplianceItem>[] = [
    { key: 'name', header: kind === 'Obrigação' ? 'Guia ou declaração' : 'Registro', render: (row) => <div>
      <strong className="break-words">{row.title}</strong><p className="text-xs text-[#5B6472]">{categoryOf(row)}</p>
    </div> },
    ...(kind === 'Obrigação' ? [{
      key: 'competence', header: 'Competência',
      render: (row: ComplianceItem) => normalizeCompetence(row.competence ?? '') ? formatMonthLabelBR(normalizeCompetence(row.competence)) : row.competence || 'Sem dados',
    }] : kind === 'Certidão' ? [{
      key: 'issue', header: 'Emissão', render: (row: ComplianceItem) => formatDateBR(row.issuedDate),
    }] : []),
    { key: 'date', header: kind === 'Obrigação' ? 'Vencimento' : 'Validade', render: (row) => formatDateBR(row.dueDate) },
    { key: 'status', header: 'Situação', render: (row) => <ComplianceStatusBadge status={statusOf(row, today)} kind={row.kind} /> },
    { key: 'file', header: kind === 'Obrigação' ? 'Comprovante' : 'Arquivo', render: (row) => row.attachmentId
      ? <button type="button" className="text-left font-semibold text-[#1F3A5F] underline focus-visible:ring-2 focus-visible:ring-[#1F3A5F]"
          onClick={() => onFile(row)}>Baixar {row.fileName || 'arquivo'}</button>
      : <span className="break-words text-[#5B6472]">{row.fileName ? 'Ref. ' + row.fileName : 'Sem arquivo'}</span> },
    { key: 'edit', header: 'Ação', render: (row) => <button type="button" className={button} onClick={() => onEdit(row)} aria-label={'Editar ' + row.title}>Editar</button> },
  ];
  return <DataList rows={rows} columns={columns} keyExtractor={(row) => row.id}
    caption={kind} emptyTitle="Sem registros neste recorte" emptyDescription="Os registros cadastrados aparecem aqui."
    renderMobileCard={(row) => <article className={panel}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><strong className="break-words text-sm">{row.title}</strong><p className="text-xs text-[#5B6472]">{categoryOf(row)}</p></div>
        <ComplianceStatusBadge status={statusOf(row, today)} kind={row.kind} />
      </div>
      <dl className="grid gap-2 text-sm">
        {kind === 'Obrigação' && <div className="flex justify-between gap-2"><dt>Competência</dt><dd>{normalizeCompetence(row.competence ?? '') ? formatMonthLabelBR(normalizeCompetence(row.competence)) : row.competence || 'Sem dados'}</dd></div>}
        {kind === 'Certidão' && <div className="flex justify-between gap-2"><dt>Emissão</dt><dd>{formatDateBR(row.issuedDate)}</dd></div>}
        <div className="flex justify-between gap-2"><dt>{kind === 'Obrigação' ? 'Vencimento' : 'Validade'}</dt><dd>{formatDateBR(row.dueDate)}</dd></div>
      </dl>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className={button} onClick={() => onEdit(row)} aria-label={'Editar ' + row.title}>Editar</button>
        {row.attachmentId ? <button type="button" className={button + ' break-all'} onClick={() => onFile(row)}>Baixar {row.fileName || 'arquivo'}</button>
          : row.fileName && <span className={note}>Ref. {row.fileName}</span>}
      </div>
    </article>} />;
}

function ObligationsCalendar({ month, items, today, onEdit }: { month: string; items: ComplianceItem[]; today: string; onEdit: OptionActions['onEdit'] }) {
  const first = month + '-01';
  const next = addMonthsISO(first, 1);
  const leading = new Date(first + 'T12:00:00Z').getUTCDay();
  const days = Number(addDaysISO(next, -1).slice(-2));
  const slots = Array.from({ length: Math.ceil((leading + days) / 7) * 7 }, (_, index) => index - leading + 1);
  const byDate = new Map<string, ComplianceItem[]>();
  for (const item of items) {
    const current = byDate.get(item.dueDate);
    if (current) current.push(item);
    else byDate.set(item.dueDate, [item]);
  }
  return (
    <div className="hidden min-w-0 md:block">
      <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-[#E4E1DA]" aria-label="Calendário de vencimentos">
        {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map((weekday) => <div key={weekday} className="border-b border-[#E4E1DA] bg-[#F0EEE9] p-2 text-center text-xs font-semibold">{weekday}</div>)}
        {slots.map((day) => {
          const date = day > 0 && day <= days ? month + '-' + String(day).padStart(2, '0') : '';
          return <div key={day} className={'min-w-0 min-h-16 border-b border-r border-[#E4E1DA] p-1.5 ' + (date === today ? 'bg-[#E6EEFB]' : date ? '' : 'bg-[#F6F5F2]')}>
            {date && <><span className="mb-1 block text-xs font-semibold" aria-current={date === today ? 'date' : undefined}>{day}</span>
              <div className="grid gap-1">{(byDate.get(date) ?? []).map((item) => {
                const status = statusOf(item, today);
                const tone = status === 'Em atraso' ? 'bg-[#FDECEA] text-[#B42318]' : status === 'Em dia' ? 'bg-[#EAF6EF] text-[#1E694C]' : 'bg-[#F0EEE9] text-[#1F3A5F]';
                return <button key={item.id} type="button" title={item.title + ' · ' + status}
                  aria-label={item.title + ' · ' + status} onClick={() => onEdit(item)}
                  className={'min-w-0 rounded border-0 px-1.5 py-1 text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-[#1F3A5F] ' + tone}>
                  <span className="block truncate">{item.title}</span><span className="block">{status}</span>
                </button>;
              })}</div>
            </>}
          </div>;
        })}
      </div>
    </div>
  );
}

function defaultDraft(kind: ComplianceKind, projectId = '', category = ''): Draft {
  return { kind, title: category, category, projectId, competence: '', dueDate: '', issuedDate: '',
    fileName: '', mandatory: true, status: 'Pendente', notes: '' };
}

export function ComplianceView({ uid, data, companyEmail, initialTab }: {
  uid: string; data: PilotisDataState; companyEmail?: string | null; initialTab?: string;
}) {
  const today = planningTodayISO();
  const [tab, setTab] = useState(initialTab && tabs.includes(initialTab) ? initialTab : 'Obrigações');
  const [calendarMonth, setCalendarMonth] = useState(today.slice(0, 7));
  const [onlyLate, setOnlyLate] = useState(false);
  const [workProject, setWorkProject] = useState('');
  const [invoiceProject, setInvoiceProject] = useState('');
  const [invoiceMonth, setInvoiceMonth] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<ComplianceItem | null>(null);
  const [pickedFile, setPickedFile] = useState<File | undefined>();
  const [invoice, setInvoice] = useState<InvoiceReceipt | null>(null);
  const [actor, setActor] = useState<ActorRole>('Responsável administrativo');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  useEffect(() => { if (initialTab && tabs.includes(initialTab)) setTab(initialTab); }, [initialTab]);

  const summary = calcularResumoConformidade(data.complianceItems, data.transactions, today, data.installments);
  const obligations = data.complianceItems.filter((row) => row.kind === 'Obrigação').sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const certificates = data.complianceItems.filter((row) => row.kind === 'Certidão').sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
  const currentMonth = obligations.filter((row) => (row.dueDate ?? '').slice(0, 7) === calendarMonth);
  const late = obligations.filter((row) => statusOf(row, today) === 'Em atraso');
  const currentProject = data.projects.find((project) => project.id === workProject) ?? data.projects[0];
  const workDocs = data.complianceItems.filter((row) => row.kind === 'Documento de obra' && row.projectId === currentProject?.id);
  const tenderDocs = data.complianceItems.filter((row) => row.kind === 'Licitação');
  const readiness = prontidaoLicitacaoPorCategoria(toDomainComplianceItems(tenderDocs), today);
  const tenderCategories = [...new Set([...TENDER_CATEGORIES, ...readiness.map((row) => row.categoria)])];
  const receipts = getInvoiceReceipts(data.transactions, data.installments);
  const invoiceOptions = [...new Map(receipts.map((row) => [row.projectId, row.projectName || (row.projectId === 'Empresa' ? 'Empresa' : 'Obra vinculada')])).entries()];
  const pending = pendingInvoiceReceipts(receipts, invoiceProject, invoiceMonth);
  const receiptsInView = receipts.some((row) => (!invoiceProject || row.projectId === invoiceProject) && (!invoiceMonth || row.date.startsWith(invoiceMonth)));
  const activeKind = kindByTab[tab];

  function openNew(kind: ComplianceKind, category = '') {
    setEditing(null); setPickedFile(undefined); setError('');
    setDraft(defaultDraft(kind, kind === 'Documento de obra' ? currentProject?.id : '', category));
  }

  function openEdit(row: ComplianceItem) {
    setEditing(row); setPickedFile(undefined); setError('');
    const known = statusesByKind[row.kind];
    const status = known.includes(row.status) ? row.status : row.kind === 'Certidão' && row.status === 'Vence em breve' ? 'Válida' : 'Pendente';
    setDraft({
      kind: row.kind, title: row.title, category: categoryOf(row), projectId: row.projectId || '',
      competence: normalizeCompetence(row.competence || ''), dueDate: row.dueDate || '',
      issuedDate: row.issuedDate || '', fileName: row.fileName || '',
      mandatory: row.mandatory !== false, status, notes: row.notes || '',
    });
  }

  async function download(row: ComplianceItem) {
    try {
      const file = await readComplianceFile(row);
      const bytes = file.content.toUint8Array().slice().buffer as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
      const link = document.createElement('a');
      link.href = url; link.download = file.name;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (err) { setFeedback({ tone: 'bad', text: err instanceof Error ? err.message : 'Não foi possível abrir o arquivo.' }); }
  }

  const records = (rows: ComplianceItem[], kind: ComplianceKind) =>
    <Records rows={rows} kind={kind} today={today} onEdit={openEdit} onFile={(row) => void download(row)} />;
  const invoicePlace = (row: InvoiceReceipt) => row.projectName || invoiceOptions.find(([id]) => id === row.projectId)?.[1] || 'Empresa';
  const openInvoice = (row: InvoiceReceipt) => { setInvoice(row); setError(''); };
  const invoiceColumns: DataListColumn<InvoiceReceipt>[] = [
    { key: 'name', header: 'Recebimento', render: (row) => <strong className="break-words">{row.description}</strong> },
    { key: 'project', header: 'Obra ou empresa', render: invoicePlace },
    { key: 'date', header: 'Data do recebimento', render: (row) => formatDateBR(row.date) },
    { key: 'amount', header: 'Valor recebido', numeric: true, align: 'right', render: (row) => formatBRL(row.amount) },
    { key: 'status', header: 'Nota fiscal', render: (row) => <StatusBadge label={row.invoiceStatus} tone="warn" /> },
    { key: 'action', header: 'Ação', render: (row) => <button type="button" className={button} onClick={() => openInvoice(row)}>Marcar como emitida</button> },
  ];

  return (
    <div className="grid gap-4">
      <PageHeader title="Conformidade e Documentos" subtitle="Guias, certidões, documentos de obra, notas fiscais e habilitação"
        companyEmail={companyEmail} actions={activeKind ? <button type="button" className={primary}
          disabled={activeKind === 'Documento de obra' && !currentProject} onClick={() => openNew(activeKind)}>{actionByKind[activeKind]}</button> : undefined} />
      <AlertNote tone="info" title="Registro e acompanhamento">
        Este módulo registra e alerta. As decisões sobre regularização são tratadas com o contador, o advogado e o CREA.
      </AlertNote>
      {feedback && <AlertNote tone={feedback.tone} title={feedback.tone === 'ok' ? 'Conformidade' : 'Atenção'}>{feedback.text}</AlertNote>}
      <Tabs items={tabs} active={tab} onChange={setTab} />
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Obrigações a vencer ou em atraso" value={summary.obrigacoesAVencerOuAtrasadas?.toString() ?? 'Sem dados'} isEmpty={summary.obrigacoesAVencerOuAtrasadas === null} subtext="Prazo nos próximos 7 dias ou vencido" />
        <KpiCard label="Certidões válidas" value={summary.certidoesValidas?.toString() ?? 'Sem dados'} isEmpty={summary.certidoesValidas === null} subtext="Considera a data de validade" />
        <KpiCard label="Recebido sem nota" value={formatBRL(summary.receitaSemNotaPendente)} isEmpty={summary.receitaSemNotaPendente === null} subtext="Saldo de notas a emitir ou não emitidas" />
        <KpiCard label="Documentos de obra pendentes" value={summary.documentosObraPendentes?.toString() ?? 'Sem dados'} isEmpty={summary.documentosObraPendentes === null} subtext="Itens cadastrados que exigem atenção" />
      </div>

      {tab === 'Obrigações' && <>
        <section className={panel}>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div><h2 className="text-base font-semibold">Calendário de guias e declarações</h2>
              <p className={note}>Vencimentos informados no cadastro.</p></div>
            <div className="flex flex-wrap items-end gap-2">
              <button type="button" className={button} aria-label="Mês anterior"
                onClick={() => { setCalendarMonth(addMonthsISO(calendarMonth + '-01', -1).slice(0, 7)); setOnlyLate(false); }}>←</button>
              <label className={label}>Mês
                <input type="month" className={field} value={calendarMonth} onChange={(event) => {
                  const month = normalizeCompetence(event.target.value);
                  if (month) { setCalendarMonth(month); setOnlyLate(false); }
                }} />
              </label>
              <button type="button" className={button} aria-label="Próximo mês"
                onClick={() => { setCalendarMonth(addMonthsISO(calendarMonth + '-01', 1).slice(0, 7)); setOnlyLate(false); }}>→</button>
              <button type="button" className={button + ' aria-pressed:bg-[#FDECEA]'} aria-pressed={onlyLate}
                onClick={() => setOnlyLate((value) => !value)}>{late.length ? 'Em atraso (' + late.length + ')' : 'Em atraso'}</button>
            </div>
          </div>
          {!onlyLate && <ObligationsCalendar month={calendarMonth} items={currentMonth} today={today} onEdit={openEdit} />}
        </section>
        <h2 className="text-base font-semibold">{onlyLate ? 'Obrigações em atraso' : formatMonthLabelBR(calendarMonth)}</h2>
        {records(onlyLate ? late : currentMonth, 'Obrigação')}
        {obligations.some((row) => !row.dueDate) && <><h3 className="text-sm font-semibold">Registros sem vencimento</h3>
          {records(obligations.filter((row) => !row.dueDate), 'Obrigação')}</>}
      </>}

      {tab === 'Certidões' && <>
        <h2 className="text-base font-semibold">Emissão e validade</h2>
        {records(certificates, 'Certidão')}
      </>}

      {tab === 'Documentos por obra' && <section className={panel}>
        {!currentProject ? <p className={note}>Sem obras cadastradas para conferir documentos.</p> : <>
          <label className={label + ' max-w-md'}>Obra
            <select className={field} value={currentProject.id} onChange={(event) => setWorkProject(event.target.value)}>
              {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          {[...WORK_DOCUMENT_TYPES, ...(workDocs.some((row) => categoryOf(row) === 'Outros') ? ['Outros'] : [])].map((type) => {
            const rows = workDocs.filter((row) => categoryOf(row) === type);
            const checked = rows.some((row) => isReady(statusOf(row, today)) && Boolean(row.fileName || row.attachmentId));
            return <section key={type} className="grid gap-2 border-t border-[#E4E1DA] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">{type}</h3>
                  <StatusBadge label={checked ? 'Registrado' : rows.length ? 'Pendente' : 'Sem registro'} tone={checked ? 'ok' : 'neutral'} /></div>
                <button type="button" className={button} onClick={() => openNew('Documento de obra', type)}>Adicionar documento</button>
              </div>
              {rows.length > 0 && records(rows, 'Documento de obra')}
            </section>;
          })}
        </>}
      </section>}

      {tab === 'Notas fiscais' && <>
        <section className={panel}>
          <h2 className="text-base font-semibold">Recebimentos sem nota emitida</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Obra ou empresa
              <select className={field} value={invoiceProject} onChange={(event) => setInvoiceProject(event.target.value)}>
                <option value="">Todos os centros</option>{invoiceOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <label className={label + ' flex-1'}>Mês de recebimento
                <input type="month" className={field} value={invoiceMonth} onChange={(event) => setInvoiceMonth(event.target.value)} />
              </label>
              {invoiceMonth && <button type="button" className={button} onClick={() => setInvoiceMonth('')}>Todos os meses</button>}
            </div>
          </div>
          <p className="text-sm">Total pendente no recorte · <strong>{formatBRL(receiptsInView ? sumPendingInvoices(pending) : null)}</strong></p>
        </section>
        <DataList rows={pending} columns={invoiceColumns} keyExtractor={(row) => row.key}
          emptyTitle="Sem recebimentos pendentes de nota no recorte" emptyDescription="Os registros vêm dos recebimentos realizados no Financeiro."
          renderMobileCard={(row) => <article className={panel}>
            <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words text-sm">{row.description}</strong><StatusBadge label={row.invoiceStatus} tone="warn" /></div>
            <p className={note}>{invoicePlace(row)} · {formatDateBR(row.date)}</p>
            <strong className="text-sm">{formatBRL(row.amount)}</strong>
            <button type="button" className={button + ' justify-self-start'} onClick={() => openInvoice(row)}>Marcar como emitida</button>
          </article>} />
      </>}

      {tab === 'Licitações' && <section className={panel}>
        <div className="grid gap-2"><h2 className="text-base font-semibold">Checklist de habilitação</h2>
          <p className="text-sm">Prontidão geral · <strong>{summary.prontidaoLicitacoesPct === null ? 'Sem dados' : summary.prontidaoLicitacoesPct + '%'}</strong></p>
          {summary.prontidaoLicitacoesPct !== null && <ProgressBar pct={summary.prontidaoLicitacoesPct} />}
        </div>
        {tenderCategories.map((category) => {
          const result = readiness.find((row) => row.categoria === category);
          const rows = tenderDocs.filter((row) => categoryOf(row) === category);
          return <section key={category} className="grid gap-2 border-t border-[#E4E1DA] pt-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h3 className="text-sm font-semibold">{category}</h3>
                <p className={note}>{result ? result.pct + '% · ' + result.prontos + ' de ' + result.total + ' itens prontos' : 'Sem dados'}</p>
              </div>
              <button type="button" className={button} onClick={() => openNew('Licitação', category)}>Adicionar item</button>
            </div>
            {result && <ProgressBar pct={result.pct} />}
            {rows.length > 0 && records(rows, 'Licitação')}
          </section>;
        })}
      </section>}

      <Modal open={Boolean(draft)} onClose={() => { if (!saving) setDraft(null); }} title={editing ? 'Editar registro' : 'Novo registro'} maxWidth="max-w-2xl">
        {draft && <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError('');
          try {
            await saveComplianceItem(uid, actor, draft, editing?.id, pickedFile);
            if (draft.kind === 'Obrigação') { setCalendarMonth(draft.dueDate.slice(0, 7)); setOnlyLate(false); }
            if (draft.kind === 'Documento de obra') setWorkProject(draft.projectId);
            setDraft(null); setFeedback({ tone: 'ok', text: 'Registro salvo.' });
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o registro.'); }
          finally { setSaving(false); }
        }}>
          <label className={label}>Categoria
            <select className={field} value={draft.category} required onChange={(event) => {
              const category = event.target.value;
              setDraft({ ...draft, category, title: !draft.title || draft.title === draft.category ? category : draft.title });
            }}>
              <option value="">Selecione a categoria</option>
              {[...new Set([...fieldsByKind[draft.kind], 'Outros', ...(draft.category ? [draft.category] : [])])].map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className={label}>Título
            <input className={field} required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
          </label>
          {(draft.kind === 'Documento de obra' || draft.kind === 'Obrigação') && <label className={label}>Obra vinculada{draft.kind === 'Obrigação' ? ' (opcional)' : ''}
            <select className={field} required={draft.kind === 'Documento de obra'} value={draft.projectId}
              onChange={(event) => setDraft({ ...draft, projectId: event.target.value })}>
              <option value="">{draft.kind === 'Documento de obra' ? 'Selecione a obra' : 'Empresa'}</option>
              {data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>}
          <div className="grid gap-2 sm:grid-cols-2">
            {draft.kind === 'Obrigação' ? <label className={label}>Competência
              <input type="month" required className={field} value={draft.competence} onChange={(event) => setDraft({ ...draft, competence: event.target.value })} />
            </label> : <label className={label}>Emissão
              <input type="date" required={draft.kind === 'Certidão'} className={field} value={draft.issuedDate}
                onChange={(event) => setDraft({ ...draft, issuedDate: event.target.value })} />
            </label>}
            <label className={label}>{draft.kind === 'Obrigação' ? 'Vencimento' : 'Validade'}
              <input type="date" required={draft.kind === 'Obrigação' || draft.kind === 'Certidão'} className={field}
                value={draft.dueDate} min={draft.kind !== 'Obrigação' ? draft.issuedDate : undefined}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} />
            </label>
            <label className={label}>Situação
              <select className={field} value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ComplianceStatus })}>
                {statusesByKind[draft.kind].map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <label className={label}>{draft.kind === 'Obrigação' ? 'Comprovante' : 'Arquivo'} (PDF, PNG ou JPEG até 700 KB)
            <input type="file" className={field} accept="application/pdf,image/png,image/jpeg" onChange={(event) => setPickedFile(event.target.files?.[0])} />
          </label>
          {!pickedFile && editing?.attachmentId ? <p className={note}>Anexo atual · {editing.fileName}</p> : !pickedFile && (
            <label className={label}>Referência do arquivo ou protocolo
              <input className={field} maxLength={160} value={draft.fileName} onChange={(event) => setDraft({ ...draft, fileName: event.target.value })} />
            </label>
          )}
          <label className={label}>Observações
            <textarea className={field} rows={2} maxLength={500} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
          </label>
          {(draft.kind === 'Documento de obra' || draft.kind === 'Licitação') && <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.mandatory} onChange={(event) => setDraft({ ...draft, mandatory: event.target.checked })} />
            Item obrigatório
          </label>}
          <RegisteredBySelect id="compliance-record-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button type="submit" className={primary + ' justify-self-end'} disabled={saving}>{saving ? 'Salvando...' : 'Salvar registro'}</button>
        </form>}
      </Modal>

      <Modal open={Boolean(invoice)} onClose={() => { if (!saving) setInvoice(null); }} title="Confirmar emissão de nota">
        {invoice && <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError('');
          try {
            await markReceiptInvoiceIssued(uid, actor, invoice.target);
            setInvoice(null); setFeedback({ tone: 'ok', text: 'Nota marcada como emitida no Financeiro e na Conformidade.' });
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível confirmar a emissão.'); }
          finally { setSaving(false); }
        }}>
          <p className="break-words text-sm">{invoice.description} · {formatDateBR(invoice.date)} · {formatBRL(invoice.amount)}</p>
          <RegisteredBySelect id="compliance-invoice-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button type="submit" className={primary + ' justify-self-end'} disabled={saving}>{saving ? 'Atualizando...' : 'Confirmar emissão'}</button>
        </form>}
      </Modal>
    </div>
  );
}
