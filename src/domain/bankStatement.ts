import { parseDateBRToISO, roundCents } from './formatters';
import type { ExtratoLinhaEntrada } from './financeiro';

function parseCsvRecords(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && (character === separator || character === '\n')) {
      fields.push(field.trim());
      field = '';
      if (character === '\n') {
        if (fields.some(Boolean)) records.push(fields);
        fields = [];
      }
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error('Há um campo com aspas não fechadas no CSV.');
  fields.push(field.trim());
  if (fields.some(Boolean)) records.push(fields);
  return records;
}

function parseAmount(value: string): number {
  const clean = value.trim().replace(/R\$\s*/gi, '').replace(/\s/g, '');
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(clean) &&
      !/^[+-]?\d+(?:\.\d{1,2})?$/.test(clean)) return NaN;
  return Number(clean.includes(',') || /^[+-]?\d{1,3}(?:\.\d{3})+$/.test(clean)
    ? clean.replace(/\./g, '').replace(',', '.')
    : clean);
}

function ofxField(block: string, tag: string): string {
  return new RegExp('<' + tag + '\\s*>([^<\\r\\n]+)', 'i').exec(block)?.[1].trim() ?? '';
}

export function parseBankStatement(raw: string, fileName: string): {
  rows: ExtratoLinhaEntrada[];
  invalidCount: number;
} {
  const text = raw.replace(/^\uFEFF/, '');
  const isOfx = /\.ofx$/i.test(fileName) || /<OFX[\s>]/i.test(text);
  const candidates = isOfx
    ? text.split(/<STMTTRN\s*>/i).slice(1).map((block) => {
        const date = /^(\d{4})(\d{2})(\d{2})/.exec(ofxField(block, 'DTPOSTED'));
        const name = ofxField(block, 'NAME');
        const memo = ofxField(block, 'MEMO');
        return {
          date: date ? date.slice(1).join('-') : '',
          description: name && memo && name !== memo ? name + ' · ' + memo : memo || name,
          amount: ofxField(block, 'TRNAMT'),
          externalId: ofxField(block, 'FITID'),
        };
      })
    : (() => {
        const alternatives = [';', ',', '\t'].map((separator) => parseCsvRecords(text, separator));
        const records = alternatives.find((items) => items[0]?.length === 3) ??
          alternatives.find((items) => items[0]?.length > 3) ?? [];
        const [first, ...rest] = records;
        const hasHeader = /data|descri|valor/i.test(first?.join(' ') ?? '') &&
          !parseDateBRToISO(first?.[0] ?? '');
        return (hasHeader ? rest : records).map(([date = '', description = '', amount = '']) => ({
          date, description, amount, externalId: '',
        }));
      })();

  const account = [ofxField(text, 'BANKID'), ofxField(text, 'ACCTID')].join('/');
  const repeats = new Map<string, number>();
  const rows: ExtratoLinhaEntrada[] = [];
  for (const [index, item] of candidates.entries()) {
    const date = parseDateBRToISO(item.date);
    const amount = parseAmount(item.amount);
    if (!date || !item.description.trim() || !Number.isFinite(amount) || roundCents(amount) === 0) continue;
    const description = item.description.trim().replace(/\s+/g, ' ').slice(0, 180);
    const identity = JSON.stringify(item.externalId && account !== '/'
      ? ['ofx', account.slice(0, 100), item.externalId.slice(0, 120)]
      : ['bank', date, description.toLowerCase(), roundCents(amount)]);
    const occurrence = (repeats.get(identity) ?? 0) + 1;
    repeats.set(identity, occurrence);
    rows.push({
      id: 'statement-' + index,
      statementKey: identity + ':' + occurrence,
      data: date,
      descricao: description,
      valorAssinado: roundCents(amount),
    });
  }
  return { rows, invalidCount: candidates.length - rows.length };
}
