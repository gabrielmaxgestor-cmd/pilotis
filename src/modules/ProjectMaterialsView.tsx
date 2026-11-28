import { useState } from 'react';
import { Button, Modal, RegisteredBySelect, StatusBadge } from '../components/ui/PilotisUI';
import { DataList } from '../components/ui/DataList';
import { PurchasingScheduleButton } from '../components/ui/PurchasingScheduleButton';
import {
  customerMaterialTemplate, DEFAULT_MATERIAL_LEAD_DAYS, MATERIAL_STATUSES, weeksToCalendarDays, type CustomerMaterialRow,
} from '../domain/customerMaterials';
import { addDaysISO, formatDateBR, formatTimestampBR, isValidISODate } from '../domain/formatters';
import { formatMaterialQuantity } from '../domain/purchasingSchedulePdf';
import { getProjectSchedule, planningTodayISO } from '../domain/pilotisAdapters';
import { useViewParam } from '../hooks/useViewUrl';
import { saveCustomerMaterials } from '../services/pilotisService';
import type { ActorRole, CustomerMaterial, CustomerMaterialInput, PilotisDataState, Project, ProjectStage } from '../types/pilotis';

const field = 'min-h-10 w-full min-w-0 rounded-lg border border-[#E4E1DA] bg-white px-2.5 py-2 text-sm font-normal';
const label = 'grid min-w-0 gap-1 text-sm font-semibold';
type Schedule = ReturnType<typeof getProjectSchedule>;

