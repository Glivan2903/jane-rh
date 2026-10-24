import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Download, ScanBarcode } from 'lucide-react';
import { Badge, ErrorBox, Modal, PageHeader, Skeleton, StatCard, useDebounced } from '../../components/ui';
import { FilterSelect, SearchBox } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';
import { dmy, dmyTime, num } from '../../lib/format';
import { COUNT_STATUS } from './Inventory';

interface Item { id: number; productId: string; code: string; name: string; barcode: string | null; unit: string; batchId: number | null; batchCode: string | null; expiresAt: string | null;
  systemQty: string; countedQty: string | null; currentQty: string; note: string | null; countedBy: string | null; appliedDelta: string | null }
interface Data { id: number; title: string; status: 'aberto' | 'finalizado' | 'cancelado'; notes: string | null; category: string | null; createdBy: string | null; createdAt: string; finalizedAt: string | null; finalizedBy: string | null;
  stats: { total: number; counted: number; divergent: number; movedSince: number }; rows: Item[]; total: number; page: number; pageSize: number }
interface Draft { c: string; n: string; saved?: boolean; err?: string }
const PAGE = 50;

/** Folha de contagem: digite o que contou; salva ao sair do campo. O estoque só muda ao finalizar. */
export default function InventoryDetail() {
  const { id } = useParams(); const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const [q, setQ] = useState(''); const dq = useDebounced(q); const [only, setOnly] = useState(''); const [page, setPage] = useState(1);
  const [scan, setScan] = useState(''); const [scanMsg, setScanMsg] = useState('');
  const [fin, setFin] = useState(false); const [busy, setBusy] = useState(false);
  const data = useFetch<Data>(`/est/counts/${id}`, { q: dq, only, page, pageSize: PAGE });
  const [draft, setDraft] = useState<Record<number, Draft>>({});
  const refs = useRef<Record<number, HTMLInputElement | null>>({});
  const d = data.data;
  const open = d?.status === 'aberto' && can('est.adjust');

  useEffect(() => { setPage(1); }, [dq, only]);
  // ao recarregar, o que o servidor tem vira o valor da linha, exceto o que a pessoa já digitou e ainda não foi salvo
  useEffect(() => {
    if (!d) return;
    setDraft((prev) => Object.fromEntries(d.rows.map((r) => {
      const srv: Draft = { c: r.countedQty == null ? '' : String(Number(r.countedQty)), n: r.note ?? '' };
      const p = prev[r.id];
      return [r.id, p && !p.saved && (p.c !== srv.c || p.n !== srv.n) ? p : srv];
    })));
  }, [d?.rows]);   // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (it: Item) => {
    const dr = draft[it.id]; if (!dr) return;
    const prev = it.countedQty == null ? '' : String(Number(it.countedQty));
    if (dr.c === prev && dr.n === (it.note ?? '')) return;
    if (dr.c !== '' && !(Number(dr.c) >= 0)) { setDraft((s) => ({ ...s, [it.id]: { ...dr, err: 'Valor inválido' } })); return; }
    try {
      await api.put(`/est/counts/${id}/items`, { items: [{ id: it.id, countedQty: dr.c === '' ? null : Number(dr.c), note: dr.n }] });
      setDraft((s) => ({ ...s, [it.id]: { ...dr, saved: true, err: undefined } }));
      data.reload();
    } catch (e) { setDraft((s) => ({ ...s, [it.id]: { ...dr, err: errMsg(e) } })); }
  };

  // leitor de código de barras: Enter filtra a lista pelo código lido e leva o cursor ao campo de contagem
  const onScan = async () => {
    const code = scan.trim(); if (!code) return;
    setScan(''); setQ(code); setScanMsg('');
    try {
      const r = await api.get<Data>(`/est/counts/${id}`, { q: code, pageSize: 5 });
      if (!r.rows.length) { setScanMsg(`Nenhum item com o código ${code} nesta contagem.`); return; }
      setTimeout(() => refs.current[r.rows[0].id]?.focus(), 350);
    } catch (e) { setScanMsg(errMsg(e)); }
  };

  const finalize = async () => {
    setBusy(true);
    try {
      const r = await api.post<{ adjusted: number; unchanged: number; skipped: number; totalDelta: number }>(`/est/counts/${id}/finalize`, {});
      toast.success(`Inventário finalizado: ${r.adjusted} ajuste(s), ${r.unchanged} sem diferença${r.skipped ? `, ${r.skipped} ignorado(s)` : ''}.`); setFin(false); data.reload();
    } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!(await confirm({ title: 'Cancelar o inventário?', message: 'As contagens lançadas serão descartadas e o estoque não será alterado.', confirmLabel: 'Cancelar inventário', danger: true }))) return;
    try { await api.post(`/est/counts/${id}/cancel`, {}); toast.success('Inventário cancelado.'); data.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (data.error) return <ErrorBox message={data.error} onRetry={data.reload} />;
  if (!d) return <div className="space-y-3"><Skeleton className="h-24" /><Skeleton className="h-64" /></div>;
  const pending = d.stats.total - d.stats.counted; const pct = d.stats.total ? Math.round((d.stats.counted / d.stats.total) * 100) : 0;
  const pages = Math.max(1, Math.ceil(d.total / PAGE));

  return (
    <div>
      <PageHeader back="/estoque/inventario" title={d.title} subtitle={`${d.category ?? 'Todos os produtos'} · aberto em ${dmyTime(d.createdAt)}${d.createdBy ? ` por ${d.createdBy}` : ''}`}
        actions={<>
          <Badge tone={COUNT_STATUS[d.status].tone}>{COUNT_STATUS[d.status].label}</Badge>
          {can('est.export') && <button className="btn-outline" onClick={() => api.download(`/est/counts/${id}/report`, { format: 'csv' }, `inventario-${id}.csv`).catch((e) => toast.error(errMsg(e)))}><Download className="h-4 w-4" />Exportar CSV</button>}
          {open && <button className="btn-outline" onClick={cancel}>Cancelar</button>}
          {open && <button className="btn-primary" onClick={() => setFin(true)} disabled={d.stats.counted === 0}><Check className="h-4 w-4" />Finalizar e ajustar</button>}
        </>} />
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Itens na contagem" value={d.stats.total} format={(n) => String(n)} icon={Check} tone="info" />
        <StatCard label="Contados" value={d.stats.counted} format={(n) => String(n)} icon={Check} tone="success" hint={`${pct}% concluído`} />
        <StatCard label="Pendentes" value={pending} format={(n) => String(n)} icon={ScanBarcode} tone={pending ? 'warning' : 'success'} />
        <StatCard label="Com diferença" value={d.stats.divergent} format={(n) => String(n)} icon={AlertTriangle} tone={d.stats.divergent ? 'danger' : 'success'} />
      </div>
      {d.status === 'aberto' && d.stats.movedSince > 0 && <p role="status" className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">{d.stats.movedSince} item(ns) tiveram movimentação de estoque depois da abertura da contagem. Ao finalizar, o estoque é ajustado para o valor contado.</p>}
      <div className="no-print mb-3 grid gap-2 rounded-xl border bg-card p-2.5 sm:grid-cols-3">
        <div><input className="input" aria-label="Ler código de barras" placeholder="Ler código de barras e pressionar Enter" value={scan} onChange={(e) => setScan(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onScan(); } }} disabled={!open} />
          {scanMsg && <p role="alert" className="mt-1 text-xs text-danger">{scanMsg}</p>}</div>
        <SearchBox value={q} onChange={setQ} placeholder="Buscar produto, código ou lote…" />
        <FilterSelect label="Mostrar" placeholder="Todos os itens" value={only} onChange={setOnly} options={[{ value: 'pendentes', label: 'Só pendentes' }, { value: 'contados', label: 'Só contados' }, { value: 'divergentes', label: 'Só com diferença' }]} />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-muted/50 text-xs text-muted-foreground"><tr>
            <th className="px-3 py-2 text-left font-semibold">Produto</th><th className="px-3 py-2 text-right font-semibold">Na abertura</th><th className="px-3 py-2 text-right font-semibold">Atual</th>
            <th className="px-3 py-2 text-right font-semibold">Contado</th><th className="px-3 py-2 text-right font-semibold">Diferença</th><th className="px-3 py-2 text-left font-semibold">Observação</th></tr></thead>
          <tbody>
            {d.rows.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-muted-foreground">Nenhum item para os filtros informados.</td></tr>}
            {d.rows.map((it) => {
              const dr = draft[it.id] ?? { c: '', n: '' };
              const counted = d.status === 'finalizado' ? (it.countedQty == null ? null : Number(it.countedQty)) : dr.c === '' ? null : Number(dr.c);
              const diff = counted == null ? null : d.status === 'finalizado' ? Number(it.appliedDelta ?? 0) : Math.round((counted - Number(it.currentQty)) * 1000) / 1000;
              const moved = d.status === 'aberto' && Number(it.systemQty) !== Number(it.currentQty);
              return (
                <tr key={it.id} className="border-t align-top">
                  <td className="px-3 py-2"><p className="font-semibold">{it.name}</p>
                    <p className="text-xs text-muted-foreground"><span className="font-mono">{it.code}</span>{it.barcode ? ` · ${it.barcode}` : ''}{it.batchCode ? ` · lote ${it.batchCode}${it.expiresAt ? ` (validade ${dmy(it.expiresAt)})` : ''}` : ''}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(it.systemQty)} <span className="text-xs text-muted-foreground">{it.unit}</span></td>
                  <td className={`px-3 py-2 text-right tabular-nums ${moved ? 'font-semibold text-warning' : ''}`} title={moved ? 'Movimentado depois da abertura' : undefined}>{num(it.currentQty)}</td>
                  <td className="px-3 py-2 text-right">
                    {open ? (
                      <div className="flex items-center justify-end gap-1.5">
                        {dr.saved && !dr.err && <Check aria-label="Salvo" className="h-4 w-4 text-success" />}
                        <input ref={(el) => { refs.current[it.id] = el; }} type="number" inputMode="decimal" step="0.001" min="0" aria-label={`Quantidade contada de ${it.name}${it.batchCode ? ` lote ${it.batchCode}` : ''}`} className={`input !w-28 text-right ${dr.err ? 'input-error' : ''}`}
                          value={dr.c} onChange={(e) => setDraft((s) => ({ ...s, [it.id]: { ...dr, c: e.target.value, saved: false, err: undefined } }))} onBlur={() => save(it)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); const next = d.rows[d.rows.findIndex((r) => r.id === it.id) + 1]; if (next) setTimeout(() => refs.current[next.id]?.focus(), 120); } }} />
                      </div>) : <span className="tabular-nums">{counted == null ? '—' : num(counted)}</span>}
                    {dr.err && <p role="alert" className="mt-1 text-xs text-danger">{dr.err}</p>}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${diff == null ? 'text-muted-foreground' : diff === 0 ? 'text-success' : diff > 0 ? 'text-info' : 'text-danger'}`}>{diff == null ? '—' : `${diff > 0 ? '+' : ''}${num(diff)}`}</td>
                  <td className="px-3 py-2">{open ? <input className="input" aria-label={`Observação de ${it.name}`} placeholder="Opcional" maxLength={200} value={dr.n} onChange={(e) => setDraft((s) => ({ ...s, [it.id]: { ...dr, n: e.target.value, saved: false } }))} onBlur={() => save(it)} /> : <span className="text-xs text-muted-foreground">{it.note ?? ''}</span>}</td>
                </tr>);
            })}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>{d.total} item(ns) · página {page} de {pages}</span>
          <span className="flex gap-1"><button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></button><button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Próxima página"><ChevronRight className="h-4 w-4" /></button></span>
        </div>
      </div>
      {d.finalizedAt && <p className="mt-2 text-xs text-muted-foreground">{d.status === 'finalizado' ? 'Finalizado' : 'Cancelado'} em {dmyTime(d.finalizedAt)}{d.finalizedBy ? ` por ${d.finalizedBy}` : ''}. {d.status === 'finalizado' ? 'A coluna Diferença mostra o que foi ajustado no estoque.' : ''}</p>}

      {fin && (
        <Modal title="Finalizar inventário" size="sm" onClose={() => setFin(false)}
          footer={<><button className="btn-outline" onClick={() => setFin(false)}>Voltar</button><button className="btn-primary" onClick={finalize} disabled={busy}>Finalizar e ajustar estoque</button></>}>
          <div className="space-y-2 text-sm">
            <p>O estoque será ajustado para a quantidade contada em <b>{d.stats.counted}</b> item(ns); <b>{d.stats.divergent}</b> com diferença.</p>
            {pending > 0 && <p className="rounded-lg bg-muted px-3 py-2">{pending} item(ns) sem contagem continuam como estão.</p>}
            <p className="text-muted-foreground">Cada diferença vira um ajuste de estoque registrado com o nome desta contagem. Depois de finalizar, não é possível editar.</p>
          </div>
        </Modal>)}
    </div>
  );
}
