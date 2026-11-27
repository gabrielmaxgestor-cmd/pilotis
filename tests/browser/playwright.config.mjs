import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: '.',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'npm exec -- vite --host 127.0.0.1 --port 4173 --strictPort',
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    url: 'http://127.0.0.1:4173/tests/browser/index.html',
  },
});
