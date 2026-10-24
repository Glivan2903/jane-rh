import { Bot, Boxes, Sparkles, Users, Wallet, type LucideIcon } from 'lucide-react';

/** Apresentação de novidades mostrada depois do login. Troque VERSION a cada novo pacote de novidades para voltar a aparecer para quem marcou "não mostrar". */
export const NEWS_VERSION = '2026-10';
export interface Slide { icon: LucideIcon; title: string; lead: string; items?: { title: string; text: string }[] }

export const SLIDES: Slide[] = [
  { icon: Sparkles, title: 'O Gentis está ganhando novas telas', lead: 'Em breve você vai encontrar novos itens no menu, marcados com "Em breve". Cada um mostra o que vai poder fazer. Eles ficam disponíveis assim que o administrador liberar, e o que você já usa continua igual.' },
  { icon: Bot, title: 'Assistente de IA', lead: 'Pergunte em linguagem do dia a dia e receba a resposta na hora.', items: [
    { title: 'Converse do seu jeito', text: '"Quanto gastei este mês?" ou "quais produtos estão acabando?"' },
    { title: 'Tabelas e gráficos', text: 'Respostas organizadas, com exportação para CSV.' },
    { title: 'Acesso definido pelo administrador', text: 'Cada usuário consulta só as áreas que o administrador liberar.' },
  ] },
  { icon: Wallet, title: 'Financeiro', lead: 'Mais controle sobre o dinheiro da empresa.', items: [
    { title: 'Fluxo de caixa', text: 'Entradas, saídas e projeção dos próximos dias.' },
    { title: 'Contas e transferências', text: 'Saldo de cada conta e transferência entre elas.' },
    { title: 'Conciliação bancária', text: 'Compare o extrato do banco com os seus lançamentos.' },
    { title: 'Centros de custo', text: 'Veja quanto cada área gasta e recebe.' },
  ] },
  { icon: Boxes, title: 'Estoque', lead: 'Do pedido ao fornecedor até a contagem do que está na prateleira.', items: [
    { title: 'Pedidos de compra', text: 'Receba a mercadoria e gere a conta a pagar.' },
    { title: 'Inventário', text: 'Conte o estoque, com leitura de código de barras pela câmera.' },
    { title: 'Lotes e validades', text: 'Saiba o que vence antes de perder.' },
  ] },
  { icon: Users, title: 'Pessoal e cadastros', lead: 'Informações de pessoas e parceiros em um só lugar.', items: [
    { title: 'Aniversários e tempo de casa', text: 'Quem faz aniversário e quem completa tempo de empresa.' },
    { title: 'Documentos dos funcionários', text: 'Arquivos e vencimentos de cada pessoa.' },
    { title: 'Clientes e fornecedores', text: 'Um cadastro único para financeiro e estoque.' },
    { title: 'Importar planilhas', text: 'Traga produtos e cadastros de uma planilha Excel ou CSV.' },
  ] },
];


const FLAG = 'gentis:news-on-login';
const hideKey = (userId: string) => `gentis:news-hide:${userId}`;
/** Chamado no login: marca que a apresentação deve abrir assim que o sistema carregar. */
export const markNewsForLogin = () => { try { sessionStorage.setItem(FLAG, '1'); } catch { /* sem armazenamento */ } };
/** Consome a marca do login; só devolve true uma vez e se o usuário não pediu para ocultar esta versão. */
export function shouldShowNews(userId: string): boolean {
  try {
    if (sessionStorage.getItem(FLAG) !== '1') return false;
    sessionStorage.removeItem(FLAG);
    return localStorage.getItem(hideKey(userId)) !== NEWS_VERSION;
  } catch { return false; }
}
export function setHideNews(userId: string, hide: boolean) {
  try { hide ? localStorage.setItem(hideKey(userId), NEWS_VERSION) : localStorage.removeItem(hideKey(userId)); } catch { /* sem armazenamento */ }
}
export const isNewsHidden = (userId: string) => { try { return localStorage.getItem(hideKey(userId)) === NEWS_VERSION; } catch { return false; } };
