import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Download, Loader2, MessageSquarePlus, SendHorizontal, Trash2, User } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ErrorBox, PageHeader, Skeleton } from '../../components/ui';
import { SafeText } from '../../components/SafeText';
import { PALETTE } from '../../components/charts';
import { api } from '../../lib/api';
import { errMsg, useAuth, useConfirm, useToast } from '../../lib/app';
import { useFetch } from '../../lib/hooks';
import { brl, num } from '../../lib/format';

interface TableBlock { type: 'table'; title: string; columns: string[]; rows: string[][] }
interface ChartBlock { type: 'chart'; title: string; kind: 'bar' | 'line' | 'pie'; labels: string[]; series: { name: string; values: number[] }[]; money: boolean }
type Block = TableBlock | ChartBlock;
interface Msg { id?: number; role: 'user' | 'assistant'; content: string; blocks?: Block[] | null; error?: boolean }
interface Status {
  configured: boolean; model: string; access: { enabled: boolean; finance: boolean; stock: boolean; hr: boolean; salary: boolean }; tools: string[];
  limits: { messagesPerDay: number; tokensPerMonth: number }; usage: { messagesToday: number; tokensMonth: number };
}
interface Conv { id: string; title: string; updatedAt: string }

const TOOL_LABEL: Record<string, string> = {
  financeiro: 'Consultando o financeiro…', cadastros: 'Consultando cadastros…', estoque: 'Consultando o estoque…', pessoal: 'Consultando dados de pessoal…', exibir: 'Montando a visualização…',
};
const toolLabel = (n: string) => TOOL_LABEL[n.split('_')[0]] ?? 'Consultando…';

