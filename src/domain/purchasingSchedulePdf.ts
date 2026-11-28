import { formatDateBR } from './formatters';
import { createPdfDocument, pdfText } from './pdfDocument';
import type { CustomerMaterialRow } from './customerMaterials';

export function formatMaterialQuantity(quantity: number | null, unit: string) {
  return quantity === null ? 'A confirmar' : quantity.toLocaleString('pt-BR', { maximumFractionDigits: 8 }) + (unit ? ' ' + unit : '');
}

export function createPurchasingSchedulePdf(input: {
  companyName: string; projectName: string; contractCode?: string; date: string; rows: CustomerMaterialRow[];
}) {
  const lines = [
    'Anexo contratual · Cronograma de compras do cliente',
    input.companyName + ' · ' + input.projectName,
    ...(input.contractCode ? ['Orçamento vinculado: ' + input.contractCode] : []),
    'Posição em ' + formatDateBR(input.date),
    '',
    ...input.rows.flatMap(({ item, stage, status, necessaryDate }, index) => [
      (index + 1) + '. ' + item.description,
      'Etapa: ' + (stage ? stage.wbsCode + ' · ' + stage.name : 'Sem dados') +
        ' | Quantidade: ' + formatMaterialQuantity(item.quantity, item.unit),
      'Necessária: ' + formatDateBR(necessaryDate) + ' | Prometida: ' + formatDateBR(item.promisedDate) +
        ' | Situação: ' + status,
      ...(item.deliveredDate ? ['Entregue em: ' + formatDateBR(item.deliveredDate)] : []),
      'Responsável do cliente: ' + (item.clientContact || 'A confirmar'),
      ...(item.notes ? ['Observações: ' + item.notes] : []),
      '',
    ]),
  ].flatMap((line) => {
    const wrapped = [''];
    for (const word of line.split(/\s+/).flatMap((word) => word.match(/.{1,78}/gu) ?? [])) {
      const index = wrapped.length - 1;
      const candidate = [wrapped[index], word].filter(Boolean).join(' ');
      if (candidate.length <= 78) wrapped[index] = candidate;
      else wrapped.push(word);
    }
    return wrapped;
  });

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];
  const pageIds: string[] = [];
  for (let start = 0; start < lines.length; start += 49) {
    const page = objects.length + 1;
    pageIds.push(page + ' 0 R');
    const stream = 'BT /F1 11 Tf 14 TL 44 787 Td\n' +
      lines.slice(start, start + 49).map((line) => '<' + pdfText(line, true) + '> Tj T*').join('\n') + '\nET\n';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (page + 1) + ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
    );
  }
  objects[1] = '<< /Type /Pages /Kids [' + pageIds.join(' ') + '] /Count ' + pageIds.length + ' >>';
  return createPdfDocument(objects);
}
