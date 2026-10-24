import { useSyncExternalStore } from 'react';

/** Estado do PWA: atualização pronta, instalação possível e conexão. Registro do service worker só em produção. */
interface State { updateReady: boolean; canInstall: boolean; installed: boolean; offline: boolean }
let state: State = { updateReady: false, canInstall: false, installed: false, offline: typeof navigator !== 'undefined' && navigator.onLine === false };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => { state = { ...state, ...p }; subs.forEach((f) => f()); };
export const usePwa = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state);

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
let waiting: ServiceWorker | null = null;

export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
/** iPhone/iPad não oferecem o aviso de instalação: o usuário usa Compartilhar > Adicionar à Tela de Início. */
export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function promptInstall() {
  if (!deferred) return false;
  await deferred.prompt();
  const r = await deferred.userChoice; deferred = null; set({ canInstall: false });
  return r.outcome === 'accepted';
}

export function applyUpdate() {
  if (!waiting) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  waiting.postMessage('SKIP_WAITING');
}

export function initPwa() {
  window.addEventListener('online', () => set({ offline: false }));
  window.addEventListener('offline', () => set({ offline: true }));
  set({ installed: isStandalone() });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; set({ canInstall: true }); });
  window.addEventListener('appinstalled', () => { deferred = null; set({ canInstall: false, installed: true }); });
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  navigator.serviceWorker.register('/sw.js').then((reg) => {
    const ready = (w: ServiceWorker | null) => { if (w && navigator.serviceWorker.controller) { waiting = w; set({ updateReady: true }); } };
    ready(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') ready(w); }); });
    const check = () => { reg.update().catch(() => undefined); };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60_000);
  }).catch(() => undefined);
}
