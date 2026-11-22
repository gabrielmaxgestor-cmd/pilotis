const BRL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function formatBRL(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Sem dados';
  }
  const normalized = Object.is(value, -0) ? 0 : roundCents(value);
  const absFormatted = BRL_FORMATTER.format(Math.abs(normalized)).replace(/\u00A0/g, ' ');
  return normalized < 0 ? `− ${absFormatted}` : absFormatted;
}

export function formatPercentBR(
  value: number | null | undefined,
  decimals = 1,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'Sem dados';
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  const formatter = new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const formatted = formatter.format(Math.abs(normalized));
  return normalized < 0 ? `− ${formatted}%` : `${formatted}%`;
}

export function isValidISODate(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

export function formatDateBR(dateStr: string | null | undefined): string {
  if (!dateStr || !dateStr.trim()) return 'Sem dados';
  const trimmed = dateStr.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }
  const brMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (brMatch) {
    return trimmed;
  }
  return 'Sem dados';
}

export function parseDateBRToISO(brDate: string | null | undefined): string | null {
  if (!brDate) return null;
  const trimmed = brDate.trim();
  if (isValidISODate(trimmed)) return trimmed;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const iso = `${match[3]}-${match[2]}-${match[1]}`;
  return isValidISODate(iso) ? iso : null;
}

export function addMonthsISO(isoDate: string, monthsToAdd: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Data ISO inválida: "${isoDate}"`);
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);

  const targetMonthTotal = year * 12 + monthIndex + monthsToAdd;
  const targetYear = Math.floor(targetMonthTotal / 12);
  const targetMonthIndex = ((targetMonthTotal % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonthIndex + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  return `${String(targetYear).padStart(4, '0')}-${String(targetMonthIndex + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

export function addDaysISO(isoDate: string, daysToAdd: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!match) {
    throw new Error(`Data ISO inválida: "${isoDate}"`);
  }
  const dt = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + daysToAdd),
  );
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function diffDaysISO(targetIso: string, referenceIso: string): number | null {
  if (!isValidISODate(targetIso) || !isValidISODate(referenceIso)) return null;
  const [ty, tm, td] = targetIso.split('-').map(Number);
  const [ry, rm, rd] = referenceIso.split('-').map(Number);
  const tUtc = Date.UTC(ty, tm - 1, td);
  const rUtc = Date.UTC(ry, rm - 1, rd);
  return Math.round((tUtc - rUtc) / 86_400_000);
}

export function monthKey(isoDate: string | null | undefined): string {
  if (!isoDate) return '';
  const match = /^(\d{4})-(\d{2})/.exec(isoDate.trim());
  return match ? `${match[1]}-${match[2]}` : '';
}

export function formatMonthLabelBR(ym: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(ym.trim());
  if (!match) return ym;
  const months = [
    'Jan',
    'Fev',
    'Mar',
    'Abr',
    'Mai',
    'Jun',
    'Jul',
    'Ago',
    'Set',
    'Out',
    'Nov',
    'Dez',
  ];
  const idx = Number(match[2]) - 1;
  return `${months[idx] ?? match[2]}/${match[1]}`;
}
