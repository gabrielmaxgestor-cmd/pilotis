import type { CellObject, Sheet, SheetData } from 'write-excel-file/browser';
import type { PilotisDataState, TransactionKind } from '../types/pilotis';
import {
  classificarLancamento,
  isLoanKeywordPresent,
  formatDateBR as domainFormatDateBR,
  formatTimestampBR,
  normalizeBRDateToISO,
  parseCurrencyInput,
  resolverStatusConformidade,
  resolverStatusDivida,
  resolverStatusLancamento,
  resolverStatusParcela,
  todayISO,
} from '../domain';

const formatDateBR = (val: string | null | undefined) => domainFormatDateBR(val, '—');

export interface ColumnMapping {
  dateCol: number;
  descriptionCol: number;
  categoryCol: number;
  amountCol: number;
  projectCol: number;
  kindCol: number; // -1 if not mapped
}

export interface ParsedSheetData {
  fileName: string;
  sheetName: string;
  headers: string[];
  rawRows: string[][];
  suggestedMapping: ColumnMapping;
}

export interface ImportPreviewRow {
  id: string;
  rowIndex: number;
  date: string;
  description: string;
  rawCategory: string;
  rawKind: string;
  entryKind: TransactionKind;
  category: string;
  projectName: string;
  amount: number;
  flaggedLoan: boolean;
  wasTaggedAsRevenue: boolean;
}

export interface ImportBuildResult {
  rows: ImportPreviewRow[];
  skippedRowsCount: number;
  flaggedLoansCount: number;
}

const VALID_HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export function normalizeHexColor(val: string | undefined, fallback = '#9A6212'): string {
  if (!val) return fallback;
  const trimmed = val.trim();
  return VALID_HEX_COLOR.test(trimmed) ? trimmed.toUpperCase() : fallback;
}

function splitCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result.map((cell) => cell.replace(/^"|"$/g, '').trim());
}

function normalizeHeaderToken(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

export function autoSuggestColumnMapping(headers: string[]): ColumnMapping {
  const normalized = headers.map(normalizeHeaderToken);

  const findIndex = (patterns: RegExp[], fallback: number): number => {
    const idx = normalized.findIndex((h) => patterns.some((p) => p.test(h)));
    return idx >= 0 ? idx : fallback < headers.length ? fallback : -1;
  };

  const dateCol = findIndex([/\bdata\b/, /venc/, /compet/, /emiss/, /dt/], 0);
  const descriptionCol = findIndex([/descri/, /hist/, /lanc/, /memo/, /item/, /nome/], 1);
  const categoryCol = findIndex([/categ/, /grupo/, /conta/, /classif/, /nat/], 2);
  const amountCol = findIndex([/valor/, /mont/, /total/, /quant/, /r\$/], 3);
  const projectCol = findIndex([/obra/, /centro/, /proj/, /local/, /cliente/], 4);
  const kindCol = findIndex([/\btipo\b/, /entrada.*saida/, /mov/], -1);

  return {
    dateCol,
    descriptionCol,
    categoryCol,
    amountCol,
    projectCol,
    kindCol,
  };
}

function looksLikeHeaderRow(cells: string[]): boolean {
  const joined = cells.map(normalizeHeaderToken).join(' ');
  return (
    /data|descri|valor|categ|obra|tipo|historico/.test(joined) &&
    !/\d{2}\/\d{2}\/\d{4}/.test(joined)
  );
}

export function parseCsvText(raw: string, fileName = 'planilha.csv'): ParsedSheetData {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return {
      fileName,
      sheetName: 'CSV',
      headers: [],
      rawRows: [],
      suggestedMapping: {
        dateCol: -1,
        descriptionCol: -1,
        categoryCol: -1,
        amountCol: -1,
        projectCol: -1,
        kindCol: -1,
      },
    };
  }

  const first = lines[0];
  const sep = first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',';
  const parsedLines = lines.map((l) => splitCsvLine(l, sep));
  const maxCols = Math.max(...parsedLines.map((r) => r.length));

  const hasHeader = looksLikeHeaderRow(parsedLines[0]);
  const headers = hasHeader
    ? parsedLines[0].map((h, idx) => h || `Coluna ${idx + 1}`)
    : Array.from({ length: maxCols }, (_, idx) => `Coluna ${idx + 1}`);

  const rawRows = (hasHeader ? parsedLines.slice(1) : parsedLines).filter((row) =>
    row.some((cell) => cell.trim() !== '')
  );

  return {
    fileName,
    sheetName: 'CSV',
    headers,
    rawRows,
    suggestedMapping: autoSuggestColumnMapping(headers),
  };
}

