import { useEffect, useRef, useState } from 'react';
import { Building, ImagePlus, Trash2 } from 'lucide-react';
import { ErrorBox, PageHeader, Spinner } from '../../components/ui';
import { FInput, FSelect, Section, SubmitButton } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useConfirm, useToast } from '../../lib/app';
import { useForm } from '../../lib/hooks';
import { logoUrl, refreshCompany, useCompany, type Company as C } from '../../lib/company';
import { maskCep, maskCnpj, maskPhone, onlyDigits, validCnpj } from '../../lib/format';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const FIELDS = ['legalName', 'tradeName', 'cnpj', 'stateRegistration', 'zip', 'street', 'number', 'complement', 'district', 'city', 'state', 'phone', 'email', 'website'] as const;

export default function Company() {
  const c = useCompany(); const toast = useToast(); const confirm = useConfirm();
  const f = useForm(Object.fromEntries(FIELDS.map((k) => [k, ''])) as Record<(typeof FIELDS)[number], string>);
  const [loaded, setLoaded] = useState(false); const [up, setUp] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!c || loaded) return;
    f.setV(Object.fromEntries(FIELDS.map((k) => [k, k === 'cnpj' ? maskCnpj(String(c[k] ?? '')) : k === 'zip' ? maskCep(String(c[k] ?? '')) : String((c as C)[k] ?? '')])) as typeof f.v);
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c]);

  const lookupCep = async () => {
    const z = onlyDigits(f.v.zip); if (z.length !== 8) return;
    try { const d = await (await fetch(`https://viacep.com.br/ws/${z}/json/`)).json(); if (!d.erro) f.setV((s) => ({ ...s, street: s.street || d.logradouro || '', district: s.district || d.bairro || '', city: s.city || d.localidade || '', state: s.state || d.uf || '' })); } catch { /* manual */ }
  };

  const sendLogo = async () => {
    const fl = file.current?.files?.[0]; if (!fl) return;
    if (fl.size > 1024 * 1024) { toast.error('A imagem deve ter até 1 MB.'); return; }
    setUp(true);
    try { const fd = new FormData(); fd.append('file', fl); await api.upload('/company/logo', fd); await refreshCompany(); toast.success('Logotipo atualizado.'); }
    catch (e) { toast.error(errMsg(e)); } finally { setUp(false); if (file.current) file.current.value = ''; }
  };
  const removeLogo = async () => {
    if (!(await confirm({ title: 'Remover logotipo?', message: 'Os relatórios passarão a usar o logotipo do sistema.', confirmLabel: 'Remover', danger: true }))) return;
    try { await api.del('/company/logo'); await refreshCompany(); toast.success('Logotipo removido.'); } catch (e) { toast.error(errMsg(e)); }
  };

  if (!c) return <div className="p-10 text-center"><Spinner className="mx-auto h-6 w-6" /></div>;
  const logo = logoUrl(c);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Dados da empresa" subtitle="Usados no cabeçalho dos relatórios impressos e em outros documentos." />
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <section className="card h-fit p-5">
          <h2 className="mb-3 font-display text-sm font-bold text-primary">Logotipo</h2>
          <div className="flex h-36 items-center justify-center rounded-xl border border-dashed bg-muted/40 p-3">
            {logo ? <img src={logo} alt="Logotipo da empresa" className="max-h-full max-w-full object-contain" /> : <div className="text-center text-xs text-muted-foreground"><Building className="mx-auto mb-1 h-8 w-8" />Nenhum logotipo</div>}
          </div>
          <input ref={file} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={sendLogo} aria-label="Arquivo do logotipo" />
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn-outline flex-1" onClick={() => file.current?.click()} disabled={up}>{up ? <Spinner /> : <ImagePlus className="h-4 w-4" />}{logo ? 'Trocar' : 'Enviar'}</button>
            {logo && <button type="button" className="btn-outline text-danger" onClick={removeLogo} aria-label="Remover logotipo"><Trash2 className="h-4 w-4" /></button>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">PNG, JPG ou WEBP, até 1 MB. Prefira fundo transparente.</p>
        </section>
        <form className="card p-5" noValidate onSubmit={async (e) => {
          e.preventDefault();
          const ok = await f.submit(() => api.put('/company', { ...f.v, cnpj: onlyDigits(f.v.cnpj), zip: onlyDigits(f.v.zip) }), () => ({
            ...(!f.v.legalName.trim() ? { legalName: 'Informe a razão social' } : {}),
            ...(f.v.cnpj && !validCnpj(f.v.cnpj) ? { cnpj: 'CNPJ inválido' } : {}),
            ...(f.v.email && !/^\S+@\S+\.\S+$/.test(f.v.email) ? { email: 'E-mail inválido' } : {}),
            ...(f.v.zip && onlyDigits(f.v.zip).length !== 8 ? { zip: 'CEP deve ter 8 dígitos' } : {}),
          }));
          if (ok) { await refreshCompany(); toast.success('Dados da empresa salvos.'); }
        }}>
          <Section title="Identificação">
            <FInput f={f} name="legalName" label="Razão social" required className="lg:col-span-2" />
            <FInput f={f} name="cnpj" label="CNPJ" mask={maskCnpj} placeholder="00.000.000/0000-00" />
            <FInput f={f} name="tradeName" label="Nome fantasia" className="lg:col-span-2" />
            <FInput f={f} name="stateRegistration" label="Inscrição estadual" />
          </Section>
          <Section title="Endereço">
            <div onBlur={lookupCep}><FInput f={f} name="zip" label="CEP" mask={maskCep} placeholder="00000-000" /></div>
            <FInput f={f} name="street" label="Logradouro" className="lg:col-span-2" />
            <FInput f={f} name="number" label="Número" /><FInput f={f} name="complement" label="Complemento" /><FInput f={f} name="district" label="Bairro" />
            <FInput f={f} name="city" label="Cidade" />
            <FSelect f={f} name="state" label="Estado" placeholder="UF" options={UFS.map((u) => ({ value: u, label: u }))} />
          </Section>
          <Section title="Contato">
            <FInput f={f} name="phone" label="Telefone" mask={maskPhone} />
            <FInput f={f} name="email" label="E-mail" type="email" />
            <FInput f={f} name="website" label="Site" placeholder="www.suaempresa.com.br" />
          </Section>
          <div className="flex justify-end border-t pt-4"><SubmitButton busy={f.busy}>Salvar dados da empresa</SubmitButton></div>
        </form>
      </div>
    </div>
  );
}
