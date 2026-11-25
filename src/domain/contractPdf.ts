import { createPdfDocument, pdfText } from './pdfDocument';
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

  return createPdfDocument(objects);
}
