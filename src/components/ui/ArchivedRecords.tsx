import { useId, useState } from 'react';
import { DELETE_CONFIRMATION, isArchived, type ArchivableCollection } from '../../domain/recordLifecycle';
import { recordDay } from '../../domain/listQuery';
import { formatDateBR } from '../../domain/formatters';
import { deleteArchivedRecord, setRecordArchived } from '../../services/archiveService';
import type { ActorRole, PilotisDataState } from '../../types/pilotis';
import { DataList } from './DataList';
import { Button, Modal, PageHeader, RegisteredBySelect } from './PilotisUI';
import { ListToolbar, useListFilters } from './ListFilters';
import { useToast } from './Toast';

const labels: Record<ArchivableCollection, string> = {
  clients: 'Cliente', quotes: 'Orçamento', projects: 'Obra', employees: 'Colaborador',
};

interface RecordChoice {
  entity: ArchivableCollection;
  id: string;
  title: string;
}

export function RecordLifecycleButton({ uid, record, action = 'archive', onSaved }: {
  uid: string; record: RecordChoice; action?: 'archive' | 'restore' | 'delete'; onSaved?: () => void;
}) {
  const { showToast } = useToast();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [actor, setActor] = useState<ActorRole>('Sócio');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const deleting = action === 'delete';
  const label = deleting ? 'Excluir definitivamente' : action === 'restore' ? 'Restaurar' : 'Arquivar';
  const completed = deleting ? 'Registro excluído.' : action === 'restore' ? 'Registro restaurado.' : 'Registro arquivado.';

  return <>
    <Button type="button" size="sm" variant="secondary" onClick={(event) => {
      event.stopPropagation();
      setError(''); setConfirmation(''); setActor('Sócio'); setOpen(true);
    }}>{label}</Button>
    <Modal open={open} onClose={() => setOpen(false)} title={label + ' · ' + record.title}>
      <form className="grid gap-3" onSubmit={async (event) => {
        event.preventDefault();
        if (saving) return;
        setSaving(true); setError('');
        try {
          if (deleting) await deleteArchivedRecord(actor, record.entity, record.id, confirmation);
          else await setRecordArchived(uid, actor, record.entity, record.id, action === 'archive');
          setOpen(false);
          onSaved?.();
          showToast({ tone: 'success', title: completed });
        } catch (error) {
          setError(error instanceof Error ? error.message : 'Não foi possível alterar este registro.');
        } finally {
          setSaving(false);
        }
      }}>
        {deleting ? <>
          <p className="text-sm">A exclusão é permanente e só está disponível para registros sem vínculos.</p>
          <label className="grid gap-1 text-sm font-semibold">Digite {DELETE_CONFIRMATION} para confirmar
            <input className="rounded-lg border border-[#E4E1DA] px-3 py-2" value={confirmation} required
              autoComplete="off" onChange={(event) => setConfirmation(event.target.value)} />
          </label>
        </> : action === 'archive' && <p className="text-sm">O registro poderá ser restaurado na lista de arquivados.</p>}
        <RegisteredBySelect id={id} value={actor} onChange={setActor} />
        {error && <p role="alert" className="text-sm text-[#B42318]">{error}</p>}
        <Button type="submit" variant="primary" disabled={saving || (deleting && confirmation !== DELETE_CONFIRMATION)}>
          {saving ? 'Salvando…' : label}
        </Button>
      </form>
    </Modal>
  </>;
}

export function ArchivedRecords({ uid, data, entities, scope }: {
  uid: string; data: PilotisDataState; entities: readonly ArchivableCollection[]; scope: string;
}) {
  const records = entities.flatMap((entity) => data[entity].filter(isArchived).map((row) => ({
    entity, id: row.id, title: 'title' in row ? row.title : row.name,
    day: recordDay(row.archive?.at), actor: row.archive?.by ?? '',
  })));
  const list = useListFilters(scope + '.arquivo', records, {
    text: (row) => [row.title, labels[row.entity], row.id],
    dates: (row) => row.day, status: (row) => labels[row.entity],
    columns: [
      { key: 'name', label: 'Registro', value: (row) => row.title },
      { key: 'entity', label: 'Tipo', value: (row) => labels[row.entity] },
      { key: 'day', label: 'Data de arquivamento', value: (row) => row.day },
    ],
  });
  return <section className="grid gap-4">
    <PageHeader title="Arquivados" subtitle="Registros disponíveis para restaurar ou excluir" />
    <ListToolbar label="registros arquivados" list={list} />
    <DataList rows={list.rows} sort={list.sort} keyExtractor={(row) => row.entity + '/' + row.id}
      emptyTitle="Nenhum registro arquivado"
      columns={[
        { key: 'name', header: 'Registro', render: (row) => <strong>{row.title}</strong> },
        { key: 'entity', header: 'Tipo', render: (row) => labels[row.entity] },
        { key: 'day', header: 'Data de arquivamento', render: (row) => formatDateBR(row.day) },
        { key: 'actor', header: 'Registrado por', render: (row) => row.actor },
        { key: 'actions', header: 'Ações', render: (row) => <div className="flex flex-wrap gap-2">
          <RecordLifecycleButton uid={uid} record={row} action="restore" />
          <RecordLifecycleButton uid={uid} record={row} action="delete" />
        </div> },
      ]} />
  </section>;
}
