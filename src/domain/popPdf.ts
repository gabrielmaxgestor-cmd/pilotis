import { formatDateBR } from './formatters';
import { createPdfDocument, pdfText } from './pdfDocument';
import type { CompanySettings, Pop } from '../types/pilotis';

export type PdfLogo = { bytes: Uint8Array; width: number; height: number };

function wrapped(text: string, columns: number) {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const words = paragraph.trim().split(/\s+/u).flatMap((word) => word.match(new RegExp('.{1,' + columns + '}', 'gu')) ?? ['']);
    const lines = [''];
    for (const word of words) {
      const last = lines.length - 1;
      const combined = lines[last] ? lines[last] + ' ' + word : word;
      if ([...combined].length <= columns) lines[last] = combined;
      else lines.push(word);
    }
    return lines;
  });
}

export function createPopPdf(pop: Pop, settings: CompanySettings | null, date: string, logo?: PdfLogo): Uint8Array {
  const company = settings?.companyName?.trim() || 'Pilotis Soluções Construtivas';
  const title = settings?.popPdfHeader?.trim() || 'Procedimento Operacional Padrão';
  const footer = settings?.popPdfFooter?.trim();
  const hex = /^#[0-9a-f]{6}$/i.test(settings?.accentColor ?? '') ? settings!.accentColor : '#9A6212';
  const accent = hex.slice(1).match(/../g)!.map((value) => (parseInt(value, 16) / 255).toFixed(3)).join(' ');
  const text = (value: string, x: number, y: number, size: number, bold = false) =>
    'BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x + ' ' + y + ' Td <' + pdfText(value, true) + '> Tj ET';
  const dateLine = (pop.publishedOn ? 'Publicação ' + formatDateBR(pop.publishedOn) : 'Exportação ' + formatDateBR(date));
  const companyDetails = [settings?.cnpj ? 'CNPJ ' + settings.cnpj : '', settings?.city, settings?.email].filter(Boolean).join(' · ');
  const rows: { value: string; bold?: boolean }[] = [];
  const section = (label: string, values: string[]) => {
    const nonempty = values.filter((value) => value?.trim());
    if (!nonempty.length) return;
    rows.push({ value: label, bold: true });
    for (const value of nonempty) rows.push(...wrapped(value, 82).map((line) => ({ value: line })));
    rows.push({ value: '' });
  };
  rows.push(...wrapped(pop.title, 64).map((value) => ({ value, bold: true })));
  rows.push({ value: 'Serviço: ' + pop.serviceType }, { value: '' });
  section('Identificação', [
    pop.linkedStagePhase ? 'Fase no planejamento: ' + pop.linkedStagePhase : '',
    pop.usedInOnboarding ? 'Usado no treinamento de integração.' : '',
    pop.approvedBy ? 'Aprovação: ' + pop.approvedBy : '',
  ]);
  section('Objetivo', [pop.objective]);
  section('Materiais e EPIs', [pop.materialsAndEpi]);
  section('Ferramentas', [pop.tools ?? '']);
  section('Equipamentos de proteção', [pop.protectiveEquipment ?? '']);
  section('Passo a passo', (pop.steps ?? []).map((item, index) => (index + 1) + '. ' + item));
  section('Critérios de aceite', (pop.acceptanceCriteria ?? []).map((item) => '[ ] ' + item));
  section('Anexos', (pop.attachments ?? []).map((item) => (item.contentType.startsWith('image/') ? 'Foto · ' : 'Vídeo · ') + item.name));

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  const drawLogo = settings?.pdfShowLogo !== false && logo && logo.width > 0 && logo.height > 0;
  if (drawLogo && logo) {
    const stream = Array.from(logo.bytes, (byte) => byte.toString(16).padStart(2, '0')).join('') + '>';
    objects.push('<< /Type /XObject /Subtype /Image /Width ' + logo.width + ' /Height ' + logo.height +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ' + stream.length +
      ' >>\nstream\n' + stream + '\nendstream');
  }
  const pages: string[] = [];
  const perPage = 45;
  for (let start = 0; start < rows.length; start += perPage) {
    const commands = [accent + ' RG 1.5 w 42 748 m 553 748 l S', accent + ' RG 42 51 m 553 51 l S', '0.08 0.09 0.12 rg'];
    const x = drawLogo ? 109 : 42;
    if (drawLogo && logo) {
      const scale = Math.min(61 / logo.width, 43 / logo.height);
      commands.push('q ' + (logo.width * scale).toFixed(2) + ' 0 0 ' + (logo.height * scale).toFixed(2) + ' 42 762 cm /Logo Do Q');
    }
    commands.push(...wrapped(company, 62).slice(0, 2).map((line, index) => text(line, x, 811 - index * 14, 14, true)));
    commands.push(...wrapped(title, 76).slice(0, 2).map((line, index) => text(line, x, 782 - index * 11, 10)));
    commands.push(text(wrapped(companyDetails, 90)[0] ?? '', x, 755, 8));
    if (footer) commands.push(...wrapped(footer, 95).slice(0, 2).map((line, index) => text(line, 42, 38 - 10 * index, 8)));
    commands.push(text(pop.version + ' · ' + dateLine + ' · Página ' + (pages.length + 1) + '/' + Math.ceil(rows.length / perPage), 42, 15, 9, true));
    rows.slice(start, start + perPage).forEach((row, index) => commands.push(text(row.value, 42, 728 - index * 14, 10, row.bold)));
    const page = objects.length + 1;
    pages.push(page + ' 0 R');
    const stream = commands.join('\n') + '\n';
    objects.push(
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' +
        (drawLogo ? ' /XObject << /Logo 5 0 R >>' : '') + ' >> /Contents ' + (page + 1) + ' 0 R >>',
      '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream',
    );
  }
  objects[1] = '<< /Type /Pages /Kids [' + pages.join(' ') + '] /Count ' + pages.length + ' >>';
  return createPdfDocument(objects);
}
