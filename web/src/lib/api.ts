export class ApiError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); }
}

type Q = Record<string, string | number | boolean | undefined | null>;
export const qs = (q?: Q) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q ?? {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

let onUnauthorized: (() => void) | null = null;
export const setUnauthorizedHandler = (fn: () => void) => { onUnauthorized = fn; };

async function request<T>(method: string, url: string, body?: unknown, form?: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api' + url, {
      method, credentials: 'same-origin',
      headers: { 'X-Requested-With': 'gentis', ...(form ? {} : { 'Content-Type': 'application/json' }) },
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/login')) onUnauthorized?.();
    throw new ApiError(res.status, data?.error ?? 'Erro inesperado. Tente novamente.', data?.fields);
  }
  return data as T;
}

export const api = {
  get: <T,>(url: string, q?: Q) => request<T>('GET', url + qs(q)),
  post: <T,>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T,>(url: string, body: unknown) => request<T>('PUT', url, body),
  del: <T,>(url: string) => request<T>('DELETE', url),
  upload: <T,>(url: string, form: FormData) => request<T>('POST', url, undefined, form),
  /** Download autenticado (CSV, backup, anexos). */
  async download(url: string, q?: Q, fallbackName = 'arquivo') {
    const res = await fetch('/api' + url + qs(q), { credentials: 'same-origin', headers: { 'X-Requested-With': 'gentis' } });
    if (!res.ok) { const d = await res.json().catch(() => null); throw new ApiError(res.status, d?.error ?? 'Falha ao baixar o arquivo.'); }
    const blob = await res.blob();
    const cd = res.headers.get('content-disposition') ?? '';
    const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? fallbackName;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = decodeURIComponent(name); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
};

export interface Page<T> { rows: T[]; total: number; page: number; pageSize: number; sum?: string }
