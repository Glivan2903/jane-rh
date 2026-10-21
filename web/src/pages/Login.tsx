import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import { HeartHandshake, LineChart, PackageCheck, ShieldCheck } from 'lucide-react';
import { Brand, ParticleNetwork } from '../components/brand';
import { Field } from '../components/forms';
import { Spinner } from '../components/ui';
import { api } from '../lib/api';
import { errMsg, useAuth } from '../lib/app';

export default function Login() {
  const { me, login } = useAuth();
  const nav = useNavigate();
  const [l, setL] = useState(''); const [p, setP] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('[data-hero]', { y: 28, opacity: 0, duration: 0.8, stagger: 0.12 })
        .from('[data-feat]', { x: -20, opacity: 0, duration: 0.5, stagger: 0.1 }, '-=0.4')
        .from('[data-card]', { y: 36, opacity: 0, scale: 0.97, duration: 0.7 }, 0.15);
    }, root);
    return () => ctx.revert();
  }, []);

  // Sistema recém-implantado (sem usuários): leva ao cadastro do primeiro administrador.
  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/auth/setup-status').then((r) => { if (r.needsSetup) nav('/configurar', { replace: true }); }).catch(() => undefined);
  }, [nav]);

  if (me) return <Navigate to={me.mustChangePassword ? '/perfil/senha' : '/'} replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr('');
    try {
      const u = await login(l, p);
      nav(u.mustChangePassword ? '/perfil/senha' : '/', { replace: true });
    } catch (x) {
      setErr(errMsg(x));
      gsap.fromTo('[data-card]', { x: -8 }, { x: 0, duration: 0.5, ease: 'elastic.out(1,0.25)' });
    } finally { setBusy(false); }
  };

  return (
    <div ref={root} className="grid min-h-full lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-[#0b1f2e] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(20,184,166,.28),transparent_55%),radial-gradient(ellipse_at_90%_90%,rgba(255,122,89,.18),transparent_50%)]" />
        <ParticleNetwork />
        <div className="relative" data-hero><Brand light /></div>
        <div className="relative max-w-lg">
          <h1 data-hero className="font-display text-4xl font-bold leading-tight">Pessoas, finanças e estoque <span className="text-[#5eead4]">em um só lugar</span>.</h1>
          <p data-hero className="mt-4 text-base text-white/70">Controle admissões, contas a pagar e receber e movimentações de estoque com dados reais, histórico completo e acesso por perfil.</p>
          <ul className="mt-8 space-y-3 text-sm">
            {[[HeartHandshake, 'Gestão de pessoal com histórico do colaborador'], [LineChart, 'Fluxo de caixa e indicadores confiáveis'], [PackageCheck, 'Estoque com saldo auditável e alertas'], [ShieldCheck, 'Permissões, auditoria e backups reais']].map(([I, t], i) => {
              const Icon = I as typeof HeartHandshake;
              return <li key={i} data-feat className="flex items-center gap-3"><span className="rounded-lg bg-white/10 p-2"><Icon className="h-4 w-4 text-[#5eead4]" /></span>{t as string}</li>;
            })}
          </ul>
        </div>
        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Gentis</p>
      </section>
      <section className="flex items-center justify-center bg-background p-6">
        <div data-card className="card w-full max-w-md p-7 shadow-xl">
          <div className="mb-6 lg:hidden"><Brand /></div>
          <h2 className="font-display text-2xl font-bold">Bem-vindo(a)</h2>
          <p className="mt-1 text-sm text-muted-foreground">Acesse com seu e-mail ou nome de usuário.</p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
            <Field label="E-mail ou usuário" required><input className="input" autoFocus autoComplete="username" value={l} onChange={(e) => setL(e.target.value)} /></Field>
            <Field label="Senha" required><input className="input" type="password" autoComplete="current-password" value={p} onChange={(e) => setP(e.target.value)} /></Field>
            {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
            <button className="btn-primary w-full !py-2.5" disabled={busy || !l || !p}>{busy && <Spinner />}Entrar</button>
          </form>
          <p className="mt-5 text-center text-xs text-muted-foreground">Esqueceu a senha? Solicite a redefinição a um administrador.</p>
        </div>
      </section>
    </div>
  );
}
