import { createPdfDocument, pdfText } from '../domain/pdfDocument.ts';
import { formatDateBR } from '../domain/formatters.ts';
import { reportText, type WorkReport } from '../domain/workReport.ts';

export const REPORT_SOURCE_PHOTO_BYTES = 393_216;

export function prepareReportJpeg(source: Buffer) {
  if (source.length < 10 || source[0] !== 0xff || source[1] !== 0xd8 ||
    source.at(-2) !== 0xff || source.at(-1) !== 0xd9) throw new Error('Imagem JPEG indisponível ou incompatível.');
  const parts = [source.subarray(0, 2)];
  let width = 0;
  let height = 0;
  let channels = 0;
  for (let offset = 2; offset + 4 <= source.length;) {
    if (source[offset] !== 0xff) break;
    const marker = source[offset + 1];
    const size = source.readUInt16BE(offset + 2);
    const end = offset + 2 + size;
    if (size < 2 || end > source.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8 && source[offset + 4] === 8) {
      height = source.readUInt16BE(offset + 5);
      width = source.readUInt16BE(offset + 7);
      channels = source[offset + 9];
    }
    if (marker === 0xda && width > 0 && width <= 2400 && height > 0 && height <= 2400 && (channels === 1 || channels === 3)) {
      parts.push(source.subarray(offset));
      return { bytes: Buffer.concat(parts), width, height, channels };
    }
    // The diary stores rasterized JPEGs. Strip optional metadata such as EXIF/comment segments.
    if (!(marker >= 0xe1 && marker <= 0xef) && marker !== 0xfe) parts.push(source.subarray(offset, end));
    offset = end;
  }
  throw new Error('Imagem JPEG indisponível ou incompatível.');
}

type Jpeg = ReturnType<typeof prepareReportJpeg>;
export type WorkReportPhoto = { image: Jpeg; caption: string; date: string };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 46;
const BODY_WIDTH = PAGE_WIDTH - 2 * LEFT;
const BOTTOM = 60;

function wrap(value: string, size: number) {
  const width = (text: string) => [...text].reduce((sum, char) => sum +
    ("Ilij .,':;!".includes(char) ? 0.32 : 'MW@%'.includes(char) ? 0.94 : 0.64), 0) * size;
  const lines: string[] = [];
  let line = '';
  for (const word of value.split(/\s+/)) {
    const tokens = width(word) <= BODY_WIDTH ? [word] : word.match(/.{1,45}/gu) ?? [];
    for (const token of tokens) {
      const candidate = line ? line + ' ' + token : token;
      if (line && width(candidate) > BODY_WIDTH) { lines.push(line); line = token; }
      else line = candidate;
    }
  }
  return [...lines, line];
}

