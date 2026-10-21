import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Brand } from '../components/brand';
import { Field } from '../components/forms';
import { Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { errMsg, useAuth } from '../lib/app';

/** Tela exibida uma única vez: cadastro do primeiro administrador após a implantação. */
export default function Setup() {
  const { me, setup } = useAuth();
  const nav = useNavigate();
  const [status, setStatus] = useState<{ needsSetup: boolean; requiresToken: boolean } | null>(null);
  const [f, setF] = useState({ name: '', email: '', password: '', confirm: '', token: '' });
  const [err, setErr] = useState(''); const [fields, setFields] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false);

  useEffect(() => { api.get<{ needsSetup: boolean; requiresToken: boolean }>('/auth/setup-status').then(setStatus).catch(() => setStatus({ needsSetup: false, requiresToken: false })); }, []);

  if (me) return <Navigate to="/" replace />;
  if (!status) return <div className="flex h-full items-center justify-center"><Spinner className="h-8 w-8 text-primary" /></div>;
  if (!status.needsSetup) return <Navigate to="/login" replace />;

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(''); setFields({});
    try {
      await setup({ ...f, token: f.token || undefined });
      nav('/', { replace: true });
    } catch (x) {
      setErr(errMsg(x));
      if (x instanceof ApiError && x.fields) setFields(x.fields);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-background p-6">
      <div className="card w-full max-w-md p-7 shadow-xl">
        <div className="mb-6"><Brand /></div>
        <h1 className="font-display text-2xl font-bold">Configuração inicial</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cadastre o primeiro administrador. Esta tela só aparece uma vez, enquanto não houver usuários.</p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          <Field label="Nome completo" required error={fields.name}><input className="input" autoFocus autoComplete="name" value={f.name} onChange={set('name')} /></Field>
          <Field label="E-mail" required error={fields.email}><input className="input" type="email" autoComplete="username" value={f.email} onChange={set('email')} /></Field>
          <Field label="Senha" required error={fields.password}><input className="input" type="password" autoComplete="new-password" value={f.password} onChange={set('password')} /></Field>
          <Field label="Confirmar senha" required error={fields.confirm}><input className="input" type="password" autoComplete="new-password" value={f.confirm} onChange={set('confirm')} /></Field>
          {status.requiresToken && (
            <Field label="Código de configuração" required><input className="input" value={f.token} onChange={set('token')} /></Field>
          )}
          {err && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <button className="btn-primary w-full !py-2.5" disabled={busy || !f.name || !f.email || !f.password || !f.confirm}>{busy && <Spinner />}Criar administrador e entrar</button>
        </form>
      </div>
    </div>
  );
}
