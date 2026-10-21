import { useEffect, useRef } from 'react';

export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Gentis">
      <defs><linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#14b8a6" /><stop offset="1" stopColor="#0f5e66" /></linearGradient></defs>
      <rect width="48" height="48" rx="14" fill="url(#gl)" />
      <path d="M34.5 17.5A13 13 0 1 0 36.5 26H25" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="21.5" r="3.6" fill="#ff7a59" />
    </svg>
  );
}

export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <Logo size={compact ? 32 : 38} />
      {!compact && (
        <div className="leading-tight">
          <div className={`font-display text-lg font-bold tracking-tight ${light ? 'text-white' : ''}`}>Gentis</div>
          <div className={`text-[10px] uppercase tracking-[0.14em] ${light ? 'text-white/60' : 'text-muted-foreground'}`}>Pessoas &amp; Negócios</div>
        </div>
      )}
    </div>
  );
}

/** Rede de partículas interativa (canvas): links entre pontos próximos e "grab" ao passar o mouse. */
export function ParticleNetwork({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!; const ctx = cv.getContext('2d')!;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let w = 0, h = 0, raf = 0; const mouse = { x: -999, y: -999 };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type P = { x: number; y: number; vx: number; vy: number; r: number; warm: boolean };
    let pts: P[] = [];
    const resize = () => {
      w = cv.clientWidth; h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(90, Math.round((w * h) / 14000));
      pts = Array.from({ length: n }, () => ({ x: Math.random() * w, y: Math.random() * h, vx: (Math.random() - 0.5) * 0.5, vy: (Math.random() - 0.5) * 0.5, r: 1 + Math.random() * 2, warm: Math.random() < 0.12 }));
    };
    const tick = () => {
      ctx.clearRect(0, 0, w, h);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0 || p.x > w) p.vx *= -1; if (p.y < 0 || p.y > h) p.vy *= -1;
      }
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j]; const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 120) { ctx.strokeStyle = `rgba(94,234,212,${0.22 * (1 - d / 120)})`; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
        }
        const dm = Math.hypot(a.x - mouse.x, a.y - mouse.y);
        if (dm < 150) { ctx.strokeStyle = `rgba(255,138,108,${0.7 * (1 - dm / 150)})`; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke(); }
        ctx.fillStyle = a.warm ? 'rgba(255,138,108,.9)' : 'rgba(153,246,228,.85)'; ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, Math.PI * 2); ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (e: MouseEvent) => { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; };
    const leave = () => { mouse.x = mouse.y = -999; };
    resize(); tick();
    window.addEventListener('resize', resize); window.addEventListener('mousemove', move); window.addEventListener('mouseleave', leave);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize); window.removeEventListener('mousemove', move); window.removeEventListener('mouseleave', leave); };
  }, []);
  return <canvas ref={ref} className={`absolute inset-0 h-full w-full ${className}`} aria-hidden />;
}
