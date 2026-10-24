import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import gsap from 'gsap';
import {
  Activity, AlertTriangle, Bot, Cake, CalendarClock, FileCheck2, Landmark, Layers, LineChart, Link2, ListChecks, ShoppingCart, Sparkles, ArrowDownToLine, ArrowUpFromLine, Bell, Boxes, Building2, ClipboardCheck, DatabaseBackup, FileBarChart, FolderTree, HandCoins, KeyRound, LayoutDashboard,
  ChevronDown, ChevronLeft, ChevronRight, LogOut, Menu, Moon, Package, Receipt, Scale, ScrollText, Settings, ShieldCheck, Sun, Tags, TrendingDown, TrendingUp, UserCog, UserMinus, UserPlus, Users, Wallet, X, type LucideIcon,
} from 'lucide-react';
import { useAuth, useTheme } from '../lib/app';
import { api } from '../lib/api';
import { Brand } from './brand';
import { useCompany } from '../lib/company';

interface Item { to: string; label: string; icon: LucideIcon; perm?: string[]; end?: boolean; soon?: boolean }
interface Group { label: string; icon: LucideIcon; perm: string[]; open?: boolean; items: Item[] }

const NAV: Group[] = [
  { label: 'Geral', icon: LayoutDashboard, perm: ['dash.view'], items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { label: 'Assistente', icon: Bot, perm: [], open: true, items: [{ to: '/assistente', label: 'Assistente de IA', icon: Sparkles, soon: true }] },
  { label: 'RH / Pessoal', icon: Users, perm: ['rh.view'], items: [
    { to: '/rh/funcionarios', label: 'Funcionários', icon: Users },
    { to: '/rh/celebracoes', label: 'Aniversários e tempo de casa', icon: Cake, soon: true },
    { to: '/rh/documentos', label: 'Documentos', icon: FileCheck2, soon: true },
    { to: '/rh/cadastros', label: 'Cargos e departamentos', icon: Building2 },
    { to: '/rh/relatorios', label: 'Relatórios', icon: FileBarChart },
  ] },
  { label: 'Financeiro', icon: Wallet, perm: ['fin.view'], items: [
    { to: '/financeiro', label: 'Visão geral', icon: Activity, end: true },
    { to: '/financeiro/receitas', label: 'Receitas', icon: TrendingUp },
    { to: '/financeiro/despesas', label: 'Despesas', icon: TrendingDown },
    { to: '/financeiro/fluxo-de-caixa', label: 'Fluxo de caixa', icon: LineChart, soon: true },
    { to: '/financeiro/contas', label: 'Contas e transferências', icon: Landmark, soon: true },
    { to: '/financeiro/conciliacao', label: 'Conciliação bancária', icon: Link2, soon: true },
    { to: '/financeiro/categorias', label: 'Categorias', icon: Tags },
    { to: '/financeiro/centros-de-custo', label: 'Centros de custo', icon: Layers, soon: true },
    { to: '/financeiro/relatorios', label: 'Relatórios', icon: FileBarChart },
  ] },
  { label: 'Estoque', icon: Boxes, perm: ['est.view'], items: [
    { to: '/estoque', label: 'Produtos', icon: Package, end: true },
    { to: '/estoque/movimentacoes', label: 'Movimentações', icon: ClipboardCheck },
    { to: '/estoque/pedidos', label: 'Pedidos de compra', icon: ShoppingCart, soon: true },
    { to: '/estoque/inventario', label: 'Inventário', icon: ListChecks, soon: true },
    { to: '/estoque/lotes', label: 'Lotes e validades', icon: CalendarClock, soon: true },
    { to: '/estoque/cadastros', label: 'Categorias e unidades', icon: FolderTree },
    { to: '/estoque/relatorios', label: 'Relatórios', icon: FileBarChart },
  ] },
  { label: 'Cadastros', icon: Users, perm: ['fin.view', 'est.view'], items: [
    { to: '/cadastros/parceiros', label: 'Clientes e fornecedores', icon: HandCoins, soon: true },
  ] },
  { label: 'Configurações', icon: Settings, perm: ['cfg.users', 'cfg.roles', 'cfg.audit', 'cfg.backup', 'cfg.settings'], items: [
    { to: '/config/empresa', label: 'Dados da empresa', icon: Building2, perm: ['cfg.settings'] },
    { to: '/config/usuarios', label: 'Usuários', icon: UserCog, perm: ['cfg.users'] },
    { to: '/config/perfis', label: 'Perfis e permissões', icon: ShieldCheck, perm: ['cfg.roles'] },
    { to: '/config/auditoria', label: 'Auditoria', icon: ScrollText, perm: ['cfg.audit'] },
    { to: '/config/backup', label: 'Backup', icon: DatabaseBackup, perm: ['cfg.backup'] },
    { to: '/config/parametros', label: 'Parâmetros', icon: Settings, perm: ['cfg.settings'] },
  ] },
];

interface Notice { id: string; text: string; to: string; tone: 'danger' | 'warning' }

function useNotices() {
  const [n, setN] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      let next = 2;
      try {
        const r = await api.get<{ refreshMinutes: number; notices: Notice[] }>('/dashboard/notices');
        if (alive) setN(r.notices);
        next = r.refreshMinutes || 2;
      } catch { /* notificações são opcionais */ }
      if (alive) timer = setTimeout(load, next * 60_000);
    };
    load();
    return () => { alive = false; clearTimeout(timer); };
  }, []);
  return n;
}

