import { useState } from 'react';
import { Bot, ShieldCheck } from 'lucide-react';
import { Badge, ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { api } from '../../lib/api';
import { errMsg, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';

interface U { id: string; name: string; email: string; role: string; active: boolean; fullAccess: boolean; enabled: boolean; finance: boolean; stock: boolean; hr: boolean; hrSalary: boolean; messagesMonth: number }
interface Data { users: U[]; limits: { messagesPerDay: number; tokensPerMonth: number }; usage: { messagesToday: number; tokensMonth: number }; configured: boolean }
type Flag = 'enabled' | 'finance' | 'stock' | 'hr' | 'hrSalary';

const COLS: { key: Flag; label: string; hint: string }[] = [
  { key: 'finance', label: 'Financeiro', hint: 'Receitas, despesas, contas, fluxo de caixa, clientes e fornecedores' },
  { key: 'stock', label: 'Estoque', hint: 'Produtos, saldos e movimentações' },
  { key: 'hr', label: 'Pessoal', hint: 'Funcionários, cargos, departamentos e aniversariantes (sem CPF e documentos)' },
  { key: 'hrSalary', label: 'Salários', hint: 'Valores de salário e folha. Exige Pessoal liberado' },
];

export default function AiAccess() {
  const { data, loading, error, reload, setData } = useFetch<Data>('/ai/admin/access');
  const toast = useToast(); const [saving, setSaving] = useState<string | null>(null);

  const change = async (u: U, key: Flag, value: boolean) => {
    const next: U = { ...u, [key]: value };
    if (key === 'hr' && !value) next.hrSalary = false;
    if (key === 'hrSalary' && value) next.hr = true;
    if (key === 'enabled' && value && !(next.finance || next.stock || next.hr)) { next.finance = true; }   // ao ligar sem nenhuma área, começa pelo financeiro
    setSaving(u.id);
    setData((d) => (d ? { ...d, users: d.users.map((x) => (x.id === u.id ? next : x)) } : d));
    try { await api.put(`/ai/admin/access/${u.id}`, { enabled: next.enabled, finance: next.finance, stock: next.stock, hr: next.hr, hrSalary: next.hrSalary }); toast.success(`Acesso de ${u.name} atualizado.`); }
    catch (e) { toast.error(errMsg(e)); reload(); } finally { setSaving(null); }
  };

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  return (
    <div>
      <PageHeader title="Assistente de IA" subtitle="Defina quem pode usar o assistente e o que ele pode consultar para cada usuário. O administrador tem acesso total. Sem liberação, não há acesso." />
      {data && !data.configured && <div role="alert" className="mb-4 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">A chave do modelo (<code>GEMINI_API_KEY</code>) não está configurada neste ambiente: ninguém conseguirá usar o assistente até configurá-la.</div>}
      {data && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div className="card p-3 text-sm"><p className="text-xs text-muted-foreground">Perguntas hoje (todos)</p><p className="font-display text-xl font-bold">{data.usage.messagesToday}</p><p className="text-xs text-muted-foreground">Limite por usuário: {data.limits.messagesPerDay}/dia</p></div>
          <div className="card p-3 text-sm"><p className="text-xs text-muted-foreground">Tokens no mês</p><p className="font-display text-xl font-bold">{data.usage.tokensMonth.toLocaleString('pt-BR')}</p><p className="text-xs text-muted-foreground">Limite mensal: {data.limits.tokensPerMonth.toLocaleString('pt-BR')}</p></div>
          <div className="card p-3 text-sm"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5" />Proteção de dados</p><p className="mt-1 text-xs">CPF e documentos nunca são enviados ao modelo. Nome, nascimento e salário só quando liberados. Além desta liberação, vale a permissão do perfil do usuário em cada área.</p></div>
        </div>
      )}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left font-semibold">Usuário</th><th className="px-3 py-2 text-center font-semibold">Usar assistente</th>
            {COLS.map((c) => <th key={c.key} className="px-3 py-2 text-center font-semibold" title={c.hint}>{c.label}</th>)}
            <th className="px-3 py-2 text-right font-semibold">Perguntas no mês</th></tr></thead>
          <tbody>
            {loading && !data && <tr><td colSpan={7} className="p-4"><Skeleton className="h-24 w-full" /></td></tr>}
            {data?.users.map((u) => (
              <tr key={u.id} className={`border-t ${u.active ? '' : 'opacity-50'}`}>
                <td className="px-3 py-2"><p className="font-semibold">{u.name}</p><p className="text-xs text-muted-foreground">{u.email} · {u.role}</p></td>
                {u.fullAccess ? <td colSpan={5} className="px-3 py-2 text-center"><Badge tone="info"><Bot className="h-3 w-3" />Acesso total</Badge></td> : (
                  <>
                    <td className="px-3 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" aria-label={`Liberar assistente para ${u.name}`} checked={u.enabled} disabled={saving === u.id || !u.active} onChange={(e) => change(u, 'enabled', e.target.checked)} /></td>
                    {COLS.map((c) => <td key={c.key} className="px-3 py-2 text-center"><input type="checkbox" className="h-4 w-4 accent-[rgb(var(--primary))]" aria-label={`${c.label} para ${u.name}`} checked={u[c.key]} disabled={saving === u.id || !u.enabled || !u.active} onChange={(e) => change(u, c.key, e.target.checked)} /></td>)}
                  </>)}
                <td className="px-3 py-2 text-right tabular-nums">{u.messagesMonth}</td>
              </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
