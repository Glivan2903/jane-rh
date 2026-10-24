import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { SLIDES, isNewsHidden, setHideNews } from '../lib/news';

export function NewsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [i, setI] = useState(0); const [hide, setHide] = useState(() => isNewsHidden(userId));
  const s = SLIDES[i]; const last = i === SLIDES.length - 1; const Icon = s.icon;
  const close = () => { setHideNews(userId, hide); onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, SLIDES.length - 1)); else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0)); };
    document.addEventListener('keydown', k); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = ''; };
  });
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-0 backdrop-blur-[2px] sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label="Novidades do Gentis" className="flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card shadow-2xl sm:rounded-2xl">
        <div className="hero relative shrink-0 overflow-hidden bg-[#0b1f2e] px-5 pb-5 pt-6 text-white sm:px-7">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_12%_0%,rgba(20,184,166,.30),transparent_55%),radial-gradient(ellipse_at_96%_100%,rgba(255,122,89,.20),transparent_50%)]" />
          <Icon aria-hidden strokeWidth={1.2} className="pointer-events-none absolute -right-2 top-1/2 h-28 w-28 -translate-y-1/2 text-white/[0.09]" />
          <button type="button" onClick={close} aria-label="Fechar" className="absolute right-3 top-3 rounded-lg p-1.5 text-white/80 hover:bg-white/10"><X className="h-5 w-5" /></button>
          <p className="relative text-xs font-medium text-white/70">Novidades · {i + 1} de {SLIDES.length}</p>
          <h2 key={i} className="relative mt-1 max-w-[85%] font-display text-xl font-bold sm:text-2xl">{s.title}</h2>
        </div>
        <div className="min-h-[15rem] overflow-y-auto px-5 py-4 sm:px-7">
          <p className="text-sm text-muted-foreground sm:text-base">{s.lead}</p>
          {s.items && <ul className="mt-4 space-y-3">{s.items.map((it) => (
            <li key={it.title} className="flex gap-3"><span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" /><span className="text-sm"><b className="font-semibold">{it.title}.</b> <span className="text-muted-foreground">{it.text}</span></span></li>))}</ul>}
        </div>
        <div className="shrink-0 space-y-3 border-t px-5 py-3 sm:px-7">
          <div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Páginas da apresentação">
            {SLIDES.map((x, n) => <button key={x.title} type="button" role="tab" aria-selected={n === i} aria-label={`Página ${n + 1}: ${x.title}`} onClick={() => setI(n)} className={`h-2 rounded-full transition-all ${n === i ? 'w-6 bg-primary' : 'w-2 bg-border hover:bg-muted-foreground/40'}`} />)}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={hide} onChange={(e) => setHide(e.target.checked)} />Não mostrar nos próximos acessos</label>
            <div className="flex gap-2">
              {i > 0 && <button type="button" className="btn-outline" onClick={() => setI(i - 1)}><ChevronLeft className="h-4 w-4" />Voltar</button>}
              {last ? <button type="button" className="btn-primary" onClick={close}>Entendi</button> : <button type="button" className="btn-primary" onClick={() => setI(i + 1)}>Próximo<ChevronRight className="h-4 w-4" /></button>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
