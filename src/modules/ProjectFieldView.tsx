import { useEffect, useState } from 'react';
import {
  AlertNote, Modal, ProgressBar, RegisteredBySelect, StatusBadge,
} from '../components/ui/PilotisUI';
import {
  applyFieldStageUpdate, DAILY_PHOTO_LIMIT, FIELD_OFFLINE_NOTICE, formatDateBR,
  getFieldStageFields, isValidISODate, planningTodayISO, validateStageWorkflow,
  type FieldJob, type FieldStageFields, type FieldStageUpdate,
} from '../domain';
import { compressDailyLogPhoto, readDailyLogPhoto } from '../services/dailyLogPhotos';
import {
  cacheDiaryPhoto, flushFieldQueue, getCachedDiaryPhoto, putFieldJob, readFieldQueue, removeFieldJob, subscribeFieldQueue,
} from '../services/fieldQueue';
import { generateId } from '../services/pilotisService';
import type { ActorRole, DailyLog, Pop, Project, ProjectStage, WeatherType } from '../types/pilotis';

const card = 'grid gap-3 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const input = 'w-full rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const primary = 'min-h-10 rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const secondary = 'min-h-10 rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
type DiaryJob = Extract<FieldJob, { kind: 'diary' }>;
type StageJob = Extract<FieldJob, { kind: 'stage' }>;
type Photo = DiaryJob['photos'][number];
const weatherOptions: WeatherType[] = ['Sol', 'Chuva fraca', 'Chuva forte'];

