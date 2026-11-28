import { isValidISODate } from './formatters';

export const LIST_FILTER_KEYS = ['q', 'status', 'obra', 'de', 'ate', 'ordem', 'sentido'] as const;
export type ListFilterKey = typeof LIST_FILTER_KEYS[number];
export type ListFilters = Record<ListFilterKey, string>;
export type SortDirection = 'asc' | 'desc';

export interface ListColumn<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | undefined | null;
}

export interface ListSchema<T> {
  text: (row: T) => Array<string | number | null | undefined>;
  status: (row: T) => string;
  projects?: (row: T) => string | readonly string[] | undefined;
  dates: (row: T, projectId?: string) => string | readonly string[] | undefined;
  interval?: (row: T) => readonly [string, string] | undefined;
  columns: ListColumn<T>[];
}

export function normalizeSearch(value: string) {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').trim();
}

export function searchTerms(value: string) {
  const normalized = normalizeSearch(value);
  return normalized ? normalized.split(/\s+/) : [];
}

const recordDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function recordDay(value: unknown): string {
  if (typeof value === 'string') {
    const key = value.slice(0, 10);
    return isValidISODate(key) ? key : '';
  }
  const date = typeof value === 'object' && value && 'toDate' in value && typeof value.toDate === 'function'
    ? value.toDate() : value;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const parts = Object.fromEntries(recordDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true });
function asList(value: string | readonly string[] | undefined): readonly string[] {
  return typeof value === 'string' ? [value] : value ?? [];
}

export function applyListFilters<T>(source: readonly T[], filters: ListFilters, schema: ListSchema<T>): T[] {
  const terms = searchTerms(filters.q);
  const from = isValidISODate(filters.de) ? filters.de : '';
  const to = isValidISODate(filters.ate) ? filters.ate : '';
  const results = source.filter((row) => {
    if (filters.status && schema.status(row) !== filters.status) return false;
    if (filters.obra && !asList(schema.projects?.(row)).includes(filters.obra)) return false;
    if (from || to) {
      const interval = schema.interval?.(row);
      const overlaps = interval && interval.every(isValidISODate) &&
        (!from || interval[1] >= from) && (!to || interval[0] <= to);
      if (!overlaps && !asList(schema.dates(row, filters.obra)).some((date) =>
        isValidISODate(date) && (!from || date >= from) && (!to || date <= to))) return false;
    }
    if (!terms.length) return true;
    const text = normalizeSearch(schema.text(row).join(' '));
    return terms.every((term) => text.includes(term));
  });
  const column = schema.columns.find((item) => item.key === filters.ordem);
  if (column) results.sort((a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    if (left === right) return 0;
    if (left == null || left === '') return 1;
    if (right == null || right === '') return -1;
    const comparison = typeof left === 'number' && typeof right === 'number'
      ? left - right : collator.compare(String(left), String(right));
    return filters.sentido === 'desc' ? -comparison : comparison;
  });
  return results;
}
