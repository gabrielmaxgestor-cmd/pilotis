import { useEffect, useState } from 'react';
import { Button, Modal, RegisteredBySelect, StatusBadge } from './PilotisUI';
import { getComplianceAttachment, listComplianceVersions, removeComplianceAttachment, type ComplianceVersionPage } from '../../services/complianceAttachmentService';
import type { ComplianceVersion } from '../../domain/complianceAttachments';
import type { ActorRole, ComplianceItem } from '../../types/pilotis';

const date = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const empty: ComplianceVersionPage = { activeId: '', versions: [], next: null };

export function ComplianceAttachmentsDialog({ item, onClose, onEdit }: {
  item: ComplianceItem; onClose: () => void; onEdit?: () => void;
}) {
  const [page, setPage] = useState(empty);
  const [preview, setPreview] = useState<{ id: string; name: string; type: string; url: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<ComplianceVersion | null>(null);
  const [actor, setActor] = useState<ActorRole>('Responsável administrativo');
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void listComplianceVersions(item.id).then((data) => {
      if (active) setPage(data);
    }).catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [item.id, refresh]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  async function open(version: ComplianceVersion) {
    if (busy) return;
    if (preview?.id === version.id) { setPreview(null); return; }
    setBusy(true); setError('');
    try {
      const { blob, name } = await getComplianceAttachment(item.id, version.id);
      const url = URL.createObjectURL(blob);
      if (blob.type !== 'application/pdf' && !blob.type.startsWith('image/')) {
        const element = document.createElement('a');
        element.href = url; element.download = name;
        document.body.append(element); element.click(); element.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      } else setPreview({ id: version.id, name, type: blob.type, url });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível abrir o arquivo.'); }
    finally { setBusy(false); }
  }

  const versions = [...page.versions].sort((a, b) =>
    Number(b.id === page.activeId) - Number(a.id === page.activeId) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));

  return <Modal open title={'Anexos · ' + item.title} onClose={() => { if (!busy) onClose(); }} maxWidth="max-w-3xl">
    <section className="grid gap-3 text-sm" aria-label="Versões do arquivo">
      {onEdit && <Button size="sm" variant="secondary" onClick={onEdit} disabled={busy} className="justify-self-start">
        {page.activeId || item.attachmentId ? 'Substituir anexo' : 'Anexar arquivo'}
      </Button>}
      {error && <p role="alert" className="text-[#B42318]">{error}</p>}
      {loading ? <p role="status">Carregando anexos…</p> : !versions.length ? <p>Sem versões de arquivo.</p> :
        <ul className="grid gap-2">
          {versions.map((version) => <li key={version.id} className="grid gap-2 rounded-lg border border-[#E4E1DA] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <strong className="break-all">{version.name}</strong>
              <StatusBadge label={version.removedAt ? 'Removido' : version.id === page.activeId ? 'Atual' : 'Versão anterior'} />
            </div>
            {version.createdAt && <p className="text-xs text-[#424D5D]">Anexado em {date.format(new Date(version.createdAt))}</p>}
            {version.removedAt && <p className="text-xs text-[#424D5D]">Removido em {date.format(new Date(version.removedAt))}</p>}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void open(version)}>
                {version.mimeType.endsWith('.document') ? 'Baixar DOCX' : preview?.id === version.id ? 'Fechar prévia' : 'Pré-visualizar'}
              </Button>
              {version.id === page.activeId && !version.removedAt && <Button size="sm" variant="secondary" disabled={busy} onClick={() => {
                setError(''); setConfirmation(version);
              }}>Remover anexo</Button>}
            </div>
            {confirmation?.id === version.id && <form className="grid gap-2 rounded-lg bg-[#F6F5F2] p-3" onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true); setError('');
              try {
                await removeComplianceAttachment(item.id, version.id, actor);
                setConfirmation(null); setPreview(null); setRefresh((old) => old + 1);
              } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível remover o anexo.'); }
              finally { setBusy(false); }
            }}>
              <p>O arquivo sairá do documento atual e ficará no histórico.</p>
              <RegisteredBySelect id="compliance-delete-file-actor" value={actor} onChange={setActor} />
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={busy}>Confirmar remoção</Button>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>Cancelar</Button>
              </div>
            </form>}
            {preview?.id === version.id && <div className="grid gap-2">
              {preview.type === 'application/pdf'
                ? <iframe title={'Prévia de ' + preview.name} className="h-[55vh] w-full rounded-lg border border-[#E4E1DA]" src={preview.url} />
                : <img src={preview.url} alt={'Prévia de ' + preview.name} className="max-h-[55vh] max-w-full rounded-lg object-contain" />}
              <a href={preview.url} download={preview.name} className="justify-self-start font-semibold text-[#1F3A5F] underline">Baixar arquivo</a>
            </div>}
          </li>)}
        </ul>}
      {page.next && <Button size="sm" variant="secondary" disabled={busy} className="justify-self-start" onClick={async () => {
        if (!page.next || busy) return;
        setBusy(true); setError('');
        try {
          const next = await listComplianceVersions(item.id, page.next);
          const versions = new Map([...page.versions, ...next.versions].map((version) => [version.id, version]));
          setPage({ ...next, versions: [...versions.values()] });
        } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o histórico.'); }
        finally { setBusy(false); }
      }}>Carregar mais versões</Button>}
    </section>
  </Modal>;
}