function formatExcelCellValue(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    const y = cell.getFullYear();
    const m = String(cell.getMonth() + 1).padStart(2, '0');
    const d = String(cell.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(cell).trim();
}

export async function parseSpreadsheetFile(file: File): Promise<ParsedSheetData> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xls')) {
    throw new Error(
      'Formato .xls legado não é mais suportado por segurança. Salve a planilha como .xlsx ou .csv e tente novamente.'
    );
  }

  if (lower.endsWith('.xlsx')) {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file);
    const firstSheet = sheets[0];
    if (!firstSheet) {
      return parseCsvText('', file.name);
    }

    const stringRows = firstSheet.data
      .map((row) => (Array.isArray(row) ? row.map(formatExcelCellValue) : []))
      .filter((row) => row.some((cell) => cell !== ''));

    if (stringRows.length === 0) {
      return parseCsvText('', file.name);
    }

    const maxCols = Math.max(...stringRows.map((r) => r.length));
    const hasHeader = looksLikeHeaderRow(stringRows[0]);
    const headers = hasHeader
      ? stringRows[0].map((h, idx) => h || `Coluna ${idx + 1}`)
      : Array.from({ length: maxCols }, (_, idx) => `Coluna ${idx + 1}`);
    const rawRows = hasHeader ? stringRows.slice(1) : stringRows;

    return {
      fileName: file.name,
      sheetName: firstSheet.sheet || 'Planilha1',
      headers,
      rawRows,
      suggestedMapping: autoSuggestColumnMapping(headers),
    };
  }

  const text = await file.text();
  return parseCsvText(text, file.name);
}

function parseSpreadsheetAmount(raw: string): { absAmount: number; isNegative: boolean } {
  const trimmed = raw.trim();
  if (!trimmed) return { absAmount: 0, isNegative: false };

  // Handle plain decimal number (e.g. from XLSX numeric cell "5200.5" or "-1250.75")
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return {
      absAmount: Math.abs(n),
      isNegative: n < 0,
    };
  }

  const isNegative = /^-|^\(.*\)$/.test(trimmed);
  const parsed = parseCurrencyInput(trimmed.replace(/^-/, ''));
  return { absAmount: parsed, isNegative };
}

function normalizeDateCell(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) return normalizeBRDateToISO(trimmed);
  // Month/Year (e.g. 11/2026) -> first day of month
  const my = /^(\d{2})\/(\d{4})$/.exec(trimmed);
  if (my) return `${my[2]}-${my[1]}-01`;
  return null;
}

