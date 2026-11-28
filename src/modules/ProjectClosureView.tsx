import { useViewParam } from '../hooks/useViewUrl';
import { useEffect, useState } from 'react';
import { Modal, RegisteredBySelect, StatusBadge } from '../components/ui/PilotisUI';
import { formatBRL, formatDateBR, formatPercentBR, getClosureReview, getWarrantyWindow, planningTodayISO, summarizeWarrantyCalls } from '../domain';
import type { DreObraResult } from '../domain/dre';
import { readDailyLogPhoto } from '../services/dailyLogPhotos';
import { getCachedDiaryPhoto } from '../services/fieldQueue';
import { closeProject, saveProjectFollowUp, saveWarrantyCall } from '../services/pilotisService';
import type { ActorRole, DailyLog, MarketingPhotoRef, PilotisDataState, Project, WarrantyCall, WarrantyStatus } from '../types/pilotis';

const card = 'min-w-0 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const primary = 'rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const secondary = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const input = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const label = 'grid min-w-0 gap-1 text-sm font-semibold';
const statuses: WarrantyStatus[] = ['Aberto', 'Em atendimento', 'Resolvido'];
const samePhoto = (a: MarketingPhotoRef, b: MarketingPhotoRef) => a.logId === b.logId && a.photoId === b.photoId;

function PhotoPreview({ log, id, index, downloadable }: { log: DailyLog; id: string; index: number; downloadable?: boolean }) {
  const [url, setUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    setUrl(''); setFailed(false);
    void (async () => {
      const cached = await getCachedDiaryPhoto(log.ownerUid, log.id, id).catch(() => undefined);
      const blob = cached ?? await readDailyLogPhoto(log, id);
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    })().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [log, id]);

  return url ? (
    <a href={url} target={downloadable ? undefined : '_blank'} rel="noreferrer"
      download={downloadable ? 'pilotis-' + log.date + '-' + id + '.jpg' : undefined}
      aria-label={downloadable ? 'Baixar foto autorizada ' + index : 'Abrir foto ' + index}
      className="grid gap-1 rounded-lg text-xs font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
      <img src={url} alt={'Foto ' + index + ' do diário de ' + formatDateBR(log.date)} className="aspect-square w-full rounded-lg object-cover" />
      {downloadable && <span>Baixar foto</span>}
    </a>
  ) : <p className="grid aspect-square items-center rounded-lg bg-[#F0EEE9] px-2 text-center text-xs text-[#5B6472]">{failed ? 'Foto indisponível' : 'Carregando foto...'}</p>;
}

function PhotoSelection({ logs, photos, onChange, note, onNoteChange }: {
  logs: DailyLog[]; photos: MarketingPhotoRef[]; onChange: (photos: MarketingPhotoRef[]) => void;
  note: string; onNoteChange: (note: string) => void;
}) {
  const [selectedDay, setSelectedDay] = useState('');
  const available = logs.filter((log) => log.photoIds?.length).sort((a, b) => b.date.localeCompare(a.date));
  const current = available.find((log) => log.id === selectedDay);
  function toggle(photo: MarketingPhotoRef, checked: boolean) {
    if (checked && photos.length >= 100) return;
    onChange(checked ? [...photos, photo] : photos.filter((item) => !samePhoto(item, photo)));
  }
  return (
    <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
      <legend className="px-1 text-sm font-semibold">Fotos autorizadas para marketing</legend>
      {available.length === 0 ? <p className="text-sm text-[#5B6472]">Sem fotos sincronizadas no diário desta obra.</p> : (
        <>
          <label className={label}>Registro do diário
            <select className={input} value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>
              <option value="">Selecione um registro</option>
              {available.map((log) => <option key={log.id} value={log.id}>{formatDateBR(log.date)} · {log.activities.slice(0, 45)}</option>)}
            </select>
          </label>
          {current && <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {current.photoIds?.map((id, index) => {
              const photo = { logId: current.id, photoId: id };
              const checked = photos.some((item) => samePhoto(item, photo));
              return <div key={id} className="grid gap-1 rounded-lg bg-[#F6F5F2] p-2">
                <PhotoPreview log={current} id={id} index={index + 1} />
                <label className="flex items-center gap-2 text-xs font-semibold">
                  <input type="checkbox" checked={checked} disabled={!checked && photos.length >= 100}
                    onChange={(event) => toggle(photo, event.target.checked)} />
                  Autorizada
                </label>
              </div>;
            })}
          </div>}
          <p className="text-xs text-[#5B6472]">{photos.length} de até 100 fotos selecionadas.</p>
          {photos.length > 0 && <label className={label}>Registro da autorização do cliente
            <textarea className={input} rows={2} maxLength={500} required value={note} onChange={(event) => onNoteChange(event.target.value)} />
          </label>}
        </>
      )}
    </fieldset>
  );
}

