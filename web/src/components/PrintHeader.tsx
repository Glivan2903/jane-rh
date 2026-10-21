import { Brand } from './brand';
import { useAuth } from '../lib/app';
import { companyAddress, logoUrl, useCompany } from '../lib/company';
import { fmtCnpj } from '../lib/format';

/** Cabeçalho e rodapé que só aparecem na impressão (relatórios e documentos). */
export function PrintHeader({ title, details }: { title: string; details?: string[] }) {
  const c = useCompany(); const { me } = useAuth();
  const logo = logoUrl(c);
  const name = c?.tradeName || c?.legalName;
  const now = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
  return (
    <>
      <div className="print-only print-header">
        <div className="flex items-center justify-between gap-6 border-b-2 border-black pb-3">
          <div className="flex items-center gap-4">
            {logo ? <img src={logo} alt="" className="max-h-16 max-w-[180px] object-contain" /> : <Brand />}
            <div className="leading-snug">
              <p className="text-lg font-bold">{name || 'Empresa não configurada'}</p>
              {c?.tradeName && c.legalName && c.tradeName !== c.legalName && <p className="text-xs">{c.legalName}</p>}
              <p className="text-xs">{[c?.cnpj && `CNPJ ${fmtCnpj(c.cnpj)}`, c?.stateRegistration && `IE ${c.stateRegistration}`].filter(Boolean).join(' · ')}</p>
              <p className="text-xs">{companyAddress(c)}</p>
              <p className="text-xs">{[c?.phone, c?.email, c?.website].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
          <div className="text-right text-xs leading-snug">
            <p>Emitido em {now}</p>
            <p>por {me?.name}</p>
          </div>
        </div>
        <div className="mb-3 mt-3">
          <h1 className="text-base font-bold uppercase tracking-wide">{title}</h1>
          {details?.filter(Boolean).map((d, i) => <p key={i} className="text-xs">{d}</p>)}
        </div>
      </div>
      <div className="print-only print-footer">{name ? `${name} · ` : ''}Relatório gerado pelo sistema Gentis em {now}</div>
    </>
  );
}
