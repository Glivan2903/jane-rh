import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Gera dist/sw.js a partir de src/sw.template.js com a lista de arquivos do build. A versão muda só quando os arquivos mudam. */
function serviceWorker(): Plugin {
  return {
    name: 'gentis-service-worker', apply: 'build',
    closeBundle() {
      const dist = resolve('dist');
      const assets = readdirSync(join(dist, 'assets')).filter((f) => /\.(js|css)$/.test(f)).sort().map((f) => `/assets/${f}`);
      const build = createHash('sha1').update(assets.join('|')).digest('hex').slice(0, 10);
      const sw = readFileSync(resolve('src/sw.template.js'), 'utf8').split('__BUILD__').join(build).split('__PRECACHE__').join(JSON.stringify(assets));
      if (sw.includes('__BUILD__') || sw.includes('__PRECACHE__')) throw new Error('service worker: marcadores de build não substituídos');
      writeFileSync(join(dist, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: { port: 5173, proxy: { '/api': process.env.API_URL ?? 'http://localhost:3001' } },
  build: { chunkSizeWarningLimit: 900 },
});