export function buildImportPreviewRows(
  sheet: ParsedSheetData,
  mapping: ColumnMapping
): ImportBuildResult {
  const rows: ImportPreviewRow[] = [];
  let skippedRowsCount = 0;
  let flaggedLoansCount = 0;

  sheet.rawRows.forEach((cols, idx) => {
    const rawDate = mapping.dateCol >= 0 ? cols[mapping.dateCol] || '' : '';
    const rawDesc = mapping.descriptionCol >= 0 ? cols[mapping.descriptionCol] || '' : '';
    const rawCat = mapping.categoryCol >= 0 ? cols[mapping.categoryCol] || '' : '';
    const rawAmt = mapping.amountCol >= 0 ? cols[mapping.amountCol] || '' : '';
    const rawProj = mapping.projectCol >= 0 ? cols[mapping.projectCol] || '' : '';
    const rawKind = mapping.kindCol >= 0 ? cols[mapping.kindCol] || '' : '';

    const { absAmount, isNegative } = parseSpreadsheetAmount(rawAmt);
    const parsedDate = normalizeDateCell(rawDate);

    // Empty months / blank lines remain empty — never create zero-filled entries
    if (absAmount <= 0 || (!rawDesc.trim() && !rawCat.trim())) {
      skippedRowsCount++;
      return;
    }

    const hintJoined = `${rawKind} ${rawCat} ${rawDesc}`.toLowerCase();
    const taggedAsRevenue =
      !isNegative &&
      (/receita|faturamento|entrada|parcela/.test(`${rawKind} ${rawCat}`.toLowerCase()) ||
        (!rawKind && /faturamento|parcela|receb/.test(hintJoined)));

    const classified = classificarLancamento({
      descricao: rawDesc || 'Lançamento da planilha',
      categoria: rawCat || 'Outros',
      tipoInformado: !isNegative && isLoanKeywordPresent(hintJoined)
        ? 'emprestimo'
        : taggedAsRevenue ? 'receita' : 'despesa',
      valor: absAmount,
      previsto: false,
    });

    const entryKind: TransactionKind =
      classified.tipo === 'emprestimo'
        ? 'loan'
        : classified.tipo === 'receita'
        ? 'income'
        : 'expense';

    const flaggedLoan = classified.tipo === 'emprestimo';
    if (flaggedLoan) flaggedLoansCount++;

    let finalCategory = classified.categoria;
    if (entryKind === 'expense' && (!rawCat || rawCat === 'Outros')) {
      if (/folha|sal[aá]rio/.test(hintJoined)) finalCategory = 'Folha';
      else if (/tributo|simples|iss|inss|fgts|imposto/.test(hintJoined)) finalCategory = 'Tributos';
      else if (/pr[oó]-labore|pro-labore|s[oó]cio/.test(hintJoined)) finalCategory = 'Pró-labore';
      else if (/empreit/.test(hintJoined)) finalCategory = 'Subempreitadas';
      else if (/equip|epi|ferrament/.test(hintJoined)) finalCategory = 'Equipamentos e EPI';
    }

    rows.push({
      id: `imp_${idx + 1}`,
      rowIndex: idx + 1,
      date: parsedDate || todayISO(),
      description: rawDesc.trim() || finalCategory,
      rawCategory: rawCat.trim() || '—',
      rawKind: rawKind.trim(),
      entryKind,
      category: finalCategory,
      projectName: rawProj.trim() || 'Empresa',
      amount: absAmount,
      flaggedLoan,
      wasTaggedAsRevenue: flaggedLoan && classified.rejeitadoComoReceita,
    });
  });

  return { rows, skippedRowsCount, flaggedLoansCount };
}

export function sanitizeSpreadsheetCell(val: unknown): string | number | boolean {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return val;
  const s = String(val);
  // Prevent formula injection in Excel/Calc when opening exported CSV/XLSX
  if (/^[=+\-@\t\r]/.test(s)) {
    return `'${s}`;
  }
  return s;
}

function sanitizeSheetRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = sanitizeSpreadsheetCell(v);
    }
    return out;
  });
}

function toWriteExcelCell(val: unknown): CellObject {
  const safe = sanitizeSpreadsheetCell(val);
  if (typeof safe === 'number') {
    return Number.isFinite(safe) ? { value: safe, type: Number } : { value: '', type: String };
  }
  if (typeof safe === 'boolean') {
    return { value: safe, type: Boolean };
  }
  return { value: safe, type: String };
}

function recordsToSheetData(rows: Array<Record<string, unknown>>): SheetData {
  const sourceRows = rows.length > 0 ? sanitizeSheetRows(rows) : [{ Status: 'Sem registros' }];
  const headers = Object.keys(sourceRows[0]);
  const headerRow = headers.map((header) => ({
    value: String(sanitizeSpreadsheetCell(header)),
    type: String,
    fontWeight: 'bold' as const,
  }));
  const bodyRows = sourceRows.map((row) => headers.map((header) => toWriteExcelCell(row[header])));
  return [headerRow, ...bodyRows];
}

