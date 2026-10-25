import { useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge, Empty, PageHeader, Spinner } from '../components/ui';
import { api } from '../lib/api';
import { errMsg, useAuth, useToast } from '../lib/app';
import { useFetch } from '../lib/hooks';
import { dmyTime } from '../lib/format';

interface A { id: number; kind: string; area: 'fin' | 'est' | 'rh'; severity: 'atencao' | 'alerta'; title: string; detail: string; link: string | null; status: string; lastSeen: string; dismissedBy: string | null; dismissedAt: string | null }
const AREAS: Record<string, string> = { fin: 'Financeiro', est: 'Estoque', rh: 'Pessoal' };
const TABS = [['aberto', 'Para conferir'], ['dispensado', 'Dispensados'], ['resolvido', 'Resolvidos']] as const;

export default function Alerts() {
  const { can } = useAuth(); const toast = useToast();
  const [status, setStatus] = useState<string>('aberto'); const [area, setArea] = useState(''); const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useFetch<{ rows: A[]; areas: string[]; lastScan: string | null }>('/anomalies', { status, ...(area ? { area } : {}) });
  const act = async (id: number, what: 'dismiss' | 'reopen') => {
    try { await api.post(`/anomalies/${id}/${what}`); toast.success(what === 'dismiss' ? 'Alerta dispensado.' : 'Alerta reaberto.'); reload(); } catch (e) { toast.error(errMsg(e)); }
  };
  const scan = async () => {
    setBusy(true);
    try { const r = await api.post<{ abertos: number; novos: number }>('/anomalies/scan'); toast.success(r.novos ? `${r.novos} alerta(s) novo(s).` : 'Verificação concluída, nada de novo.'); reload(); } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div>
      <PageHeader title="Alertas" subtitle="Valores e movimentos fora do padrão, calculados sobre o histórico" icon={BellRing}
        actions={can('cfg.settings') ? <button type="button" className="btn-outline" onClick={scan} disabled={busy}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />Verificar agora</button> : undefined} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={status === k ? 'btn-primary' : 'btn-outline'}>{l}</button>)}
        {(data?.areas.length ?? 0) > 1 && (
          <select className="input ml-auto w-auto" aria-label="Área" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Todas as áreas</option>{data!.areas.map((a) => <option key={a} value={a}>{AREAS[a]}</option>)}
          </select>)}
      </div>
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