function useFieldQueue(uid: string) {
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [queueError, setQueueError] = useState('');
  useEffect(() => {
    let disposed = false;
    let requestId = 0;
    const refresh = () => {
      const request = ++requestId;
      void readFieldQueue(uid).then((items) => {
        if (!disposed && request === requestId) { setJobs(items); setQueueError(''); }
      }).catch(() => {
        if (!disposed) setQueueError('O armazenamento local está indisponível neste navegador.');
      });
    };
    const updateOnline = () => setOnline(navigator.onLine);
    const unlisten = subscribeFieldQueue(refresh);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    refresh();
    return () => {
      disposed = true;
      unlisten();
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, [uid]);

  function send() { void flushFieldQueue(uid).catch(() => setQueueError('Não foi possível iniciar a sincronização.')); }
  return {
    jobs, online, queueError, send,
    save: async (job: FieldJob) => { await putFieldJob(job); send(); },
    retry: async (job: FieldJob) => { await putFieldJob({ ...job, error: undefined }); send(); },
    remove: (id: string) => removeFieldJob(uid, id),
  };
}

function QueueStatus({ queue, jobs }: { queue: ReturnType<typeof useFieldQueue>; jobs: FieldJob[] }) {
  const [error, setError] = useState('');
  const pending = jobs.filter((job) => !job.error).length;
  const blocked = jobs.filter((job) => job.error);
  return (
    <div className="grid gap-2">
      {!queue.online && <p role="status" className="rounded-lg bg-[#E6EEFB] px-3 py-2 text-sm font-semibold text-[#1F3A5F]">{FIELD_OFFLINE_NOTICE}</p>}
      {queue.queueError && <p role="alert" className="text-sm text-[#B42318]">{queue.queueError}</p>}
      {queue.online && pending > 0 && <p role="status" className="text-sm text-[#5B6472]">
        {pending === 1 ? '1 registro aguardando sincronização.' : pending + ' registros aguardando sincronização.'}
      </p>}
      {blocked.map((job) => (
        <AlertNote key={job.id} tone="bad" title="Registro aguardando revisão">
          <p>{job.error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={secondary} disabled={!queue.online} onClick={() => {
              setError(''); void queue.retry(job).catch(() => setError('Não foi possível reabrir o registro local.'));
            }}>Tentar novamente</button>
            <button type="button" className={secondary} onClick={() => {
              if (!window.confirm('Retirar este registro do aparelho?')) return;
              setError(''); void queue.remove(job.id).catch(() => setError('Não foi possível retirar o registro.'));
            }}>Retirar da fila</button>
          </div>
        </AlertNote>
      ))}
      {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
    </div>
  );
}

function PhotoTile({ photoId, blob, log, online, index }: { photoId: string; blob?: Blob; log?: DailyLog; online: boolean; index: number }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    let objectUrl = '';
    setUrl(''); setError(false);
    async function load() {
      let image = blob;
      if (!image && log) {
        image = await getCachedDiaryPhoto(log.ownerUid, log.id, photoId).catch(() => undefined);
        if (!image) {
          image = await readDailyLogPhoto(log, photoId);
          void cacheDiaryPhoto(log.ownerUid, log.id, photoId, image).catch(() => undefined);
        }
      }
      if (!image || disposed) return;
      objectUrl = URL.createObjectURL(image);
      setUrl(objectUrl);
    }
    void load().catch(() => { if (!disposed) setError(true); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [blob, log, photoId, online]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" aria-label={'Abrir foto ' + index + ' do registro'}
      className="block overflow-hidden rounded-lg bg-[#F0EEE9] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
      <img src={url} alt={'Foto ' + index + ' do registro'} className="aspect-square w-full object-cover" />
    </a>
  ) : <span className="grid aspect-square place-items-center rounded-lg bg-[#F0EEE9] p-2 text-center text-xs text-[#5B6472]">
    {error ? 'Foto indisponível' : 'Carregando foto…'}
  </span>;
}

function DiaryRecord({ log, pending, online, initiallyOpen }: { log: DailyLog; pending?: DiaryJob; online: boolean; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const photos = pending?.photos ?? (log.photoIds ?? []).map((id) => ({ id, blob: undefined }));
  const hasPeople = log.presentCount !== undefined;
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className={card}>
      <summary className="cursor-pointer rounded text-sm font-semibold focus-visible:ring-2 focus-visible:ring-[#1F3A5F]">
        {formatDateBR(log.date)} · {log.weather}{hasPeople ? ' · ' + log.presentCount + (log.presentCount === 1 ? ' pessoa' : ' pessoas') : ''}
        {pending && <span className="ml-2 inline-block"><StatusBadge label={pending.error ? 'Aguardando revisão' : 'Salvo no aparelho'} tone="warn" /></span>}
      </summary>
      {open && <div className="mt-3 grid gap-3 text-sm">
        {log.presentTeam && <p className="whitespace-pre-wrap break-words"><strong>Equipe presente</strong><br />{log.presentTeam}</p>}
        <p className="whitespace-pre-wrap break-words"><strong>Atividades</strong><br />{log.activities}</p>
        {log.occurrences && <p className="whitespace-pre-wrap break-words"><strong>Ocorrências</strong><br />{log.occurrences}</p>}
        {photos.length > 0 && <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((photo, index) => <li key={photo.id}><PhotoTile photoId={photo.id} blob={photo.blob}
            log={pending ? undefined : log} online={online} index={index + 1} /></li>)}
        </ul>}
        <p className="text-xs text-[#5B6472]">Registrado por {log.createdBy}</p>
      </div>}
    </details>
  );
}

export function ProjectDiary({ uid, project, logs }: { uid: string; project: Project; logs: DailyLog[] }) {
  const queue = useFieldQueue(uid);
  const [date, setDate] = useState(planningTodayISO);
  const [count, setCount] = useState('');
  const [weather, setWeather] = useState<WeatherType | ''>('');
  const [people, setPeople] = useState('');
  const [activities, setActivities] = useState('');
  const [occurrences, setOccurrences] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');

  const remote = logs.filter((log) => log.projectId === project.id);
  const pending = queue.jobs.filter((job): job is DiaryJob => job.kind === 'diary' && job.draft.projectId === project.id);
  const entries = [
    ...pending.filter((job) => !remote.some((log) => log.id === job.id)).map((job) => ({
      pending: job,
      log: { ...job.draft, id: job.id, ownerUid: uid, photoNotes: [], createdBy: job.actor, updatedBy: job.actor },
    })),
    ...remote.map((log) => ({ log, pending: undefined })),
  ].sort((a, b) => b.log.date.localeCompare(a.log.date) || Number(Boolean(b.pending)) - Number(Boolean(a.pending)));

  async function addPhotos(files: File[]) {
    if (!files.length) return;
    if (files.length + photos.length > DAILY_PHOTO_LIMIT) { setError('Anexe até ' + DAILY_PHOTO_LIMIT + ' fotos por registro.'); return; }
    setCompressing(true); setError('');
    const failures: string[] = [];
    const compressed: Photo[] = [];
    try {
      for (const file of files) {
        try { compressed.push({ id: generateId('photo'), blob: await compressDailyLogPhoto(file) }); }
        catch { failures.push(file.name || 'Foto'); }
      }
      setPhotos((current) => [...current, ...compressed].slice(0, DAILY_PHOTO_LIMIT));
      if (failures.length) setError('Não foi possível preparar: ' + failures.join(', ') + '. Use outra imagem.');
    } finally { setCompressing(false); }
  }

  return (
    <div className="grid gap-4">
      <QueueStatus queue={queue} jobs={pending} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section className={card + ' lg:col-start-2 lg:row-start-1'}>
          <h2 className="text-base font-semibold">Novo registro do dia</h2>
          <form className="grid gap-3" onSubmit={async (event) => {
            event.preventDefault();
            setError(''); setFeedback('');
            const presentCount = Number(count);
            if (!isValidISODate(date) || !count.trim() || !Number.isInteger(presentCount) || presentCount < 0 || !weather || !activities.trim()) {
              setError('Preencha a data, o clima, a equipe presente e as atividades.'); return;
            }
            setSaving(true);
            try {
              await queue.save({
                id: generateId('log'), kind: 'diary', uid, actor, queuedAt: Date.now(), photos,
                draft: { projectId: project.id, date, presentCount, weather, activities: activities.trim(),
                  occurrences: occurrences.trim(), presentTeam: people.trim() },
              });
              setCount(''); setWeather(''); setPeople(''); setActivities(''); setOccurrences(''); setPhotos([]);
              setFeedback(queue.online ? 'Registro salvo no aparelho. Sincronização em andamento.' : 'Registro salvo no aparelho.');
            } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar no aparelho.'); }
            finally { setSaving(false); }
          }}>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-sm font-semibold">Data
                <input type="date" className={input} value={date} onChange={(event) => setDate(event.target.value)} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">Equipe presente
                <input type="number" inputMode="numeric" className={input} value={count} min={0} step={1}
                  onChange={(event) => setCount(event.target.value)} required />
              </label>
            </div>
            <label className="grid gap-1 text-sm font-semibold">Nomes da equipe (opcional)
              <textarea rows={2} maxLength={500} className={input} value={people} onChange={(event) => setPeople(event.target.value)} />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Clima
              <select className={input} value={weather} onChange={(event) => setWeather(event.target.value as WeatherType | '')} required>
                <option value="">Selecione</option>{weatherOptions.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">Atividades do dia
              <textarea rows={3} className={input} value={activities} maxLength={1500} onChange={(event) => setActivities(event.target.value)} required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">Ocorrências
              <textarea rows={2} className={input} value={occurrences} maxLength={1000} onChange={(event) => setOccurrences(event.target.value)} />
            </label>
            <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-2">
              <legend className="px-1 text-sm font-semibold">Fotos · {photos.length}/{DAILY_PHOTO_LIMIT}</legend>
              <div className="flex flex-wrap gap-2">
                <label className={secondary + ' relative cursor-pointer focus-within:ring-2 focus-within:ring-[#1F3A5F]'}>
                  Selecionar fotos
                  <input className="sr-only" type="file" accept="image/*" multiple disabled={compressing || saving || photos.length >= DAILY_PHOTO_LIMIT}
                    onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addPhotos(files); }} />
                </label>
                <label className={secondary + ' relative cursor-pointer focus-within:ring-2 focus-within:ring-[#1F3A5F] md:hidden'}>
                  Fotografar
                  <input className="sr-only" type="file" accept="image/*" capture="environment" disabled={compressing || saving || photos.length >= DAILY_PHOTO_LIMIT}
                    onChange={(event) => { const files = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; void addPhotos(files); }} />
                </label>
              </div>
              {compressing && <p role="status" className="text-xs text-[#5B6472]">Preparando fotos...</p>}
              {photos.length > 0 && <ul className="grid grid-cols-3 gap-2">
                {photos.map((photo, index) => <li key={photo.id} className="grid gap-1">
                  <PhotoTile photoId={photo.id} blob={photo.blob} online={queue.online} index={index + 1} />
                  <button type="button" onClick={() => setPhotos((current) => current.filter((item) => item.id !== photo.id))}
                    className="rounded text-xs text-[#B42318] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]" disabled={saving}
                    aria-label={'Remover foto ' + (index + 1)}>Remover</button>
                </li>)}
              </ul>}
            </fieldset>
            <RegisteredBySelect id="diary-actor" value={actor} onChange={setActor} />
            {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
            {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
            <button type="submit" className={primary} disabled={saving || compressing}>{saving ? 'Salvando no aparelho...' : 'Salvar registro do dia'}</button>
          </form>
        </section>
        <section className="grid min-w-0 gap-3 lg:col-start-1 lg:row-start-1">
          <h2 className="text-base font-semibold">Registros do diário</h2>
          {entries.length ? entries.map(({ log, pending: job }, index) => (
            <DiaryRecord key={log.id} log={log} pending={job} online={queue.online} initiallyOpen={index === 0} />
          )) : <p className={card + ' text-sm text-[#5B6472]'}>Sem registros nesta obra.</p>}
        </section>
      </div>
    </div>
  );
}

export function FieldStages({ uid, project, stages, pops }: { uid: string; project: Project; stages: ProjectStage[]; pops: Pop[] }) {
  const queue = useFieldQueue(uid);
  const [editing, setEditing] = useState<ProjectStage | null>(null);
  const [progress, setProgress] = useState('');
  const [material, setMaterial] = useState('');
  const [checklist, setChecklist] = useState<string[]>([]);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const pending = queue.jobs.filter((job): job is StageJob => job.kind === 'stage' && job.projectId === project.id);
  const displayStages = new Map(stages.map((stage) => [stage.id, stage]));
  const paused = new Set<string>();
  for (const job of pending) {
    if (job.error) paused.add(job.stageId);
    const stage = displayStages.get(job.stageId);
    if (!stage || paused.has(job.stageId)) continue;
    try { displayStages.set(stage.id, applyFieldStageUpdate(stage, job.update)); }
    catch { paused.add(job.stageId); }
  }
  const pop = pops.find((item) => item.id === editing?.popId);

  async function save(complete: boolean) {
    if (!editing) return;
    setError(''); setFeedback('');
    const progressPct = Number(progress);
    if (!progress.trim() || !Number.isFinite(progressPct) || progressPct < 0 || progressPct > 100) {
      setError('Informe um progresso entre 0 e 100.'); return;
    }
    if (material && !isValidISODate(material)) { setError('Informe uma data válida para o material do cliente.'); return; }
    const previous = getFieldStageFields(editing);
    const next: Partial<FieldStageFields> = {};
    if (!complete && progressPct !== previous.progressPct) next.progressPct = progressPct;
    if (material !== previous.materialExpectedDate) next.materialExpectedDate = material;
    if (checklist.length !== previous.checklistCompleted.length || checklist.some((item) => !previous.checklistCompleted.includes(item))) {
      next.checklistCompleted = checklist;
    }
    if (!complete && !Object.keys(next).length) { setError('Atualize um campo para salvar.'); return; }
    setSaving(true);
    try {
      const update: FieldStageUpdate = { previous, next, popId: editing.popId ?? '', complete };
      const candidate = applyFieldStageUpdate(editing, update);
      validateStageWorkflow(candidate, editing, [...displayStages.values()], project, pop);
      await queue.save({
        id: generateId('field'), kind: 'stage', uid, actor, queuedAt: Date.now(),
        projectId: project.id, stageId: editing.id, knownStageIds: stages.map((stage) => stage.id), update,
      });
      setEditing(null);
      setFeedback('Atualização salva no aparelho.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar a etapa.'); }
    finally { setSaving(false); }
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-base font-semibold">Etapas em campo</h2>
      <QueueStatus queue={queue} jobs={pending} />
      {feedback && <p role="status" className="text-sm text-[#1D6849]">{feedback}</p>}
      {stages.length === 0 ? <p className={card + ' text-sm text-[#5B6472]'}>Sem etapas no cronograma.</p> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {[...displayStages.values()].map((stage) => <li key={stage.id} className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="text-sm text-[#14181F]">{stage.wbsCode} · {stage.name}</strong>
              <StatusBadge label={stage.status} />
            </div>
            <ProgressBar pct={stage.progressPct} />
            <p className="text-xs text-[#5B6472]">{stage.progressPct}%{stage.materialExpectedDate && ' · Material prometido para ' + formatDateBR(stage.materialExpectedDate)}</p>
            {pending.some((job) => job.stageId === stage.id) && <p className="text-xs font-medium text-[#704509]">Atualização na fila do aparelho</p>}
            <button type="button" className={secondary + ' justify-self-start'} onClick={() => {
              const fields = getFieldStageFields(stage);
              setEditing(stage); setProgress(String(fields.progressPct)); setMaterial(fields.materialExpectedDate);
              setChecklist(fields.checklistCompleted); setError(''); setFeedback('');
            }}>Atualizar etapa</button>
          </li>)}
        </ul>
      )}
      <Modal open={Boolean(editing)} onClose={() => { if (!saving) setEditing(null); }} title={editing?.name ?? 'Atualizar etapa'} maxWidth="max-w-lg">
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(false); }}>
          <label className="grid gap-1 text-sm font-semibold">Progresso (%)
            <input type="number" inputMode="decimal" min={0} max={100} step="any" className={input}
              value={progress} onChange={(event) => setProgress(event.target.value)} disabled={editing?.status === 'Concluída'} />
          </label>
          <label className="grid gap-1 text-sm font-semibold">Data prometida do material do cliente
            <input type="date" className={input} value={material} onChange={(event) => setMaterial(event.target.value)} />
          </label>
          {pop && (pop.acceptanceCriteria?.length ?? 0) > 0 && <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-2">
            <legend className="px-1 text-sm font-semibold">Checklist · {pop.title}</legend>
            {(pop.acceptanceCriteria ?? []).map((item) => (
              <label key={item} className="flex min-h-9 items-center gap-2 text-sm">
                <input type="checkbox" checked={checklist.includes(item)} disabled={editing?.status === 'Concluída'}
                  onChange={(event) => setChecklist((current) => event.target.checked ? [...current, item] : current.filter((value) => value !== item))} />
                {item}
              </label>
            ))}
          </fieldset>}
          {editing?.popId && !pop && <p className="text-sm text-[#704509]">Checklist do POP indisponível no aparelho.</p>}
          <RegisteredBySelect id="field-stage-actor" value={actor} onChange={setActor} />
          {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="submit" className={secondary} disabled={saving}>{saving ? 'Salvando...' : 'Salvar atualização'}</button>
            {editing?.status !== 'Concluída' && <button type="button" className={primary} disabled={saving} onClick={() => void save(true)}>
              Marcar como concluída
            </button>}
          </div>
        </form>
      </Modal>
    </section>
  );
}
