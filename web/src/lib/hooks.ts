import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Page } from './api';
import { errMsg, useToast } from './app';
import { useDebounced, type ListState } from '../components/ui';

type Params = Record<string, string | number | boolean | undefined | null>;

/** Listagem paginada no servidor com pesquisa (debounce), ordenação e filtros. */
export function useList<T>(url: string, opts: { sort?: string; dir?: 'asc' | 'desc'; filters?: Params; pageSize?: number; enabled?: boolean } = {}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(opts.pageSize ?? 20);
  const [sort, setSort] = useState(opts.sort ?? '');
  const [dir, setDir] = useState<'asc' | 'desc'>(opts.dir ?? 'asc');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [data, setData] = useState<Page<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const filtersKey = JSON.stringify(opts.filters ?? {});
  const seq = useRef(0);

  useEffect(() => { setPage(1); }, [dq, filtersKey, pageSize]);

  const load = useCallback(async () => {
    if (opts.enabled === false) return;
    const my = ++seq.current;
    setLoading(true);
    try {
      const r = await api.get<Page<T>>(url, { ...(opts.filters ?? {}), q: dq, page, pageSize, sort, dir });
      if (my === seq.current) { setData(r); setError(null); }
    } catch (e) { if (my === seq.current) setError(errMsg(e)); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, dq, page, pageSize, sort, dir, filtersKey, opts.enabled]);
  useEffect(() => { load(); }, [load]);

  const list: ListState = {
    page, pageSize, sort, dir, total: data?.total ?? 0, setPage, setPageSize,
    toggleSort: (k) => { if (sort === k) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(k); setDir('asc'); } },
  };
  return { rows: data?.rows ?? [], loading, error, list, q, setQ, reload: load, extra: data };
}

/** Carrega um recurso simples. */
export function useFetch<T>(url: string | null, params?: Params) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const key = url + JSON.stringify(params ?? {});
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current; setLoading(true);
    try { const r = await api.get<T>(url, params); if (my === seq.current) { setData(r); setError(null); } }
    catch (e) { if (my === seq.current) setError(errMsg(e)); }
    finally { if (my === seq.current) setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);
  return { data, loading, error, reload: load, setData };
}

/** Estado de formulário: valores, erros por campo (cliente e servidor) e proteção contra envio duplicado. */
export function useForm<T extends Record<string, unknown>>(initial: T) {
  const [v, setV] = useState<T>(initial);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const lock = useRef(false);
  const set = <K extends keyof T>(k: K, val: T[K]) => { setV((s) => ({ ...s, [k]: val })); setErr((e) => { if (!e[k as string]) return e; const { [k as string]: _, ...rest } = e; return rest; }); };

  /** Executa `fn`; erros 422/409 do servidor são mapeados para os campos. Retorna true em caso de sucesso. */
  const submit = async (fn: () => Promise<unknown>, validate?: () => Record<string, string | undefined>) => {
    if (lock.current) return false;
    const clientErrors = Object.fromEntries(Object.entries(validate?.() ?? {}).filter(([, v]) => !!v)) as Record<string, string>;
    if (Object.keys(clientErrors).length) { setErr(clientErrors); toast.warning('Corrija os campos destacados.'); return false; }
    lock.current = true; setBusy(true);
    try { await fn(); return true; }
    catch (e) {
      if (e instanceof ApiError && e.fields) setErr(e.fields);
      toast.error(errMsg(e));
      return false;
    } finally { lock.current = false; setBusy(false); }
  };
  return { v, setV, set, err, setErr, busy, submit };
}
export type FormApi<T extends Record<string, unknown>> = ReturnType<typeof useForm<T>>;
