import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, ConfirmProvider, ToastProvider, useAuth } from './lib/app';
import { Layout } from './components/Layout';
import { ErrorBox, Spinner } from './components/ui';
import { WifiOff } from 'lucide-react';
import Login from './pages/Login';
import Setup from './pages/Setup';
import ChangePassword from './pages/ChangePassword';
import Dashboard from './pages/Dashboard';
import ComingSoon from './pages/ComingSoon';

const Employees = lazy(() => import('./pages/rh/Employees'));
const EmployeeForm = lazy(() => import('./pages/rh/EmployeeForm'));
const EmployeeDetail = lazy(() => import('./pages/rh/EmployeeDetail'));
const RhReports = lazy(() => import('./pages/rh/Reports'));
const RhCatalogs = lazy(() => import('./pages/rh/Processes').then((m) => ({ default: m.RhCatalogs })));
const FinOverview = lazy(() => import('./pages/fin/Overview'));
const Transactions = lazy(() => import('./pages/fin/Transactions'));
const Categories = lazy(() => import('./pages/fin/Categories'));
const FinReports = lazy(() => import('./pages/fin/Reports'));
const Products = lazy(() => import('./pages/est/Products'));
const Movements = lazy(() => import('./pages/est/Movements'));
const EstCatalogs = lazy(() => import('./pages/est/Misc').then((m) => ({ default: m.EstCatalogs })));
const EstReports = lazy(() => import('./pages/est/Misc').then((m) => ({ default: m.EstReports })));
const Users = lazy(() => import('./pages/cfg/Users'));
const Roles = lazy(() => import('./pages/cfg/Roles'));
const Audit = lazy(() => import('./pages/cfg/Audit'));
const Backup = lazy(() => import('./pages/cfg/Backup'));
const Settings = lazy(() => import('./pages/cfg/Settings'));
const CompanyPage = lazy(() => import('./pages/cfg/Company'));

