import { ArrowDown, ArrowUp, ArrowUpDown, Search, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import { applyListFilters, LIST_FILTER_KEYS, type ListColumn, type ListFilters, type ListSchema, type SortDirection } from '../../domain/listQuery';
import { updateViewUrl, useViewSearch } from '../../hooks/useViewUrl';
import { Modal } from './PilotisUI';

const field = 'min-w-0 w-full rounded-lg border border-[#E4E1DA] bg-white px-2.5 py-2 text-sm text-[#14181F]';
const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[#E4E1DA] bg-white px-3 text-sm font-semibold text-[#1F3A5F]';

export interface ColumnSort {
  available: readonly string[];
  column: string;
  direction: SortDirection;
  change: (column: string) => void;
}

export function useListFilters<T>(scope: string, source: readonly T[], schema: ListSchema<T>) {
  const params = useViewSearch();
  const filters = Object.fromEntries(LIST_FILTER_KEYS.map((key) =>
    [key, params.get(scope + '.' + key) ?? ''])) as ListFilters;
  const change = (values: Partial<ListFilters>) => updateViewUrl(Object.fromEntries(
    Object.entries(values).map(([key, value]) => [scope + '.' + key, value]),
  ));
  const sort: ColumnSort = {
    available: schema.columns.map(({ key }) => key), column: filters.ordem,
    direction: filters.sentido === 'desc' ? 'desc' : 'asc',
    change: (ordem) => change({ ordem, sentido: filters.ordem === ordem && filters.sentido !== 'desc' ? 'desc' : 'asc' }),
  };
  const statuses = [...new Set(source.map(schema.status).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  return {
    filters, change, sort, statuses, columns: schema.columns, rows: applyListFilters(source, filters, schema),
    reset: () => updateViewUrl(Object.fromEntries(LIST_FILTER_KEYS.map((key) => [scope + '.' + key, undefined]))),
  };
}

type ListController = Pick<ReturnType<typeof useListFilters>, 'filters' | 'change' | 'statuses' | 'reset'> & {
  columns: readonly Pick<ListColumn<never>, 'key' | 'label'>[];
};
type ProjectOption = { id: string; name: string };

export function ListToolbar({ label, list, projects, projectSelection, phase, month }: {
  label: string;
  list: ListController;
  projects?: readonly ProjectOption[];
  projectSelection?: { value: string; change: (id: string) => void };
  phase?: { options: readonly string[]; value: string; change: (phase: string) => void };
  month?: { label: string; value: string; change: (month: string) => void };
}) {
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const { filters, change, statuses, columns, reset } = list;
  const count = [filters.status, filters.obra, filters.de || filters.ate, filters.ordem, phase?.value, month?.value].filter(Boolean).length;
  const allStatuses = statuses.includes(filters.status) || !filters.status ? statuses : [...statuses, filters.status];

  function fields() {
    return <div className="grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fit,minmax(110px,1fr))]">
      <label className="block min-w-0 text-xs font-semibold">Situação
        <select className={field} value={filters.status} onChange={(event) => change({ status: event.target.value })}>
          <option value="">Todas</option>
          {allStatuses.map((status) => <option key={status}>{status}</option>)}
        </select>
      </label>
      {projects && <label className="block min-w-0 text-xs font-semibold">Obra
        <select className={field} value={projectSelection?.value ?? filters.obra}
          onChange={(event) => projectSelection ? projectSelection.change(event.target.value) : change({ obra: event.target.value })}>
          {!projectSelection && <option value="">Todas as obras</option>}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>}
      {phase && <label className="block min-w-0 text-xs font-semibold">Fase
        <select className={field} value={phase.value} onChange={(event) => phase.change(event.target.value)}>
          <option value="">Todas as fases</option>
          {phase.options.map((name) => <option key={name}>{name}</option>)}
        </select>
      </label>}
      {month && <label className="block min-w-0 text-xs font-semibold">{month.label}
        <input type="month" className={field} value={month.value} onChange={(event) => month.change(event.target.value)} />
      </label>}
      <label className="block min-w-0 text-xs font-semibold">De
        <input type="date" className={field} value={filters.de} onChange={(event) => change({ de: event.target.value })} />
      </label>
      <label className="block min-w-0 text-xs font-semibold">Até
        <input type="date" className={field} value={filters.ate} onChange={(event) => change({ ate: event.target.value })} />
      </label>
      <label className="block min-w-0 text-xs font-semibold">Ordenar por
        <select className={field} value={filters.ordem} onChange={(event) => change({ ordem: event.target.value, sentido: 'asc' })}>
          <option value="">Ordem original</option>
          {columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}
        </select>
      </label>
      {filters.ordem && <label className="block min-w-0 text-xs font-semibold">Direção
        <select className={field} value={filters.sentido || 'asc'} onChange={(event) => change({ sentido: event.target.value })}>
          <option value="asc">Crescente</option><option value="desc">Decrescente</option>
        </select>
      </label>}
      <button type="button" className={button} onClick={() => { reset(); phase?.change(''); month?.change(''); }}>Limpar filtros</button>
    </div>;
  }

  return <div role="group" aria-label={'Filtros de ' + label} className="grid min-w-0 gap-2">
    <div className="flex min-w-0 items-center gap-2">
      <label htmlFor={inputId} className="sr-only">{'Buscar ' + label}</label>
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6472]" />
        <input id={inputId} type="search" className={field + ' pl-9'} placeholder={'Buscar ' + label}
          value={filters.q} onChange={(event) => change({ q: event.target.value })} />
      </div>
      <button type="button" className={button + ' shrink-0 md:hidden'} onClick={() => setOpen(true)}>
        <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />Filtros{count ? ' (' + count + ')' : ''}
      </button>
    </div>
    <div className="hidden md:block">{fields()}</div>
    <Modal open={open} onClose={() => setOpen(false)} title={'Filtros · ' + label}
      footer={<button type="button" className={button} onClick={() => setOpen(false)}>Ver resultados</button>}>
      {fields()}
    </Modal>
  </div>;
}

export function SortHeading({ column, label, sort, className }: {
  column: string; label: string; sort?: ColumnSort; className?: string;
}) {
  const active = sort?.column === column;
  const direction = sort?.direction === 'desc' ? 'descending' : 'ascending';
  const Icon = active ? sort?.direction === 'desc' ? ArrowDown : ArrowUp : ArrowUpDown;
  return <th scope="col" className={className} aria-sort={active ? direction : undefined}>
    {sort?.available.includes(column) ? <button type="button" className="inline-flex items-center gap-1 whitespace-nowrap"
      onClick={() => sort.change(column)}>{label}<Icon className="h-3.5 w-3.5" aria-hidden="true" /></button> : label}
  </th>;
}
