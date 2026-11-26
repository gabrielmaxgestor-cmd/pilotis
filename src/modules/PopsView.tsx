import { useEffect, useState } from 'react';
import { AlertNote, EmptySection, Modal, PageHeader, RegisteredBySelect, SegmentedControl, StatusBadge } from '../components/ui/PilotisUI';
import { formatDateBR, isPublishedPop, nextPopVersion, POP_ATTACHMENT_LIMIT, POP_MEDIA_TOTAL_BYTES, readPopContent } from '../domain';
import { saveProjectStage } from '../services/pilotisService';
import { downloadPopPdf } from '../services/popPdfExport';
import { preparePopAttachment, readPopAttachment, savePop, type NewPopFile } from '../services/popService';
import type { ActorRole, PilotisDataState, Pop, PopAttachment, PopContent, PopVersion } from '../types/pilotis';

const panel = 'grid min-w-0 gap-4 rounded-xl border border-[#E4E1DA] bg-white p-4 sm:p-5';
const primary = 'rounded-lg bg-[#1F3A5F] px-3 py-2 text-sm font-semibold text-white focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const secondary = 'rounded-lg border border-[#E4E1DA] bg-white px-3 py-2 text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F] disabled:opacity-50';
const field = 'w-full rounded-lg border border-[#E4E1DA] px-3 py-2 text-sm font-normal focus-visible:ring-2 focus-visible:ring-[#1F3A5F]';
const label = 'grid min-w-0 gap-1 text-sm font-semibold';
const plain = 'whitespace-pre-wrap break-words text-sm leading-relaxed text-[#424B5A]';

const emptyContent: PopContent = {
  title: '', serviceType: '', linkedStagePhase: '', objective: '', materialsAndEpi: '', tools: '',
  protectiveEquipment: '', steps: [], acceptanceCriteria: [], attachments: [], usedInOnboarding: false,
};

function AttachmentPreview({ popId, attachment }: { popId: string; attachment: PopAttachment }) {
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!requested) return;
    let active = true;
    let localUrl = '';
    setUrl(''); setError(false);
    void readPopAttachment(popId, attachment).then((blob) => {
      if (!active) return;
      localUrl = URL.createObjectURL(blob);
      setUrl(localUrl);
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; if (localUrl) URL.revokeObjectURL(localUrl); };
  }, [popId, attachment, requested]);
  const isPhoto = attachment.contentType.startsWith('image/');
  return (
    <li className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 break-words text-sm">{isPhoto ? 'Foto' : 'Vídeo'} · {attachment.name}</span>
        <button type="button" className={secondary} onClick={() => setRequested(!requested)}>{requested ? 'Fechar anexo' : 'Abrir anexo'}</button>
      </div>
      {requested && (error ? <p role="alert" className="text-sm text-[#B42318]">Anexo indisponível. Confira a conexão e abra novamente.</p>
        : url ? <>
          {isPhoto ? <img src={url} alt={attachment.name} className="max-h-96 w-full rounded-lg object-contain" />
            : <video controls playsInline src={url} aria-label={attachment.name} className="max-h-96 w-full rounded-lg bg-[#14181F]" />}
          <a className="justify-self-start rounded text-sm font-semibold text-[#1F3A5F] focus-visible:ring-2 focus-visible:ring-[#1F3A5F]" href={url} download={attachment.name}>Baixar arquivo</a>
        </> : <p role="status" className="text-sm text-[#5B6472]">Carregando anexo...</p>)}
    </li>
  );
}

function ProcedureContent({ popId, source }: { popId: string; source: PopContent }) {
  return (
    <div className="grid gap-4">
      {([
        ['Objetivo', source.objective],
        ['Materiais e EPIs', source.materialsAndEpi],
        ['Ferramentas', source.tools],
        ['Equipamentos de proteção', source.protectiveEquipment],
      ]).map(([title, content]) => content && <section key={title} className="grid gap-1">
        <h3 className="text-sm font-semibold">{title}</h3><p className={plain}>{content}</p>
      </section>)}
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Passo a passo</h3>
        {source.steps?.length ? <ol className="grid list-decimal gap-2 pl-6 text-sm leading-relaxed">
          {source.steps.map((step, index) => <li key={index} className="rounded-lg bg-[#F6F5F2] p-2 break-words">{step}</li>)}
        </ol> : <p className={plain}>Sem passos registrados.</p>}
      </section>
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Critérios de aceite</h3>
        {source.acceptanceCriteria?.length ? <ul className="grid gap-2 text-sm">
          {source.acceptanceCriteria.map((item, index) => <li key={index} className="flex items-start gap-2 rounded-lg border border-[#E4E1DA] p-2">
            <span aria-hidden="true">□</span><span className="break-words">{item}</span>
          </li>)}
        </ul> : <p className={plain}>Sem critérios registrados.</p>}
      </section>
      {!!source.attachments?.length && <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Fotos e vídeos</h3>
        <ul className="grid gap-2">{source.attachments.map((item) => <AttachmentPreview key={item.id} popId={popId} attachment={item} />)}</ul>
      </section>}
    </div>
  );
}

