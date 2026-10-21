import { useEffect, useState } from 'react';
import { Bell, Boxes } from 'lucide-react';
import { PageHeader, Spinner } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { errMsg, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';

interface Prefs {
  allow_negative_stock: boolean;
  notify_bills_enabled: boolean; notify_bills_days: number; notify_overdue_enabled: boolean; notify_receivables: boolean;
  notify_stock_enabled: boolean; notify_refresh_minutes: number; upcoming_list_size: number;
}

const Check = ({ checked, onChange, title, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; hint: string; disabled?: boolean }) => (
  <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}>
    <input type="checkbox" disabled={disabled} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--primary))]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span><b className="text-sm">{title}</b><span className="block text-xs text-muted-foreground sm:text-sm">{hint}</span></span>
  </label>
);

const Num = ({ label, hint, value, onChange, min, max, suffix, error }: { label: string; hint: string; value: number; onChange: (n: number) => void; min: number; max: number; suffix: string; error?: string }) => (
  <label className="block">
    <span className="mb-1 block text-xs font-semibold">{label}</span>
    <span className="flex items-center gap-2"><input type="number" className="input !w-24" min={min} max={max} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))} /><span className="text-sm text-muted-foreground">{suffix}</span></span>
    <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
    {error && <span role="alert" className="mt-1 block text-xs text-danger">{error}</span>}
  </label>
);

export default function Settings() {
  const { data, loading, reload } = useFetch<Prefs>('/config/settings');
  const [f, setF] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false); const [errs, setErrs] = useState<Record<string, string>>({}); const toast = useToast();
  useEffect(() => { if (data) setF(data); }, [data]);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setF((s) => (s ? { ...s, [k]: v } : s));
  const save = async () => {
    if (!f) return;
    setBusy(true); setErrs({});
    try { await api.put('/config/settings', f); toast.success('Parâmetros salvos. Os avisos já usam as novas regras.'); reload(); }
    catch (e) { toast.error(errMsg(e)); if (e instanceof ApiError && e.fields) setErrs(e.fields); } finally { setBusy(false); }
  };
  return (
    <div className="w-full max-w-3xl">
      <PageHeader title="Parâmetros do sistema" subtitle="Personalize avisos, notificações e o comportamento do estoque." />
      {loading || !f ? <div className="card p-6"><Spinner /></div> : (
        <div className="space-y-4">
          <section className="card space-y-4 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-bold"><Bell className="h-4 w-4 text-primary" />Avisos e notificações</h2>
            <Check checked={f.notify_bills_enabled} onChange={(v) => set('notify_bills_enabled', v)} title="Avisar contas próximas do vencimento" hint="Exibe no sino as contas pendentes que vencem dentro da antecedência escolhida." />
            <div className="grid gap-4 pl-7 sm:grid-cols-2">
              <Num label="Antecedência do aviso" suffix="dia(s) antes do vencimento" min={0} max={90} value={f.notify_bills_days} onChange={(n) => set('notify_bills_days', n)} error={errs.notify_bills_days}
                hint="Também é o período padrão da lista “Próximas contas” no Dashboard. Use 0 para avisar só no dia." />
              <Num label="Itens na lista do Dashboard" suffix="contas" min={3} max={30} value={f.upcoming_list_size} onChange={(n) => set('upcoming_list_size', n)} error={errs.upcoming_list_size}
                hint="Quantidade máxima de contas exibidas em “Próximas contas”." />
            </div>
            <Check checked={f.notify_overdue_enabled} onChange={(v) => set('notify_overdue_enabled', v)} title="Avisar contas vencidas" hint="Mostra no sino o total de contas pendentes com vencimento já passado." />
            <Check checked={f.notify_receivables} onChange={(v) => set('notify_receivables', v)} title="Incluir contas a receber nos avisos" hint="Por padrão os avisos consideram só contas a pagar. Ative para avisar também recebimentos a vencer e vencidos." />
            <Check checked={f.notify_stock_enabled} onChange={(v) => set('notify_stock_enabled', v)} title="Avisar estoque baixo ou zerado" hint="Exibe no sino produtos abaixo do estoque mínimo e sem estoque." />
            <Num label="Atualização das notificações" suffix="minuto(s)" min={1} max={60} value={f.notify_refresh_minutes} onChange={(n) => set('notify_refresh_minutes', n)} error={errs.notify_refresh_minutes}
              hint="De quanto em quanto tempo o sino consulta novos avisos." />
          </section>
          <section className="card space-y-4 p-4 sm:p-5">
            <h2 className="flex items-center gap-2 font-display text-base font-bold"><Boxes className="h-4 w-4 text-primary" />Estoque</h2>
            <Check checked={f.allow_negative_stock} onChange={(v) => set('allow_negative_stock', v)} title="Permitir saldo de estoque negativo" hint="Por padrão, saídas e ajustes maiores que o saldo disponível são bloqueados (no servidor e no banco). Ative somente se necessário." />
          </section>
          <div className="flex justify-end"><button className="btn-primary" onClick={save} disabled={busy || Object.values(f).some((v) => typeof v === 'number' && !Number.isFinite(v))}>{busy && <Spinner />}Salvar parâmetros</button></div>
        </div>
      )}
    </div>
  );
}
