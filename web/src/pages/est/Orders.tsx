import { useEffect, useState } from 'react';
import { PackageCheck, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { Badge, DataTable, Empty, ErrorBox, Modal, PageHeader, Skeleton, useDebounced, type Col, type Tone } from '../../components/ui';
import { FCheck, FilterBar, FilterSelect, FInput, FSelect, FTextarea, SearchBox } from '../../components/forms';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch, useForm, useList, usePersisted } from '../../lib/hooks';
import { brl, dmy, num, todayIso } from '../../lib/format';
import { ScanButton } from '../../components/BarcodeScanner';

interface Row { id: number; number: string; status: string; partyId: number; supplier: string; orderDate: string; expectedDate: string | null; total: string; itemsCount: number; receivedRatio: string }
interface Item { id: number; productId: string; code: string; name: string; unit: string; tracksBatches: boolean; quantity: string; unitCost: string; receivedQty: string; remaining: string }
interface Receipt { id: number; receivedAt: string; docNumber: string | null; total: string; transactionId: string | null; createdBy: string | null; items: { name: string; quantity: string; unitCost: string; batchCode: string | null }[] | null }
interface Detail extends Row { notes: string | null; items: Item[]; receipts: Receipt[] }
interface Opt { id: string; code: string; name: string; unit: string; cost: string; tracksBatches?: boolean }

