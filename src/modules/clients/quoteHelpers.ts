import { formatBRL, formatDateBR } from '../../utils/formatters';
import type { ActorRole } from '../../types/pilotis';

export interface ParsedQuoteVersion {
  version: string;
  dateISO: string;
  totalValue: number;
  totalCost: number;
  marginPct: number;
  registeredBy: string;
  note: string;
  raw: string;
}

export interface ParsedContractAddendum {
  label: string;
  dateISO: string;
  amountDelta: number;
  registeredBy: string;
  description: string;
  raw: string;
}

export function incrementQuoteVersion(current?: string): string {
  const clean = (current || 'v1.0').trim();
  const match = /^v?(\d+)\.(\d+)$/i.exec(clean);
  if (!match) return 'v1.1';
  const major = Number(match[1]);
  const minor = Number(match[2]) + 1;
  return `v${major}.${minor}`;
}

function sanitizePipeText(value: string): string {
  return value.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

export function serializeVersionEntry(params: {
  version: string;
  dateISO: string;
  totalValue: number;
  totalCost: number;
  marginPct: number;
  registeredBy: ActorRole;
  note: string;
}): string {
  const safeNote = sanitizePipeText(params.note || 'Versão registrada').slice(0, 140);
  return [
    sanitizePipeText(params.version),
    params.dateISO,
    params.totalValue.toFixed(2),
    params.totalCost.toFixed(2),
    params.marginPct.toFixed(1),
    params.registeredBy,
    safeNote,
  ].join('|');
}

export function parseVersionHistory(entries?: string[]): ParsedQuoteVersion[] {
  if (!entries || entries.length === 0) return [];
  return entries.map((raw) => {
    const parts = raw.split('|');
    if (parts.length >= 7) {
      return {
        version: parts[0] || 'v1.0',
        dateISO: parts[1] || '',
        totalValue: Number(parts[2]) || 0,
        totalCost: Number(parts[3]) || 0,
        marginPct: Number(parts[4]) || 0,
        registeredBy: parts[5] || 'Sócio',
        note: parts.slice(6).join(' · '),
        raw,
      };
    }
    return {
      version: 'v1.0',
      dateISO: '',
      totalValue: 0,
      totalCost: 0,
      marginPct: 0,
      registeredBy: 'Sócio',
      note: raw,
      raw,
    };
  });
}

export function serializeAddendumEntry(params: {
  index: number;
  dateISO: string;
  amountDelta: number;
  registeredBy: ActorRole;
  description: string;
}): string {
  const label = `Aditivo #${params.index}`;
  const safeDesc = sanitizePipeText(params.description).slice(0, 180);
  return [
    label,
    params.dateISO,
    params.amountDelta.toFixed(2),
    params.registeredBy,
    safeDesc,
  ].join('|');
}

export function parseContractAddenda(entries?: string[]): ParsedContractAddendum[] {
  if (!entries || entries.length === 0) return [];
  return entries.map((raw, idx) => {
    const parts = raw.split('|');
    if (parts.length >= 5) {
      return {
        label: parts[0] || `Aditivo #${idx + 1}`,
        dateISO: parts[1] || '',
        amountDelta: Number(parts[2]) || 0,
        registeredBy: parts[3] || 'Sócio',
        description: parts.slice(4).join(' · '),
        raw,
      };
    }
    return {
      label: `Aditivo #${idx + 1}`,
      dateISO: '',
      amountDelta: 0,
      registeredBy: 'Sócio',
      description: raw,
      raw,
    };
  });
}

export function formatVersionSummaryLine(v: ParsedQuoteVersion): string {
  const datePart = v.dateISO ? formatDateBR(v.dateISO) : '—';
  return `${v.version} · ${datePart} · ${formatBRL(v.totalValue)} (${v.marginPct.toFixed(1).replace('.', ',')}%) · ${v.note}`;
}