function TableView({ b }: { b: TableBlock }) {
  const csv = () => {
    const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : /^[=+\-@]/.test(v) ? `'${v}` : v);   // evita injeção de fórmula
    const text = '﻿' + [b.columns, ...b.rows].map((r) => r.map(esc).join(';')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = `${b.title.replace(/[^\w\-]+/g, '_').slice(0, 40) || 'tabela'}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  return (
    <div className="mt-2 overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2"><span className="text-sm font-semibold">{b.title}</span>
        <button className="btn-ghost btn-sm" onClick={csv}><Download className="h-3.5 w-3.5" />CSV</button></div>
      <div className="max-h-80 overflow-auto"><table className="w-full text-sm">
        <thead className="sticky top-0 bg-muted/70 text-xs text-muted-foreground"><tr>{b.columns.map((c, i) => <th key={i} className="whitespace-nowrap px-3 py-1.5 text-left font-semibold">{c}</th>)}</tr></thead>
        <tbody>{b.rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="px-3 py-1.5 align-top">{c}</td>)}</tr>)}</tbody>
      </table></div>
    </div>
  );
}

function ChartView({ b }: { b: ChartBlock }) {
  const data = b.labels.map((l, i) => Object.fromEntries([['label', l], ...b.series.map((s) => [s.name, s.values[i] ?? 0])]));
  const fmt = (v: number) => (b.money ? brl(v) : num(v, 2));
  const kfmt = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(0)} mil` : String(v));
  const axis = { fill: '#7a93a2', fontSize: 11 };
  return (
    <div className="mt-2 rounded-lg border bg-card p-3">
      <p className="mb-2 text-sm font-semibold">{b.title}</p>
      <div className="h-60"><ResponsiveContainer width="100%" height="100%">
        {b.kind === 'pie' ? (
          <PieChart><Pie data={b.labels.map((l, i) => ({ name: l, value: b.series[0]?.values[i] ?? 0 }))} dataKey="value" nameKey="name" innerRadius={45} outerRadius={85} paddingAngle={2}>
            {b.labels.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}</Pie><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart>
        ) : b.kind === 'line' ? (
          <LineChart data={data} margin={{ left: -6, right: 10, top: 8 }}><CartesianGrid strokeDasharray="3 4" stroke="rgb(128 150 165 / .22)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={48} /><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            {b.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={{ r: 3 }} />)}</LineChart>
        ) : (
          <BarChart data={data} margin={{ left: -6, right: 10, top: 8 }}><CartesianGrid strokeDasharray="3 4" stroke="rgb(128 150 165 / .22)" vertical={false} />
            <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={false} /><YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={kfmt} width={48} /><Tooltip formatter={(v: number) => fmt(v)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            {b.series.map((s, i) => <Bar key={s.name} dataKey={s.name} fill={PALETTE[i % PALETTE.length]} radius={[6, 6, 2, 2]} maxBarSize={36} />)}</BarChart>
        )}
      </ResponsiveContainer></div>
    </div>
  );
}

const SUGGESTIONS = (a: Status['access']) => [
  a.finance && 'Qual o resultado financeiro deste mês?', a.finance && 'Quanto tenho de contas vencidas a pagar e a receber?', a.finance && 'Meu saldo vai ficar negativo nos próximos 60 dias?',
  a.stock && 'Quais produtos estão com estoque baixo ou zerado?', a.hr && 'Quantos funcionários ativos temos por departamento?', a.hr && 'Quem faz aniversário este mês?',
].filter(Boolean) as string[];

export default function Assistant() {
  const { me } = useAuth(); const toast = useToast(); const confirm = useConfirm();
  const status = useFetch<Status>('/ai/status');
  const convs = useFetch<Conv[]>('/ai/conversations');
  const [convId, setConvId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [stage, setStage] = useState('');
  const [loadingConv, setLoadingConv] = useState(false);
  const bottom = useRef<HTMLDivElement>(null); const abort = useRef<AbortController | null>(null);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [msgs, stage]);
  useEffect(() => () => abort.current?.abort(), []);

  const open = useCallback(async (id: string | null) => {
    abort.current?.abort(); setBusy(false); setStage(''); setConvId(id);
    if (!id) { setMsgs([]); return; }
    setLoadingConv(true);
    try { const c = await api.get<{ messages: Msg[] }>(`/ai/conversations/${id}`); setMsgs(c.messages); } catch (e) { toast.error(errMsg(e)); } finally { setLoadingConv(false); }
  }, [toast]);

  const send = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const message = (preset ?? text).trim();
    if (!message || busy) return;
    setText(''); setBusy(true); setStage('Pensando…');
    setMsgs((m) => [...m, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
    const ctl = new AbortController(); abort.current = ctl;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((arr) => arr.map((m, i) => (i === arr.length - 1 ? fn(m) : m)));
    try {
      const res = await fetch('/api/ai/chat', { method: 'POST', credentials: 'same-origin', signal: ctl.signal, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'gentis' }, body: JSON.stringify({ message, conversationId: convId ?? undefined }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => null); throw new Error(j?.error ?? 'Não foi possível enviar a pergunta.'); }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''; let newId = convId;
      for (;;) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 2);
          if (!line.startsWith('data:')) continue;
          const ev = JSON.parse(line.slice(5));
          if (ev.type === 'start') newId = ev.conversationId;
          else if (ev.type === 'tool') setStage(toolLabel(ev.name));
          else if (ev.type === 'text') { setStage(''); patch((m) => ({ ...m, content: m.content + ev.delta })); }
          else if (ev.type === 'done') patch((m) => ({ ...m, id: ev.messageId, content: ev.text, blocks: ev.blocks }));        // texto final já filtrado pelo servidor
          else if (ev.type === 'error') patch((m) => ({ ...m, content: ev.message, error: true }));
        }
      }
      if (newId && newId !== convId) setConvId(newId);
      convs.reload(); status.reload();
    } catch (x) {
      if ((x as Error).name !== 'AbortError') patch((m) => ({ ...m, content: errMsg(x), error: true }));
    } finally { setBusy(false); setStage(''); }
  };

  const remove = async (c: Conv) => {
    if (!(await confirm({ title: 'Excluir conversa?', message: `"${c.title}" será excluída do seu histórico.`, confirmLabel: 'Excluir', danger: true }))) return;
    try { await api.del(`/ai/conversations/${c.id}`); if (convId === c.id) { setConvId(null); setMsgs([]); } convs.reload(); } catch (e) { toast.error(errMsg(e)); }
  };

  if (status.error) return <ErrorBox message={status.error} onRetry={status.reload} />;
  const st = status.data;
  if (!st) return <Skeleton className="h-96 w-full" />;
  const usable = st.access.enabled && (st.access.finance || st.access.stock || st.access.hr) && st.configured;
  const left = st.limits.messagesPerDay - st.usage.messagesToday;

  return (
    <div>
      <PageHeader title="Assistente de IA" subtitle="Pergunte em português sobre os dados que o administrador liberou para você. O assistente só consulta; não altera nada." />
      {!st.access.enabled || !(st.access.finance || st.access.stock || st.access.hr) ? (
        <div role="status" className="card p-6 text-sm">O administrador ainda não liberou o Assistente de IA para o seu usuário. Peça acesso em <b>Configurações &gt; Assistente de IA</b>.</div>
      ) : !st.configured ? (
        <div role="alert" className="card border-warning/40 bg-warning/10 p-6 text-sm">O Assistente de IA ainda não foi configurado neste ambiente (chave do modelo ausente). Avise o administrador.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[250px_1fr]">
          <aside className="card h-fit p-2">
            <button className="btn-primary mb-2 w-full" onClick={() => open(null)}><MessageSquarePlus className="h-4 w-4" />Nova conversa</button>
            <div className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {(convs.data ?? []).map((c) => (
                <div key={c.id} className={`group flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${convId === c.id ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-muted'}`}>
                  <button className="min-w-0 flex-1 truncate text-left" onClick={() => open(c.id)} title={c.title}>{c.title}</button>
                  <button className="rounded p-1 text-muted-foreground opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100" aria-label={`Excluir ${c.title}`} onClick={() => remove(c)}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>))}
              {convs.data?.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">Nenhuma conversa ainda.</p>}
            </div>
          </aside>
          <section className="card flex min-h-[60vh] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
              {loadingConv ? <Skeleton className="h-32 w-full" /> : msgs.length === 0 ? (
                <div className="mx-auto max-w-xl py-8 text-center">
                  <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Bot className="h-6 w-6" /></div>
                  <p className="font-display text-lg font-bold">Olá, {me?.name.split(' ')[0]}! Como posso ajudar?</p>
                  <p className="mt-1 text-sm text-muted-foreground">Exemplos do que você pode perguntar:</p>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {SUGGESTIONS(st.access).map((s) => <button key={s} className="rounded-full border px-3 py-1.5 text-xs hover:bg-muted" onClick={() => send(undefined, s)}>{s}</button>)}
                  </div>
                </div>
              ) : msgs.map((m, i) => (
                <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                  <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${m.role === 'user' ? 'bg-accent/20 text-accent' : 'bg-primary/10 text-primary'}`}>{m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}</div>
                  <div className={`max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2 ${m.role === 'user' ? 'bg-primary text-primary-foreground' : m.error ? 'border border-danger/40 bg-danger/10 text-danger' : 'bg-muted'}`}>
                    {m.role === 'user' ? <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{m.content}</p> : m.content ? <SafeText text={m.content} /> : <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{stage || 'Pensando…'}</span>}
                    {m.role === 'assistant' && busy && i === msgs.length - 1 && m.content && stage && <p className="mt-1 text-xs text-muted-foreground">{stage}</p>}
                    {m.blocks?.map((b, j) => (b.type === 'table' ? <TableView key={j} b={b} /> : <ChartView key={j} b={b} />))}
                  </div>
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form onSubmit={send} className="border-t p-3">
              <div className="flex items-end gap-2">
                <textarea aria-label="Pergunta" className="input min-h-[44px] flex-1 resize-none" rows={1} maxLength={4000} placeholder="Digite sua pergunta…" value={text} disabled={busy || !usable}
                  onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                <button className="btn-primary h-11" disabled={busy || !text.trim() || !usable} aria-label="Enviar">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}</button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">Respostas geradas por IA a partir dos dados do sistema: confira valores importantes. Seus dados de CPF e documentos nunca são enviados ao modelo. {left <= 10 && `Restam ${Math.max(left, 0)} pergunta(s) hoje.`}</p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
