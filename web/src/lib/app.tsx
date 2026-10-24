import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import gsap from 'gsap';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { api, setUnauthorizedHandler, ApiError } from './api';
import { Modal } from '../components/ui';

// ---------- Auth ----------
export interface Me { id: string; name: string; email: string; role: string; permissions: string[]; mustChangePassword: boolean }
interface AuthCtx { me: Me | null; loading: boolean; netError: boolean; login: (l: string, p: string) => Promise<Me>; logout: () => Promise<void>; refresh: () => Promise<void>; setup: (d: SetupData) => Promise<Me>; can: (...p: string[]) => boolean }
export interface SetupData { name: string; email: string; password: string; confirm: string; token?: string }
const Auth = createContext<AuthCtx>(null as never);
export const useAuth = () => useContext(Auth);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [netError, setNetError] = useState(false);
  // Sem internet não é o mesmo que sessão expirada: nesse caso não manda para o login, avisa e tenta de novo quando a conexão voltar.
  const refresh = useCallback(async () => {
    try { setMe(await api.get<Me>('/auth/me')); setNetError(false); }
    catch (e) { if (e instanceof ApiError && e.status === 0) setNetError(true); else { setMe(null); setNetError(false); } }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { setUnauthorizedHandler(() => setMe(null)); refresh(); window.addEventListener('online', refresh); return () => window.removeEventListener('online', refresh); }, [refresh]);
  // Na tela de "sem conexão", tenta de novo sozinho: o evento "online" pode chegar antes de a rede estar realmente pronta.
  useEffect(() => { if (!netError) return; const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [netError, refresh]);
  const value = useMemo<AuthCtx>(() => ({
    me, loading, netError, refresh,
    login: async (login, password) => { const u = await api.post<Me>('/auth/login', { login, password }); setMe(u); return u; },
    setup: async (d) => { const u = await api.post<Me>('/auth/setup', d); setMe(u); return u; },
    logout: async () => { try { await api.post('/auth/logout'); } finally { setMe(null); } },
    can: (...p) => !!me && p.some((x) => me.permissions.includes(x)),
  }), [me, loading, netError, refresh]);
  return <Auth.Provider value={value}>{children}</Auth.Provider>;
}

// ---------- Toasts ----------
type Kind = 'success' | 'error' | 'warning' | 'info';
interface T { id: number; kind: Kind; text: string }
const ToastCtx = createContext<{ push: (k: Kind, t: string) => void }>({ push: () => {} });
export const useToast = () => {
  const { push } = useContext(ToastCtx);
  return useMemo(() => ({ success: (t: string) => push('success', t), error: (t: string) => push('error', t), warning: (t: string) => push('warning', t), info: (t: string) => push('info', t) }), [push]);
};
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : 'Erro inesperado.');

const ICON = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const COLOR = { success: 'text-success', error: 'text-danger', warning: 'text-warning', info: 'text-info' };

function ToastItem({ t, onDone }: { t: T; onDone: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const Icon = ICON[t.kind];
  useEffect(() => {
    const el = ref.current!;
    gsap.fromTo(el, { x: 40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out' });
    const timer = setTimeout(() => gsap.to(el, { x: 40, opacity: 0, duration: 0.25, onComplete: onDone }), t.kind === 'error' ? 6500 : 3800);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div ref={ref} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex items-start gap-3 rounded-xl border bg-card p-3 pr-4 shadow-lg">
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${COLOR[t.kind]}`} />
      <p className="text-sm">{t.text}</p>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const id = useRef(0);
  const push = useCallback((kind: Kind, text: string) => setItems((l) => [...l.slice(-3), { id: ++id.current, kind, text }]), []);
  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div data-toast className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,380px)] flex-col gap-2">
        {items.map((t) => <ToastItem key={t.id} t={t} onDone={() => setItems((l) => l.filter((x) => x.id !== t.id))} />)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Confirmação ----------
interface ConfirmOpts { title: string; message?: ReactNode; confirmLabel?: string; danger?: boolean }
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [st, setSt] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setSt({ ...o, resolve })), []);
  const close = (v: boolean) => { st?.resolve(v); setSt(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {st && (
        <Modal title={st.title} onClose={() => close(false)} size="sm"
          footer={<>
            <button className="btn-outline" onClick={() => close(false)}>Cancelar</button>
            <button autoFocus className={st.danger ? 'btn-danger' : 'btn-primary'} onClick={() => close(true)}>{st.confirmLabel ?? 'Confirmar'}</button>
          </>}>
          <div className="text-sm text-muted-foreground">{st.message}</div>
        </Modal>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---------- Tema ----------
export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark; setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try { localStorage.setItem('gentis-theme', next ? 'dark' : 'light'); } catch { /* ignore */ }
  };
  return { dark, toggle };
}
