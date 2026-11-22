export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Sem dados';
  }
  const abs = Math.abs(value);
  const formatted = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(abs);
  return value < 0 ? `− ${formatted}` : formatted;
}

export function formatBRLCompact(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'Sem dados';
  }
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `${value < 0 ? '− ' : ''}R$ ${(abs / 1_000_000).toFixed(2).replace('.', ',')} mi`;
  }
  if (abs >= 1000 && abs % 1000 === 0) {
    return `${value < 0 ? '− ' : ''}R$ ${(abs / 1000).toLocaleString('pt-BR')} mil`;
  }
  return formatBRL(value);
}

export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(dateStr.trim());
  if (brMatch) return dateStr.trim().slice(0, 10);
  return dateStr;
}

export function formatShortDateBR(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}`;
  }
  return dateStr;
}

export function formatTimestampBR(ts: unknown): string {
  if (!ts) return 'Agora';
  if (typeof ts === 'object' && ts !== null && 'toDate' in ts && typeof (ts as { toDate: () => Date }).toDate === 'function') {
    const d = (ts as { toDate: () => Date }).toDate();
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return 'Registrado';
}

export function addMonthsISO(isoDate: string, monthsToAdd: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  const base = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date();
  const target = new Date(base.getFullYear(), base.getMonth() + monthsToAdd, base.getDate());
  const y = target.getFullYear();
  const m = String(target.getMonth() + 1).padStart(2, '0');
  const d = String(target.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(isoDate: string, daysToAdd: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  const base = parts
    ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
    : new Date();
  base.setDate(base.getDate() + daysToAdd);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function diffDaysFromToday(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!parts) return null;
  const target = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  const now = new Date();
  const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayMidnight.getTime()) / (1000 * 60 * 60 * 24));
}

export function monthKey(isoDate: string): string {
  const parts = /^(\d{4})-(\d{2})/.exec(isoDate || '');
  return parts ? `${parts[1]}-${parts[2]}` : '';
}

export function formatMonthLabelBR(ym: string): string {
  const parts = /^(\d{4})-(\d{2})/.exec(ym);
  if (!parts) return ym;
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const idx = Number(parts[2]) - 1;
  return `${months[idx] ?? parts[2]}/${parts[1]}`;
}

export function clampStr(val: string, maxLen: number): string {
  return (val ?? '').trim().slice(0, maxLen);
}

export function parseCurrencyInput(raw: string): number {
  const cleaned = raw.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeBRDateToISO(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return todayISO();
}
