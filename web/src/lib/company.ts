import { useEffect, useState } from 'react';
import { api } from './api';

export interface Company {
  legalName?: string; tradeName?: string | null; cnpj?: string | null; stateRegistration?: string | null;
  zip?: string | null; street?: string | null; number?: string | null; complement?: string | null; district?: string | null; city?: string | null; state?: string | null;
  phone?: string | null; email?: string | null; website?: string | null; logoVersion?: number | null;
}

// Cache simples compartilhado entre telas; `refreshCompany()` avisa quem estiver usando.
let cache: Company | null = null;
let pending: Promise<Company> | null = null;
const subs = new Set<(c: Company) => void>();

export function refreshCompany() {
  pending = api.get<Company>('/company').then((c) => { cache = c; subs.forEach((f) => f(c)); return c; }).finally(() => { pending = null; });
  return pending;
}

export function useCompany() {
  const [c, setC] = useState<Company | null>(cache);
  useEffect(() => {
    subs.add(setC);
    if (!cache) (pending ?? refreshCompany()).catch(() => {});
    return () => { subs.delete(setC); };
  }, []);
  return c;
}

export const logoUrl = (c: Company | null) => (c?.logoVersion ? `/api/company/logo?v=${c.logoVersion}` : null);

export function companyAddress(c: Company | null) {
  if (!c) return '';
  const l1 = [c.street, c.number, c.complement].filter(Boolean).join(', ');
  const l2 = [c.district, [c.city, c.state].filter(Boolean).join('/')].filter(Boolean).join(' · ');
  const cep = c.zip ? `CEP ${c.zip.replace(/(\d{5})(\d{3})/, '$1-$2')}` : '';
  return [l1, l2, cep].filter(Boolean).join(' — ');
}