function Protected({ children }: { children: JSX.Element }) {
  const { me, loading, netError, refresh } = useAuth(); const loc = useLocation();
  if (loading) return <div className="flex h-full items-center justify-center"><Spinner className="h-8 w-8 text-primary" /></div>;
  if (!me && netError) return (
    <div className="flex h-full items-center justify-center p-6"><div className="card max-w-sm p-6 text-center">
      <WifiOff className="mx-auto h-10 w-10 text-muted-foreground" /><h1 className="mt-3 font-display text-lg font-bold">Sem conexão com a internet</h1>
      <p className="mt-1 text-sm text-muted-foreground">O Gentis precisa de internet para carregar os seus dados. Verifique a conexão: tentamos de novo sozinhos assim que ela voltar.</p>
      <button className="btn-primary mt-4" onClick={() => refresh()}>Tentar novamente</button>
    </div></div>);
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (me.mustChangePassword && loc.pathname !== '/perfil/senha') return <Navigate to="/perfil/senha" replace />;
  return children;
}
/** Oculta rotas sem permissão (o servidor valida de qualquer forma). */
function Guard({ perm, children }: { perm: string[]; children: JSX.Element }) {
  const { can } = useAuth();
  return can(...perm) ? children : <div className="mx-auto max-w-md pt-10"><ErrorBox message="Você não tem permissão para acessar esta página." /></div>;
}
const g = (perm: string, el: JSX.Element) => <Guard perm={[perm]}>{el}</Guard>;

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider><ConfirmProvider><AuthProvider>
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Spinner className="h-8 w-8 text-primary" /></div>}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/configurar" element={<Setup />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route index element={g('dash.view', <Dashboard />)} />
              <Route path="perfil/senha" element={<ChangePassword />} />
              <Route path="rh/funcionarios" element={g('rh.view', <Employees />)} />
              <Route path="rh/funcionarios/novo" element={g('rh.create', <EmployeeForm />)} />
              <Route path="rh/funcionarios/:id" element={g('rh.view', <EmployeeDetail />)} />
              <Route path="rh/funcionarios/:id/editar" element={g('rh.edit', <EmployeeForm />)} />
              <Route path="rh/admissao" element={<Navigate to="/rh/funcionarios" replace />} />
              <Route path="rh/desligamento" element={<Navigate to="/rh/funcionarios" replace />} />
              <Route path="alertas" element={<Guard perm={['fin.view', 'est.view', 'rh.view']}><ComingSoon slug="alertas" /></Guard>} />
              <Route path="assistente" element={<ComingSoon slug="assistente" />} />
              <Route path="rh/celebracoes" element={g('rh.view', <ComingSoon slug="rh-celebracoes" />)} />
              <Route path="rh/documentos" element={g('rh.view', <ComingSoon slug="rh-documentos" />)} />
              <Route path="financeiro/fluxo-de-caixa" element={g('fin.view', <ComingSoon slug="fin-fluxo" />)} />
              <Route path="financeiro/contas" element={g('fin.view', <ComingSoon slug="fin-contas" />)} />
              <Route path="financeiro/conciliacao" element={g('fin.view', <ComingSoon slug="fin-conciliacao" />)} />
              <Route path="financeiro/centros-de-custo" element={g('fin.view', <ComingSoon slug="fin-centros" />)} />
              <Route path="estoque/pedidos" element={g('est.view', <ComingSoon slug="est-pedidos" />)} />
              <Route path="estoque/inventario" element={g('est.view', <ComingSoon slug="est-inventario" />)} />
              <Route path="estoque/lotes" element={g('est.view', <ComingSoon slug="est-lotes" />)} />
              <Route path="cadastros/importar" element={<Guard perm={['fin.view', 'est.view']}><ComingSoon slug="cad-importar" /></Guard>} />
              <Route path="cadastros/parceiros" element={<Guard perm={['fin.view', 'est.view']}><ComingSoon slug="cad-parceiros" /></Guard>} />
              <Route path="rh/cadastros" element={g('rh.view', <RhCatalogs />)} />
              <Route path="rh/relatorios" element={g('rh.view', <RhReports />)} />
              <Route path="financeiro" element={g('fin.view', <FinOverview />)} />
              <Route path="financeiro/receitas" element={g('fin.view', <Transactions type="receita" />)} />
              <Route path="financeiro/despesas" element={g('fin.view', <Transactions type="despesa" />)} />
              <Route path="financeiro/categorias" element={g('fin.view', <Categories />)} />
              <Route path="financeiro/relatorios" element={g('fin.view', <FinReports />)} />
              <Route path="estoque" element={g('est.view', <Products />)} />
              <Route path="estoque/entrada" element={<Navigate to="/estoque" replace />} />
              <Route path="estoque/saida" element={<Navigate to="/estoque" replace />} />
              <Route path="estoque/ajuste" element={<Navigate to="/estoque" replace />} />
              <Route path="estoque/movimentacoes" element={g('est.view', <Movements />)} />
              <Route path="estoque/cadastros" element={g('est.view', <EstCatalogs />)} />
              <Route path="estoque/relatorios" element={g('est.view', <EstReports />)} />
              <Route path="config/empresa" element={g('cfg.settings', <CompanyPage />)} />
              <Route path="config/usuarios" element={g('cfg.users', <Users />)} />
              <Route path="config/perfis" element={g('cfg.roles', <Roles />)} />
              <Route path="config/auditoria" element={g('cfg.audit', <Audit />)} />
              <Route path="config/backup" element={g('cfg.backup', <Backup />)} />
              <Route path="config/parametros" element={g('cfg.settings', <Settings />)} />
              <Route path="*" element={<div className="py-20 text-center"><p className="font-display text-5xl font-bold text-primary">404</p><p className="mt-2 text-muted-foreground">Página não encontrada.</p></div>} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider></ConfirmProvider></ToastProvider>
    </BrowserRouter>
  );
}