function MaterialEditor({ item, stages, project, schedule, onClose, onSave }: {
  item?: CustomerMaterial; stages: ProjectStage[]; project: Project; schedule: Schedule; onClose: () => void;
  onSave: (fields: CustomerMaterialInput, actor: ActorRole, revision?: number) => Promise<void>;
}) {
  const available = stages.filter((stage) => stage.status !== 'Concluída' || stage.id === item?.stageId);
  const [draft, setDraft] = useState<CustomerMaterialInput>(item ?? {
    stageId: available[0]?.id ?? '', description: '', quantity: null, unit: '', leadDays: DEFAULT_MATERIAL_LEAD_DAYS,
    promisedDate: '', deliveredDate: '', status: 'A comprar', clientContact: '', notes: '',
  });
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [revision] = useState(project.scheduleRevision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof CustomerMaterialInput,>(key: K, value: CustomerMaterialInput[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const detail = schedule.details.get(draft.stageId);
  const date = detail && isValidISODate(project.startDate) && Number.isInteger(draft.leadDays) && draft.leadDays >= 0 && draft.leadDays <= 3650
    ? addDaysISO(project.startDate, weeksToCalendarDays(detail.inicioAntesDaRestricao ?? detail.inicioMaisCedo) - draft.leadDays)
    : null;

  return <Modal open title={item ? 'Editar material do cliente' : 'Novo material do cliente'} onClose={onClose}>
    <form className="grid gap-3" onSubmit={async (event) => {
      event.preventDefault();
      if (saving) return;
      setSaving(true); setError('');
      try { await onSave(draft, actor, revision); onClose(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar o material.'); }
      finally { setSaving(false); }
    }}>
      <label className={label}>Descrição
        <input className={field} required maxLength={160} value={draft.description} onChange={(event) => set('description', event.target.value)} />
      </label>
      <label className={label}>Etapa que depende do material
        <select className={field} required value={draft.stageId} onChange={(event) => set('stageId', event.target.value)}>
          <option value="">Selecione a etapa</option>{available.map((stage) => <option key={stage.id} value={stage.id}>{stage.wbsCode} · {stage.name}</option>)}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={label}>Quantidade
          <input className={field} type="number" step="any" min="0.00000001" value={draft.quantity ?? ''}
            onChange={(event) => set('quantity', event.target.value ? Number(event.target.value) : null)} />
        </label>
        <label className={label}>Unidade
          <input className={field} maxLength={24} value={draft.unit} onChange={(event) => set('unit', event.target.value)} />
        </label>
        <label className={label}>Antecedência em dias
          <input className={field} required type="number" min={0} max={3650} step={1} value={Number.isNaN(draft.leadDays) ? '' : draft.leadDays}
            onChange={(event) => set('leadDays', event.target.valueAsNumber)} />
        </label>
        <p className="self-center text-sm">Data necessária · <strong>{formatDateBR(date)}</strong></p>
        <label className={label}>Data prometida pelo cliente
          <input className={field} type="date" value={draft.promisedDate} onChange={(event) => set('promisedDate', event.target.value)} />
        </label>
        <label className={label}>Situação da compra
          <select className={field} value={draft.status} onChange={(event) => {
            const status = event.target.value as CustomerMaterialInput['status'];
            setDraft((previous) => ({ ...previous, status,
              deliveredDate: status === 'Entregue' ? previous.deliveredDate || planningTodayISO() : '' }));
          }}>
            {MATERIAL_STATUSES.map((status) => <option key={status}>{status}</option>)}
          </select>
        </label>
        {draft.status === 'Entregue' && <label className={label}>Data efetiva da entrega
          <input className={field} type="date" required max={planningTodayISO()} value={draft.deliveredDate}
            onChange={(event) => set('deliveredDate', event.target.value)} />
        </label>}
      </div>
      <label className={label}>Responsável do lado do cliente
        <input className={field} maxLength={140} value={draft.clientContact} onChange={(event) => set('clientContact', event.target.value)} />
      </label>
      <label className={label}>Observações
        <textarea className={field} rows={2} maxLength={600} value={draft.notes} onChange={(event) => set('notes', event.target.value)} />
      </label>
      <RegisteredBySelect id="material-actor" value={actor} onChange={setActor} />
      {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
      <Button type="submit" disabled={saving} className="justify-self-end">{saving ? 'Salvando…' : 'Salvar material'}</Button>
    </form>
  </Modal>;
}

export function ProjectMaterialsView({ uid, project, stages, schedule, data }: {
  uid: string; project: Project; stages: ProjectStage[]; schedule: Schedule; data: PilotisDataState;
}) {
  const { rows, deliveryImpactDays } = schedule.materials;
  const [recordId, setRecordId] = useViewParam('registro');
  const [editor, setEditor] = useState<'new' | CustomerMaterial | null>(null);
  const [template, setTemplate] = useState(false);
  const [templateLead, setTemplateLead] = useState(DEFAULT_MATERIAL_LEAD_DAYS);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [error, setError] = useState('');
  const selected = rows.find(({ item }) => item.id === recordId);
  const history = data.auditLogs.filter((entry) => entry.entityType === 'customerMaterials' && entry.entityId === selected?.item.id)
    .sort((a, b) => {
      const timestamp = (value: unknown) => value && typeof value === 'object' && 'toMillis' in value &&
        typeof value.toMillis === 'function' ? Number(value.toMillis()) : 0;
      return timestamp(b.createdAt) - timestamp(a.createdAt);
    });
  const active = project.status !== 'Concluída';
  const mayCreate = active && Boolean(schedule.forecastEndDate) && stages.some((stage) => stage.status !== 'Concluída');
  const proposals = template ? customerMaterialTemplate(project.type, stages, rows.map((row) => row.item), templateLead) : [];
  const late = rows.filter((row) => row.status === 'Atrasado' && row.stage?.status !== 'Concluída').length;
  const contractCode = data.quotes.find((quote) => quote.id === project.quoteId)?.code;
  const detail = (row: CustomerMaterialRow) => setRecordId(row.item.id, { push: true });

  return <section className="grid min-w-0 gap-4 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5" aria-label="Materiais do cliente">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-[#14181F]">Materiais do cliente</h2>
        <p className="max-w-prose text-sm text-[#424D5D]">A data necessária usa o início previsto da etapa antes da espera pelos seus materiais, menos a antecedência de cada item.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {mayCreate && <>
          <Button size="sm" onClick={() => setEditor('new')}>Novo material</Button>
          <Button size="sm" variant="secondary" onClick={() => { setError(''); setTemplate(true); }}>Gerar lista do modelo</Button>
        </>}
        <PurchasingScheduleButton rows={rows} projectId={project.id} projectName={project.name} companyName={data.settings?.companyName} contractCode={contractCode} />
      </div>
    </div>
    {active && !schedule.forecastEndDate && <p className="text-sm text-[#424D5D]">Defina as etapas e a data de início da obra para montar o cronograma de compras.</p>}
    {rows.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
      <StatusBadge label={late + (late === 1 ? ' item em atraso' : ' itens em atraso')} tone={late ? 'bad' : 'neutral'} />
      <span>Impacto estimado na entrega · <strong>{deliveryImpactDays === null ? 'Sem dados' : deliveryImpactDays + ' dia(s)'}</strong></span>
    </div>}
    {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
    <DataList caption="Lista de materiais do cliente" keyboardScroll rows={rows} keyExtractor={(row) => row.item.id}
      onRowClick={detail} emptyTitle="Sem materiais cadastrados"
      emptyDescription="Cadastre um material ou gere a lista inicial do modelo da obra."
      columns={[
        { key: 'description', header: 'Material', render: ({ item }) => <strong className="break-words">{item.description}</strong> },
        { key: 'stage', header: 'Etapa', render: ({ stage }) => stage ? stage.wbsCode + ' · ' + stage.name : 'Sem dados' },
        { key: 'quantity', header: 'Quantidade', render: ({ item }) => formatMaterialQuantity(item.quantity, item.unit) },
        { key: 'required', header: 'Data necessária', render: (row) => formatDateBR(row.necessaryDate) },
        { key: 'promised', header: 'Data prometida', render: ({ item }) => formatDateBR(item.promisedDate) },
        { key: 'status', header: 'Situação', render: (row) => <StatusBadge label={row.status} tone={row.status === 'Atrasado' ? 'bad' : 'neutral'} /> },
        { key: 'contact', header: 'Responsável do cliente', render: ({ item }) => item.clientContact || 'Sem dados' },
      ]} />

    <Modal open={Boolean(selected)} title={selected?.item.description ?? 'Material do cliente'} onClose={() => setRecordId('')}>
      {selected && <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap gap-2">
          <StatusBadge label={selected.status} tone={selected.status === 'Atrasado' ? 'bad' : 'neutral'} />
          {selected.critical && <StatusBadge label="Etapa no caminho crítico" tone="warn" />}
        </div>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt>Etapa</dt><dd>{selected.stage?.name || 'Sem dados'}</dd></div>
          <div><dt>Quantidade</dt><dd>{formatMaterialQuantity(selected.item.quantity, selected.item.unit)}</dd></div>
          <div><dt>Data necessária</dt><dd>{formatDateBR(selected.necessaryDate)}</dd></div>
          <div><dt>Prometida pelo cliente</dt><dd>{formatDateBR(selected.item.promisedDate)}</dd></div>
          <div><dt>Entrega efetiva</dt><dd>{formatDateBR(selected.item.deliveredDate)}</dd></div>
          <div><dt>Antecedência</dt><dd>{selected.item.leadDays} dia(s)</dd></div>
          <div><dt>Espera estimada para a etapa</dt><dd>{selected.estimatedWaitDays === null ? 'Sem dados' : selected.estimatedWaitDays + ' dia(s)'}</dd></div>
          <div><dt>Responsável do cliente</dt><dd>{selected.item.clientContact || 'Sem dados'}</dd></div>
        </dl>
        {selected.item.notes && <p className="whitespace-pre-wrap break-words">{selected.item.notes}</p>}
        {active && <Button size="sm" variant="secondary" className="justify-self-start"
          onClick={() => { setRecordId(''); setEditor(selected.item); }}>Editar material</Button>}
        <h4 className="font-semibold">Histórico de datas</h4>
        {history.length ? <ul className="grid gap-2">{history.map((entry) => <li key={entry.id} className="rounded border border-[#E4E1DA] p-2">
          <strong>{formatTimestampBR(entry.createdAt)} · {entry.registeredBy}</strong>
          {entry.beforeValue && <p>Antes · {entry.beforeValue}</p>}
          <p>Depois · {entry.afterValue}</p>
        </li>)}</ul> : <p className="text-[#424D5D]">Sem alterações registradas.</p>}
      </div>}
    </Modal>
    {editor && <MaterialEditor key={editor === 'new' ? 'new' : editor.id} item={editor === 'new' ? undefined : editor} stages={stages}
      project={project} schedule={schedule} onClose={() => setEditor(null)}
      onSave={async (item, registered, revision) => {
        await saveCustomerMaterials({ uid, actor: registered, project: { id: project.id, scheduleRevision: revision }, knownStages: stages, item,
          itemId: editor === 'new' ? undefined : editor.id });
        setFeedback('Material salvo.');
      }} />}
    <Modal open={template} title="Gerar lista do modelo" onClose={() => setTemplate(false)}>
      <form className="grid gap-3 text-sm" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true); setError('');
        try {
          const count = await saveCustomerMaterials({ uid, actor, project, knownStages: stages, templateLeadDays: templateLead });
          setFeedback(count + ' item(ns) incluído(s) no cronograma de compras.'); setTemplate(false);
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível aplicar o modelo.'); }
        finally { setSaving(false); }
      }}>
        <p>Modelo de {project.type}. Confirme as quantidades e as datas prometidas com o cliente depois de gerar a lista.</p>
        {proposals.length ? <ul className="list-disc pl-5">{proposals.map((item) => <li key={item.templateKey}>{item.description}</li>)}</ul>
          : <p>Sem novos itens compatíveis com as etapas desta obra.</p>}
        <label className={label}>Antecedência inicial em dias
          <input className={field} required type="number" min={0} max={3650} step={1} value={Number.isNaN(templateLead) ? '' : templateLead}
            onChange={(event) => setTemplateLead(event.target.valueAsNumber)} />
        </label>
        <RegisteredBySelect id="material-template-actor" value={actor} onChange={setActor} />
        {error && <p role="alert" className="text-[#B42318]">{error}</p>}
        <Button type="submit" disabled={saving || !proposals.length} className="justify-self-end">
          {saving ? 'Gerando…' : 'Gerar lista'}
        </Button>
      </form>
    </Modal>
  </section>;
}
