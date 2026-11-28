import { auth } from '../lib/firebase';

export async function workReportRequest(projectId: string, path = '', body?: object) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Entre no Pilotis para acessar os relatórios.');
  const response = await fetch('/api/work-reports/projects/' + encodeURIComponent(projectId) + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error || 'Não foi possível acessar o relatório.');
  }
  return response;
}

export async function reportLogoJpeg(value?: string) {
  if (!value) return '';
  if (!/^data:image\/(?:png|webp|jpeg);base64,/.test(value)) throw new Error('Confira a logo em Configurações.');
  const image = new Image();
  image.src = value;
  await image.decode();
  const scale = Math.min(1, 240 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Não foi possível preparar a logo.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.88).split(',')[1];
}
