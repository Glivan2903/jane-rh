import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellRing, CheckCircle2, Lightbulb, RefreshCw } from 'lucide-react';
import { Badge, Empty, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { errMsg, useAuth, useToast } from '../lib/app';
import { useFetch } from '../lib/hooks';
import { brl, dmyTime, num } from '../lib/format';

interface A { id: number; kind: string; area: 'fin' | 'est' | 'rh'; severity: 'atencao' | 'alerta'; title: string; detail: string; link: string | null; status: string; lastSeen: string; dismissedBy: string | null; dismissedAt: string | null }
const AREAS: Record<string, string> = { fin: 'Financeiro', est: 'Estoque', rh: 'Pessoal' };
const TABS = [['aberto', 'Para conferir'], ['dispensado', 'Dispensados'], ['resolvido', 'Resolvidos']] as const;

interface SItem { productId: string; code: string; name: string; unit: string; current: number; pending: number; min: number; suggested: number; unitCost: number }
interface Sug { id: string; title: string; detail: string; partyId: number | null; items: SItem[] }

/** Sugestão de reposição: a pessoa ajusta as quantidades e só então confirma. O pedido nasce como rascunho e nada é enviado ao fornecedor. */
function SuggestionCard({ s, canAct, onDone }: { s: Sug; canAct: boolean; onDone: () => void }) {
  const toast = useToast(); const nav = useNavigate();
  const { data: suppliers } = useFetch<{ id: number; name: string }[]>(s.partyId ? null : '/cad/parties/options', { kind: 'supplier' });
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(s.items.map((i) => [i.productId, String(i.suggested)])));
  const [off, setOff] = useState<Set<string>>(new Set()); const [party, setParty] = useState(s.partyId ? String(s.partyId) : ''); const [busy, setBusy] = useState(false);
  const chosen = s.items.filter((i) => !off.has(i.productId) && Number(qty[i.productId].replace(',', '.')) > 0);
  const total = chosen.reduce((t, i) => t + Number(qty[i.productId].replace(',', '.')) * i.unitCost, 0);
  const confirm = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ id: number; number: string }>('/suggestions/purchase-order/confirm', { partyId: Number(party), items: chosen.map((i) => ({ productId: i.productId, quantity: Number(qty[i.productId].replace(',', '.')), unitCost: i.unitCost })) });
      toast.success(`Pedido ${r.number} criado como rascunho.`); onDone(); nav('/estoque/pedidos');
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card border-l-4 border-l-primary p-3 sm:p-4" aria-label={s.title}>
      <div className="flex flex-wrap items-center gap-2"><Badge tone="success">Sugestão</Badge><Badge>Estoque</Badge><h2 className="font-semibold">{s.title}</h2></div>
      <p className="mt-1 text-sm text-muted-foreground">{s.detail}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm"><thead className="bg-muted text-left text-xs"><tr><th className="w-8 px-3 py-2" /><th className="px-3 py-2">Produto</th><th className="px-3 py-2 text-right">Saldo</th><th className="px-3 py-2 text-right">Mínimo</th><th className="px-3 py-2 text-right">Em pedido</th><th className="w-28 px-3 py-2 text-right">Pedir</th></tr></thead>
          <tbody>{s.items.map((i) => (
            <tr key={i.productId} className="border-t border-border">
              <td className="px-3 py-1.5"><input type="checkbox" aria-label={`Incluir ${i.name}`} checked={!off.has(i.productId)} disabled={!canAct} onChange={(e) => { const n = new Set(off); e.target.checked ? n.delete(i.productId) : n.add(i.productId); setOff(n); }} /></td>
              <td className="px-3 py-1.5"><span className="font-medium">{i.name}</span> <span className="text-xs text-muted-foreground">{i.code}</span></td>
              <td className="px-3 py-1.5 text-right">{num(i.current)} {i.unit}</td><td className="px-3 py-1.5 text-right">{num(i.min)}</td><td className="px-3 py-1.5 text-right">{num(i.pending)}</td>
              <td className="px-3 py-1.5 text-right"><input className="input w-24 text-right" inputMode="decimal" aria-label={`Quantidade de ${i.name}`} value={qty[i.productId]} disabled={!canAct || off.has(i.productId)} onChange={(e) => setQty({ ...qty, [i.productId]: e.target.value })} /></td>
            </tr>))}</tbody></table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {!s.partyId && (
          <label className="text-sm"><span className="font-medium">Fornecedor</span>
            <select className="input mt-1 min-w-[14rem]" value={party} onChange={(e) => setParty(e.target.value)} disabled={!canAct}><option value="">Selecione…</option>{suppliers?.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>)}
        <p className="text-sm text-muted-foreground">{chosen.length} item(ns) · estimado {brl(total)}</p>
        {canAct ? <button type="button" className="btn-primary ml-auto" disabled={busy || !chosen.length || !party} onClick={confirm}>{busy ? 'Criando…' : 'Criar pedido (rascunho)'}</button>
          : <p className="ml-auto text-xs text-muted-foreground">Você não tem permissão para criar pedidos.</p>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Nada é enviado ao fornecedor. O rascunho fica em Pedidos de compra para você revisar e enviar.</p>
    </section>
  );
}

