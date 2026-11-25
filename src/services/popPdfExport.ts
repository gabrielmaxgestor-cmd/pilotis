import { createPopPdf, type PdfLogo } from '../domain/popPdf';
import { planningTodayISO } from '../domain';
import type { CompanySettings, Pop } from '../types/pilotis';

async function readLogo(settings: CompanySettings | null): Promise<PdfLogo | undefined> {
  if (!settings?.logoDataUrl || settings.pdfShowLogo === false) return undefined;
  const image = new Image();
  image.src = settings.logoDataUrl;
  await image.decode();
  const scale = Math.min(1, 440 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a logo do PDF.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
  if (!jpeg) throw new Error('Não foi possível converter a logo.');
  return { bytes: new Uint8Array(await jpeg.arrayBuffer()), width: canvas.width, height: canvas.height };
}

export async function downloadPopPdf(pop: Pop, settings: CompanySettings | null) {
  const logo = await readLogo(settings);
  const pdf = createPopPdf(pop, settings, planningTodayISO(), logo);
  const url = URL.createObjectURL(new Blob([pdf.slice().buffer as ArrayBuffer], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'POP-' + pop.title.replace(/[^\p{L}\p{N} -]/gu, '').trim().slice(0, 55).replace(/\s+/g, '-') + '-' + pop.version + '.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
