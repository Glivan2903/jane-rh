/** Funcionalidades já prontas em homologação e ainda não liberadas em produção. Cada uma abre uma tela "Em breve". */
export interface SoonFeature { slug: string; label: string; headline: string; description: string; bullets: string[] }

export const SOON: Record<string, SoonFeature> = {
  assistente: {
    slug: 'assistente', label: 'Assistente de IA', headline: 'Pergunte ao sistema, em português',
    description: 'Faça perguntas como "quanto gastei este mês?" ou "quais produtos estão acabando?" e receba a resposta na hora, com números, tabelas e gráficos.',
    bullets: ['Consulta financeiro, estoque e pessoal, só no que o administrador liberar para cada usuário.', 'CPF e documentos dos funcionários nunca são enviados ao modelo de IA.', 'Cada pessoa vê apenas o próprio histórico de conversas.', 'Apenas consulta: não altera nenhum dado do sistema.'],
  },
  'rh-celebracoes': {
    slug: 'rh-celebracoes', label: 'Aniversários e tempo de casa', headline: 'Quem faz aniversário e quem completa tempo de empresa',
    description: 'Acompanhe os aniversariantes e os aniversários de admissão dos funcionários ativos, sem precisar procurar na ficha de cada um.',
    bullets: ['Próximos 30 dias, inclusive na virada do mês e do ano.', 'Destaque para quem faz aniversário hoje.', 'Calendário do mês com navegação mês a mês.'],
  },
  'rh-documentos': {
    slug: 'rh-documentos', label: 'Documentos dos funcionários', headline: 'Documentos na ficha e aviso antes de vencer',
    description: 'Guarde ASO, contratos, CNH e certificados na ficha do funcionário e saiba o que está vencido ou perto de vencer.',
    bullets: ['Tipos de documento configuráveis, com o prazo de aviso de cada um.', 'Avisos de vencimento no sino do sistema.', 'Arquivos em PDF, PNG ou JPG guardados com segurança e com registro de cada download.', 'Acesso restrito a quem tiver a permissão de documentos do RH.'],
  },
  'fin-fluxo': {
    slug: 'fin-fluxo', label: 'Fluxo de caixa projetado', headline: 'O saldo dos próximos 30, 60 e 90 dias',
    description: 'Veja como o caixa deve ficar com base nas contas a pagar e a receber, e seja avisado antes de o saldo ficar negativo.',
    bullets: ['Projeção por dia, partindo do saldo atual das contas.', 'Alerta quando o saldo previsto fica negativo.', 'Contas vencidas entram no primeiro dia da projeção.'],
  },
  'fin-contas': {
    slug: 'fin-contas', label: 'Contas e transferências', headline: 'Saldo de cada conta bancária e do caixa',
    description: 'Cadastre as contas da empresa, escolha de qual conta cada lançamento saiu e registre transferências entre elas.',
    bullets: ['Saldo calculado automaticamente a partir dos lançamentos baixados.', 'Os lançamentos que já existem continuam valendo, na conta padrão.', 'Transferências entre contas sem alterar o total.'],
  },
  'fin-conciliacao': {
    slug: 'fin-conciliacao', label: 'Conciliação bancária', headline: 'Confira o extrato do banco com o sistema',
    description: 'Importe o extrato do banco (arquivo OFX) e o sistema sugere a qual lançamento cada linha corresponde.',
    bullets: ['Importação sem duplicar linhas se o mesmo arquivo for enviado de novo.', 'Concilia e já registra a baixa do pagamento ou do recebimento.', 'Cria o lançamento quando a linha do banco ainda não existe no sistema.'],
  },
  'fin-centros': {
    slug: 'fin-centros', label: 'Centros de custo', headline: 'Resultado por área, projeto ou unidade',
    description: 'Classifique receitas e despesas por centro de custo e veja quanto cada área gasta e gera.',
    bullets: ['Escolha do centro de custo em cada lançamento.', 'Filtro nas listas e relatório de resultado por centro de custo.'],
  },
  'cad-parceiros': {
    slug: 'cad-parceiros', label: 'Clientes e fornecedores', headline: 'Um só cadastro para financeiro e estoque',
    description: 'Cadastre clientes e fornecedores uma vez e use nos lançamentos financeiros e nas movimentações de estoque.',
    bullets: ['CPF ou CNPJ validado, sem cadastro duplicado.', 'Os fornecedores que você já usa no estoque são mantidos.', 'Escolha do cliente ou fornecedor direto no lançamento.'],
  },
};
