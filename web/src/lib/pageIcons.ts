import { Activity, Bot, Building2, Cake, ClipboardCheck, DatabaseBackup, FileBarChart, FileCheck2, FolderTree, HandCoins, KeyRound, Landmark, Layers, LayoutDashboard, LineChart, Link2, Package, ScrollText, Settings,
  ShieldCheck, Tags, TrendingDown, TrendingUp, UserCog, UserPlus, Users, Wallet, type LucideIcon } from 'lucide-react';

/** Ícone de cada página (usado no destaque do topo). Vale o prefixo mais específico. */
const MAP: [string, LucideIcon][] = [
  ['/rh/funcionarios/novo', UserPlus], ['/rh/funcionarios', Users], ['/rh/celebracoes', Cake], ['/rh/documentos', FileCheck2], ['/rh/cadastros', Building2], ['/rh/relatorios', FileBarChart],
  ['/financeiro/receitas', TrendingUp], ['/financeiro/despesas', TrendingDown], ['/financeiro/fluxo-de-caixa', LineChart], ['/financeiro/contas', Landmark], ['/financeiro/conciliacao', Link2],
  ['/financeiro/categorias', Tags], ['/financeiro/centros-de-custo', Layers], ['/financeiro/relatorios', FileBarChart], ['/financeiro', Activity],
  ['/estoque/movimentacoes', ClipboardCheck], ['/estoque/cadastros', FolderTree], ['/estoque/relatorios', FileBarChart], ['/estoque', Package],
  ['/cadastros/parceiros', HandCoins], ['/assistente', Bot],
  ['/config/empresa', Building2], ['/config/usuarios', UserCog], ['/config/perfis', ShieldCheck], ['/config/auditoria', ScrollText], ['/config/backup', DatabaseBackup],
  ['/config/parametros', Settings], ['/config/assistente-ia', Bot], ['/perfil/senha', KeyRound],
].sort((a, b) => b[0].length - a[0].length) as [string, LucideIcon][];

export function iconForPath(pathname: string): LucideIcon {
  if (pathname === '/') return LayoutDashboard;
  const hit = MAP.find(([p]) => pathname === p || pathname.startsWith(p + '/'));
  return hit ? hit[1] : (pathname.startsWith('/financeiro') ? Wallet : LayoutDashboard);
}
