/*
 * Service worker do Gentis. Gerado no build (vite.config.ts): a versão e a lista de arquivos entram nas duas constantes abaixo.
 * Regras de segurança: NUNCA guarda respostas da API (dados e sessão); guarda só os arquivos do aplicativo.
 */
const BUILD = '__BUILD__';
const CACHE = `gentis-${BUILD}`;
const PRECACHE = __PRECACHE__;
const SHELL = ['/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  // Não chama skipWaiting sozinho: a versão nova espera o usuário confirmar ("Atualizar") para não trocar o app no meio de um preenchimento.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([...SHELL, ...PRECACHE])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gentis-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== self.location.origin && !fonts) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;       // API e o próprio SW: sempre direto na rede

  // Navegação (SPA): rede primeiro, para sempre pegar o index mais novo; sem rede, usa o index guardado.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(CACHE)).put('/', res.clone());
        return res;
      } catch { return (await caches.match('/')) ?? new Response('Sem conexão.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
    })());
    return;
  }
  // Arquivos com hash no nome (/assets): nunca mudam, então cache primeiro.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })());
    return;
  }
  // Ícones, manifesto e fontes: usa o guardado e atualiza em segundo plano.
  event.respondWith((async () => {
    const hit = await caches.match(req);
    const fresh = fetch(req).then(async (res) => { if (res.ok || res.type === 'opaque') (await caches.open(CACHE)).put(req, res.clone()); return res; }).catch(() => undefined);
    return hit ?? (await fresh) ?? new Response('', { status: 504 });
  })());
});
