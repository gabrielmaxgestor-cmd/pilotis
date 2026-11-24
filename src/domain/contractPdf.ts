import { formatBRL, formatDateBR } from './formatters';
import type { ParcelaGerada } from './orcamentos';

interface ContractPdfInput {
  code: string;
  companyName: string;
  clientName: string;
  projectName: string;
  contractKind: string;
  city?: string;
  description?: string;
  estimatedMonths?: number;
  totalValue: number;
  startDate: string;
  installments: ParcelaGerada[];
}

const windowsAnsi = '€\u0000‚ƒ„…†‡ˆ‰Š‹Œ\u0000Ž\u0000\u0000‘’“”•–—˜™š›œ\u0000žŸ';

function pdfText(value: string): string {
  return Array.from(value.normalize('NFC'), (character) => {
    const code = character.charCodeAt(0);
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) {
      return code.toString(16).padStart(2, '0');
    }
    const offset = windowsAnsi.indexOf(character);
    if (offset >= 0) return (128 + offset).toString(16);
    throw new Error('O contrato contém um caractere que não pode ser incluído no PDF.');
  }).join('');
}

function wrapLine(value: string): string[] {
  const words = value.trim().split(/\s+/u).flatMap((word) => word.match(/.{1,78}/gu) ?? ['']);
  const lines = [''];
  for (const word of words) {
    const last = lines.length - 1;
    const candidate = lines[last] ? lines[last] + ' ' + word : word;
    if (candidate.length <= 78) lines[last] = candidate;
    else lines.push(word);
  }
  return lines;
}

export function createContractPdf(input: ContractPdfInput): Uint8Array {
  const lines = [
    'Contrato de execução de obra',
    'Orçamento ' + input.code,
    '',
    'Contratada: ' + input.companyName,
    'Contratante: ' + input.clientName,
    '',
    '1. Objeto e valor fechado',
    input.projectName + ' · Obra ' + input.contractKind,
    ...(input.city ? ['Localidade: ' + input.city] : []),
    ...(input.description ? [input.description] : []),
    'Valor fechado: ' + formatBRL(input.totalValue) + '. Alterações exigem aditivo.',
    '',
    '2. Pagamento',
    ...input.installments.map((item) => item.rotulo + ' · ' + item.vencimentoBR + ' · ' + formatBRL(item.valor)),
    '',
    '3. Materiais do cliente',
    'Os materiais são adquiridos pelo contratante e ficam fora do valor fechado.',
    '',
    '4. Início, prazo e garantia',
    'Início: ' + formatDateBR(input.startDate),
    ...(input.estimatedMonths ? ['Prazo estimado: ' + input.estimatedMonths + ' mês(es).'] : []),
    'Garantia contratual de 1 ano, contada da conclusão e entrega formal da obra.',
    '',
    'Assinaturas: ________________________________________________',
  ].flatMap(wrapLine);

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];
  const pageIds: string[] = [];
  for (let start = 0; start < lines.length; start += 49) {
    const pageId = objects.length + 1;
    pageIds.push(pageId + ' 0 R');
    const content = 'BT /F1 11 Tf 14 TL 44 787 Td\n' +
      lines.slice(start, start + 49).map((line) => '<' + pdfText(line) + '> Tj T*').join('\n') +
      '\nET\n';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' +
        (pageId + 1) + ' 0 R >>',
      '<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream',
    );
  }
  objects[1] = '<< /Type /Pages /Kids [' + pageIds.join(' ') + '] /Count ' + pageIds.length + ' >>';

  // All objects use ASCII syntax, so string offsets are also byte offsets.
  let pdf = '%PDF-1.4\n';
  const offsets = ['0000000000 65535 f \n'];
  for (const [index, object] of objects.entries()) {
    offsets.push(String(pdf.length).padStart(10, '0') + ' 00000 n \n');
    pdf += (index + 1) + ' 0 obj\n' + object + '\nendobj\n';
  }
  const xref = pdf.length;
  pdf += 'xref\n0 ' + offsets.length + '\n' + offsets.join('') +
    'trailer\n<< /Size ' + offsets.length + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return new TextEncoder().encode(pdf);
}
