import { useEffect, useState } from 'react';
import { Button, Card, Modal, RegisteredBySelect, StatusBadge } from '../components/ui/PilotisUI';
import { formatDateBR } from '../domain/formatters';
import { planningTodayISO } from '../domain/pilotisAdapters';
import { reportMonth, REPORT_PHOTO_LIMIT, type ClientApproval, type ReportPhotoSelection, type WorkReportRecord } from '../domain/workReport';
import { readDailyLogPhoto } from '../services/dailyLogPhotos';
import { reportLogoJpeg, workReportRequest } from '../services/workReportService';
import type { ActorRole, DailyLog, PilotisDataState, Project } from '../types/pilotis';

const field = 'min-w-0 w-full rounded-lg border border-[#E4E1DA] bg-white p-2.5 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const label = 'grid min-w-0 gap-1 text-sm font-semibold';
const newApproval: ClientApproval = { id: '', title: '', dueDate: '', approvedAt: '' };
const time = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const stamp = (iso: string) => time.format(new Date(iso));
const monthLabel = (month: string) => month.slice(5) + '/' + month.slice(0, 4);
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir a operação.';

function ReportPhotoTile({ log, photoId, index }: { log: DailyLog; photoId: string; index: number }) {
  const [src, setSrc] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let url = '';
    void readDailyLogPhoto(log, photoId).then((blob) => {
      if (active) { url = URL.createObjectURL(blob); setSrc(url); }
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [log, photoId]);
  return src ? <img src={src} alt={'Foto ' + (index + 1) + ' do diário de ' + formatDateBR(log.date)}
    className="h-24 w-full rounded-lg object-cover" /> :
    <p className="grid h-24 place-items-center rounded-lg bg-[#F6F5F2] p-2 text-center text-xs">
      {failed ? 'Foto indisponível' : 'Carregando foto…'}
    </p>;
}

function ReportCreator({ project, data, onClose, onCreated }: {
  project: Project; data: PilotisDataState; onClose: () => void; onCreated: (row: WorkReportRecord) => void;
}) {
  const today = planningTodayISO();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [logId, setLogId] = useState('');
  const [photos, setPhotos] = useState<ReportPhotoSelection[]>([]);
  const [authorized, setAuthorized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const period = reportMonth(month, today);
  const logs = period ? data.dailyLogs.filter((row) => row.projectId === project.id &&
    row.date >= period.first && row.date <= period.cutoff && row.photoIds?.length)
    .sort((a, b) => b.date.localeCompare(a.date)) : [];
  const log = logs.find((row) => row.id === logId);
  const key = (photo: ReportPhotoSelection) => photo.logId + '/' + photo.photoId;

  return <Modal open onClose={onClose} title="Gerar relatório de andamento" maxWidth="max-w-2xl">
    <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault();
      if (!period || saving) return;
      setSaving(true); setError('');
      try {
        const logoJpeg = await reportLogoJpeg(data.settings?.pdfShowLogo === false ? undefined : data.settings?.logoDataUrl);
        const response = await workReportRequest(project.id, '', { actor, month, photos, photosAuthorized: authorized, logoJpeg });
        onCreated(await response.json() as WorkReportRecord);
      } catch (error) { setError(errorText(error)); }
      finally { setSaving(false); }
    }}>
      <label className={label}>Mês do relatório
        <input type="month" required max={today.slice(0, 7)} value={month} className={field} onChange={(event) => {
          setMonth(event.target.value); setLogId(''); setPhotos([]); setAuthorized(false);
        }} />
      </label>
      <fieldset className="grid min-w-0 gap-3 rounded-lg border border-[#E4E1DA] p-3">
        <legend className="px-1 text-sm font-semibold">Fotos do diário · {photos.length}/{REPORT_PHOTO_LIMIT}</legend>
        {logs.length ? <label className={label}>Registro do diário
          <select className={field} value={logId} onChange={(event) => setLogId(event.target.value)}>
            <option value="">Selecione uma data</option>
            {logs.map((log) => <option key={log.id} value={log.id}>{formatDateBR(log.date)} · {log.activities.slice(0, 45)}</option>)}
          </select>
        </label> : <p className="text-sm text-[#424D5D]">Nenhuma foto sincronizada para este mês.</p>}
        {log && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {log.photoIds?.map((photoId, index) => {
            const selected = photos.some((photo) => photo.logId === log.id && photo.photoId === photoId);
            return <label key={log.id + '/' + photoId} className="grid min-w-0 cursor-pointer gap-1 text-sm">
              <ReportPhotoTile log={log} photoId={photoId} index={index} />
              <span className="flex items-start gap-2">
                <input type="checkbox" checked={selected} disabled={!selected && photos.length >= REPORT_PHOTO_LIMIT}
                  onChange={() => {
                    setAuthorized(false);
                    setPhotos((rows) => selected ? rows.filter((row) => row.logId !== log.id || row.photoId !== photoId) :
                      [...rows, { logId: log.id, photoId, caption: log.photoNotes?.[index] ?? '' }]);
                  }} /> Incluir foto {index + 1}
              </span>
            </label>;
          })}
        </div>}
        {photos.map((photo) => {
          const row = logs.find((log) => log.id === photo.logId);
          const index = (row?.photoIds?.indexOf(photo.photoId) ?? -1) + 1;
          return <div key={key(photo)} className="flex items-end gap-2">
            <label className={label + ' flex-1'}>Legenda · foto {index} de {formatDateBR(row?.date)}
              <input required maxLength={160} className={field} value={photo.caption} onChange={(event) =>
                setPhotos((rows) => rows.map((item) => key(item) === key(photo) ? { ...item, caption: event.target.value } : item))} />
            </label>
            <Button size="sm" variant="secondary" onClick={() => {
              setAuthorized(false); setPhotos((rows) => rows.filter((item) => key(item) !== key(photo)));
            }} aria-label={'Retirar foto ' + index + ' de ' + formatDateBR(row?.date)}>Retirar</Button>
          </div>;
        })}
        {photos.length > 0 && <label className="flex items-start gap-2 text-sm">
          <input required type="checkbox" checked={authorized} onChange={(event) => setAuthorized(event.target.checked)} />
          Confirmo a autorização de uso destas fotos no relatório para o cliente.
        </label>}
      </fieldset>
      <RegisteredBySelect id="report-author" value={actor} onChange={setActor} />
      {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
      <Button type="submit" disabled={!period || saving} className="justify-self-start">{saving ? 'Gerando…' : 'Gerar PDF'}</Button>
    </form>
  </Modal>;
}

type ReportList = { reports: WorkReportRecord[]; approvals: ClientApproval[]; nextCursor: string | null };
type ReportAction = 'share' | 'revoke' | 'sent';

export function ProjectReportView({ project, data }: { project: Project; data: PilotisDataState }) {
  const today = planningTodayISO();
  const [rows, setRows] = useState<ReportList>({ reports: [], approvals: [], nextCursor: null });
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [approval, setApproval] = useState<ClientApproval | null>(null);
  const [action, setAction] = useState<{ row: WorkReportRecord; type: ReportAction } | null>(null);
  const [share, setShare] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const cursor = cursors.at(-1);
  const update = () => setReload((count) => count + 1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void workReportRequest(project.id, cursor ? '?after=' + encodeURIComponent(cursor) : '').then((r) => r.json()).then((result: ReportList) => {
      if (active) { setRows(result); setLoading(false); }
    }).catch((failure) => {
      if (active) { setError(errorText(failure)); setLoading(false); }
    });
    return () => { active = false; };
  }, [project.id, cursor, reload]);

  async function download(row: WorkReportRecord) {
    setError('');
    try {
      const response = await workReportRequest(project.id, '/' + row.id + '/pdf');
      const href = URL.createObjectURL(await response.blob());
      const element = document.createElement('a');
      element.href = href; element.download = 'relatorio-de-andamento-' + row.month + '.pdf';
      document.body.append(element); element.click(); element.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
    } catch (error) { setError(errorText(error)); }
  }

  function openAction(row: WorkReportRecord, type: ReportAction) {
    setActor('Sócio'); setError(''); setFeedback(''); setShare(''); setAction({ row, type });
  }
  const closeModal = () => { if (!busy) { setApproval(null); setAction(null); setShare(''); setError(''); } };

  return <div className="grid gap-4">
    <Card title="Relatórios de andamento" actions={<Button size="sm" onClick={() => { setError(''); setGenerating(true); }}>Novo relatório</Button>}>
      {feedback && <p role="status" className="mb-2 text-sm text-[#1D6849]">{feedback}</p>}
      {error && !approval && !action && <p role="alert" className="mb-2 text-sm text-[#B42318]">{error}</p>}
      {loading ? <p role="status" className="text-sm">Carregando relatórios…</p>
        : rows.reports.length ? <ul className="grid gap-2">
          {rows.reports.map((row) => <li key={row.id} className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <strong>Relatório de {monthLabel(row.month)}</strong>
              {row.shareExpiresAt && <StatusBadge label={row.shareRevokedAt ? 'Link revogado' : row.shareActive ? 'Link ativo' : 'Link expirado'} />}
            </div>
            <p>Gerado em {stamp(row.createdAt)} · {row.createdBy}</p>
            {row.sentAt && <p>Envio registrado em {stamp(row.sentAt)} · {row.sentBy}</p>}
            {row.shareActive && row.shareExpiresAt && <p>Link válido até {stamp(row.shareExpiresAt)}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void download(row)}>Baixar PDF</Button>
              <Button size="sm" variant="secondary" onClick={() => openAction(row, 'share')}>{row.shareActive ? 'Gerar novo link' : 'Gerar link de leitura'}</Button>
              {row.shareActive && <Button size="sm" variant="secondary" onClick={() => openAction(row, 'revoke')}>Revogar link</Button>}
              <Button size="sm" variant="secondary" onClick={() => openAction(row, 'sent')}>Registrar envio</Button>
            </div>
          </li>)}
        </ul> : <p className="text-sm text-[#424D5D]">Nenhum relatório gerado.</p>}
      {!loading && (rows.nextCursor || cursors.length > 1) && <div className="mt-3 flex flex-wrap gap-2">
        {cursors.length > 1 && <Button size="sm" variant="secondary" onClick={() => setCursors((old) => old.slice(0, -1))}>Mais recentes</Button>}
        {rows.nextCursor && <Button size="sm" variant="secondary" onClick={() => setCursors((old) => [...old, rows.nextCursor])}>Mais antigos</Button>}
      </div>}
    </Card>

    <Card title="Aprovações do cliente" actions={<Button size="sm" variant="secondary" onClick={() => {
      setActor('Sócio'); setError(''); setApproval({ ...newApproval });
    }}>Nova aprovação</Button>}>
      {rows.approvals.length ? <ul className="grid gap-2">
        {rows.approvals.map((row) => <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F6F5F2] p-2 text-sm">
          <span className="break-words">{row.title} · {row.approvedAt ? 'Aprovada em ' + formatDateBR(row.approvedAt) :
            row.dueDate ? 'Pendente até ' + formatDateBR(row.dueDate) : 'Pendente'}</span>
          <Button size="sm" variant="secondary" onClick={() => { setError(''); setActor('Sócio'); setApproval(row); }} aria-label={'Editar aprovação ' + row.title}>Editar</Button>
        </li>)}
      </ul> : <p className="text-sm text-[#424D5D]">Nenhuma aprovação cadastrada.</p>}
    </Card>

    {generating && <ReportCreator project={project} data={data} onClose={() => setGenerating(false)} onCreated={(row) => {
      setGenerating(false); setCursors([null]); update(); setFeedback('Relatório de ' + monthLabel(row.month) + ' gerado.'); void download(row);
    }} />}

    <Modal open={Boolean(approval)} title="Aprovação do cliente" onClose={closeModal}>
      {approval && <form className="grid gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
          await workReportRequest(project.id, '/approvals', { ...approval, approvalId: approval.id, actor });
          setApproval(null); setFeedback('Aprovação registrada.'); update();
        } catch (error) { setError(errorText(error)); }
        finally { setBusy(false); }
      }}>
        <label className={label}>O que precisa de aprovação
          <input className={field} required maxLength={160} value={approval.title}
            onChange={(event) => setApproval({ ...approval, title: event.target.value })} />
        </label>
        <label className={label}>Prazo para resposta
          <input type="date" className={field} value={approval.dueDate}
            onChange={(event) => setApproval({ ...approval, dueDate: event.target.value })} />
        </label>
        <label className={label}>Data da aprovação
          <input type="date" max={today} className={field} value={approval.approvedAt}
            onChange={(event) => setApproval({ ...approval, approvedAt: event.target.value })} />
          <span className="text-xs font-normal text-[#424D5D]">Deixe em branco enquanto estiver pendente.</span>
        </label>
        <RegisteredBySelect id="report-approval-actor" value={actor} onChange={setActor} />
        {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
        <Button type="submit" disabled={busy} className="justify-self-start">Salvar aprovação</Button>
      </form>}
    </Modal>

    <Modal open={Boolean(action)} title={share ? 'Link somente leitura' : action?.type === 'revoke' ? 'Revogar link'
      : action?.type === 'sent' ? 'Registrar envio do relatório' : 'Gerar link de leitura'} onClose={closeModal}>
      {share ? <div className="grid gap-3 text-sm">
        <label className={label}>Link do relatório
          <input className={field} value={share} readOnly onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p className="text-[#424D5D]">Qualquer pessoa com este link pode abrir o PDF durante 30 dias. Copie o endereço agora para enviar ao cliente.</p>
        <Button size="sm" variant="secondary" className="justify-self-start" onClick={async () => {
          try { await navigator.clipboard.writeText(share); setFeedback('Link copiado.'); }
          catch { setFeedback('Selecione e copie o endereço acima.'); }
        }}>Copiar link</Button>
        {feedback && <p role="status">{feedback}</p>}
      </div> : action && <form className="grid gap-3 text-sm" onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
          const r = await workReportRequest(project.id, '/' + action.row.id + '/' + action.type, { actor });
          const result = await r.json() as { token: string | null };
          update();
          if (result.token) {
            const url = new URL('/relatorio', window.location.origin);
            url.hash = result.token;
            setShare(url.toString());
          } else {
            setFeedback(action.type === 'revoke' ? 'Link revogado.' : 'Envio registrado.');
            setAction(null);
          }
        } catch (error) { setError(errorText(error)); }
        finally { setBusy(false); }
      }}>
        <p>{action.type === 'share' ? (action.row.shareActive ? 'O novo link substitui o atual e vale por 30 dias.' :
          'O link dá acesso ao PDF por 30 dias e pode ser revogado.') : action.type === 'revoke' ?
          'Quem já recebeu este endereço perderá o acesso pelo link.' : 'Confirme depois de enviar o PDF ou o link ao cliente.'}</p>
        <RegisteredBySelect id="report-action-actor" value={actor} onChange={setActor} />
        {error && <p role="alert" className="text-[#B42318]">{error}</p>}
        <Button type="submit" disabled={busy} className="justify-self-start">
          {action.type === 'share' ? 'Gerar link' : action.type === 'revoke' ? 'Revogar' : 'Confirmar envio'}
        </Button>
      </form>}
    </Modal>
  </div>;
}