export default function Alerts() {
  const { can } = useAuth(); const toast = useToast();
  const [status, setStatus] = useState<string>('aberto'); const [area, setArea] = useState(''); const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useFetch<{ rows: A[]; areas: string[]; lastScan: string | null }>('/anomalies', { status, ...(area ? { area } : {}) });
  const sug = useFetch<{ rows: Sug[]; can: { purchase_order: boolean } }>('/suggestions');
  const act = async (id: number, what: 'dismiss' | 'reopen') => {
    try { await api.post(`/anomalies/${id}/${what}`); toast.success(what === 'dismiss' ? 'Alerta dispensado.' : 'Alerta reaberto.'); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const scan = async () => {
    setBusy(true);
    try { const r = await api.post<{ abertos: number; novos: number }>('/anomalies/scan'); toast.success(r.novos ? `${r.novos} alerta(s) novo(s).` : 'Verificação concluída, nada de novo.'); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title="Alertas" subtitle="Valores e movimentos fora do padrão e sugestões de ação" icon={BellRing}
        actions={can('cfg.settings') ? <button type="button" className="btn-outline" onClick={scan} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Verificar agora</button> : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={status === k ? 'btn-primary' : 'btn-outline'}>{l}</button>)}
        {(data?.areas.length ?? 0) > 1 && (
          <select className="input ml-auto w-auto" aria-label="Área" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas as áreas</option>{data!.areas.map((a) => <option key={a} value={a}>{AREAS[a]}</option>)}
          </select>)}
      </div>
      {status === 'aberto' && !!sug.data?.rows.length && (
        <div className="mb-4 space-y-3">
          <h2 className="flex items-center gap-2 font-display text-base font-bold"><Lightbulb className="h-4 w-4 text-primary" />Sugestões para você</h2>
          {sug.data.rows.map((x) => <SuggestionCard key={x.id} s={x} canAct={sug.data!.can.purchase_order} onDone={sug.reload} />)}
        </div>)}
      {loading && !data ? <div className="card p-6"><Spinner /></div> : error ? <p role="alert" className="text-danger">{error}</p> : !data?.rows.length ? (
        <div className="card"><Empty icon={CheckCircle2} title={status === 'aberto' ? 'Nada fora do padrão por enquanto' : 'Nenhum alerta aqui'} hint={status === 'aberto' ? 'Os valores e movimentos estão dentro do esperado. A verificação roda sozinha de tempos em tempos.' : undefined} /></div>
      ) : (
        <ul className="space-y-2">
          {data.rows.map((a) => (
            <li key={a.id} className={`card flex flex-col gap-2 border-l-4 p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4 ${a.severity === 'alerta' ? 'border-l-danger' : 'border-l-warning'}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2"><Badge tone={a.severity === 'alerta' ? 'danger' : 'warning'}>{a.severity === 'alerta' ? 'Alerta' : 'Atenção'}</Badge><Badge>{AREAS[a.area]}</Badge><h2 className="font-semibold">{a.title}</h2></div>
                <p className="mt-1 text-sm text-muted-foreground">{a.detail}</p>
                <p className="mt-1 text-xs text-muted-foreground">{a.status === 'dispensado' && a.dismissedBy ? `Dispensado por ${a.dismissedBy} em ${dmyTime(a.dismissedAt)}` : `Visto em ${dmyTime(a.lastSeen)}`}</p>
              </div>
              <div className="flex shrink-0 gap-2">
                {a.link && <Link className="btn-outline" to={a.link}>Ver</Link>}
                {a.status === 'aberto' && <button type="button" className="btn-outline" onClick={() => act(a.id, 'dismiss')}>Dispensar</button>}
                {a.status === 'dispensado' && <button type="button" className="btn-outline" onClick={() => act(a.id, 'reopen')}>Reabrir</button>}
              </div>
            </li>))}
        </ul>)}
      {data?.lastScan && <p className="mt-3 text-xs text-muted-foreground">Última verificação: {dmyTime(data.lastScan)}</p>}
    </div>
  );
}