export function exportBackupJson(data: PilotisDataState): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    system: 'Sistema de Gestão Pilotis',
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pilotis-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function buildBackupWorkbookSheets(data: PilotisDataState): Sheet<File | Blob | ArrayBuffer>[] {
  const sheets: Sheet<File | Blob | ArrayBuffer>[] = [];
  const todayRef = todayISO();

  const appendSheet = (name: string, rows: Array<Record<string, unknown>>) => {
    sheets.push({
      sheet: name.slice(0, 31),
      data: recordsToSheetData(rows),
    });
  };

  appendSheet(
    'Empresa',
    data.settings
      ? [
          {
            Nome: data.settings.companyName,
            CNPJ: data.settings.cnpj,
            EnderecoFiscal: data.settings.fiscalAddress,
            Cidade: data.settings.city,
            Email: data.settings.email,
            Telefone: data.settings.phone,
            CorDestaque: data.settings.accentColor,
            INSS_Pct: data.settings.inssRate,
            FGTS_Pct: data.settings.fgtsRate,
            Ferias_Pct: data.settings.vacationRate,
            DecimoTerceiro_Pct: data.settings.thirteenthRate,
            MetaMargem_Pct: data.settings.targetMarginPct ?? '',
            VigenciaEncargos: data.settings.taxParamsEffectiveDate,
            FonteEncargos: data.settings.taxParamsSource,
          },
        ]
      : []
  );

  appendSheet(
    'Lancamentos',
    data.transactions.map((t) => ({
      Data: formatDateBR(t.date),
      Vencimento: formatDateBR(t.dueDate),
      Descricao: t.description,
      Tipo: t.entryKind === 'income' ? 'Receita' : t.entryKind === 'loan' ? 'Empréstimo' : 'Despesa',
      Categoria: t.category,
      Obra: t.projectName,
      Valor: t.amount,
      Natureza: t.isForecast ? 'Previsto' : 'Realizado',
      Status: resolverStatusLancamento(
        {
          tipo:
            t.entryKind === 'income'
              ? 'receita'
              : t.entryKind === 'loan'
              ? 'emprestimo'
              : 'despesa',
          status: t.status,
          previsto: t.isForecast,
          vencimento: t.dueDate || t.date,
          data: t.date,
        },
        todayRef,
      ),
      NotaFiscal: t.invoiceStatus,
      Origem: t.source,
      RegistradoPor: t.createdBy,
    }))
  );

  appendSheet(
    'Dividas',
    data.debts.map((d) => ({
      Credor: d.creditor,
      Tipo: d.debtType,
      SaldoDevedor: d.principalBalance,
      CustoMensal: d.monthlyCost,
      ParcelasRestantes: d.remainingInstallments,
      ProximoVencimento: formatDateBR(d.nextDueDate),
      Status: resolverStatusDivida(
        { status: d.status, proximoVencimento: d.nextDueDate },
        todayRef,
      ),
      RegistradoPor: d.createdBy,
    }))
  );

  appendSheet(
    'Clientes',
    data.clients.map((c) => ({
      Nome: c.name,
      Origem: c.origin,
      Cidade: c.city,
      Telefone: c.phone,
      Email: c.email,
      Status: c.status,
      Indicacoes: c.referralsCount,
      RegistradoPor: c.createdBy,
    }))
  );

  appendSheet(
    'Orcamentos',
    data.quotes.map((q) => ({
      Codigo: q.code,
      Cliente: q.clientName,
      Titulo: q.title,
      Tipo: q.type,
      ValorTotal: q.totalValue,
      Entrada_Pct: q.downPaymentPct,
      Parcelas: q.installmentsCount,
      Probabilidade_Pct: q.probabilityPct,
      Status: q.status,
      RegistradoPor: q.createdBy,
    }))
  );

  appendSheet(
    'Obras',
    data.projects.map((p) => ({
      Obra: p.name,
      TipoContrato: p.contractKind || (p.type === 'Obra satélite' ? 'Satélite' : 'Principal'),
      Cliente: p.clientName,
      Tipo: p.type,
      ValorContrato: p.contractValue,
      Inicio: formatDateBR(p.startDate),
      TerminoPrevisto: formatDateBR(p.forecastEndDate),
      Planejamento: p.planningStatus || 'Cronograma criado',
      Status: p.status,
      RegistradoPor: p.createdBy,
    }))
  );

  appendSheet(
    'Parcelas',
    data.installments.map((inst) => ({
      Obra: inst.projectName,
      Cliente: inst.clientName,
      Numero: inst.number,
      Parcela: inst.label,
      Vencimento: formatDateBR(inst.dueDate),
      Valor: inst.amount,
      NotaFiscal: inst.invoiceStatus,
      Status: resolverStatusParcela(
        { status: inst.status, vencimento: inst.dueDate },
        todayRef,
      ),
      RecebidaEm: inst.receivedDate ? formatDateBR(inst.receivedDate) : '',
      RegistradoPor: inst.createdBy,
    }))
  );

  appendSheet(
    'Etapas',
    data.stages.map((s) => ({
      ObraId: s.projectId,
      EAP: s.wbsCode,
      Fase: s.phase,
      Etapa: s.name,
      Responsavel: s.responsible,
      SemanaInicio: s.startWeek,
      DuracaoSemanas: s.durationWeeks,
      Progresso_Pct: s.progressPct,
      Status: s.status,
    }))
  );

  appendSheet(
    'Equipe',
    data.employees.map((e) => ({
      Nome: e.name,
      Funcao: e.role,
      Vinculo: e.employmentType,
      SalarioBase: e.baseSalary,
      ObraAtual: e.currentProjectName,
      ASO: formatDateBR(e.asoExpiry),
      NR18: formatDateBR(e.nr18Expiry),
      NR35: formatDateBR(e.nr35Expiry),
      EPI: e.epiStatus,
    }))
  );

  appendSheet(
    'POPs',
    data.pops.map((p) => ({
      Titulo: p.title,
      Servico: p.serviceType,
      Versao: p.version,
      Status: p.status,
      EtapaVinculada: p.linkedStagePhase,
    }))
  );

  appendSheet(
    'Conformidade',
    data.complianceItems.map((c) => ({
      Tipo: c.kind,
      Titulo: c.title,
      Obra: c.projectName,
      Vencimento: formatDateBR(c.dueDate),
      Status: resolverStatusConformidade(
        { status: c.status, vencimento: c.dueDate },
        todayRef,
      ),
      Obrigatorio: c.mandatory ? 'Sim' : 'Não',
    }))
  );

  appendSheet(
    'Auditoria',
    data.auditLogs.map((a) => ({
      Quando: formatTimestampBR(a.createdAt),
      RegistradoPor: a.registeredBy,
      Acao: a.action,
      Entidade: a.entityType,
      Resumo: a.summary,
      Antes: a.beforeValue || '',
      Depois: a.afterValue || '',
    }))
  );

  return sheets;
}