function ClosingDre({ dre, date }: { dre: DreObraResult; date?: string }) {
  return (
    <section className={card + ' grid gap-3'}>
      <div>
        <h2 className="text-base font-semibold">{date ? 'DRE consolidado' : 'DRE real para conferência'}</h2>
        {date && <p className="text-xs text-[#5B6472]">Posição em {formatDateBR(date)}</p>}
      </div>
      <dl className="grid gap-2 text-sm">
        {([
          ['Receita recebida', formatBRL(dre.possuiRealizado ? dre.receita.realizado : null)],
          ['Custos realizados', formatBRL(dre.possuiRealizado ? dre.custosTotais.realizado : null)],
          ['Resultado real', formatBRL(dre.possuiRealizado ? dre.resultado.realizado : null)],
          ['Margem real', formatPercentBR(dre.receita.realizado > 0 ? dre.margemRealizadaPct : null)],
        ]).map(([title, value]) => <div key={title} className="flex justify-between gap-2 border-b border-[#F0EEE9] pb-1">
          <dt className="text-[#5B6472]">{title}</dt><dd className="font-semibold tabular-nums">{value}</dd>
        </div>)}
      </dl>
    </section>
  );
}

export function ProjectClosureView({ uid, project, data, onAftercare }: {
  uid: string; project: Project; data: PilotisDataState; onAftercare: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [marketingPhotos, setMarketingPhotos] = useState<MarketingPhotoRef[]>([]);
  const [authorizationNote, setAuthorizationNote] = useState('');
  const now = planningTodayISO();
  const review = getClosureReview(project, data, now);
  const closure = data.projectClosures?.find((row) => row.projectId === project.id);
  const warranty = getWarrantyWindow(project, now);
  const closed = project.status === 'Concluída';

  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <section className={card + ' grid gap-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{closed ? 'Obra encerrada' : 'Conferência de encerramento'}</h2>
          <StatusBadge label={project.status} />
        </div>
        {closed ? (
          <div className="grid gap-2 text-sm">
            <p>Garantia · <strong>{warranty ? formatDateBR(warranty.start) + ' a ' + formatDateBR(warranty.end) : 'Sem dados'}</strong></p>
            <button type="button" className={secondary + ' justify-self-start'} onClick={onAftercare}>Abrir pós-obra</button>
          </div>
        ) : (
          <>
            <ul className="grid gap-2">{review.items.map((item) => <li key={item.id} className="grid gap-1 rounded-lg bg-[#F6F5F2] p-2 text-sm">
              <div className="flex flex-wrap justify-between gap-2"><strong>{item.label}</strong>
                <StatusBadge label={item.cleared ? 'Conferido' : 'Pendente'} tone={item.cleared ? 'ok' : 'warn'} />
              </div>
              <p className="break-words text-xs text-[#5B6472]">{item.detail}</p>
            </li>)}</ul>
            {project.status !== 'Em execução' && <p className="text-sm text-[#5B6472]">Inicie a execução para habilitar o encerramento.</p>}
            <button type="button" className={primary + ' justify-self-start'} disabled={!review.canClose} onClick={() => { setOpen(true); setError(''); }}>Encerrar obra</button>
          </>
        )}
      </section>
      {closed && !closure
        ? <p className={card + ' text-sm text-[#5B6472]'}>Sem DRE consolidado para este encerramento.</p>
        : <ClosingDre dre={closure?.dre ?? review.dre} date={closure?.date} />}
      <Modal open={open} onClose={() => setOpen(false)} title="Encerrar obra" maxWidth="max-w-2xl">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError('');
          try {
            await closeProject(uid, actor, project.id, marketingPhotos, authorizationNote);
            setOpen(false); onAftercare();
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível encerrar a obra.'); }
          finally { setSaving(false); }
        }}>
          <p className="text-sm text-[#5B6472]">O encerramento consolida o DRE, inicia a garantia de um ano, libera a equipe e abre os pedidos de depoimento e indicação.</p>
          <PhotoSelection logs={data.dailyLogs.filter((log) => log.projectId === project.id)} photos={marketingPhotos}
            onChange={setMarketingPhotos} note={authorizationNote} onNoteChange={setAuthorizationNote} />
          <RegisteredBySelect id="close-project-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondary} disabled={saving} onClick={() => setOpen(false)}>Cancelar</button>
            <button type="submit" className={primary} disabled={saving}>{saving ? 'Encerrando...' : 'Confirmar encerramento'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function WarrantyCalls({ uid, project, calls }: { uid: string; project: Project; calls: WarrantyCall[] }) {
  const [recordId, setRecordId] = useViewParam('registro');
  const linkedCall = calls.find((call) => call.id === recordId);
  const [editing, setEditing] = useState<WarrantyCall | 'new' | null>(null);
  const [description, setDescription] = useState('');
  const [openedDate, setOpenedDate] = useState('');
  const [deadlineDate, setDeadlineDate] = useState('');
  const [cost, setCost] = useState('');
  const [status, setStatus] = useState<WarrantyStatus>('Aberto');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const today = planningTodayISO();
  const warranty = getWarrantyWindow(project, today);
  const summary = summarizeWarrantyCalls(calls);
  function open(call?: WarrantyCall) {
    setEditing(call ?? 'new'); setError('');
    setDescription(call?.description ?? ''); setOpenedDate(call?.openedDate ?? today);
    setDeadlineDate(call?.deadlineDate ?? ''); setCost(call ? String(call.cost) : '');
    setStatus(call?.status ?? 'Aberto');
  }
  return (
    <section className={card + ' grid gap-3'}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-base font-semibold">Chamados de garantia</h2>
          <p className="text-sm text-[#5B6472]">Custo registrado · <strong>{formatBRL(summary.cost)}</strong></p>
        </div>
        {warranty && <button type="button" className={primary} onClick={() => open()}>Registrar chamado</button>}
      </header>
      {calls.length ? <ul className="grid gap-2">
        {calls.map((call) => <li key={call.id}><button type="button" onClick={() => open(call)}
          className="grid w-full gap-1 rounded-lg border border-[#E4E1DA] p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
          <strong className="break-words">{call.description}</strong>
          <span className="text-xs text-[#5B6472]">Abertura {formatDateBR(call.openedDate)} · Prazo {formatDateBR(call.deadlineDate)}</span>
          <span className="flex flex-wrap items-center gap-2"><StatusBadge label={call.status} />
            <span className="font-semibold">{formatBRL(call.cost)}</span>
            {call.status !== 'Resolvido' && call.deadlineDate && call.deadlineDate < today && <StatusBadge label="Prazo vencido" tone="bad" />}
          </span>
        </button></li>)}
      </ul> : <p className="text-sm text-[#5B6472]">Sem chamados nesta obra.</p>}
      <Modal open={Boolean(linkedCall)} title="Chamado de garantia" onClose={() => setRecordId('')}>
        {linkedCall && <div className="grid gap-3 text-sm">
          <p className="break-words font-semibold">{linkedCall.description}</p>
          <StatusBadge label={linkedCall.status} />
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Obra</dt><dd>{project.name}</dd></div>
            <div><dt>Prazo</dt><dd>{formatDateBR(linkedCall.deadlineDate)}</dd></div>
            <div><dt>Abertura</dt><dd>{formatDateBR(linkedCall.openedDate)}</dd></div>
            <div><dt>Custo registrado</dt><dd>{formatBRL(linkedCall.cost)}</dd></div>
          </dl>
          <button type="button" className={secondary} onClick={() => { setRecordId(''); open(linkedCall); }}>Editar chamado</button>
        </div>}
      </Modal>
      <Modal open={Boolean(editing)} onClose={() => setEditing(null)}
        title={editing === 'new' ? 'Registrar chamado' : 'Editar chamado'} maxWidth="max-w-lg">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          if (!editing) return;
          setSaving(true); setError('');
          try {
            await saveWarrantyCall(uid, actor, project.id, { description, openedDate, deadlineDate, cost: Number(cost), status },
              editing === 'new' ? undefined : editing.id);
            setEditing(null);
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível registrar o chamado.'); }
          finally { setSaving(false); }
        }}>
          {warranty && <p className="text-xs text-[#5B6472]">Período de garantia · {formatDateBR(warranty.start)} a {formatDateBR(warranty.end)}</p>}
          <label className={label}>Descrição
            <textarea className={input} required rows={3} maxLength={400} value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Abertura
              <input type="date" required className={input} value={openedDate} max={today} onChange={(event) => setOpenedDate(event.target.value)} />
            </label>
            <label className={label}>Prazo
              <input type="date" required className={input} value={deadlineDate} min={openedDate} onChange={(event) => setDeadlineDate(event.target.value)} />
            </label>
            <label className={label}>Custo registrado (R$)
              <input type="number" required min={0} step="0.01" inputMode="decimal" className={input} value={cost} onChange={(event) => setCost(event.target.value)} />
            </label>
            <label className={label}>Situação
              <select className={input} value={status} onChange={(event) => setStatus(event.target.value as WarrantyStatus)}>
                {statuses.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <RegisteredBySelect id="post-warranty-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button type="submit" className={primary + ' justify-self-end'} disabled={saving}>{saving ? 'Salvando...' : 'Salvar chamado'}</button>
        </form>
      </Modal>
    </section>
  );
}

function FollowUp({ uid, project, data }: { uid: string; project: Project; data: PilotisDataState }) {
  const current = data.projectFollowUps?.find((row) => row.projectId === project.id);
  const logs = data.dailyLogs.filter((log) => log.projectId === project.id);
  const client = data.clients.find((row) => row.id === project.clientId);
  const [open, setOpen] = useState(false);
  const [testimonial, setTestimonial] = useState('');
  const [referrals, setReferrals] = useState('');
  const [testimonialRequestedAt, setTestimonialRequestedAt] = useState('');
  const [referralRequestedAt, setReferralRequestedAt] = useState('');
  const [photos, setPhotos] = useState<MarketingPhotoRef[]>([]);
  const [note, setNote] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState('');
  const today = planningTodayISO();
  const approved = current?.marketingPhotos ?? [];
  const message = 'Olá' + (client?.name ? ', ' + client.name : '') +
    '! Agradecemos pela confiança na Pilotis durante a obra ' + project.name +
    '. Você poderia nos enviar um depoimento sobre a experiência? Se conhecer alguém que esteja planejando construir ou reformar, agradecemos pela indicação.';
  return (
    <div className="grid gap-4">
      <section className={card + ' grid gap-3'}>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Depoimento e indicação</h2>
          <button type="button" className={secondary} onClick={() => {
            setOpen(true); setError(''); setTestimonial(current?.testimonial ?? ''); setReferrals(current?.referrals ?? '');
            setTestimonialRequestedAt(current?.testimonialRequestedAt ?? ''); setReferralRequestedAt(current?.referralRequestedAt ?? '');
            setPhotos(approved); setNote(current?.authorizationNote ?? '');
          }}>Registrar retorno ou autorização</button>
        </header>
        <p className="text-sm">Depoimento · <strong>{current?.testimonial ? 'Recebido' : current?.testimonialRequestedAt ? 'Solicitado em ' + formatDateBR(current.testimonialRequestedAt) : 'A solicitar'}</strong></p>
        {current?.testimonial && <blockquote className="whitespace-pre-wrap break-words rounded-lg bg-[#F6F5F2] p-3 text-sm">{current.testimonial}</blockquote>}
        <p className="text-sm">Indicação · <strong>{current?.referrals ? 'Recebida' : current?.referralRequestedAt ? 'Solicitada em ' + formatDateBR(current.referralRequestedAt) : 'A solicitar'}</strong></p>
        {current?.referrals && <p className="whitespace-pre-wrap break-words text-sm">{current.referrals}</p>}
        <details className="rounded-lg border border-[#E4E1DA] p-3">
          <summary className="cursor-pointer text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">Solicitar depoimento e indicação</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={secondary} onClick={() => {
              void (async () => {
                try { await navigator.clipboard.writeText(message); setCopied('Texto copiado.'); }
                catch { setCopied('Selecione e copie o texto da solicitação.'); }
              })();
            }}>Copiar texto</button>
            {client?.email && <a className={secondary} href={'mailto:' + encodeURIComponent(client.email).replace('%40', '@') +
              '?subject=' + encodeURIComponent('Pós-obra · Pilotis') + '&body=' + encodeURIComponent(message)}>Abrir e-mail</a>}
          </div>
          {copied && <p role="status" className="mt-2 text-xs text-[#5B6472]">{copied}</p>}
        </details>
      </section>
      <section className={card + ' grid gap-3'}>
        <h2 className="text-base font-semibold">Fotos autorizadas para marketing</h2>
        {current?.authorizationNote && <p className="whitespace-pre-wrap break-words text-xs text-[#5B6472]">{current.authorizationNote}</p>}
        {approved.length ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {approved.map((photo, index) => {
            const log = logs.find((row) => row.id === photo.logId);
            return log ? <PhotoPreview key={photo.logId + '/' + photo.photoId} log={log} id={photo.photoId} index={index + 1} downloadable />
              : <p key={photo.logId + '/' + photo.photoId} className="text-xs">Foto indisponível.</p>;
          })}
        </div> : <p className="text-sm text-[#5B6472]">Sem fotos autorizadas registradas.</p>}
      </section>
      <Modal open={open} onClose={() => setOpen(false)} title="Acompanhamento pós-obra" maxWidth="max-w-2xl">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true); setError('');
          try {
            await saveProjectFollowUp(uid, actor, project.id, {
              testimonial, referrals, testimonialRequestedAt, referralRequestedAt, marketingPhotos: photos, authorizationNote: note,
            });
            setOpen(false);
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o acompanhamento.'); }
          finally { setSaving(false); }
        }}>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className={label}>Data do pedido de depoimento
              <input type="date" max={today} className={input} value={testimonialRequestedAt} onChange={(event) => setTestimonialRequestedAt(event.target.value)} />
            </label>
            <label className={label}>Data do pedido de indicação
              <input type="date" max={today} className={input} value={referralRequestedAt} onChange={(event) => setReferralRequestedAt(event.target.value)} />
            </label>
          </div>
          <label className={label}>Depoimento recebido
            <textarea className={input} rows={3} maxLength={3000} value={testimonial} onChange={(event) => setTestimonial(event.target.value)} />
          </label>
          <label className={label}>Indicações recebidas
            <textarea className={input} rows={2} maxLength={2000} value={referrals} onChange={(event) => setReferrals(event.target.value)} />
          </label>
          <PhotoSelection logs={logs} photos={photos} onChange={setPhotos} note={note} onNoteChange={setNote} />
          <RegisteredBySelect id="post-follow-up-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <button type="submit" className={primary + ' justify-self-end'} disabled={saving}>{saving ? 'Salvando...' : 'Salvar acompanhamento'}</button>
        </form>
      </Modal>
    </div>
  );
}

export function PostConstructionView({ uid, data, projectId, initialProjectId }: {
  uid: string; data: PilotisDataState; projectId?: string; initialProjectId?: string;
}) {
  const [recordId, setRecordId] = useViewParam('registro');
  const [activeOnly, setActiveOnly] = useState(!initialProjectId);
  const [selectedId, setSelectedId] = useState(initialProjectId ?? '');
  const today = planningTodayISO();
  const projects = data.projects.filter((row) => row.status === 'Concluída' && (!projectId || row.id === projectId));
  const visible = activeOnly && !projectId ? projects.filter((row) => getWarrantyWindow(row, today)?.active) : projects;
  const selected = visible.find((row) => row.id === selectedId) ?? visible[0];
  const linkedWarranty = selected && selected.id === recordId ? getWarrantyWindow(selected, today) : null;
  const totals = summarizeWarrantyCalls(data.warrantyCalls.filter((call) => visible.some((row) => row.id === call.projectId)));
  const testimonials = (data.projectFollowUps ?? []).filter((row) => row.testimonial && visible.some((item) => item.id === row.projectId));
  return (
    <div className="grid gap-4">
      <Modal open={Boolean(linkedWarranty)} onClose={() => setRecordId('')}
        title={selected ? 'Garantia · ' + selected.name : 'Garantia'}>
        {linkedWarranty && <div className="grid gap-3 text-sm">
          <StatusBadge label={linkedWarranty.active ? 'Em garantia' : 'Fora do período de garantia'} />
          <dl className="grid gap-2 sm:grid-cols-2">
            <div><dt>Início da garantia</dt><dd>{formatDateBR(linkedWarranty.start)}</dd></div>
            <div><dt>Fim da garantia</dt><dd>{formatDateBR(linkedWarranty.end)}</dd></div>
          </dl>
        </div>}
      </Modal>
      {!projectId && <section className={card + ' grid gap-3'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Pós-obra e garantia</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activeOnly} onChange={(event) => setActiveOnly(event.target.checked)} />
            Somente obras em garantia
          </label>
        </div>
        {visible.length ? <div className="grid gap-2">
          <p className="text-sm">Custo dos chamados · <strong>{formatBRL(totals.cost)}</strong> · Depoimentos recebidos <strong>{testimonials.length}</strong></p>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((row) => {
              const window = getWarrantyWindow(row, today);
              return <li key={row.id}><button type="button" aria-pressed={selected?.id === row.id} onClick={() => setSelectedId(row.id)}
                className="grid w-full gap-1 rounded-lg border border-[#E4E1DA] p-3 text-left text-sm focus-visible:ring-2 focus-visible:ring-[#1F3A5F] aria-pressed:border-[#1F3A5F]">
                <strong>{row.name}</strong>
                <span className="text-xs text-[#5B6472]">{window ? 'Garantia até ' + formatDateBR(window.end) : 'Sem data de garantia'}</span>
                {testimonials.some((item) => item.projectId === row.id) && <span className="text-xs font-semibold text-[#1D6849]">Depoimento recebido</span>}
              </button></li>;
            })}
          </ul>
        </div> : <p className="text-sm text-[#5B6472]">{activeOnly ? 'Sem obras em garantia nesta data.' : 'Sem obras encerradas.'}</p>}
      </section>}
      {selected ? (
        <div key={selected.id} className="grid items-start gap-4 lg:grid-cols-2">
          <WarrantyCalls uid={uid} project={selected} calls={data.warrantyCalls.filter((row) => row.projectId === selected.id).sort((a, b) => (b.openedDate ?? '').localeCompare(a.openedDate ?? ''))} />
          <FollowUp uid={uid} project={selected} data={data} />
        </div>
      ) : projectId ? <p className={card + ' text-sm text-[#5B6472]'}>Encerramento pendente para iniciar o pós-obra.</p> : null}
    </div>
  );
}
