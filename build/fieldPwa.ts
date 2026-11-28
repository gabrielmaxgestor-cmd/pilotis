import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import type { Plugin } from 'vite';

function pngChunk(type: string, data: Buffer) {
  const body = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}

function createAppIcon(size: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  const stride = size * 3 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const x = column / size;
      const y = row / size;
      const stem = x >= 0.34 && x <= 0.43 && y >= 0.25 && y <= 0.72;
      const bowl = x >= 0.43 && x <= 0.65 && y >= 0.25 && y <= 0.52
        && (y <= 0.33 || y >= 0.44 || x >= 0.57);
      const line = x >= 0.33 && x <= 0.66 && y >= 0.76 && y <= 0.79;
      const color = stem || bowl ? 0xf6f5f2 : line ? 0xd5a85d : 0x1f3a5f;
      pixels.writeUIntBE(color, row * stride + 1 + column * 3, 3);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

export function createFieldWorker(assets: string[], version: string) {
  return `
const CACHE = 'pilotis-app-' + ${JSON.stringify(version)};
const ROOT = self.registration.scope;
const SHELL = new URL('index.html', ROOT).href;
const ASSETS = new Set(${JSON.stringify(assets)}.map(path => new URL(path, ROOT).href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...ASSETS].map(url => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('pilotis-app-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || !request.url.startsWith(ROOT) ||
      request.url.startsWith(new URL('api/', ROOT).href) ||
      new URL(request.url).pathname.replace(/\\/$/, '') === new URL('relatorio', ROOT).pathname) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const shell = await (await caches.open(CACHE)).match(SHELL);
        return shell || new Response('Conecte-se para abrir o Pilotis pela primeira vez.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })());
  } else if (ASSETS.has(request.url)) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match(request);
      return cached || fetch(request);
    })());
  }
});
`;
}

export function fieldPwa(): Plugin {
  return {
    name: 'pilotis-field-pwa',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const icons = [192, 512].map((size) => ({ fileName: 'pwa-' + size + '.png', source: createAppIcon(size) }));
      for (const icon of icons) this.emitFile({ type: 'asset', ...icon });
      const assets = [
        'index.html', 'manifest.webmanifest', ...icons.map((icon) => icon.fileName),
        ...Object.keys(bundle).filter((name) => /\.(?:js|css|woff2?)$/.test(name)),
      ];
      const unique = [...new Set(assets)].sort();
      const version = createHash('sha256').update(createFieldWorker(unique, '')).update(icons[1].source).digest('hex').slice(0, 16);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: createFieldWorker(unique, version) });
    },
  };
}
