import { useEffect, useState } from 'react';
import { Download, Printer, Play } from 'lucide-react';
import { Empty, ErrorBox, PageHeader, Spinner } from '../components/ui';
import { FilterDate, FilterSelect } from '../components/forms';
import { api } from '../lib/api';
import { errMsg, useAuth, useToast } from '../lib/app';
import { useFetch } from '../lib/hooks';
import { dmy, monthStart, todayIso } from '../lib/format';
import { PrintHeader } from '../components/PrintHeader';

interface Result { title: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; total?: string; totalLabel?: string; note?: string; period?: { from: string; to: string } }
export interface Opt { value: string | number; label: string }

export interface ReportCfg {
  base: string; title: string; exportPerm: string;
  dateFilter?: 'period' | 'none';
  /** `only`: o filtro só aparece (e só é enviado) para esses relatórios. */
  extra?: { key: string; label: string; options: Opt[]; only?: string[] }[];
}

/** Tela genérica de relatórios: escolhe o relatório, aplica filtros, consulta, exporta CSV e imprime. */
export function ReportPage({ cfg }: { cfg: ReportCfg }) {
  const { data: names } = useFetch<Record<string, string>>(`${cfg.base}/reports`);
  const [name, setName] = useState('');
  const [from, setFrom] = useState(monthStart()); const [to, setTo] = useState(todayIso());
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [res, setRes] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const [orient, setOrient] = useState<'landscape' | 'portrait'>(() => { try { return localStorage.getItem('gentis-print-orient') === 'portrait' ? 'portrait' : 'landscape'; } catch { return 'landscape'; } });
  const setOrientation = (o: 'landscape' | 'portrait') => { setOrient(o); try { localStorage.setItem('gentis-print-orient', o); } catch { /* ignore */ } };
  const { can } = useAuth(); const toast = useToast();

  useEffect(() => { if (names && !name) setName(Object.keys(names)[0]); }, [names, name]);
  const visible = (cfg.extra ?? []).filter((x) => !x.only || x.only.includes(name));
  const params = () => ({ ...(cfg.dateFilter === 'none' ? {} : { from, to }), ...Object.fromEntries(visible.filter((x) => extra[x.key]).map((x) => [x.key, extra[x.key]])) });

  const run = async () => {
    if (!name) return;
    setBusy(true); setErr('');
    try { setRes(await api.get<Result>(`${cfg.base}/reports/${name}`, params())); } catch (e) { setErr(errMsg(e)); setRes(null); } finally { setBusy(false); }
  };
  useEffect(() => { if (name) run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [name]);

  const csv = async () => { try { await api.download(`${cfg.base}/reports/${name}`, { ...params(), format: 'csv' }, `${name}.csv`); toast.success('Arquivo gerado.'); } catch (e) { toast.error(errMsg(e)); } };

  return (
    <div className={`report-${orient}`}>
      <style>{`@media print { @page { size: A4 ${orient}; } }`}</style>
      <PageHeader title={cfg.title} subtitle="Consulte, exporte para CSV (Excel) ou imprima."
        actions={<>
          {can(cfg.exportPerm) && <button className="btn-outline" onClick={csv} disabled={!res}><Download className="h-4 w-4" />Exportar CSV</button>}
          <select aria-label="Orientação da impressão" className="input !w-auto" value={orient} onChange={(e) => setOrientation(e.target.value as 'landscape' | 'portrait')}>
            <option value="landscape">Paisagem</option><option value="portrait">Retrato</option>
          </select>
          <button className="btn-outline" onClick={() => window.print()} disabled={!res}><Printer className="h-4 w-4" />Imprimir</button>
        </>} />
      <div className="no-print mb-3 grid grid-cols-2 gap-2 rounded-xl border bg-card p-2.5 sm:mb-4 sm:gap-3 sm:p-3 lg:grid-cols-4">
        <select aria-label="Relatório" className="input col-span-2" value={name} onChange={(e) => setName(e.target.value)}>
          {Object.entries(names ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {cfg.dateFilter !== 'none' && <><FilterDate label="De" value={from} onChange={setFrom} /><FilterDate label="Até" value={to} onChange={setTo} /></>}
        {visible.map((x) => <FilterSelect key={x.key} label={x.label} placeholder={x.label} options={x.options} value={extra[x.key] ?? ''} onChange={(v) => setExtra((s) => ({ ...s, [x.key]: v }))} />)}
        <button className="btn-primary col-span-2 sm:col-span-1" onClick={run} disabled={busy}>{busy ? <Spinner /> : <Play className="h-4 w-4" />}Gerar</button>
      </div>
      <div className="card overflow-hidden">
        {err ? <ErrorBox message={err} onRetry={run} /> : !res ? <div className="p-10 text-center text-sm text-muted-foreground">{busy ? <Spinner className="mx-auto h-6 w-6" /> : 'Selecione um relatório.'}</div> : (
          <>
            <PrintHeader title={res.title} details={[
              res.period ? `Período: ${dmy(res.period.from)} a ${dmy(res.period.to)}` : '',
              ...visible.filter((x) => extra[x.key]).map((x) => `${x.label}: ${x.options.find((o) => String(o.value) === extra[x.key])?.label ?? extra[x.key]}`),
              `${res.rows.length} registro(s)`,
            ]} />
            <div className="no-print flex items-center justify-between border-b px-4 py-3"><h2 className="font-display font-bold">{res.title}</h2><span className="text-xs text-muted-foreground">{res.rows.length} linha(s)</span></div>
            {res.rows.length === 0 ? <Empty title="Nenhum dado para os filtros informados" hint="Ajuste o período ou os filtros e gere novamente." /> : (
              <div className="overflow-x-auto print:overflow-visible"><table className="report-table w-full min-w-[520px] sm:min-w-[640px] print:min-w-0">
                <thead className="border-b bg-muted/50"><tr>{res.columns.map((c) => <th key={c.key} className="th">{c.label}</th>)}</tr></thead>
                <tbody className="divide-y">{res.rows.map((r, i) => <tr key={i} className="hover:bg-muted/40">{res.columns.map((c) => <td key={c.key} className="td">{String(r[c.key] ?? '') || '—'}</td>)}</tr>)}</tbody>
              </table></div>
            )}
            {res.total && <div className="flex justify-end gap-3 border-t bg-muted/30 px-4 py-3 text-sm font-semibold"><span>{res.totalLabel ?? 'Total'}:</span><span className="tabular-nums">{res.total.match(/^[\d.,]+$/) ? `R$ ${res.total}` : res.total}</span></div>}
            {res.note && <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">{res.note}</p>}
          </>
        )}
      </div>
    </div>
  );
}