const ST: Record<string, { tone: Tone; label: string }> = {
  rascunho: { tone: 'neutral', label: 'Rascunho' }, enviado: { tone: 'info', label: 'Enviado' }, parcial: { tone: 'warning', label: 'Recebido em parte' },
  recebido: { tone: 'success', label: 'Recebido' }, encerrado: { tone: 'neutral', label: 'Encerrado' }, cancelado: { tone: 'danger', label: 'Cancelado' },
};
const FILTER = [{ value: 'abertos', label: 'Em aberto' }, { value: 'rascunho', label: 'Rascunhos' }, { value: 'enviado', label: 'Enviados' }, { value: 'parcial', label: 'Recebidos em parte' }, { value: 'recebido', label: 'Recebidos' }, { value: 'encerrado', label: 'Encerrados' }, { value: 'cancelado', label: 'Cancelados' }, { value: 'todos', label: 'Todos' }];
const addDays = (n: number) => { const d = new Date(`${todayIso()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/* ---------------------------------------------------------- formulário do pedido ---------------------------------------------------------- */
interface Line { productId: string; name: string; unit: string; quantity: string; unitCost: string }

function OrderForm({ orderId, onClose, onSaved }: { orderId: number | null; onClose: () => void; onSaved: (id: number) => void }) {
  const toast = useToast();
  const sups = useFetch<{ id: number; name: string }[]>('/cad/parties/options', { kind: 'supplier' });
  const cur = useFetch<Detail>(orderId ? `/est/orders/${orderId}` : null);
  const f = useForm({ partyId: '', orderDate: todayIso(), expectedDate: '', notes: '' });
  const [lines, setLines] = useState<Line[]>([]);
  const [search, setSearch] = useState(''); const dq = useDebounced(search);
  const opts = useFetch<Opt[]>('/est/products/options', { q: dq });
  const [pick, setPick] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    const d = cur.data; if (!d) return;
    f.setV({ partyId: String(d.partyId), orderDate: d.orderDate, expectedDate: d.expectedDate ?? '', notes: d.notes ?? '' });
    setLines(d.items.map((i) => ({ productId: i.productId, name: i.name, unit: i.unit, quantity: String(Number(i.quantity)), unitCost: String(Number(i.unitCost)) })));
  }, [cur.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const add = () => {
    const o = opts.data?.find((x) => x.id === pick); if (!o) return;
    if (lines.some((l) => l.productId === o.id)) { setErr('Este produto já está no pedido.'); return; }
    setErr(''); setLines([...lines, { productId: o.id, name: o.name, unit: o.unit, quantity: '1', unitCost: String(Number(o.cost)) }]); setPick('');
  };
  const upd = (i: number, k: 'quantity' | 'unitCost', v: string) => setLines(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.partyId) e.partyId = 'Selecione o fornecedor';
    if (!f.v.orderDate) e.orderDate = 'Informe a data';
    if (f.v.expectedDate && f.v.expectedDate < f.v.orderDate) e.expectedDate = 'Anterior à data do pedido';
    if (!lines.length) setErr('Inclua ao menos um produto.'); else if (lines.some((l) => !(Number(l.quantity) > 0) || Number(l.unitCost) < 0 || l.unitCost === '')) setErr('Confira as quantidades e os custos.'); else setErr('');
    if (!lines.length || lines.some((l) => !(Number(l.quantity) > 0) || Number(l.unitCost) < 0 || l.unitCost === '')) e.items = 'x';
    return e;
  };
  return (
    <Modal title={orderId ? `Editar pedido ${cur.data?.number ?? ''}` : 'Novo pedido de compra'} size="xl" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="ordf" className="btn-primary" disabled={f.busy}>Salvar rascunho</button></>}>
      {orderId && cur.loading && !cur.data ? <Skeleton className="h-40" /> : cur.error ? <ErrorBox message={cur.error} /> : (
        <form id="ordf" noValidate className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          let id = orderId ?? 0;
          const ok = await f.submit(async () => {
            const body = { partyId: Number(f.v.partyId), orderDate: f.v.orderDate, expectedDate: f.v.expectedDate || undefined, notes: f.v.notes, items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) };
            if (orderId) await api.put(`/est/orders/${orderId}`, body); else id = (await api.post<{ id: number }>('/est/orders', body)).id;
          }, validate);
          if (ok) { toast.success('Pedido salvo como rascunho.'); onSaved(id); }
        }}>
          <div className="grid gap-3 sm:grid-cols-3">
            <FSelect f={f} name="partyId" label="Fornecedor" required options={(sups.data ?? []).map((s) => ({ value: s.id, label: s.name }))} hint={sups.data?.length === 0 ? 'Cadastre um fornecedor em Cadastros > Clientes e fornecedores.' : undefined} />
            <FInput f={f} name="orderDate" label="Data do pedido" type="date" required />
            <FInput f={f} name="expectedDate" label="Previsão de entrega" type="date" />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold">Produtos do pedido</p>
            <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-2.5">
              <div className="flex min-w-48 flex-1 gap-2"><input className="input" type="search" aria-label="Pesquisar produto" placeholder="Pesquisar por nome, código ou código de barras…" value={search} onChange={(e) => setSearch(e.target.value)} /><ScanButton onCode={(c) => setSearch(c)} /></div>
              <select className="input min-w-56 flex-1" aria-label="Produto" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{opts.loading ? 'Carregando…' : opts.data?.length ? 'Selecione o produto…' : 'Nenhum produto encontrado'}</option>
                {(opts.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} — {o.name}</option>)}
              </select>
              <button type="button" className="btn-outline" onClick={add} disabled={!pick}><Plus className="h-4 w-4" />Adicionar</button>
            </div>
            {err && <p role="alert" className="mt-1 text-xs text-danger">{err}</p>}
            {lines.length > 0 && (
              <div className="mt-2 overflow-x-auto rounded-lg border"><table className="w-full min-w-[560px] text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-semibold">Produto</th><th className="px-3 py-2 text-right font-semibold">Quantidade</th><th className="px-3 py-2 text-right font-semibold">Custo unitário (R$)</th><th className="px-3 py-2 text-right font-semibold">Subtotal</th><th /></tr></thead>
                <tbody>{lines.map((l, i) => (
                  <tr key={l.productId} className="border-t">
                    <td className="px-3 py-1.5 font-medium">{l.name}</td>
                    <td className="px-3 py-1.5 text-right"><input type="number" step="0.001" min="0.001" aria-label={`Quantidade de ${l.name}`} className="input !w-28 text-right" value={l.quantity} onChange={(e) => upd(i, 'quantity', e.target.value)} /> <span className="text-xs text-muted-foreground">{l.unit}</span></td>
                    <td className="px-3 py-1.5 text-right"><input type="number" step="0.0001" min="0" aria-label={`Custo de ${l.name}`} className="input !w-28 text-right" value={l.unitCost} onChange={(e) => upd(i, 'unitCost', e.target.value)} /></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{brl((Number(l.quantity) || 0) * (Number(l.unitCost) || 0))}</td>
                    <td className="px-2 text-right"><button type="button" className="btn-ghost btn-sm text-danger" aria-label={`Remover ${l.name}`} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>))}</tbody>
                <tfoot><tr className="border-t bg-muted/30"><td colSpan={3} className="px-3 py-2 text-right text-xs font-semibold">Total do pedido</td><td className="px-3 py-2 text-right font-bold tabular-nums">{brl(total)}</td><td /></tr></tfoot>
              </table></div>)}
          </div>
          <FTextarea f={f} name="notes" label="Observações" rows={2} />
        </form>)}
    </Modal>
  );
}

/* ------------------------------------------------------------- recebimento ------------------------------------------------------------- */
function ReceiveModal({ order, onClose, onDone }: { order: Detail; onClose: () => void; onDone: () => void }) {
  const { can } = useAuth(); const toast = useToast();
  const pending = order.items.filter((i) => Number(i.remaining) > 0);
  const cats = useFetch<{ id: number; name: string }[]>(can('fin.create') ? '/fin/categories' : null, { type: 'despesa', active: 'true' });
  const accs = useFetch<{ accounts: { id: number; name: string; isDefault: boolean }[] }>(can('fin.create') ? '/fin/accounts' : null, { active: 'true' });
  const f = useForm({ receivedAt: todayIso(), docNumber: '', create: false, dueDate: addDays(30), categoryId: '', accountId: '' });
  const [rows, setRows] = useState<Record<number, { q: string; batchCode: string; expiresAt: string }>>(Object.fromEntries(pending.map((i) => [i.id, { q: String(Number(i.remaining)), batchCode: '', expiresAt: '' }])));
  const set = (id: number, k: 'q' | 'batchCode' | 'expiresAt', v: string) => setRows((s) => ({ ...s, [id]: { ...s[id], [k]: v } }));
  const total = pending.reduce((s, i) => s + (Number(rows[i.id]?.q) || 0) * Number(i.unitCost), 0);
  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.receivedAt) e.receivedAt = 'Informe a data';
    const used = pending.filter((i) => Number(rows[i.id].q) > 0);
    if (!used.length) e.receivedAt = 'Informe a quantidade recebida de ao menos um item';
    for (const i of used) {
      if (Number(rows[i.id].q) > Number(i.remaining)) e.receivedAt = `${i.name}: máximo ${num(i.remaining)}`;
      if (i.tracksBatches && !rows[i.id].batchCode.trim()) e.receivedAt = `${i.name}: informe o lote`;
    }
    if (f.v.create) { if (!f.v.dueDate) e.dueDate = 'Informe o vencimento'; if (!f.v.categoryId) e.categoryId = 'Selecione a categoria'; }
    return e;
  };
  return (
    <Modal title={`Receber mercadoria — ${order.number}`} size="xl" onClose={onClose}
      footer={<><button className="btn-outline" onClick={onClose}>Cancelar</button><button form="rcf2" className="btn-primary" disabled={f.busy}><PackageCheck className="h-4 w-4" />Confirmar recebimento</button></>}>
      <form id="rcf2" noValidate className="space-y-4" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(async () => {
          await api.post(`/est/orders/${order.id}/receive`, {
            receivedAt: f.v.receivedAt, docNumber: f.v.docNumber || undefined,
            items: pending.filter((i) => Number(rows[i.id].q) > 0).map((i) => ({ itemId: i.id, quantity: Number(rows[i.id].q), ...(i.tracksBatches ? { batchCode: rows[i.id].batchCode, expiresAt: rows[i.id].expiresAt || undefined } : {}) })),
            payable: f.v.create ? { create: true, dueDate: f.v.dueDate, categoryId: Number(f.v.categoryId), accountId: f.v.accountId ? Number(f.v.accountId) : undefined } : undefined,
          });
        }, validate);
        if (ok) { toast.success(f.v.create ? 'Recebimento registrado e conta a pagar gerada.' : 'Recebimento registrado.'); onDone(); }
      }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <FInput f={f} name="receivedAt" label="Data do recebimento" type="date" required max={todayIso()} />
          <FInput f={f} name="docNumber" label="Nº da nota fiscal" />
        </div>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[640px] text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-semibold">Produto</th><th className="px-3 py-2 text-right font-semibold">Falta receber</th><th className="px-3 py-2 text-right font-semibold">Recebido agora</th><th className="px-3 py-2 text-left font-semibold">Lote e validade</th></tr></thead>
          <tbody>{pending.map((i) => (
            <tr key={i.id} className="border-t align-top">
              <td className="px-3 py-2"><p className="font-semibold">{i.name}</p><p className="text-xs text-muted-foreground">R$ {num(i.unitCost)} por {i.unit}</p></td>
              <td className="px-3 py-2 text-right tabular-nums">{num(i.remaining)} {i.unit}</td>
              <td className="px-3 py-2 text-right"><input type="number" step="0.001" min="0" aria-label={`Recebido de ${i.name}`} className="input !w-28 text-right" value={rows[i.id].q} onChange={(e) => set(i.id, 'q', e.target.value)} /></td>
              <td className="px-3 py-2">{i.tracksBatches ? <div className="flex flex-wrap gap-1.5"><input className="input !w-32" placeholder="Lote" aria-label={`Lote de ${i.name}`} value={rows[i.id].batchCode} onChange={(e) => set(i.id, 'batchCode', e.target.value)} /><input className="input !w-36" type="date" aria-label={`Validade de ${i.name}`} value={rows[i.id].expiresAt} onChange={(e) => set(i.id, 'expiresAt', e.target.value)} /></div> : <span className="text-xs text-muted-foreground">Sem controle por lote</span>}</td>
            </tr>))}</tbody>
          <tfoot><tr className="border-t bg-muted/30"><td colSpan={2} className="px-3 py-2 text-right text-xs font-semibold">Valor recebido</td><td className="px-3 py-2 text-right font-bold tabular-nums">{brl(total)}</td><td /></tr></tfoot>
        </table></div>
        {f.err.receivedAt && f.v.receivedAt && <p role="alert" className="text-xs text-danger">{f.err.receivedAt}</p>}
        {can('fin.create') && (
          <div className="rounded-lg border p-3">
            <FCheck f={f} name="create" label="Gerar conta a pagar no financeiro com o valor recebido" />
            {f.v.create && (
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <FInput f={f} name="dueDate" label="Vencimento" type="date" required />
                <FSelect f={f} name="categoryId" label="Categoria da despesa" required options={(cats.data ?? []).map((c) => ({ value: c.id, label: c.name }))} />
                <FSelect f={f} name="accountId" label="Conta" placeholder="Conta padrão" options={(accs.data?.accounts ?? []).filter((a) => !a.isDefault).map((a) => ({ value: a.id, label: a.name }))} />
              </div>)}
          </div>)}
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------------ detalhe ------------------------------------------------------------------ */
function OrderView({ id, onClose, onChanged, onEdit }: { id: number; onClose: () => void; onChanged: () => void; onEdit: (id: number) => void }) {
  const { can } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const q = useFetch<Detail>(`/est/orders/${id}`);
  const [receive, setReceive] = useState(false);
  const o = q.data;
  const act = async (path: string, ok: string, ask?: { title: string; message: string; label: string }) => {
    if (ask && !(await confirm({ title: ask.title, message: ask.message, confirmLabel: ask.label, danger: true }))) return;
    try { await api.post(`/est/orders/${id}/${path}`, {}); toast.success(ok); q.reload(); onChanged(); } catch (e) { toast.error(errMsg(e)); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Excluir o rascunho?', message: 'O pedido em rascunho será excluído.', confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/est/orders/${id}`); toast.success('Rascunho excluído.'); onChanged(); onClose(); } catch (e) { toast.error(errMsg(e)); }
  };
  return (
    <>
      <Modal title={o ? `Pedido ${o.number}` : 'Pedido de compra'} size="xl" onClose={onClose}
        footer={o && (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {o.status === 'rascunho' && can('est.edit') && <button className="btn-outline text-danger" onClick={remove}>Excluir</button>}
              {['rascunho', 'enviado'].includes(o.status) && can('est.edit') && <button className="btn-outline" onClick={() => act('cancel', 'Pedido cancelado.', { title: 'Cancelar o pedido?', message: 'O pedido deixa de aceitar recebimentos.', label: 'Cancelar pedido' })}>Cancelar pedido</button>}
              {o.status === 'parcial' && can('est.edit') && <button className="btn-outline" onClick={() => act('close', 'Pedido encerrado.', { title: 'Encerrar o pedido?', message: 'O que ainda não foi recebido deixa de ser esperado.', label: 'Encerrar' })}>Encerrar com o que foi recebido</button>}
            </div>
            <div className="flex flex-wrap gap-2">
              {o.status === 'rascunho' && can('est.edit') && <button className="btn-outline" onClick={() => onEdit(o.id)}>Editar</button>}
              {o.status === 'rascunho' && can('est.edit') && <button className="btn-primary" onClick={() => act('send', 'Pedido enviado.')}>Marcar como enviado</button>}
              {['enviado', 'parcial'].includes(o.status) && can('est.move') && <button className="btn-primary" onClick={() => setReceive(true)}><PackageCheck className="h-4 w-4" />Receber mercadoria</button>}
            </div>
          </div>)}>
        {q.error ? <ErrorBox message={q.error} onRetry={q.reload} /> : !o ? <Skeleton className="h-48" /> : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Badge tone={ST[o.status].tone}>{ST[o.status].label}</Badge>
              <span><span className="text-muted-foreground">Fornecedor:</span> <b>{o.supplier}</b></span>
              <span><span className="text-muted-foreground">Pedido em:</span> {dmy(o.orderDate)}</span>
              {o.expectedDate && <span><span className="text-muted-foreground">Previsão:</span> {dmy(o.expectedDate)}</span>}
              <span><span className="text-muted-foreground">Total:</span> <b>{brl(o.total)}</b></span>
            </div>
            {o.notes && <p className="rounded-lg bg-muted px-3 py-2">{o.notes}</p>}
            <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[560px]">
              <thead className="bg-muted/50 text-xs text-muted-foreground"><tr><th className="px-3 py-2 text-left font-semibold">Produto</th><th className="px-3 py-2 text-right font-semibold">Pedido</th><th className="px-3 py-2 text-right font-semibold">Recebido</th><th className="px-3 py-2 text-right font-semibold">Custo unit.</th><th className="px-3 py-2 text-right font-semibold">Subtotal</th></tr></thead>
              <tbody>{o.items.map((i) => (
                <tr key={i.id} className="border-t"><td className="px-3 py-2"><b>{i.name}</b>{i.tracksBatches && <span className="ml-2"><Badge tone="info">Lote</Badge></span>}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{num(i.quantity)} {i.unit}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Number(i.receivedQty) >= Number(i.quantity) ? 'text-success' : ''}`}>{num(i.receivedQty)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{brl(i.unitCost)}</td><td className="px-3 py-2 text-right tabular-nums">{brl(Number(i.quantity) * Number(i.unitCost))}</td></tr>))}</tbody>
            </table></div>
            {o.receipts.length > 0 && (
              <div><h3 className="mb-1.5 font-display font-bold">Recebimentos</h3>
                <ul className="divide-y rounded-lg border">{o.receipts.map((r) => (
                  <li key={r.id} className="px-3 py-2"><div className="flex flex-wrap items-center justify-between gap-2"><span><b>{dmy(r.receivedAt)}</b>{r.docNumber ? ` · NF ${r.docNumber}` : ''}{r.createdBy ? ` · ${r.createdBy}` : ''}</span>
                    <span className="flex items-center gap-2">{r.transactionId && <Badge tone="success">Conta a pagar gerada</Badge>}<b className="tabular-nums">{brl(r.total)}</b></span></div>
                    <p className="mt-0.5 text-xs text-muted-foreground">{(r.items ?? []).map((i) => `${i.name}: ${num(i.quantity)}${i.batchCode ? ` (lote ${i.batchCode})` : ''}`).join(' · ')}</p></li>))}</ul></div>)}
          </div>)}
      </Modal>
      {receive && o && <ReceiveModal order={o} onClose={() => setReceive(false)} onDone={() => { setReceive(false); q.reload(); onChanged(); }} />}
    </>
  );
}

export default function Orders() {
  const { can } = useAuth();
  const [status, setStatus] = usePersisted('est.orders.status', 'abertos');
  const t = useList<Row>('/est/orders', { sort: 'id', dir: 'desc', persistKey: 'est.orders', filters: { status } });
  const [form, setForm] = useState<number | 'new' | null>(null); const [view, setView] = useState<number | null>(null);
  const add = can('est.create') && <button className="btn-primary" onClick={() => setForm('new')}><Plus className="h-4 w-4" />Novo pedido</button>;
  const cols: Col<Row>[] = [
    { key: 'id', label: 'Pedido', sort: 'id', render: (r) => <button className="font-mono text-xs font-semibold text-primary hover:underline" onClick={() => setView(r.id)}>{r.number}</button> },
    { key: 'supplier', label: 'Fornecedor', sort: 'supplier', render: (r) => <span className="font-semibold">{r.supplier}</span> },
    { key: 'date', label: 'Data', sort: 'date', render: (r) => <div>{dmy(r.orderDate)}{r.expectedDate && <div className="text-xs text-muted-foreground">previsão {dmy(r.expectedDate)}</div>}</div> },
    { key: 'itemsCount', label: 'Itens', className: 'text-right', render: (r) => r.itemsCount },
    { key: 'total', label: 'Total', className: 'text-right tabular-nums', render: (r) => brl(r.total) },
    { key: 'recv', label: 'Recebido', render: (r) => (['rascunho', 'cancelado'].includes(r.status) ? '—' : <div className="min-w-24"><div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-success" style={{ width: `${Math.round(Number(r.receivedRatio) * 100)}%` }} /></div><p className="mt-0.5 text-xs text-muted-foreground">{Math.round(Number(r.receivedRatio) * 100)}%</p></div>) },
    { key: 'status', label: 'Situação', sort: 'status', render: (r) => <Badge tone={ST[r.status].tone}>{ST[r.status].label}</Badge> },
    { key: 'a', label: '', className: 'text-right', render: (r) => <button className="btn-outline btn-sm" onClick={() => setView(r.id)}>Abrir</button> },
  ];
  return (
    <div>
      <PageHeader title="Pedidos de compra" subtitle="Peça ao fornecedor, receba a mercadoria no estoque e gere a conta a pagar." actions={add} />
      <FilterBar dirty={!!(t.q || status !== 'abertos')} onClear={() => { t.setQ(''); setStatus('abertos'); }}>
        <SearchBox value={t.q} onChange={t.setQ} placeholder="Buscar número ou fornecedor…" />
        <FilterSelect label="Situação" placeholder="Situação" value={status} onChange={setStatus} options={FILTER} />
      </FilterBar>
      <DataTable<Row> cols={cols} rows={t.rows} loading={t.loading} error={t.error} onRetry={t.reload} list={t.list}
        empty={<Empty icon={ShoppingCart} title={status === 'abertos' ? 'Nenhum pedido em aberto' : 'Nenhum pedido encontrado'} hint="Crie um pedido de compra para acompanhar o que foi pedido e o que já chegou." action={add} />} />
      {form && <OrderForm orderId={form === 'new' ? null : form} onClose={() => setForm(null)} onSaved={(id) => { setForm(null); t.reload(); setView(id); }} />}
      {view && <OrderView id={view} onClose={() => setView(null)} onChanged={t.reload} onEdit={(id) => { setView(null); setForm(id); }} />}
    </div>
  );
}