export async function exportBackupWorkbookXlsx(data: PilotisDataState): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const sheets = buildBackupWorkbookSheets(data);
  await writeXlsxFile(sheets).toFile(`pilotis-backup-${todayISO()}.xlsx`);
}

export function exportTransactionsCsv(data: PilotisDataState): void {
  const todayRef = todayISO();
  const headers = [
    'Data',
    'Vencimento',
    'Descrição',
    'Tipo',
    'Categoria',
    'Obra',
    'Valor',
    'Natureza',
    'Status',
    'Origem',
    'Registrado por',
  ];
  const lines = [
    headers.join(';'),
    ...data.transactions.map((t) =>
      [
        formatDateBR(t.date),
        formatDateBR(t.dueDate),
        t.description,
        t.entryKind === 'income' ? 'Receita' : t.entryKind === 'loan' ? 'Empréstimo' : 'Despesa',
        t.category,
        t.projectName,
        t.amount.toFixed(2).replace('.', ','),
        t.isForecast ? 'Previsto' : 'Realizado',
        resolverStatusLancamento(
          {
            tipo:
              t.entryKind === 'income'
                ? 'receita'
                : t.entryKind === 'loan'
                ? 'emprestimo'
                : 'despesa',
            status: t.status,
            previsto: t.isForecast,
            vencimento: t.dueDate || t.date,
            data: t.date,
          },
          todayRef,
        ),
        t.source,
        t.createdBy,
      ]
        .map((cell) => `"${String(sanitizeSpreadsheetCell(cell)).replace(/"/g, '""')}"`)
        .join(';')
    ),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pilotis-lancamentos-${todayISO()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function rasterizeLogoToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem (.png, .jpg, .webp ou .svg).');
  }
  if (file.size > 4 * 1024 * 1024) {
    throw new Error('A imagem da logo deve ter no máximo 4 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível ler a imagem selecionada.'));
      el.src = objectUrl;
    });

    const maxSize = 240;
    const scale = Math.min(1, maxSize / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || maxSize) * scale));
    const height = Math.max(1, Math.round((img.height || maxSize) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Falha ao processar a imagem no navegador.');
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const pngDataUrl = canvas.toDataURL('image/png');
    if (pngDataUrl.length <= 180_000) return pngDataUrl;

    const webpDataUrl = canvas.toDataURL('image/webp', 0.85);
    if (webpDataUrl.length <= 180_000) return webpDataUrl;

    throw new Error('A logo ficou grande demais após compactação. Use uma imagem mais simples.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