export function createWorkReportPdf(report: WorkReport, photos: WorkReportPhoto[], logo?: Jpeg) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> /Lang (pt-BR) >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  const pageIds: string[] = [];
  const pages: { ops: string[]; images: string[] }[] = [];
  let current: typeof pages[number];
  let y = 0;
  const color = (report.accent.match(/\w{2}/g) ?? []).map((c) => (parseInt(c, 16) / 255).toFixed(4)).join(' ');

  function imageObject(image: Jpeg) {
    const stream = image.bytes.toString('hex') + '>\n';
    objects.push('<< /Type /XObject /Subtype /Image /Width ' + image.width + ' /Height ' + image.height +
      ' /BitsPerComponent 8 /ColorSpace /' + (image.channels === 1 ? 'DeviceGray' : 'DeviceRGB') +
      ' /Filter [/ASCIIHexDecode /DCTDecode] /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
    return objects.length;
  }
  const logoId = logo ? imageObject(logo) : 0;
  function text(value: string, x: number, vertical: number, size = 11, bold = false) {
    current.ops.push('BT 0.12 0.17 0.24 rg /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' + x + ' ' +
      vertical + ' Td <' + pdfText(value, true) + '> Tj ET');
  }
  function placeImage(image: Jpeg, id: number, x: number, top: number, maxWidth: number, maxHeight: number) {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    const symbol = 'Im' + id;
    current.images.push('/' + symbol + ' ' + id + ' 0 R');
    current.ops.push('q ' + width.toFixed(2) + ' 0 0 ' + height.toFixed(2) + ' ' + x + ' ' +
      (top - height).toFixed(2) + ' cm /' + symbol + ' Do Q');
    return height;
  }
  function newPage(first = false) {
    current = { ops: [color + ' rg 0 829 595 13 re f'], images: [] };
    pages.push(current);
    if (logo) placeImage(logo, logoId, LEFT, 802, 68, 40);
    const brandX = logo ? LEFT + 84 : LEFT;
    text(report.company, brandX, 788, report.company.length > 55 ? 10 : 13, true);
    text('Relatório de andamento da obra', brandX, 767, 15, true);
    text('Competência ' + report.period + '  ·  Posição em ' + report.snapshotDate, LEFT, 736, 10);
    y = first ? 701 : 709;
  }
  function paragraph(value: string, size = 11, bold = false) {
    const lines = wrap(value, size);
    const height = size + 5;
    if (y - lines.length * height < BOTTOM) newPage();
    for (const line of lines) { text(line, LEFT, y, size, bold); y -= height; }
  }
  function heading(title: string) {
    if (y - 64 < BOTTOM) newPage();
    y -= 9;
    current.ops.push(color + ' rg ' + LEFT + ' ' + (y + 6) + ' ' + BODY_WIDTH + ' 1.5 re f');
    y -= 12;
    paragraph(title, 14, true);
    y -= 3;
  }
  const date = (value?: string | null) => formatDateBR(value);
  newPage(true);
  paragraph(report.title, 22, true);
  const pct = report.progress === null ? 'Sem dados' :
    new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(report.progress) + '%';
  paragraph('Progresso no período · ' + pct + (report.progress === null ? '' : ' em ' + report.progressDate), 12, true);
  paragraph((report.closed ? 'Entrega registrada' : 'Entrega prevista na posição atual') + ' · ' + date(report.forecast), 12);
  heading('Etapas concluídas no mês');
  if (!report.completed.length) paragraph('Nenhuma conclusão datada no período.');
  for (const row of report.completed) paragraph(date(row.date) + ' · ' + row.name);
  if (report.undatedCompletions) paragraph(report.undatedCompletions + ' etapa(s) concluída(s) em registros sem data de conclusão.');
  heading('Próximas etapas · cronograma atual');
  if (!report.upcoming.length) paragraph('Nenhuma etapa pendente registrada.');
  for (const row of report.upcoming) paragraph((row.date ? 'Início previsto ' + date(row.date) : 'Sem início previsto') + ' · ' + row.name);
  heading('Pendências do cliente · materiais');
  if (!report.materials.length) paragraph('Nenhum material pendente registrado.');
  for (const row of report.materials) paragraph(row.name + ' · ' + row.status +
    ' · Necessário em ' + date(row.requiredDate) + (row.promisedDate ? ' · Prometido para ' + date(row.promisedDate) : ''));
  heading('Pendências do cliente · aprovações');
  if (!report.approvals.length) paragraph('Nenhuma aprovação pendente registrada.');
  for (const row of report.approvals) paragraph(row.name + (row.date ? ' · Prazo ' + date(row.date) : ' · Sem prazo definido'));
  if (!photos.length) {
    heading('Fotos autorizadas do diário');
    paragraph('Nenhuma foto autorizada para este relatório.');
  }
  for (const photo of photos) {
    if (y < 405) newPage();
    heading('Fotos autorizadas do diário');
    const id = imageObject(photo.image);
    y -= placeImage(photo.image, id, LEFT, y, BODY_WIDTH, 274) + 13;
    paragraph(date(photo.date) + ' · ' + reportText(photo.caption));
  }

  for (let index = 0; index < pages.length; index++) {
    current = pages[index];
    text('Relatório de andamento · ' + report.period + '  |  ' + (index + 1) + '/' + pages.length, LEFT, 32, 9);
    const stream = current.ops.join('\n') + '\n';
    const pageObject = objects.length + 1;
    pageIds.push(pageObject + ' 0 R');
    objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PAGE_WIDTH + ' ' + PAGE_HEIGHT +
      '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ' + current.images.join(' ') +
      ' >> >> /Contents ' + (pageObject + 1) + ' 0 R >>',
    '<< /Length ' + stream.length + ' >>\nstream\n' + stream + 'endstream');
  }
  objects[1] = '<< /Type /Pages /Kids [' + pageIds.join(' ') + '] /Count ' + pageIds.length + ' >>';
  return createPdfDocument(objects);
}