export function Layout() {
  const { me, can, logout } = useAuth();
  const { dark, toggle } = useTheme();
  const nav = useNavigate(); const loc = useLocation();
  // full = expandido · icons = minimalista (só ícones). No desktop o menu nunca some por completo.
  const [mode, setMode] = useState<'full' | 'icons'>(() => { try { return localStorage.getItem('gentis-sb-mode') === 'icons' ? 'icons' : 'full'; } catch { return 'full'; } });
  const collapsed = mode === 'icons';
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<'user' | 'bell' | null>(null);
  const notices = useNotices();
  const company = useCompany();
  const mainRef = useRef<HTMLElement>(null);
  const sbRef = useRef<HTMLElement>(null);

  useEffect(() => { setOpen(false); setMenu(null); }, [loc.pathname]);
  useEffect(() => { try { localStorage.setItem('gentis-sb-mode', mode); } catch { /* ignore */ } }, [mode]);
  const toggleIcons = () => setMode((m) => (m === 'icons' ? 'full' : 'icons'));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); if (window.innerWidth >= 1024) toggleIcons(); else setOpen((o) => !o); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  // Página nova sempre abre no topo: o <main> é o que rola e não é recriado ao trocar de rota, então a posição anterior ficava guardada.
  useEffect(() => { mainRef.current?.scrollTo({ top: 0, left: 0 }); window.scrollTo(0, 0); }, [loc.pathname]);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(mainRef.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out', clearProps: 'all' });
  }, [loc.pathname]);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.from(sbRef.current!.querySelectorAll('[data-nav]'), { x: -14, opacity: 0, duration: 0.4, stagger: 0.025, ease: 'power2.out', delay: 0.1, clearProps: 'all' });
  }, []);

  const groups = NAV.filter((g) => g.open || can(...g.perm));
  // Módulos expansíveis: abre o da rota atual; o usuário pode abrir/fechar vários ao mesmo tempo.
  const groupOfPath = () => groups.find((g) => g.items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to))))?.label ?? null;
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => { const g = groupOfPath(); if (g) setOpenGroups((s) => (s.has(g) ? s : new Set(s).add(g))); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [loc.pathname, groups.length]);
  const toggleGroup = (label: string) => setOpenGroups((s) => { const n = new Set(s); if (n.has(label)) n.delete(label); else n.add(label); return n; });
  const sidebar = (
    <aside ref={sbRef} className={`flex h-full flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ${collapsed ? 'lg:w-[72px]' : 'lg:w-64'} w-72`}>
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Link to="/" aria-label="Gentis — início"><Brand compact={collapsed} light /></Link>
        <button className="rounded-lg p-1.5 text-sidebar-muted hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu"><X className="h-5 w-5" /></button>
      </div>
      <nav className={`sb-scroll flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 pb-3 ${collapsed ? 'sb-collapsed' : ''}`} aria-label="Menu principal">
        {groups.map((g) => {
          const items = g.items.filter((i) => !i.perm || can(...i.perm));
          const link = (i: Item) => (
            <NavLink to={i.to} end={i.end} title={collapsed ? i.label : undefined}
              className={({ isActive }) => `group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition ${collapsed ? 'lg:justify-center' : ''} ${isActive ? 'bg-primary text-primary-foreground shadow-md' : 'text-sidebar-foreground/80 hover:bg-white/10 hover:text-white'}`}>
              <i.icon className="h-[18px] w-[18px] shrink-0" /><span className={collapsed ? 'lg:hidden' : ''}>{i.label}</span>{i.soon && <span className={`ml-auto shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none ${collapsed ? 'lg:hidden' : ''}`}>Em breve</span>}
            </NavLink>
          );
          if (collapsed) return <ul key={g.label} data-nav className="space-y-0.5 border-b border-white/10 pb-2 last:border-0">{items.map((i) => <li key={i.to}>{link(i)}</li>)}</ul>;
          if (items.length === 1 && (g.label === 'Geral' || g.label === 'Assistente')) return <div key={g.label} data-nav className="pb-1">{link(items[0])}</div>;
          const isOpen = openGroups.has(g.label) && !collapsed;
          const hasActive = items.some((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to)));
          return (
            <div key={g.label} data-nav>
              <button type="button" aria-expanded={isOpen} title={collapsed ? g.label : undefined}
                onClick={() => { if (collapsed) { setMode('full'); setOpenGroups((s) => new Set(s).add(g.label)); } else toggleGroup(g.label); }}
                className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-semibold transition hover:bg-white/10 ${collapsed ? 'lg:justify-center' : ''} ${hasActive ? 'text-white' : 'text-sidebar-foreground/75'}`}>
                <g.icon className={`h-[18px] w-[18px] shrink-0 ${hasActive ? 'text-[#5eead4]' : ''}`} />
                <span className={`flex-1 text-left ${collapsed ? 'lg:hidden' : ''}`}>{g.label}</span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-sidebar-muted transition-transform ${isOpen ? 'rotate-180' : ''} ${collapsed ? 'lg:hidden' : ''}`} />
              </button>
              <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <ul className="min-h-0 space-y-0.5 overflow-hidden pl-3">
                  {items.map((i) => <li key={i.to} className="border-l border-white/10 pl-2">{isOpen ? link(i) : <span className="block h-0" />}</li>)}
                </ul>
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <div className="flex h-full">
      <div className="relative hidden shrink-0 lg:block">
        {sidebar}
        <button onClick={toggleIcons} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'} title={`${collapsed ? 'Expandir' : 'Recolher'} menu (Ctrl+B)`}
          className="absolute -right-3.5 top-20 z-20 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-lg ring-1 ring-primary/40 transition hover:scale-110 hover:brightness-110 focus-visible:scale-110">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/55" onClick={() => setOpen(false)} />
          <div className="relative h-full w-72 max-w-[85vw]">{sidebar}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-2 border-b bg-background/85 px-3 backdrop-blur sm:h-16 sm:gap-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu"><Menu className="h-5 w-5" /></button>
            <span className="font-display text-base font-bold tracking-tight sm:text-lg">Gentis <span className="hidden font-sans text-xs font-medium text-muted-foreground sm:inline">· {company?.tradeName || company?.legalName || 'Gestão de pessoas e negócios'}</span></span>
          </div>
          <div className="flex items-center gap-1.5">
            <button className="rounded-lg p-2 hover:bg-muted" onClick={toggle} aria-label={dark ? 'Tema claro' : 'Tema escuro'}>{dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}</button>
            <div className="relative">
              <button className="relative rounded-lg p-2 hover:bg-muted" onClick={() => setMenu(menu === 'bell' ? null : 'bell')} aria-label={`Notificações (${notices.length})`} aria-expanded={menu === 'bell'}>
                <Bell className="h-5 w-5" />{notices.length > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-background" />}
              </button>
              {menu === 'bell' && (
                <div className="absolute right-0 mt-2 w-80 max-w-[88vw] rounded-xl border bg-card p-2 shadow-xl">
                  <p className="px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">Notificações</p>
                  {notices.length === 0 ? <p className="px-2 py-4 text-center text-sm text-muted-foreground">Nenhum alerta no momento.</p> : notices.map((n) => (
                    <Link key={n.id} to={n.to} className="flex items-start gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-muted">
                      <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${n.tone === 'danger' ? 'text-danger' : 'text-warning'}`} />{n.text}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <button className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-muted" onClick={() => setMenu(menu === 'user' ? null : 'user')} aria-expanded={menu === 'user'} aria-label="Menu do usuário">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{me!.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
                <span className="hidden text-left leading-tight sm:block"><span className="block text-sm font-semibold">{me!.name.split(' ')[0]}</span><span className="block text-[11px] text-muted-foreground">{me!.role}</span></span>
              </button>
              {menu === 'user' && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl border bg-card p-1.5 shadow-xl">
                  <div className="border-b px-3 py-2"><p className="truncate text-sm font-semibold">{me!.name}</p><p className="truncate text-xs text-muted-foreground">{me!.email}</p></div>
                  <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm hover:bg-muted" onClick={() => nav('/perfil/senha')}><KeyRound className="h-4 w-4" />Alterar senha</button>
                  <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-muted" onClick={async () => { await logout(); nav('/login'); }}><LogOut className="h-4 w-4" />Sair</button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main ref={mainRef} className="flex-1 overflow-y-auto p-3 sm:p-5 lg:p-6" onClick={() => menu && setMenu(null)}>
          <div className="w-full"><Outlet /></div>
        </main>
      </div>
    </div>
  );
}