function EditableList({ items, onChange, title, singular, limit }: {
  items: string[]; onChange: (items: string[]) => void; title: string; singular: string; limit: number;
}) {
  return (
    <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      {items.map((item, index) => <div key={index} className="flex items-end gap-2">
        <label className={label + ' flex-1'}>{singular} {index + 1}
          <textarea className={field} rows={2} maxLength={limit} value={item}
            onChange={(event) => onChange(items.map((value, position) => position === index ? event.target.value : value))} />
        </label>
        <button type="button" className={secondary} onClick={() => onChange(items.filter((_, position) => position !== index))}
          aria-label={'Remover ' + singular.toLowerCase() + ' ' + (index + 1)}>Remover</button>
      </div>)}
      <button type="button" className={secondary + ' justify-self-start'} disabled={items.length >= 20}
        onClick={() => onChange([...items, ''])}>Adicionar {singular.toLowerCase()}</button>
    </fieldset>
  );
}

export function PopsView({ uid, data, companyEmail }: { uid: string; data: PilotisDataState; companyEmail?: string | null }) {
  const [activeId, setActiveId] = useState(() => new URLSearchParams(window.location.search).get('pop') ?? '');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('Todos');
  const [editor, setEditor] = useState<Pop | 'new' | null>(null);
  const [draft, setDraft] = useState<PopContent>(emptyContent);
  const [files, setFiles] = useState<NewPopFile[]>([]);
  const [summary, setSummary] = useState('');
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [versionPreview, setVersionPreview] = useState<PopVersion | null>(null);
  const [restoration, setRestoration] = useState<{ pop: Pop; version: PopVersion } | null>(null);
  const [linking, setLinking] = useState<Pop | null>(null);
  const [projectId, setProjectId] = useState('');
  const [stageId, setStageId] = useState('');

  const filtered = data.pops.filter((pop) => {
    const content = !isPublishedPop(pop) ? (pop.draft ?? pop) : pop;
    const term = search.trim().toLocaleLowerCase('pt-BR');
    return (status === 'Todos' || status === pop.status) &&
      [content.title, content.serviceType, content.linkedStagePhase].some((value) => (value ?? '').toLocaleLowerCase('pt-BR').includes(term));
  });
  const active = filtered.find((pop) => pop.id === activeId) ?? filtered[0];
  const published = active && isPublishedPop(active);
  const current = active ? (published ? active : active.draft ?? active) : null;
  const history = (data.popVersions ?? []).filter((version) => version.popId === active?.id).sort((a, b) => b.publicationNumber - a.publicationNumber);
  const linkedStages = data.stages.filter((stage) => stage.popId === active?.id);
  const allowedProjects = data.projects.filter((project) => project.status !== 'Concluída');
  const candidateStages = data.stages.filter((stage) => stage.projectId === projectId && stage.status !== 'Concluída');
  const setDraftValue = <K extends keyof PopContent,>(key: K, value: PopContent[K]) => setDraft((previous) => ({ ...previous, [key]: value }));

  function openEditor(pop?: Pop) {
    setEditor(pop ?? 'new'); setDraft(pop ? readPopContent(pop.draft ?? pop) : emptyContent);
    setFiles([]); setSummary(''); setError(''); setFeedback('');
  }

  async function addAttachments(picks: File[]) {
    if ((draft.attachments?.length ?? 0) + picks.length > POP_ATTACHMENT_LIMIT) {
      setError('Selecione até oito anexos por POP.'); return;
    }
    setPreparing(true); setError('');
    try {
      const prepared = [];
      for (const file of picks) prepared.push(await preparePopAttachment(file));
      const attachments = [...(draft.attachments ?? []), ...prepared.map((file) => file.attachment)];
      if (attachments.reduce((total, item) => total + item.size, 0) > POP_MEDIA_TOTAL_BYTES) {
        throw new Error('Os anexos do POP podem somar até 5 MB.');
      }
      setDraftValue('attachments', attachments); setFiles((previous) => [...previous, ...prepared]);
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível preparar os anexos.'); }
    finally { setPreparing(false); }
  }

  async function save(action: 'draft' | 'publish') {
    if (!editor || saving || preparing) return;
    setSaving(true); setError('');
    const pop = editor === 'new' ? undefined : editor;
    try {
      const id = await savePop({
        action, uid, actor, popId: pop?.id, expectedRevision: pop?.revision, files,
        content: { ...draft, steps: draft.steps.map((item) => item.trim()).filter(Boolean),
          acceptanceCriteria: draft.acceptanceCriteria.map((item) => item.trim()).filter(Boolean) },
        changeSummary: summary,
      });
      setActiveId(id); setStatus('Todos'); setSearch(''); setEditor(null);
      setFeedback(action === 'draft' ? 'Revisão salva.' : 'Versão publicada.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível salvar o POP.'); }
    finally { setSaving(false); }
  }

  async function exportPdf(pop: Pop) {
    setDownloading(true); setError('');
    try { await downloadPopPdf(pop, data.settings); }
    catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível exportar o PDF.'); }
    finally { setDownloading(false); }
  }
  const formError = error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>;
  return (
    <div className="grid gap-5">
      <PageHeader title="POPs" subtitle="Procedimentos operacionais para obras e integração"
        companyEmail={companyEmail} actions={<button type="button" className={primary} onClick={() => openEditor()}>Novo POP</button>} />
      {feedback && <AlertNote tone="ok" title="POPs">{feedback}</AlertNote>}
      {!editor && !restoration && !linking && formError}

      {!data.pops.length ? <EmptySection title="Nenhum POP cadastrado" description="Cadastre um procedimento para usar nas obras e na integração." actionLabel="Criar POP" onAction={() => openEditor()} /> : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <section className={panel}>
            <h2 className="text-base font-semibold">Biblioteca</h2>
            <SegmentedControl items={['Todos', 'Vigente', 'Em revisão']} active={status} onChange={setStatus} />
            <label className={label}>Buscar POP
              <input className={field} type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            {filtered.length ? <ul className="grid gap-2">{filtered.map((pop) => (
              <li key={pop.id}><button type="button" aria-pressed={active?.id === pop.id}
                onClick={() => {
                  setActiveId(pop.id);
                  if (window.matchMedia('(max-width: 767px)').matches) document.getElementById('pop-reading')?.scrollIntoView({ block: 'start' });
                }} className="grid w-full gap-1 rounded-lg border border-[#E4E1DA] p-3 text-left focus-visible:ring-2 focus-visible:ring-[#1F3A5F] aria-pressed:border-[#1F3A5F] aria-pressed:bg-[#E6EEFB]">
                <span className="flex flex-wrap items-center gap-2"><strong className="break-words text-sm">{pop.title}</strong><StatusBadge label={pop.status} /></span>
                <span className="text-xs text-[#5B6472]">{pop.serviceType}{isPublishedPop(pop) && ' · ' + pop.version}</span>
              </button></li>
            ))}</ul> : <p className={plain}>Sem procedimentos neste filtro.</p>}
          </section>
          {active && current && <section id="pop-reading" className={panel + ' scroll-mt-24'}>
            <header className="grid gap-2 border-b border-[#E4E1DA] pb-3">
              <div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-lg font-bold">{current.title}</h2>
                <StatusBadge label={published ? active.version : 'Aguardando publicação'} tone="info" />
              </div>
              <p className="text-xs text-[#5B6472]">
                {current.serviceType}{active.publishedOn && ' · Publicado em ' + formatDateBR(active.publishedOn)}
                {active.approvedBy && ' · Aprovado por ' + active.approvedBy}
              </p>
              {active.changeSummary && <p className={plain}>{active.changeSummary}</p>}
              {active.draft && published && <p className="text-xs text-[#5B6472]">Há uma revisão salva. O conteúdo exibido é o publicado.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={secondary} onClick={() => openEditor(active)}>{active.draft ? 'Editar revisão' : 'Nova revisão'}</button>
                {published && <button type="button" className={primary} onClick={() => void exportPdf(active)} disabled={downloading}>
                  {downloading ? 'Gerando PDF...' : 'Exportar PDF'}
                </button>}
              </div>
            </header>
            <ProcedureContent popId={active.id} source={current} />
            <section className="grid gap-2 border-t border-[#E4E1DA] pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Vínculos</h3>
                {published && <button type="button" className={secondary} onClick={() => {
                  setLinking(active); setProjectId(''); setStageId(''); setError(''); setFeedback('');
                }}>Vincular etapa</button>}
              </div>
              {current.linkedStagePhase && <p className={plain}>Fase sugerida · {current.linkedStagePhase}</p>}
              {current.usedInOnboarding && <p className={plain}>{published ? 'Disponível no treinamento de integração da Equipe.' : 'Vínculo com integração aguardando a publicação.'}</p>}
              {linkedStages.length ? <ul className="grid gap-1 text-sm">
                {linkedStages.map((stage) => <li key={stage.id}>{data.projects.find((item) => item.id === stage.projectId)?.name ?? 'Obra'} · {stage.name}</li>)}
              </ul> : <p className={plain}>Sem etapas vinculadas.</p>}
            </section>
            <section className="grid gap-2 border-t border-[#E4E1DA] pt-3">
              <h3 className="text-sm font-semibold">Histórico de versões</h3>
              {history.length ? <ul className="grid gap-2">{history.map((item) => <li key={item.id} className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
                <div className="flex flex-wrap gap-2 text-sm"><strong>{item.version}</strong>
                  <span>{item.publishedOn ? formatDateBR(item.publishedOn) : 'Data de publicação sem registro'}</span>
                  <span>{item.approvedBy ? 'Aprovação · ' + item.approvedBy : 'Aprovação sem registro'}</span>
                </div>
                {item.changeSummary && <p className={plain}>{item.changeSummary}</p>}
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={secondary} onClick={() => setVersionPreview(item)}>Consultar versão</button>
                  <button type="button" className={secondary} onClick={() => {
                    setRestoration({ pop: active, version: item }); setError(''); setSummary('Restauração da versão ' + item.version);
                  }}>Restaurar como nova versão</button>
                </div>
              </li>)}</ul> : <p className={plain}>Sem versões anteriores.</p>}
            </section>
          </section>}
        </div>
      )}

      <Modal open={Boolean(editor)} onClose={() => { if (!saving && !preparing) setEditor(null); }}
        title={editor === 'new' ? 'Novo POP' : 'Editar revisão'} maxWidth="max-w-2xl">
        <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); void save('publish'); }}>
          <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
            <legend className="px-1 text-sm font-semibold">Identificação</legend>
            <label className={label}>Título
              <input className={field} required maxLength={160} value={draft.title} onChange={(event) => setDraftValue('title', event.target.value)} />
            </label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={label}>Tipo de serviço
                <input className={field} required maxLength={80} value={draft.serviceType} onChange={(event) => setDraftValue('serviceType', event.target.value)} />
              </label>
              <label className={label}>Fase sugerida no planejamento
                <input className={field} maxLength={80} value={draft.linkedStagePhase} onChange={(event) => setDraftValue('linkedStagePhase', event.target.value)} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.usedInOnboarding} onChange={(event) => setDraftValue('usedInOnboarding', event.target.checked)} />
              Incluir no treinamento de integração
            </label>
          </fieldset>
          {([
            ['objective', 'Objetivo'], ['materialsAndEpi', 'Materiais'], ['tools', 'Ferramentas'],
            ['protectiveEquipment', 'Equipamentos de proteção'],
          ] as const).map(([key, title]) => <label className={label} key={key}>{title}
            <textarea className={field} rows={2} maxLength={1000} value={draft[key] ?? ''} onChange={(event) => setDraftValue(key, event.target.value)} />
          </label>)}
          <EditableList title="Passo a passo" singular="Passo" limit={300} items={draft.steps} onChange={(items) => setDraftValue('steps', items)} />
          <EditableList title="Checklist de critérios de aceite" singular="Critério" limit={200} items={draft.acceptanceCriteria} onChange={(items) => setDraftValue('acceptanceCriteria', items)} />
          <fieldset className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
            <legend className="px-1 text-sm font-semibold">Fotos e vídeos</legend>
            <label className={label}>Anexar arquivos
              <input className={field} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple disabled={preparing || saving}
                onChange={(event) => { const picked = Array.from(event.currentTarget.files ?? []); event.currentTarget.value = ''; if (picked.length) void addAttachments(picked); }} />
            </label>
            <p className="text-xs text-[#5B6472]">Até oito arquivos e 5 MB no total. Vídeos em MP4, WebM ou MOV.</p>
            {preparing && <p role="status" className={plain}>Preparando arquivos...</p>}
            {draft.attachments?.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="break-words">{item.name}</span>
              <button type="button" className={secondary} disabled={saving || preparing} onClick={() => {
                setDraftValue('attachments', draft.attachments?.filter((asset) => asset.id !== item.id) ?? []);
                setFiles((saved) => saved.filter((file) => file.attachment.id !== item.id));
              }}>Remover</button>
            </div>)}
          </fieldset>
          <label className={label}>O que mudou nesta publicação
            <textarea className={field} rows={2} maxLength={500} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <RegisteredBySelect id="pop-actor" value={actor} onChange={setActor} />
          <p className="text-xs text-[#5B6472]">Ao publicar, a pessoa registrada fica como aprovadora da versão.</p>
          {formError}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" className={secondary} disabled={saving || preparing} onClick={() => void save('draft')}>Salvar revisão</button>
            <button type="submit" className={primary} disabled={saving || preparing}>
              {saving ? 'Salvando...' : 'Publicar ' + nextPopVersion(editor && editor !== 'new' ? editor : undefined)}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={Boolean(versionPreview)} onClose={() => setVersionPreview(null)} title={versionPreview?.version ?? 'Versão anterior'} maxWidth="max-w-2xl">
        {versionPreview && <div className="grid gap-3"><h2 className="text-lg font-bold">{versionPreview.title}</h2>
          <ProcedureContent popId={versionPreview.popId} source={versionPreview} />
        </div>}
      </Modal>

      <Modal open={Boolean(restoration)} onClose={() => { if (!saving) setRestoration(null); }} title="Restaurar versão">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault(); if (!restoration) return;
          setSaving(true); setError('');
          try {
            await savePop({ action: 'restore', uid, actor, popId: restoration.pop.id, expectedRevision: restoration.pop.revision,
              versionId: restoration.version.id, changeSummary: summary });
            setRestoration(null); setStatus('Todos'); setFeedback('A versão anterior foi restaurada como uma nova publicação.');
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível restaurar a versão.'); }
          finally { setSaving(false); }
        }}>
          {restoration && <p className={plain}>O conteúdo da {restoration.version.version} será publicado como {nextPopVersion(restoration.pop)}.</p>}
          <label className={label}>Registro da mudança
            <textarea required rows={2} maxLength={500} className={field} value={summary} onChange={(event) => setSummary(event.target.value)} />
          </label>
          <RegisteredBySelect id="pop-restore-actor" value={actor} onChange={setActor} />
          {formError}
          <button className={primary + ' justify-self-end'} type="submit" disabled={saving}>{saving ? 'Restaurando...' : 'Publicar restauração'}</button>
        </form>
      </Modal>

      <Modal open={Boolean(linking)} onClose={() => { if (!saving) setLinking(null); }} title="Vincular etapa da obra">
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault(); if (!linking) return;
          const project = allowedProjects.find((item) => item.id === projectId);
          const stage = candidateStages.find((item) => item.id === stageId);
          if (!project || !stage) return;
          setSaving(true); setError('');
          try {
            const { id, ownerUid, createdBy, updatedBy, createdAt, updatedAt, ...fields } = stage;
            await saveProjectStage({
              uid, actor, project, knownStages: data.stages.filter((item) => item.projectId === projectId),
              stageId: id, payload: { ...fields, popId: linking.id,
                checklistCompleted: stage.popId === linking.id ? stage.checklistCompleted : [] },
            });
            setLinking(null); setFeedback('POP vinculado à etapa.');
          } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível vincular a etapa.'); }
          finally { setSaving(false); }
        }}>
          <label className={label}>Obra
            <select className={field} required value={projectId} onChange={(event) => { setProjectId(event.target.value); setStageId(''); }}>
              <option value="">Selecione a obra</option>{allowedProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label className={label}>Etapa
            <select className={field} required value={stageId} onChange={(event) => setStageId(event.target.value)}>
              <option value="">Selecione a etapa</option>{candidateStages.map((stage) => <option key={stage.id} value={stage.id}>{stage.wbsCode} · {stage.name}</option>)}
            </select>
          </label>
          <RegisteredBySelect id="pop-link-actor" value={actor} onChange={setActor} />
          {formError}
          <button type="submit" className={primary + ' justify-self-end'} disabled={saving || !stageId}>Vincular POP</button>
        </form>
      </Modal>
    </div>
  );
}
