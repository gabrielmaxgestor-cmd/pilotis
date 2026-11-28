import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { buildSearchIndex, findSearchGroups, SEARCH_MODULES, type SearchResult } from '../../domain/globalSearch';
import type { PilotisDataState } from '../../types/pilotis';
import { Modal } from './PilotisUI';

export function SearchButton({ onClick, mobile = false }: { onClick: () => void; mobile?: boolean }) {
  return <button type="button" onClick={onClick} aria-label="Buscar no sistema" aria-keyshortcuts="Control+K Meta+K"
    className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-sm font-semibold text-[#1F3A5F] hover:bg-[#E6EEFB]">
    <Search aria-hidden="true" className="h-5 w-5" />
    {!mobile && <><span>Buscar</span><kbd className="rounded border border-[#E4E1DA] px-1 text-xs font-normal">Ctrl / ⌘ K</kbd></>}
  </button>;
}

export function useGlobalSearchShortcut(open: boolean, show: () => void) {
  useEffect(() => {
    function handle(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'k') return;
      if (open || document.querySelector('dialog[open]')) return;
      event.preventDefault();
      show();
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, show]);
}

export function GlobalSearch({ data, onClose, onSelect }: {
  data: PilotisDataState; onClose: () => void; onSelect: (result: SearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { clients, quotes, projects, transactions, employees, pops, complianceItems } = data;
  const index = useMemo(() => buildSearchIndex({ clients, quotes, projects, transactions, employees, pops, complianceItems }),
    [clients, quotes, projects, transactions, employees, pops, complianceItems]);
  const groups = findSearchGroups(index, query);
  const first = groups.values().next().value?.[0];

  return <Modal open title="Busca global" onClose={onClose} initialFocusRef={input} maxWidth="max-w-2xl">
    <form role="search" onSubmit={(event) => { event.preventDefault(); if (first) onSelect(first); }} className="grid gap-3">
      <label className="grid gap-1 text-sm font-semibold">Buscar por nome ou número
        <input ref={input} type="search" value={query} onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-lg border border-[#E4E1DA] p-2.5 text-base" />
      </label>
      <p role="status" className="text-sm text-[#5B6472]">{query.trim().length < 2 ? 'Digite pelo menos dois caracteres.'
        : groups.size === 0 ? 'Nenhum registro encontrado.' : [...groups.values()].reduce((sum, rows) => sum + rows.length, 0) + ' resultado(s)'}</p>
      {[...groups].map(([module, results]) => <section key={module} className="grid gap-1">
        <h3 className="text-xs font-semibold text-[#5B6472]">{SEARCH_MODULES[module]}</h3>
        <ul>{results.map((row) => <li key={row.key}>
          <button type="button" onClick={() => onSelect(row)} className="grid w-full gap-0.5 rounded-lg p-2 text-left hover:bg-[#E6EEFB]">
            <span className="break-words text-sm font-semibold text-[#1F3A5F]">{row.label}</span>
            <span className="break-words text-xs text-[#5B6472]">{row.detail}</span>
          </button>
        </li>)}</ul>
      </section>)}
    </form>
  </Modal>;
}
