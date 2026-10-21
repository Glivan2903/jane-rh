import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/ui';
import { FInput, SubmitButton } from '../components/forms';
import { api } from '../lib/api';
import { useAuth, useToast } from '../lib/app';
import { useForm } from '../lib/hooks';

export default function ChangePassword() {
  const { me, refresh, logout } = useAuth();
  const f = useForm({ current: '', password: '', confirm: '' });
  const toast = useToast(); const nav = useNavigate();
  const forced = me?.mustChangePassword;

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.v.current) e.current = 'Informe a senha atual';
    if (f.v.password.length < 10 || !/[A-Za-z]/.test(f.v.password) || !/\d/.test(f.v.password)) e.password = 'Mínimo de 10 caracteres, com letras e números';
    if (f.v.confirm !== f.v.password) e.confirm = 'As senhas não conferem';
    return e;
  };

  return (
    <div className="mx-auto max-w-md">
      <PageHeader back={!forced} title="Alterar senha" subtitle={forced ? 'Por segurança, defina uma nova senha para continuar.' : 'Suas outras sessões serão encerradas após a alteração.'} />
      <form className="card space-y-4 p-5" onSubmit={async (e) => {
        e.preventDefault();
        const ok = await f.submit(() => api.post('/auth/change-password', f.v), validate);
        if (ok) { toast.success('Senha alterada com sucesso.'); await refresh(); nav('/', { replace: true }); }
      }}>
        <FInput f={f} name="current" label="Senha atual" type="password" required autoComplete="current-password" />
        <FInput f={f} name="password" label="Nova senha" type="password" required autoComplete="new-password" hint="Mínimo de 10 caracteres, com letras e números." />
        <FInput f={f} name="confirm" label="Confirmar nova senha" type="password" required autoComplete="new-password" />
        <div className="flex justify-end gap-2">
          {forced && <button type="button" className="btn-ghost" onClick={async () => { await logout(); nav('/login'); }}>Sair</button>}
          <SubmitButton busy={f.busy}>Salvar nova senha</SubmitButton>
        </div>
      </form>
    </div>
  );
}
