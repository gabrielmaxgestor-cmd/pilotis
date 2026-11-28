import type { ReactNode } from 'react';
import { SortHeading, type ColumnSort } from './ListFilters';
import { EmptyState } from './PilotisUI';

export interface DataListColumn<T> {
  key: string;
  header: string;
  align?: 'left' | 'right';
  numeric?: boolean;
  hideOnMobileCard?: boolean;
  render: (row: T) => ReactNode;
}

export interface DataListProps<T> {
  columns: Array<DataListColumn<T>>;
  rows: T[];
  keyExtractor: (row: T, index: number) => string;
  renderMobileCard?: (row: T) => ReactNode;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyActionLabel?: string;
  onEmptyAction?: () => void;
  caption?: string;
  keyboardScroll?: boolean;
  sort?: ColumnSort;
}

export function DataList<T>({
  columns,
  rows,
  keyExtractor,
  renderMobileCard,
  onRowClick,
  emptyTitle = 'Sem registros',
  emptyDescription = 'Nenhum registro cadastrado até o momento.',
  emptyActionLabel,
  onEmptyAction,
  caption,
  keyboardScroll = false,
  sort,
}: DataListProps<T>) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        description={emptyDescription}
        actionLabel={emptyActionLabel}
        onAction={onEmptyAction}
      />
    );
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden md:block bg-white border border-[#E4E1DA] rounded-[12px] overflow-hidden">
        <div className="overflow-x-auto focus-visible:outline-offset-[-2px]" tabIndex={keyboardScroll ? 0 : undefined}
          role={keyboardScroll && caption ? 'region' : undefined} aria-label={keyboardScroll ? caption : undefined}>
          <table className="w-full border-collapse text-left">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="bg-[#F0EEE9] border-b border-[#E4E1DA]">
                {columns.map((col) => (
                  <SortHeading
                    key={col.key}
                    column={col.key} label={col.header} sort={sort}
                    className={`px-4 py-3 text-xs font-semibold text-[#5B6472] whitespace-nowrap ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E1DA]">
              {rows.map((row, idx) => {
                const interactive = Boolean(onRowClick);
                return (
                  <tr
                    key={keyExtractor(row, idx)}
                    onClick={onRowClick ? (event) => {
                      if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"]')) return;
                      onRowClick(row);
                    } : undefined}
                    className={`transition-colors ${
                      interactive
                        ? 'pilotis-data-row cursor-pointer hover:bg-[#F6F5F2]'
                        : 'hover:bg-[#F6F5F2]/60'
                    }`}
                  >
                    {columns.map((col, columnIndex) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-[13px] text-[#14181F] align-middle ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        } ${col.numeric ? 'tabular-nums font-medium' : ''}`}
                      >
                        {col.render(row)}
                        {columnIndex === 0 && onRowClick && <button type="button" className="mt-1 block text-xs font-semibold text-[#1F3A5F] underline" onClick={() => onRowClick(row)}>Abrir detalhes</button>}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile card list */}
      <div className="md:hidden flex flex-col gap-2.5">
        {rows.map((row, idx) => {
          const key = keyExtractor(row, idx);
          if (renderMobileCard) {
            return <div key={key}>{renderMobileCard(row)}</div>;
          }

          const [primaryCol, ...restCols] = columns.filter((c) => !c.hideOnMobileCard);
          return (
            <article key={key} className="min-w-0 rounded-[12px] border border-[#E4E1DA] bg-white p-4 flex flex-col gap-2.5">
              {primaryCol && (
                <div className="text-sm font-semibold text-[#14181F]">
                  {primaryCol.render(row)}
                </div>
              )}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-[#F0EEE9]">
                {restCols.map((col) => (
                  <div
                    key={col.key}
                    className="flex flex-wrap items-start justify-between gap-2 text-xs"
                  >
                    <span className="text-[#5B6472]">{col.header}</span>
                    <span
                      className={`min-w-0 break-words text-[#14181F] font-medium text-right ${
                        col.numeric ? 'tabular-nums' : ''
                      }`}
                    >
                      {col.render(row)}
                    </span>
                  </div>
                ))}
              </div>
              {onRowClick && <button type="button" className="self-start py-1 text-xs font-semibold text-[#1F3A5F] underline" onClick={() => onRowClick(row)}>Abrir detalhes</button>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
