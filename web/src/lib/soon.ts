/** Funcionalidades já desenvolvidas em homologação e ainda não liberadas neste ambiente. Cada uma abre uma tela "Em breve". */
export type SoonIcon =
  | 'bot' | 'message' | 'chart' | 'wallet' | 'boxes' | 'users' | 'history' | 'shield' | 'cake' | 'award' | 'calendar' | 'party' | 'compass' | 'file' | 'list' | 'bell' | 'upload'
  | 'alert' | 'line' | 'clock' | 'landmark' | 'scale' | 'transfer' | 'tag' | 'link' | 'check' | 'plus' | 'undo' | 'layers' | 'filter' | 'report' | 'id' | 'merge' | 'cart' | 'checklist' | 'barcode' | 'package' | 'receipt';

export interface SoonItem { icon: SoonIcon; title: string; text: string }
export interface SoonFeature { slug: string; label: string; icon: SoonIcon; headline: string; /* vazio: sem linha de destaque */ description: string; items: SoonItem[] }

export const SOON: Record<string, SoonFeature> = {
  assistente: {
    slug: 'assistente', label: 'Assistente de IA', icon: 'bot', headline: '',
    description: 'Faça perguntas do dia a dia sobre financeiro, estoque e pessoal e receba a resposta na hora, direto no sistema.',
    items: [
      { icon: 'message', title: 'Converse do seu jeito', text: 'Pergunte "quanto gastei este mês?" ou "quais produtos estão acabando?" sem procurar em telas e relatórios.' },
      { icon: 'chart', title: 'Tabelas e gráficos', text: 'As respostas podem vir em tabelas e gráficos, com exportação para CSV.' },
      { icon: 'wallet', title: 'Financeiro', text: 'Resultado do mês, contas vencidas, saldo das contas e projeção do caixa.' },
      { icon: 'boxes', title: 'Estoque', text: 'Produtos abaixo do mínimo, valor do estoque e movimentações.' },
      { icon: 'users', title: 'Pessoal', text: 'Funcionários por departamento, aniversariantes e tempo de casa.' },
      { icon: 'history', title: 'Histórico de conversas', text: 'Volte a qualquer conversa anterior e continue de onde parou.' },
      { icon: 'shield', title: 'Acesso definido pelo administrador', text: 'O administrador escolhe quem usa o assistente e quais áreas cada usuário pode consultar.' },
    ],
  },
  'rh-celebracoes': {
    slug: 'rh-celebracoes', label: 'Aniversários e tempo de casa', icon: 'cake', headline: 'Quem faz aniversário e quem completa tempo de empresa',
    description: 'Acompanhe os aniversários e os aniversários de admissão dos funcionários ativos em uma única tela.',
    items: [
      { icon: 'cake', title: 'Aniversariantes do mês', text: 'Lista por dia, com a idade que cada pessoa completa.' },
      { icon: 'award', title: 'Tempo de casa', text: 'Quem completa 1, 2, 5, 10 anos de empresa, com destaque para as datas redondas.' },
      { icon: 'calendar', title: 'Próximos 30 dias', text: 'Visão do que vem pela frente, inclusive na virada do mês e do ano.' },
      { icon: 'party', title: 'Destaque de hoje', text: 'Quem comemora hoje aparece em evidência no topo da tela.' },
      { icon: 'compass', title: 'Navegação mês a mês', text: 'Avance e volte pelos meses para planejar homenagens e comunicados.' },
    ],
  },
  'rh-documentos': {
    slug: 'rh-documentos', label: 'Documentos dos funcionários', icon: 'file', headline: 'Documentos na ficha e aviso antes de vencer',
    description: 'Guarde ASO, contratos, CNH e certificados na ficha de cada funcionário e saiba o que está vencido ou perto de vencer.',
    items: [
      { icon: 'file', title: 'Documentos na ficha', text: 'Adicione, consulte, baixe e substitua documentos direto na ficha do funcionário.' },
      { icon: 'list', title: 'Tipos configuráveis', text: 'Defina os tipos de documento, se têm validade e quantos dias antes avisar.' },
      { icon: 'bell', title: 'Avisos de vencimento', text: 'Documentos vencidos e a vencer aparecem no sino do sistema.' },
      { icon: 'upload', title: 'Envio de arquivos', text: 'Anexe arquivos em PDF, PNG ou JPG a cada documento.' },
      { icon: 'alert', title: 'Painel de vencimentos', text: 'Uma lista com todos os documentos que exigem atenção, com filtros por situação e tipo.' },
    ],
  },
  'fin-fluxo': {
    slug: 'fin-fluxo', label: 'Fluxo de caixa projetado', icon: 'line', headline: 'O saldo dos próximos 30, 60 e 90 dias',
    description: 'Veja como o caixa deve ficar com base nas contas a pagar e a receber e antecipe os períodos de aperto.',
    items: [
      { icon: 'line', title: 'Projeção do saldo', text: 'Gráfico do saldo dia a dia, partindo do saldo atual das contas.' },
      { icon: 'calendar', title: '30, 60 ou 90 dias', text: 'Escolha o horizonte da projeção conforme a necessidade.' },
      { icon: 'alert', title: 'Alerta de saldo negativo', text: 'Aviso com a data e o valor do menor saldo previsto.' },
      { icon: 'clock', title: 'Movimentos por dia', text: 'Quanto entra e quanto sai em cada data de vencimento.' },
      { icon: 'landmark', title: 'Por conta ou geral', text: 'Projete todas as contas juntas ou uma conta específica.' },
    ],
  },
  'fin-contas': {
    slug: 'fin-contas', label: 'Contas e transferências', icon: 'landmark', headline: 'Saldo de cada conta bancária e do caixa',
    description: 'Cadastre as contas da empresa, acompanhe o saldo de cada uma e registre as transferências entre elas.',
    items: [
      { icon: 'landmark', title: 'Contas e caixas', text: 'Cadastre contas correntes, poupanças, caixas e cartões.' },
      { icon: 'scale', title: 'Saldo de cada conta', text: 'Calculado automaticamente a partir dos lançamentos pagos e recebidos.' },
      { icon: 'transfer', title: 'Transferências', text: 'Mova valores entre contas sem alterar o total da empresa.' },
      { icon: 'tag', title: 'Conta em cada lançamento', text: 'Informe de qual conta cada pagamento saiu e em qual cada recebimento entrou.' },
      { icon: 'report', title: 'Extrato da conta', text: 'Relatório com a movimentação e o saldo corrido de cada conta.' },
    ],
  },
  'fin-conciliacao': {
    slug: 'fin-conciliacao', label: 'Conciliação bancária', icon: 'link', headline: 'Confira o extrato do banco com o sistema',
    description: 'Importe o extrato do banco e confirme, linha a linha, o que já está lançado no sistema.',
    items: [
      { icon: 'upload', title: 'Importação do extrato', text: 'Envie o arquivo OFX do seu banco. Enviar o mesmo arquivo de novo não duplica linhas.' },
      { icon: 'link', title: 'Sugestões automáticas', text: 'O sistema aponta o lançamento que corresponde a cada linha, por valor e data.' },
      { icon: 'check', title: 'Concilia e dá baixa', text: 'Ao conciliar uma conta pendente, o pagamento ou recebimento já é registrado.' },
      { icon: 'plus', title: 'Cria o lançamento', text: 'Quando a linha do banco ainda não existe no sistema, crie o lançamento na hora.' },
      { icon: 'undo', title: 'Desfazer e ignorar', text: 'Ignore linhas que não interessam ou desfaça uma conciliação feita por engano.' },
    ],
  },
  'fin-centros': {
    slug: 'fin-centros', label: 'Centros de custo', icon: 'layers', headline: 'Resultado por área, projeto ou unidade',
    description: 'Classifique receitas e despesas por centro de custo e veja quanto cada área gasta e gera.',
    items: [
      { icon: 'layers', title: 'Centros de custo', text: 'Cadastre as áreas, projetos ou unidades da empresa.' },
      { icon: 'tag', title: 'Classificação dos lançamentos', text: 'Escolha o centro de custo ao registrar cada receita ou despesa.' },
      { icon: 'filter', title: 'Filtros nas listas', text: 'Veja somente os lançamentos de um centro de custo ou os que ainda não têm classificação.' },
      { icon: 'report', title: 'Relatório de resultado', text: 'Receitas, despesas e resultado de cada centro de custo no período.' },
    ],
  },
  'cad-parceiros': {
    slug: 'cad-parceiros', label: 'Clientes e fornecedores', icon: 'users', headline: 'Um só cadastro para financeiro e estoque',
    description: 'Cadastre clientes e fornecedores uma única vez e use nos lançamentos financeiros e nas movimentações de estoque.',
    items: [
      { icon: 'merge', title: 'Cadastro único', text: 'O mesmo cadastro vale para o financeiro e para o estoque.' },
      { icon: 'id', title: 'CPF e CNPJ validados', text: 'Documento conferido, sem cadastros duplicados.' },
      { icon: 'tag', title: 'Cliente, fornecedor ou ambos', text: 'Marque o tipo e filtre a lista por ele.' },
      { icon: 'link', title: 'Escolha no lançamento', text: 'Selecione o cliente ou fornecedor direto ao registrar receitas e despesas.' },
      { icon: 'report', title: 'Movimento por cadastro', text: 'Relatório do que foi comprado e vendido com cada cliente e fornecedor.' },
    ],
  },
  'est-pedidos': {
    slug: 'est-pedidos', label: 'Pedidos de compra', icon: 'cart', headline: 'Do pedido ao estoque e ao contas a pagar',
    description: 'Faça o pedido ao fornecedor, receba a mercadoria no estoque e gere a conta a pagar no financeiro, tudo no mesmo lugar.',
    items: [
      { icon: 'cart', title: 'Pedido com vários produtos', text: 'Monte o pedido com os produtos, quantidades e custos, salve como rascunho e envie quando estiver pronto.' },
      { icon: 'package', title: 'Recebimento parcial ou total', text: 'Registre cada entrega que chega. Cada recebimento já dá entrada no estoque.' },
      { icon: 'clock', title: 'Lote e validade no recebimento', text: 'Para produtos controlados por lote, informe o lote e a validade na hora de receber.' },
      { icon: 'receipt', title: 'Conta a pagar automática', text: 'Gere a conta a pagar com o valor recebido, a nota fiscal, o vencimento e a categoria.' },
      { icon: 'merge', title: 'Fornecedor do cadastro único', text: 'Use os fornecedores já cadastrados, os mesmos do financeiro e do estoque.' },
      { icon: 'chart', title: 'Acompanhamento', text: 'Veja quanto de cada pedido já chegou e quais pedidos estão em aberto.' },
    ],
  },
  'est-inventario': {
    slug: 'est-inventario', label: 'Inventário', icon: 'checklist', headline: 'Conte o estoque e ajuste as diferenças de uma vez',
    description: 'Compare o estoque físico com o do sistema, veja o que não bate e corrija tudo ao finalizar a contagem.',
    items: [
      { icon: 'checklist', title: 'Folha de contagem', text: 'Digite o que contou em cada item. O sistema salva sozinho e mostra o progresso.' },
      { icon: 'barcode', title: 'Leitor de código de barras', text: 'Leia o código do produto e vá direto ao campo de contagem dele.' },
      { icon: 'filter', title: 'Contagem por categoria', text: 'Conte o estoque inteiro ou apenas uma categoria de cada vez.' },
      { icon: 'tag', title: 'Contagem por lote', text: 'Produtos com controle por lote são contados lote a lote.' },
      { icon: 'alert', title: 'Diferenças em destaque', text: 'Veja o que sobrou e o que faltou antes de confirmar qualquer ajuste.' },
      { icon: 'report', title: 'Ajuste e relatório', text: 'Ao finalizar, cada diferença vira um ajuste registrado, e você exporta o resultado em CSV.' },
    ],
  },
  'est-lotes': {
    slug: 'est-lotes', label: 'Lotes e validades', icon: 'calendar', headline: 'Saiba o que vence antes de perder',
    description: 'Controle o estoque por lote e validade e acompanhe o que está vencido ou perto de vencer.',
    items: [
      { icon: 'tag', title: 'Controle por lote', text: 'Ative por produto. Cada entrada informa o lote e a validade.' },
      { icon: 'undo', title: 'Sai primeiro o que vence antes', text: 'Nas saídas, o sistema usa o lote de vencimento mais próximo, ou o lote que você escolher.' },
      { icon: 'alert', title: 'Painel de vencimentos', text: 'Lista de lotes vencidos e a vencer, com filtros por situação e produto.' },
      { icon: 'bell', title: 'Avisos no sino', text: 'Alerta antes de vencer, com a antecedência que você definir nos parâmetros.' },
      { icon: 'scale', title: 'Ajuste por lote', text: 'Corrija o saldo de um lote específico sem mexer nos demais.' },
    ],
  },
  'cad-importar': {
    slug: 'cad-importar', label: 'Importar planilhas', icon: 'upload', headline: 'Traga seus cadastros de uma planilha',
    description: 'Cadastre dezenas de produtos, clientes e fornecedores de uma vez a partir de uma planilha Excel ou CSV.',
    items: [
      { icon: 'file', title: 'Excel ou CSV', text: 'Envie a planilha como ela está e baixe um modelo pronto para preencher.' },
      { icon: 'list', title: 'Escolha das colunas', text: 'O sistema reconhece os títulos e você confere qual coluna vai em cada campo.' },
      { icon: 'check', title: 'Conferência antes de importar', text: 'Veja linha a linha o que será criado, o que já existe e o que tem erro, sem gravar nada ainda.' },
      { icon: 'boxes', title: 'Produtos com saldo inicial', text: 'Importe nome, unidade, categoria, código de barras, custo, preço e a quantidade em estoque.' },
      { icon: 'users', title: 'Clientes e fornecedores', text: 'Importe com CPF ou CNPJ validado, e-mail e telefone, no mesmo cadastro único.' },
      { icon: 'shield', title: 'Nada é alterado', text: 'Quem já está cadastrado é ignorado, então dá para importar a mesma planilha de novo sem duplicar.' },
    ],
  },
};
