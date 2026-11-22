import type { ReactNode } from 'react';
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
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            {caption && <caption className="sr-only">{caption}</caption>}
            <thead>
              <tr className="bg-[#F0EEE9] border-b border-[#E4E1DA]">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={`px-4 py-3 text-xs font-semibold text-[#5B6472] whitespace-nowrap ${
                      col.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E4E1DA]">
              {rows.map((row, idx) => {
                const interactive = Boolean(onRowClick);
                return (
                  <tr
                    key={keyExtractor(row, idx)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onRowClick(row);
                            }
                          }
                        : undefined
                    }
                    className={`transition-colors ${
                      interactive
                        ? 'cursor-pointer hover:bg-[#F6F5F2] focus-visible:bg-[#F6F5F2]'
                        : 'hover:bg-[#F6F5F2]/60'
                    }`}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`px-4 py-3 text-[13px] text-[#14181F] align-middle ${
                          col.align === 'right' ? 'text-right' : 'text-left'
                        } ${col.numeric ? 'tabular-nums font-medium' : ''}`}
                      >
                        {col.render(row)}
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
          const interactive = Boolean(onRowClick);

          return (
            <div
              key={key}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              onKeyDown={
                onRowClick
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onRowClick(row);
                      }
                    }
                  : undefined
              }
              className={`bg-white border border-[#E4E1DA] rounded-[12px] p-4 flex flex-col gap-2.5 ${
                interactive ? 'cursor-pointer active:bg-[#F0EEE9]' : ''
              }`}
            >
              {primaryCol && (
                <div className="text-sm font-semibold text-[#14181F]">
                  {primaryCol.render(row)}
                </div>
              )}
              <div className="flex flex-col gap-1.5 pt-1 border-t border-[#F0EEE9]">
                {restCols.map((col) => (
                  <div
                    key={col.key}
                    className="flex items-center justify-between gap-3 text-xs"
                  >
                    <span className="text-[#5B6472]">{col.header}</span>
                    <span
                      className={`text-[#14181F] font-medium text-right ${
                        col.numeric ? 'tabular-nums' : ''
                      }`}
                    >
                      {col.render(row)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
