/**
 * Setup.gs — roda UMA VEZ para preparar a planilha "Leve Sonho — Painel
 * Financeiro". Abra Extensões > Apps Script nessa planilha, cole todos os
 * arquivos .gs deste projeto, selecione a função "setupWorkbook" no menu
 * de funções (topo da tela) e clique em Executar. Na primeira vez o Google
 * vai pedir autorização — aceite (é a sua própria planilha).
 *
 * Pode rodar de novo depois sem problema: só recria cabeçalhos que
 * estiverem faltando, nunca apaga dados que você já tiver preenchido.
 */

const ABA_ACESSO = '_Acesso';
const ABA_SYNC_LOG = '_Sync_Log';
const ABA_DRE_MAPA = '_DRE_Mapa';
const ABA_FLUXO_CAIXA = 'Fluxo de Caixa';
const ABA_DRE = 'DRE';
const ABA_PRECIFICACAO = 'Precificação';
const ABA_PRECIFICACAO_CONFIG = '_Precificacao_Config';
const ABA_PRECIFICACAO_MATERIAIS = '_Precificacao_Materiais';
const ABA_PRECIFICACAO_RENDIMENTO = '_Precificacao_Rendimento';
const ABA_PRECIFICACAO_FUNCIONARIOS = '_Precificacao_Funcionarios';
const ABA_PRECIFICACAO_MAODEOBRA_PECAS = '_Precificacao_MaoDeObra_Pecas';
const ABA_PRECIFICACAO_CORTE = '_Precificacao_Corte';
const ABA_PRECIFICACAO_SKU = '_Precificacao_SKU';
const ABA_PRECIFICACAO_PRODUCAO = '_Precificacao_Producao';
const ABA_PRECIFICACAO_AVIAMENTOS_TAMANHO = '_Precificacao_Aviamentos_Tamanho';
const ABA_PRECIFICACAO_ACABAMENTOS = '_Precificacao_Acabamentos';
const ABA_DESPESAS_FIXAS = '_Despesas_Fixas';
const ABA_VENDAS = 'Vendas';

// IDs reais das planilhas FPV 2026 (uma por canal) — usados para espelhar
// a Precificação ao vivo via IMPORTRANGE, sem recriar as fórmulas.
const FPVS_2026 = [
  { canal: 'NuvemShop', id: '1L7HjcWLz15K51eC4_32AzdewBk5iwIQU0Mjf3WZLlbA', aba: 'Exemplo FPV' },
  { canal: 'Shopee', id: '18VbfcGBACEKTgUSFoT_ZWG_6l2-OuyJQwXb70DYKs1M', aba: 'Exemplo FPV' },
  { canal: 'MercadoLivre', id: '1TyDkYQaPRxfhoj2IgBiuMGG3JzT8JKq2Bf4VK3y1wlI', aba: 'Exemplo FPV' },
  { canal: 'SHEIN', id: '1lnRIuUQBXFSmrLAuIZ-vzsGifB9Lvqwxsfc4Z8Ad_pI', aba: 'Exemplo FPV' },
  { canal: 'TikTokShop', id: '1Ro7FblBU3c0ZxYVnQHUuhcFFUOEOYlHXwAPHYoHoS6k', aba: 'Exemplo FPV' }
];

function setupWorkbook() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  setupAcesso_(ss);
  setupSyncLog_(ss);
  setupFluxoCaixa_(ss);
  setupDre_(ss);
  setupDreMapa_(ss);
  setupPrecificacao_(ss);
  setupPrecificacaoCatalogo_(ss);
  setupPrecificacaoConfig_(ss);
  setupPrecificacaoMateriais_(ss);
  setupPrecificacaoRendimento_(ss);
  setupPrecificacaoFuncionarios_(ss);
  setupPrecificacaoMaoDeObraPecas_(ss);
  setupPrecificacaoCorte_(ss);
  setupPrecificacaoSku_(ss);
  setupPrecificacaoProducao_(ss);
  setupPrecificacaoAviamentosTamanho_(ss);
  setupPrecificacaoAcabamentos_(ss);
  setupDespesasFixas_(ss);

  SpreadsheetApp.flush();
  Logger.log('Setup concluído. Confira as abas: %s', ss.getSheets().map(s => s.getName()).join(', '));
}

function getOrCreateSheet_(ss, nome) {
  let sheet = ss.getSheetByName(nome);
  if (!sheet) sheet = ss.insertSheet(nome);
  return sheet;
}

/**
 * Garante o cabeçalho da aba. Em aba vazia, escreve tudo. Em aba QUE JÁ TEM
 * DADOS, acrescenta ao final só as colunas que faltam — antes essa função
 * saía sem fazer nada nesse caso, e por isso `sku`, `taxaFixaReais` e
 * `unidade` nunca apareciam em quem já tinha linha preenchida: o setup
 * "rodava com sucesso" e o dado continuava sem lugar.
 *
 * Coluna nova entra sempre no FIM, nunca no meio: mexer na ordem
 * embaralharia as linhas que já existem. Quem lê usa headers.indexOf(nome),
 * então a posição não importa — e quem grava também precisa fazer isso,
 * nunca montar a linha por posição fixa.
 */
function ensureHeader_(sheet, headers) {
  /* A grade tem um numero fixo de colunas, e getRange alem dele nao expande:
     lanca "range exceeds grid limits" e derruba o setup inteiro. A aba
     Precificacao tinha 18 colunas e o cabecalho novo pede 21 — era por isso
     que o setup "rodava" mas a coluna sku nunca aparecia. */
  const maxCols = sheet.getMaxColumns();
  if (maxCols < headers.length) sheet.insertColumnsAfter(maxCols, headers.length - maxCols);

  const vazia = sheet.getLastRow() === 0
    || sheet.getRange(1, 1, 1, headers.length).getValues()[0].join('') === '';

  if (vazia) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#8E2A44').setFontColor('#FFFFFF');
    return;
  }

  const atuais = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (h) { return String(h).trim(); });
  const faltando = headers.filter(function (h) { return atuais.indexOf(h) < 0; });
  if (!faltando.length) return;

  sheet.getRange(1, atuais.length + 1, 1, faltando.length).setValues([faltando]);
  sheet.getRange(1, atuais.length + 1, 1, faltando.length)
    .setFontWeight('bold').setBackground('#8E2A44').setFontColor('#FFFFFF');
  Logger.log('%s: colunas acrescentadas -> %s', sheet.getName(), faltando.join(', '));
}

function setupAcesso_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_ACESSO);
  ensureHeader_(sheet, ['email', 'nome', 'papel', 'ativo']);
  // Garante que quem está rodando o setup já fica com acesso.
  const email = Session.getActiveUser().getEmail();
  const dados = sheet.getDataRange().getValues();
  const jaExiste = dados.some(r => String(r[0]).toLowerCase() === email.toLowerCase());
  if (!jaExiste && email) {
    sheet.appendRow([email, '', 'admin', true]);
  }
}

function setupSyncLog_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_SYNC_LOG);
  ensureHeader_(sheet, ['timestamp', 'tipo', 'status', 'detalhes']);
}

function setupFluxoCaixa_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_FLUXO_CAIXA);
  ensureHeader_(sheet, [
    'data', 'tipo', 'situacao', 'categoriaId', 'categoriaNome', 'grupoDRE',
    'contaBancariaId', 'contaBancariaNome', 'contatoNome', 'formaPagamento',
    'descricao', 'valor', 'origemId', 'origemTipo'
  ]);
}

function setupDre_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_DRE);
  ensureHeader_(sheet, ['mes', 'grupoDRE', 'valor']);
}

/**
 * Mapa editável: cada categoria do Bling (id/descrição real, já
 * confirmada em 23/07) associada a um grupo padrão de DRE. Karolyne pode
 * mudar a coluna grupoDRE de qualquer linha direto na planilha — o
 * cálculo da DRE sempre lê esse mapa, nunca fórmula fixa no código.
 */
function setupDreMapa_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_DRE_MAPA);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['categoriaId', 'categoria', 'tipo', 'idCategoriaPai', 'grupoDRE']);
  if (jaTinhaDados) return; // não sobrescreve ajustes que ela já tiver feito

  const categorias = [
    ['14639321643', 'Vendas de produtos', '2', '0', 'Receita Bruta'],
    ['14639321644', 'Vendas de mercadorias', '2', '0', 'Receita Bruta'],
    ['14639321645', 'Vendas de serviços', '2', '0', 'Receita Bruta'],
    ['14639321646', 'Rendimento de aplicação financeira', '2', '0', 'Resultado Financeiro'],
    ['14639321647', 'Receitas adicionais em operações financeiras', '2', '0', 'Resultado Financeiro'],
    ['14639321648', 'Juros recebidos', '2', '14639321647', 'Resultado Financeiro'],
    ['14639321649', 'Descontos recebidos', '2', '14639321647', 'Resultado Financeiro'],
    ['14639321650', 'Acréscimos recebidos', '2', '14639321647', 'Resultado Financeiro'],
    ['14639321651', 'Indenização de seguro', '2', '0', 'Outras Receitas/Despesas'],
    ['14639321652', 'Venda de ativo', '2', '0', 'Outras Receitas/Despesas'],
    ['14639321653', 'Transferências recebidas', '2', '0', 'Não Operacional (ignorar na DRE)'],
    ['14639321654', 'Compras de fornecedores', '1', '0', 'CMV'],
    ['14639321655', 'Compra de insumos e matéria prima', '1', '0', 'CMV'],
    ['14639321656', 'Devoluções de vendas', '1', '0', 'Deduções da Receita'],
    ['14639321657', 'Descontos incondicionais', '1', '0', 'Deduções da Receita'],
    ['14639321658', 'Impostos sobre vendas', '1', '0', 'Deduções da Receita'],
    ['14639321659', 'Custo dos produtos vendidos', '1', '0', 'CMV'],
    ['14639321660', 'Custo das mercadorias vendidas', '1', '0', 'CMV'],
    ['14639321661', 'Custo dos serviços prestados', '1', '0', 'CMV'],
    ['14639321662', 'Despesas comerciais', '1', '0', 'Despesas Comerciais'],
    ['14639321663', 'Alimentação', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321664', 'Brindes', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321665', 'Combustíveis e lubrificantes', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321666', 'Comissões', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321667', 'Fretes e seguros', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321668', 'Manutenção de veículos', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321669', 'Propaganda e publicidade', '1', '14639321662', 'Despesas Comerciais'],
    ['14639321670', 'Despesas administrativas', '1', '0', 'Despesas Administrativas'],
    ['14639321671', 'Água', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321672', 'Aluguel', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321673', 'Condomínio', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321674', 'Energia elétrica', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321675', 'Limpeza e manutenção', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321676', 'Locações de máquinas e equipamentos', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321677', 'Material de escritório', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321678', 'Material de uso e consumo', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321679', 'Serviços contábeis', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321680', 'Serviços de terceiros', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321681', 'Software', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321682', 'Telefone', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321683', 'Internet', '1', '14639321670', 'Despesas Administrativas'],
    ['14639321684', 'Despesas com pessoal', '1', '0', 'Despesas com Pessoal'],
    ['14639321685', 'Encargos da folha', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321686', 'Plano de saúde', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321687', 'Plano odontológico', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321688', 'Pró-labore', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321689', 'Salários', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321690', 'Vale alimentação', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321691', 'Vale transporte', '1', '14639321684', 'Despesas com Pessoal'],
    ['14639321692', 'Tarifa bancária', '1', '0', 'Resultado Financeiro'],
    ['14639321693', 'Despesas adicionais em operações financeiras', '1', '0', 'Resultado Financeiro'],
    ['14639321694', 'Juros pagos', '1', '14639321693', 'Resultado Financeiro'],
    ['14639321695', 'Descontos concedidos', '1', '14639321693', 'Resultado Financeiro'],
    ['14639321696', 'Acréscimos pagos', '1', '14639321693', 'Resultado Financeiro'],
    ['14639321697', 'Taxas pagas', '1', '14639321693', 'Resultado Financeiro'],
    ['14639321698', 'Taxas do marketplace', '1', '14639321693', 'Despesas Comerciais'],
    ['14639321699', 'Perda de capital na alienação de ativo', '1', '0', 'Outras Receitas/Despesas'],
    ['14639321700', 'Imposto de renda', '1', '0', 'Impostos sobre o Lucro'],
    ['14639321701', 'Contribuição social sobre lucro líquido', '1', '0', 'Impostos sobre o Lucro'],
    ['14639321702', 'Transferências', '3', '0', 'Não Operacional (ignorar na DRE)'],
    ['14674413185', 'Capital de Giro', '1', '14639321693', 'Resultado Financeiro'],
    ['14674413186', 'Empréstimos', '1', '14639321693', 'Resultado Financeiro'],
    ['14711275622', 'Empréstimos', '2', '0', 'Não Operacional (ignorar na DRE)'],
    ['14711277262', 'Investimentos', '1', '0', 'Não Operacional (ignorar na DRE)']
  ];
  sheet.getRange(2, 1, categorias.length, categorias[0].length).setValues(categorias);
  sheet.autoResizeColumns(1, 5);
}

/**
 * Precificação: NÃO recria fórmulas. Cada aba espelha ao vivo (IMPORTRANGE)
 * a aba real do FPV 2026 daquele canal. Na primeira vez, o Google Sheets
 * vai pedir "Permitir acesso" em cada uma — é normal, clique em permitir.
 * Se o nome da aba de origem for diferente de "Exemplo FPV" em algum
 * arquivo, ajuste só o texto entre aspas na fórmula da célula A1.
 */
function setupPrecificacao_(ss) {
  FPVS_2026.forEach(fpv => {
    const nomeAba = 'Precificação_' + fpv.canal;
    const sheet = getOrCreateSheet_(ss, nomeAba);
    if (sheet.getRange('A1').getFormula() === '') {
      const url = 'https://docs.google.com/spreadsheets/d/' + fpv.id;
      const formula = '=IMPORTRANGE("' + url + '"; "\'' + fpv.aba + '\'!A1:Z3000")';
      sheet.getRange('A1').setFormula(formula);
    }
  });
}

/**
 * Catálogo real da calculadora de precificação — uma linha por produto
 * salvo. Só cria a aba/cabeçalho; quem grava linhas é
 * salvarPrecificacaoProduto_() em Precificacao.gs, nunca este setup.
 */
function setupPrecificacaoCatalogo_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO);
  ensureHeader_(sheet, [
    'id', 'nome', 'canal', 'ativo',
    'sku', 'tipoProduto', 'tamanho',
    'materiaisJson', 'maoDeObraJson', 'outrosJson', 'tarifasJson',
    'despesasFixasPct', 'precoVenda',
    'custoProdutoSnapshot', 'lucroPctSnapshot', 'margemContribuicaoPctSnapshot', 'markupSnapshot',
    'criadoEm', 'criadoPor', 'atualizadoEm', 'atualizadoPor'
  ]);
}

/**
 * Presets editáveis de taxa por canal + a % de despesas fixas global
 * (linha especial "_GLOBAL"). Karolyne pode ajustar qualquer valor direto
 * na planilha — a calculadora sempre lê daqui, nunca de número fixo no
 * código. Semeado uma única vez (nunca sobrescreve ajustes já feitos).
 */
function setupPrecificacaoConfig_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_CONFIG);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, [
    'canal', 'impostosPct', 'comissaoPct',
    'extra1Nome', 'extra1Pct', 'extra2Nome', 'extra2Pct',
    'taxaFixaReais', 'despesasFixasPct', 'confirmado'
  ]);
  if (jaTinhaDados) return;

  // taxaFixaReais: cobrança em reais por venda, não percentual. A Shopee
  // cobra R$ 4,00 por venda além da comissão. Isso estava dentro do custo
  // do produto nas fichas FPV, o que inflava o custo da peça e a fazia
  // parecer cara também na Nuvemshop, onde essa taxa não existe.
  //
  // TAXAS MEDIDAS EM 20/08/2026 — não são mais estimativa das fichas FPV.
  // De onde veio cada número:
  //
  //   Shopee 16,3% + R$ 4,00
  //     3.389 pedidos jan-jul, campo taxaComissao do Bling: R$ 16,42 por
  //     pedido num ticket de R$ 76,34 = 21,5% all-in. Tirando os R$ 4,00
  //     fixos, sobra 16,3% percentual. Separar importa: a parte fixa pesa
  //     muito mais em peça barata.
  //   Shopee Acelera 4,9%
  //     extrato oficial da API (get_wallet_transaction_list), jan-jul:
  //     R$ 13.002 de FAST_ESCROW_DEDUCT sobre R$ 258.719 de faturamento.
  //
  //   MercadoLivre 18,1% + 5,6% de frete
  //     /v1/payments/search, 2.024 pagamentos aprovados em 8 meses:
  //     bruto R$ 148.489, líquido R$ 113.282 = 23,7% de retenção total.
  //     O Bling registra 18,1% no campo de comissão; a diferença de 5,6
  //     pontos é frete subsidiado, que não aparece lá. Estava faltando
  //     no preset antigo (que somava 17,8%).
  //
  //   NuvemShop Cartão 3,14% + 10,18% + R$ 0,50
  //     tabela comercial do Pagar.me: crédito 7-12x = 3,14%; antecipação
  //     1,85% ao mês. O site vende em até 10x, então a parcela média está
  //     5,5 meses à frente: 1,85 x 5,5 = 10,18%. Fixos = R$ 0,25 de
  //     processamento + R$ 0,25 de antifraude.
  //     O preset antigo usava 13,05% de parcelamento e errava pra cima.
  //
  //   NuvemShop Pix 0,69% + R$ 0,25
  //     tabela do Pagar.me. Conferido contra 50 transações reais:
  //     R$ 126,90 de taxa sobre R$ 15.294,60 = 0,83% efetivo, que é o
  //     0,69% mais o peso do fixo no ticket.
  //
  //   SHEIN e TikTokShop continuam SEM MEDIÇÃO (confirmado = false).
  //     Juntos são 4% do faturamento. Os valores abaixo são chute
  //     herdado das fichas - não use pra decidir preço sem conferir.
  const linhas = [
    ['NuvemShop_Cartao', 0.0742, 0.0314, 'Antecipação 10x', 0.1018, '', 0, 0.50, '', true],
    ['NuvemShop_Pix', 0.0742, 0.0069, '', 0, '', 0, 0.25, '', true],
    ['MercadoLivre', 0.07, 0.181, 'Frete subsidiado', 0.056, '', 0, 0, '', true],
    ['Shopee', 0.0742, 0.163, 'Acelera (antecipação)', 0.049, '', 0, 4.00, '', true],
    ['SHEIN', 0.07, 0.14, 'Antecipação', 0.038, '', 0, 0, '', false],
    ['TikTokShop', 0.07, 0.14, 'Antecipação', 0.038, '', 0, 0, '', false],
    ['_GLOBAL', '', '', '', '', '', '', '', 0.3494, true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 10);
}

/**
 * Catálogo de tecidos/materiais — fornecedor, material, largura e valor
 * (preço por metro, usado pra preencher automaticamente o valor unitário
 * na calculadora quando você escolhe o material). "largura" e
 * "rendimento" são só referência (como você mesma anotou), não entram em
 * nenhuma conta ainda. Editável direto na planilha; a calculadora sempre
 * lê daqui. Semeado uma vez com o que você mandou — adicione o resto
 * quando quiser, sem precisar mexer em código.
 */
function setupPrecificacaoMateriais_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_MATERIAIS);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['fornecedor', 'material', 'largura', 'rendimento', 'valor', 'unidade', 'observacao']);
  if (jaTinhaDados) return;

  const linhas = [
    ['', 'Cetim Elastano', '', '', 5.99],
    ['', 'Cetim Poliéster', '', '', 2.99],
    ['Tritan', 'Malha PV', 1.2, 2.3, 48.90],
    ['Tritan', 'Piquet', 1.2, 2, 59.90],
    ['Copat', 'Moletom 3 cabos', 180, 150, 49.90],
    ['Metatex', 'Moletom 3 cabos', 180, 140, 48.39],
    ['Metatex', 'Moletom 2 cabos', 180, 170, 48.39],
    ['Metatex', 'Moletom Dry', 185, 165, 44.42],
    ['All Free', 'Moletom 2 cabos', 180, 200, 35.00]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 5);
}

/**
 * Rendimento (metros de tecido) por tipo de produto + tamanho — usado
 * pra sugerir automaticamente a quantidade de material na calculadora
 * quando você escolhe o tipo de peça e o tamanho. "metros2" é pra peças
 * com um segundo tecido (ex: pijama infantil manga+calça usa metros do
 * tecido principal + metros do punho/acabamento) — fica em branco quando
 * não se aplica. Editável direto na planilha.
 */
function setupPrecificacaoRendimento_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_RENDIMENTO);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['tipoProduto', 'tamanho', 'metros', 'metros2']);
  if (jaTinhaDados) return;

  const linhas = [
    ['Robe manga curta', 'PP', 1.26, ''], ['Robe manga curta', 'P', 1.28, ''], ['Robe manga curta', 'M', 1.43, ''],
    ['Robe manga curta', 'G', 1.53, ''], ['Robe manga curta', 'GG', 1.60, ''], ['Robe manga curta', 'G1', 2.18, ''],
    ['Robe manga curta', 'G2', 2.20, ''], ['Robe manga curta', 'G3', 2.26, ''],
    ['Robe manga 3/4', 'PP', 1.40, ''], ['Robe manga 3/4', 'P', 1.40, ''], ['Robe manga 3/4', 'M', 1.53, ''],
    ['Robe manga 3/4', 'G', 1.59, ''], ['Robe manga 3/4', 'GG', 1.74, ''], ['Robe manga 3/4', 'G1', 2.34, ''],
    ['Robe manga 3/4', 'G2', 2.35, ''], ['Robe manga 3/4', 'G3', 2.42, ''],
    ['Robe manga longa', 'PP', 1.68, ''], ['Robe manga longa', 'P', 1.68, ''], ['Robe manga longa', 'M', 1.83, ''],
    ['Robe manga longa', 'G', 1.86, ''], ['Robe manga longa', 'GG', 1.90, ''], ['Robe manga longa', 'G1', 2.45, ''],
    ['Robe manga longa', 'G2', 2.57, ''], ['Robe manga longa', 'G3', 2.64, ''],
    ['Robe infantil', '2', 0.80, ''], ['Robe infantil', '4', 0.94, ''], ['Robe infantil', '6', 0.94, ''],
    ['Robe infantil', '8', 0.92, ''], ['Robe infantil', '10', 1.10, ''], ['Robe infantil', '12', 1.24, ''],
    ['Robe infantil', '14', 1.28, ''],
    ['Robe manga flare tule', 'PP', 1.68, ''], ['Robe manga flare tule', 'P', 1.68, ''], ['Robe manga flare tule', 'M', 1.83, ''],
    ['Robe manga flare tule', 'G', 1.86, ''], ['Robe manga flare tule', 'GG', 1.90, ''], ['Robe manga flare tule', 'G1', 2.45, ''],
    ['Robe manga flare tule', 'G2', 2.57, ''], ['Robe manga flare tule', 'G3', 2.64, ''],
    ['Robe manga 3/4 longo', 'PP', 1.82, ''], ['Robe manga 3/4 longo', 'P', 1.82, ''], ['Robe manga 3/4 longo', 'M', 1.93, ''],
    ['Robe manga 3/4 longo', 'G', 3.00, ''], ['Robe manga 3/4 longo', 'GG', 3.25, ''], ['Robe manga 3/4 longo', 'G1', 3.18, ''],
    ['Robe manga 3/4 longo', 'G2', 3.25, ''], ['Robe manga 3/4 longo', 'G3', 3.27, ''],
    ['Robe manga longa longo', 'PP', 2.08, ''], ['Robe manga longa longo', 'P', 2.08, ''], ['Robe manga longa longo', 'M', 2.22, ''],
    ['Robe manga longa longo', 'G', 3.00, ''], ['Robe manga longa longo', 'GG', 3.25, ''], ['Robe manga longa longo', 'G1', 3.18, ''],
    ['Robe manga longa longo', 'G2', 3.25, ''], ['Robe manga longa longo', 'G3', 3.27, ''],
    ['Saquinhos de Cetim', '-', 0.25, ''],
    ['Pijama Americano Manga Curta e Short', 'P', 1.51, ''], ['Pijama Americano Manga Curta e Short', 'M', 1.53, ''],
    ['Pijama Americano Manga Curta e Short', 'G', 1.71, ''], ['Pijama Americano Manga Curta e Short', 'GG', 1.92, ''],
    ['Pijama Americano Manga Curta e Short', 'G1', 2.03, ''],
    ['Pijama Americano Manga Curta e Calça', 'P', 2.20, ''], ['Pijama Americano Manga Curta e Calça', 'M', 2.26, ''],
    ['Pijama Americano Manga Curta e Calça', 'G', 2.36, ''], ['Pijama Americano Manga Curta e Calça', 'GG', 2.52, ''],
    ['Pijama Americano Manga Curta e Calça', 'G1', 2.70, ''],
    ['Pijama Americano Manga Longa e Calça', 'P', 2.34, ''], ['Pijama Americano Manga Longa e Calça', 'M', 2.46, ''],
    ['Pijama Americano Manga Longa e Calça', 'G', 2.58, ''], ['Pijama Americano Manga Longa e Calça', 'GG', 2.78, ''],
    ['Pijama Americano Manga Longa e Shorts', 'P', 1.92, ''], ['Pijama Americano Manga Longa e Shorts', 'M', 1.97, ''],
    ['Pijama Americano Manga Longa e Shorts', 'G', 2.02, ''], ['Pijama Americano Manga Longa e Shorts', 'GG', 2.21, ''],
    ['Pijama Americano Infantil', '2', 0.65, ''], ['Pijama Americano Infantil', '4', 0.65, ''], ['Pijama Americano Infantil', '6', 1.00, ''],
    ['Pijama Americano Infantil', '8', 1.00, ''], ['Pijama Americano Infantil', '10', 1.40, ''], ['Pijama Americano Infantil', '12', 1.40, ''],
    ['Pijama Americano Infantil', '14', 1.40, ''],
    ['Pijama Americano Infantil Manga Curta e Calça', '2', 1.45, 0.65], ['Pijama Americano Infantil Manga Curta e Calça', '4', 1.45, 0.65],
    ['Pijama Americano Infantil Manga Curta e Calça', '6', 1.80, 1.00], ['Pijama Americano Infantil Manga Curta e Calça', '8', 1.80, 1.00],
    ['Pijama Americano Infantil Manga Curta e Calça', '10', 2.20, 1.40], ['Pijama Americano Infantil Manga Curta e Calça', '12', 2.20, 1.40],
    ['Pijama Americano Infantil Manga Curta e Calça', '14', 2.20, 1.40],
    ['Pijama Americano Infantil Manga Longa e Calça', '2', 1.70, 0.70], ['Pijama Americano Infantil Manga Longa e Calça', '4', 1.80, 0.80],
    ['Pijama Americano Infantil Manga Longa e Calça', '6', 2.00, 1.00], ['Pijama Americano Infantil Manga Longa e Calça', '8', 2.00, 1.00],
    ['Pijama Americano Infantil Manga Longa e Calça', '10', 2.40, 1.40], ['Pijama Americano Infantil Manga Longa e Calça', '12', 2.40, 1.40],
    ['Pijama Americano Infantil Manga Longa e Calça', '14', 2.40, 1.40],
    ['Pijama Americano Infantil Manga Longa e Shorts', '2', 1.50, ''], ['Pijama Americano Infantil Manga Longa e Shorts', '4', 1.60, ''],
    ['Pijama Americano Infantil Manga Longa e Shorts', '6', 1.80, ''], ['Pijama Americano Infantil Manga Longa e Shorts', '8', 1.80, ''],
    ['Pijama Americano Infantil Manga Longa e Shorts', '10', 2.20, ''], ['Pijama Americano Infantil Manga Longa e Shorts', '12', 2.20, ''],
    ['Pijama Americano Infantil Manga Longa e Shorts', '14', 2.20, ''],
    ['Camisa Pijama Verão', 'P', 1.04, ''], ['Camisa Pijama Verão', 'M', 1.04, ''], ['Camisa Pijama Verão', 'G', 1.12, ''],
    ['Camisa Pijama Verão', 'GG', 1.18, ''],
    ['Camisa Pijama Inverno', 'P', 1.29, ''], ['Camisa Pijama Inverno', 'M', 1.34, ''], ['Camisa Pijama Inverno', 'G', 1.33, ''],
    ['Camisa Pijama Inverno', 'GG', 1.44, ''],
    ['Calça Pijama', 'P', 1.18, ''], ['Calça Pijama', 'M', 1.25, ''], ['Calça Pijama', 'G', 1.29, ''], ['Calça Pijama', 'GG', 1.36, ''],
    ['Short Pijama', 'P', 0.56, ''], ['Short Pijama', 'M', 0.65, ''], ['Short Pijama', 'G', 0.66, ''], ['Short Pijama', 'GG', 0.79, ''],
    ['Pantufa de Cetim', 'PP', 0.30, ''], ['Pantufa de Cetim', 'P', 0.30, ''], ['Pantufa de Cetim', 'M', 0.30, ''],
    ['Pantufa de Cetim', 'G', 0.30, ''], ['Pantufa de Cetim', 'GG', 0.30, ''],
    ['Roupão Manga 3/4', 'PP', 1.40, ''], ['Roupão Manga 3/4', 'P', 1.40, ''], ['Roupão Manga 3/4', 'M', 1.53, ''],
    ['Roupão Manga 3/4', 'G', 1.59, ''], ['Roupão Manga 3/4', 'GG', 1.74, ''], ['Roupão Manga 3/4', 'G1', 2.34, ''],
    ['Roupão Manga 3/4', 'G2', 2.35, ''], ['Roupão Manga 3/4', 'G3', 2.42, ''],
    ['Roupão Manga Longa', 'PP', 1.68, ''], ['Roupão Manga Longa', 'P', 1.68, ''], ['Roupão Manga Longa', 'M', 1.83, ''],
    ['Roupão Manga Longa', 'G', 1.86, ''], ['Roupão Manga Longa', 'GG', 1.90, ''], ['Roupão Manga Longa', 'G1', 2.45, ''],
    ['Roupão Manga Longa', 'G2', 2.57, ''], ['Roupão Manga Longa', 'G3', 2.64, ''],
    ['Moletom', 'PP', 1.32, ''], ['Moletom', 'P', 1.46, ''], ['Moletom', 'M', 1.5, ''], ['Moletom', 'G', 1.57, ''],
    ['Moletom', 'GG', 1.63, ''], ['Moletom', 'G1', 1.61, ''], ['Moletom', 'G2', 1.63, ''], ['Moletom', 'G3', 1.65, '']
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 4);
}

/**
 * Cadastro de funcionários/prestadores pra mão de obra reutilizável — na
 * calculadora, escolher um nome aqui preenche salário e horas/mês
 * sozinho. Começa vazio (você preenche); a calculadora funciona mesmo
 * sem nenhuma linha aqui (digita manual como hoje).
 */
function setupPrecificacaoFuncionarios_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_FUNCIONARIOS);
  ensureHeader_(sheet, ['nome', 'salarioMensal', 'horasMes', 'ativo']);
}

/**
 * Mão de obra por peça — valor fixo pago por peça feita, por
 * funcionária/prestadora (é assim que você paga de verdade, não por
 * salário/hora). Na calculadora, escolher funcionária + tipo de peça
 * preenche sozinho a linha de "Outros materiais/serviços" com o valor
 * certo. "Vista C" é a prestadora dos caseados (acabamento), separada
 * das costureiras. Semeado com os valores que você mandou — edite ou
 * adicione linhas direto na planilha quando quiser.
 */
function setupPrecificacaoMaoDeObraPecas_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_MAODEOBRA_PECAS);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['funcionario', 'tipoPeca', 'valor', 'unidade']);
  if (jaTinhaDados) return;

  const costureirasPadrao = ['Margarida', 'Deise', 'Cristina', 'Vilma'];
  const tabelaPadrao = [
    ['Robe', 5.00], ['Pijama', 11.00], ['Scrunchie', 0.30], ['Saquinho', 0.30],
    ['Camiseta gola careca', 2.50], ['Camiseta gola V', 2.50], ['Bermuda', 2.00]
  ];
  const tabelaNair = [
    ['Robe', 8.00], ['Pijama', 12.00], ['Scrunchie', 0.30], ['Saquinho', 0.30],
    ['Camiseta gola careca', 2.50], ['Camiseta gola V', 2.50], ['Bermuda', 2.00],
    ['Painel', 2.50, 'm²'], ['Chemise', 11.00]
  ];
  const tabelaVistaC = [
    ['Caseado', 0.50, 'por botão'], ['Pijama adulto', 2.50], ['Pijama Infantil', 2.00],
    ['Chemise', 3.50], ['Camisa polo', 1.00]
  ];

  const linhas = [];
  costureirasPadrao.forEach(nome => {
    tabelaPadrao.forEach(([tipoPeca, valor]) => linhas.push([nome, tipoPeca, valor, '']));
  });
  tabelaNair.forEach(([tipoPeca, valor, unidade]) => linhas.push(['Nair', tipoPeca, valor, unidade || '']));
  tabelaVistaC.forEach(([tipoPeca, valor, unidade]) => linhas.push(['Vista C', tipoPeca, valor, unidade || '']));

  sheet.getRange(2, 1, linhas.length, 4).setValues(linhas);
  sheet.autoResizeColumns(1, 4);
}

/**
 * Corte por peça — valor fixo do corte, por tipo de peça (não depende de
 * quem costura). Padrão R$1,00/peça; peças com mais de uma parte (ex:
 * pijama = camisa + short) contam como mais de uma peça. Editável direto
 * na planilha.
 */
function setupPrecificacaoCorte_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_CORTE);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['tipoPeca', 'valor']);
  if (jaTinhaDados) return;

  const linhas = [
    ['Robe', 1.00], ['Pijama', 2.00], ['Scrunchie', 1.00], ['Saquinho', 1.00],
    ['Camiseta gola careca', 1.00], ['Camiseta gola V', 1.00], ['Bermuda', 1.00],
    ['Painel', 1.00], ['Chemise', 1.00], ['Pijama adulto', 1.00], ['Pijama Infantil', 1.00],
    ['Camisa polo', 1.00]
  ];
  sheet.getRange(2, 1, linhas.length, 2).setValues(linhas);
  sheet.autoResizeColumns(1, 2);
}

/**
 * Despesas fixas reais, item a item (aluguel, salários, energia, etc.).
 * A % de despesas fixas usada na calculadora passa a ser calculada
 * sozinha: soma desta aba ÷ média da Receita Bruta dos últimos meses na
 * DRE (ver getDespesasFixasPct_ em Precificacao.gs). Se a DRE ainda não
 * tiver dados suficientes, cai no valor manual da aba _Precificacao_Config
 * como reserva. Começa vazia — preencha com suas despesas reais.
 */
/**
 * Regra de custo por família de SKU — o que liga o estoque do Bling aos
 * catálogos de rendimento, corte e produção. Uma linha por família
 * (RMC-CUR, PML-LON…) em vez de uma linha por produto: o tamanho sai do
 * nome do produto no Bling e o rendimento faz o resto, então G3 custa mais
 * que M sem ninguém cadastrar nada a mais.
 *
 * Aqui fica só o que NÃO muda com o canal: qual modelo a peça é, quantos
 * componentes ela corta e que aviamentos leva. Tecido e costura mudam por
 * canal e moram em _Precificacao_Producao.
 *
 * O corte vem de _Precificacao_Corte, que já guarda o TOTAL por produto:
 * R$ 1,00 por peça componente, então Robe = 1,00 e Pijama = 2,00 (camisa +
 * short/calça).
 * `custoManual` é a saída de emergência: peça sem rendimento no catálogo
 * (scrunchie, fronha, touca) usa valor fixo e ignora o cálculo.
 * `aviamentosJson` é [{"descricao":"Linha","valor":0.03}, ...].
 */
function setupPrecificacaoSku_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_SKU);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, [
    'familia', 'descricao', 'tipoProduto', 'tipoPeca', 'materialSecundario',
    'aviamentosJson', 'custoManual', 'ativo'
  ]);
  if (jaTinhaDados) return;

  // Aviamentos confirmados nas fichas FPV: linha 0,03 + fio 0,07 +
  // saquinho crystal 0,07 + envelope correio 0,56 = 0,73 em toda peça.
  // O pijama soma 5 botões a 0,124 = 0,62. A FPV traz 0,12 aqui porque
  // divide a cartela por 250 em vez de pelas 50 unidades que ela tem —
  // valor confirmado pela Karolyne em 20/08/2026.
  const AVI_BASE = '[{"descricao":"Linha","valor":0.03},{"descricao":"Fio","valor":0.07},{"descricao":"Saquinho Crystal","valor":0.07},{"descricao":"Envelope Correio","valor":0.56}]';
  const AVI_PIJAMA = '[{"descricao":"Linha","valor":0.03},{"descricao":"Fio","valor":0.07},{"descricao":"Saquinho Crystal","valor":0.07},{"descricao":"Envelope Correio","valor":0.56},{"descricao":"Botão (5un)","valor":0.62},{"descricao":"Caseado (5 casas)","valor":2.50}]';

  const linhas = [
    // familia | descricao | tipoProduto | tipoPeca | materialSecundario | aviamentosJson | custoManual | ativo
    ['PMC-CUR', 'Pijama Americano Cetim - Manga Curta e Shorts', 'Pijama Americano Manga Curta e Short', 'Pijama', '', AVI_PIJAMA, '', true],
    ['RMC-CUR', 'Robe de Cetim - Manga Curta', 'Robe manga curta', 'Robe', '', AVI_BASE, '', true],
    ['RIF-CUR', 'Robe de Cetim - Infantil', 'Robe infantil', 'Robe', '', AVI_BASE, '', true],
    ['PML-LON', 'Pijama Americano Cetim - Manga Longa e Calça', 'Pijama Americano Manga Longa e Calça', 'Pijama', '', AVI_PIJAMA, '', true],
    ['PIF-CUR', 'Pijama Americano Cetim Infantil - Manga Curta e Shorts', 'Pijama Americano Infantil', 'Pijama', '', AVI_PIJAMA, '', true],
    ['RME-CUR', 'Robe de Cetim com Elastano - Manga Curta', 'Robe manga curta', 'Robe', '', AVI_BASE, '', true],
    ['KSC', 'Kit Saquinhos de Cetim', 'Saquinhos de Cetim', 'Saquinho', '', '', '', true],
    // Sem rendimento cadastrado — dependem de custoManual até entrarem no catálogo.
    ['SCR', 'Scrunchie de Cetim', '', 'Scrunchie', '', '', '', true],
    ['SCE', 'Scrunchie de Cetim (código alternativo)', '', 'Scrunchie', '', '', '', true],
    ['FRN', 'Fronha de Cetim', '', '', '', '', '', true],
    ['TCA', 'Touca de Cetim / Touca Mágica', '', '', '', '', '', true],
    ['FXA-CNL', 'Faixa de Cabelo Canelada', '', '', '', '', '', true],
    ['RGT-CUR', 'Regata Feminina Canelada', '', '', '', '', '', true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 8);
}

/**
 * Produção por canal — o que muda conforme onde a peça é vendida.
 *
 * Marketplace e Nuvemshop não vendem a mesma peça: o robe de marketplace é
 * 100% poliéster e a costura sai por R$ 5,00 (Margarida, Deise, Cristina,
 * Vilma); o da Nuvemshop leva cetim com elastano e a costura é da Nair, por
 * R$ 8,00. Sem esta aba o custo do mesmo SKU sairia igual nos dois canais,
 * que é justamente o erro que a média por funcionário produzia.
 *
 * `canalGrupo` aceita "Marketplace" ou "Nuvemshop" — grupoDoCanal_() traduz
 * Shopee/MercadoLivre/SHEIN/TikTok para Marketplace e NuvemShop_Cartao /
 * NuvemShop_Pix para Nuvemshop.
 */
function setupPrecificacaoProducao_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_PRODUCAO);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, [
    'canalGrupo', 'tipoPeca', 'material', 'costuraValor', 'ativo'
  ]);
  if (jaTinhaDados) return;

  const linhas = [
    ['Marketplace', 'Robe', 'Cetim Poliéster', 5.00, true],
    ['Nuvemshop', 'Robe', 'Cetim Elastano', 8.00, true],
    ['Marketplace', 'Pijama', 'Cetim Elastano', 11.00, true],
    ['Nuvemshop', 'Pijama', 'Cetim Elastano', 11.00, true],
    ['Marketplace', 'Scrunchie', 'Cetim Poliéster', 0.30, true],
    ['Nuvemshop', 'Scrunchie', 'Cetim Elastano', 0.30, true],
    ['Marketplace', 'Saquinho', 'Cetim Poliéster', 0.30, true],
    ['Nuvemshop', 'Saquinho', 'Cetim Poliéster', 0.30, true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 5);
}

/**
 * Migração do tule (20/08/2026) — roda uma vez, é idempotente.
 *
 * Regra confirmada pela Karolyne: robe flare gasta o MESMO total de tecido
 * que o manga longa, mas 0,60m desse total é renda em vez de cetim. Então o
 * catálogo passa a guardar `metros` já descontado dos 0,60 e `metros2` =
 * 0,60, e o tecido secundário da família aponta pra renda usada — "Tule"
 * neste modelo, mas a coluna aceita qualquer uma (guipir, guipir larga,
 * renda chantily), porque a diferença entre elas é só o preço do metro.
 *
 * Faz também duas correções de dados que apareceram na conferência:
 *  - Cetim Elastano estava com R$ 5,99; o valor certo é R$ 5,89.
 *  - Cria "Robe manga flare tule longo" derivado do "Robe manga longa longo".
 *
 * ATENÇÃO: os tamanhos G a G3 dos modelos "longo" ainda estão sob suspeita
 * (G1 gasta menos que GG, e os dois modelos longos são idênticos de G pra
 * cima). O flare tule longo herda esses números — quando remedir, corrija os
 * dois.
 */
function migrarTuleFlare_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const log = [];
  const METROS_TULE = 0.60;

  // 1) Tule no catálogo de materiais + preço do elastano
  const shMat = ss.getSheetByName(ABA_PRECIFICACAO_MATERIAIS);
  const mat = sheetData_(ABA_PRECIFICACAO_MATERIAIS);
  const iMatNome = mat.headers.indexOf('material'), iMatValor = mat.headers.indexOf('valor');
  let temTule = false;
  mat.rows.forEach((r, i) => {
    const nome = String(r[iMatNome] || '').trim().toLowerCase();
    if (nome === 'tule') temTule = true;
    if (nome === 'cetim elastano' && num_(r[iMatValor]) !== 5.89) {
      shMat.getRange(i + 2, iMatValor + 1).setValue(5.89);
      log.push('Cetim Elastano: ' + r[iMatValor] + ' -> 5,89');
    }
  });
  if (!temTule) {
    shMat.appendRow(['', 'Tule', '', '', 22.90]);
    log.push('Tule cadastrado a R$ 22,90/m');
  }

  // 2) Rendimento: separa os 0,60 de tule do tecido principal
  const shRend = ss.getSheetByName(ABA_PRECIFICACAO_RENDIMENTO);
  const rend = sheetData_(ABA_PRECIFICACAO_RENDIMENTO);
  const iTipo = rend.headers.indexOf('tipoProduto'), iTam = rend.headers.indexOf('tamanho'),
    iM = rend.headers.indexOf('metros'), iM2 = rend.headers.indexOf('metros2');

  rend.rows.forEach((r, i) => {
    if (String(r[iTipo] || '').trim().toLowerCase() !== 'robe manga flare tule') return;
    if (num_(r[iM2]) > 0) return;                       // já migrado
    const total = num_(r[iM]);
    if (total <= METROS_TULE) return;
    shRend.getRange(i + 2, iM + 1).setValue(Math.round((total - METROS_TULE) * 100) / 100);
    shRend.getRange(i + 2, iM2 + 1).setValue(METROS_TULE);
    log.push('flare tule ' + r[iTam] + ': ' + total + ' -> ' + (total - METROS_TULE) + ' cetim + 0,60 tule');
  });

  // 3) Flare tule longo, derivado do manga longa longo
  const jaTemLongo = rend.rows.some(r => String(r[iTipo] || '').trim().toLowerCase() === 'robe manga flare tule longo');
  if (!jaTemLongo) {
    const novas = rend.rows
      .filter(r => String(r[iTipo] || '').trim().toLowerCase() === 'robe manga longa longo')
      .map(r => {
        const total = num_(r[iM]);
        return ['Robe manga flare tule longo', r[iTam],
          Math.round((total - METROS_TULE) * 100) / 100, METROS_TULE];
      });
    if (novas.length) {
      shRend.getRange(shRend.getLastRow() + 1, 1, novas.length, 4).setValues(novas);
      log.push('Robe manga flare tule longo criado com ' + novas.length + ' tamanhos (derivado do manga longa longo)');
    }
  }

  // 4) Famílias de flare passam a apontar o tule como tecido secundário
  const shSku = ss.getSheetByName(ABA_PRECIFICACAO_SKU);
  const sku = sheetData_(ABA_PRECIFICACAO_SKU);
  const iTipoProd = sku.headers.indexOf('tipoProduto'), iMat2 = sku.headers.indexOf('materialSecundario');
  sku.rows.forEach((r, i) => {
    const tp = String(r[iTipoProd] || '').trim().toLowerCase();
    if (tp.indexOf('flare tule') < 0) return;
    if (String(r[iMat2] || '').trim()) return;
    shSku.getRange(i + 2, iMat2 + 1).setValue('Tule');
    log.push('família da linha ' + (i + 2) + ': tecido secundário = Tule');
  });

  SpreadsheetApp.flush();
  return log;
}

/** Wrapper pra rodar pelo menu do editor. */
function _rodarMigrarTuleFlare() {
  const log = migrarTuleFlare_();
  Logger.log(log.length ? log.join('\n') : 'Nada a migrar — já estava tudo aplicado.');
}

/**
 * Tecidos e aviamentos confirmados pela Karolyne em 20/08/2026.
 * Idempotente: atualiza preço de quem já existe, insere quem falta, e nunca
 * mexe em linha que não está nesta lista.
 *
 * A coluna `unidade` existia implícita e errada: cetim se compra por METRO,
 * malha e moletom por QUILO, e os dois valores conviviam na mesma coluna
 * `valor` — o cálculo lia os R$ 46,50 do quilo de malha como R$ 46,50 do
 * metro. Quem lê deve usar `valorPorMetro` (ver getPrecificacaoMateriaisCatalogo_),
 * que divide pelo rendimento sempre que a unidade não for metro.
 *
 * Aviamentos que vêm em rolo, peça ou cartela seguem a mesma regra: preço do
 * pacote em `valor`, quanto ele rende em `rendimento`.
 */
function migrarMateriais2026_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_PRECIFICACAO_MATERIAIS);
  ensureHeader_(sheet, ['fornecedor', 'material', 'largura', 'rendimento', 'valor', 'unidade', 'observacao']);
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_MATERIAIS);
  const idx = (n) => headers.indexOf(n);
  const iNome = idx('material'), iRend = idx('rendimento'), iValor = idx('valor'),
    iUnid = idx('unidade'), iObs = idx('observacao');

  // material, rendimento, valor, unidade, observacao
  const TECIDOS = [
    ['Cetim Poliéster', '', 2.99, 'm', ''],
    ['Cetim Elastano', '', 5.89, 'm', ''],
    ['Crepe Amanda', '', 12.90, 'm', ''],
    ['Prada', '', 14.90, 'm', ''],
    ['Crepe Monalisa', '', 58.90, 'm', ''],
    ['Microsoft', '', 17.50, 'm', ''],
    ['Toque de Seda', '', 22.00, 'm', ''],
    ['Viscolinho', '', 11.00, 'm', ''],
    ['Atoalhado', '', 10.70, 'm', ''],
    ['Tule', '', 22.90, 'm', ''],
    ['Malha PV', 2.25, 46.50, 'kg', '1 kg rende 2,25 m -> R$ 20,67/m'],
    ['Renda Chantily', 3, 114.00, 'peça', 'peça de 3 m por R$ 114,00 -> R$ 38,00/m'],
    ['Vivo', 50, 19.90, 'rolo', 'rolo de 50 m por R$ 19,90 -> R$ 0,398/m'],
    ['Elástico', 25, 10.40, 'rolo', 'rolo de 25 m por R$ 10,40 -> R$ 0,416/m'],
    ['Botão', 50, 6.20, 'cartela', 'cartela de 50 un por R$ 6,20 -> R$ 0,124/un'],
    ['Guipir', 21.5, 13.70, 'peça', 'peça de 21,5 m por R$ 13,70 -> R$ 0,637/m'],
    ['Guipir larga', 21.5, 18.90, 'peça', 'peça de 21,5 m por R$ 18,90 -> R$ 0,879/m']
  ];

  const log = [];
  // Nome repetido existe no catálogo — há dois "Moletom 3 cabos" e dois
  // "Moletom 2 cabos", de fornecedores diferentes. Guarda TODAS as linhas de
  // cada nome: com um mapa nome -> linha única, só a última era atualizada e
  // as outras ficavam sem unidade (foi o que aconteceu na primeira rodada).
  const porNome = {};
  rows.forEach((r, i) => {
    const k = String(r[iNome] || '').trim().toLowerCase();
    (porNome[k] = porNome[k] || []).push(i + 2);
  });

  TECIDOS.forEach(t => {
    const [nome, rend, valor, unid, obs] = t;
    const linhas = porNome[nome.toLowerCase()];
    if (linhas && linhas.length) {
      linhas.forEach(linha => {
        const atual = num_(rows[linha - 2][iValor]);
        if (atual !== valor) { sheet.getRange(linha, iValor + 1).setValue(valor); log.push(nome + ' (linha ' + linha + '): ' + atual + ' -> ' + valor); }
        sheet.getRange(linha, iRend + 1).setValue(rend);
        sheet.getRange(linha, iUnid + 1).setValue(unid);
        sheet.getRange(linha, iObs + 1).setValue(obs);
      });
    } else {
      sheet.appendRow(['', nome, '', rend, valor, unid, obs]);
      log.push(nome + ': cadastrado a ' + valor + '/' + unid);
    }
  });

  // Moletons e piquet já estavam na aba com preço por quilo sem dizer isso.
  ['piquet', 'moletom 3 cabos', 'moletom 2 cabos', 'moletom dry'].forEach(nome => {
    (porNome[nome] || []).forEach(linha => {
      if (String(rows[linha - 2][iUnid] || '').trim()) return;
      sheet.getRange(linha, iUnid + 1).setValue('kg');
      log.push(nome + ' (linha ' + linha + '): marcado como preço por quilo');
    });
  });

  SpreadsheetApp.flush();
  return log;
}

/** Wrapper pra rodar pelo menu do editor. */
function _rodarMigrarMateriais2026() {
  const log = migrarMateriais2026_();
  Logger.log(log.length ? log.join('\n') : 'Nada a migrar — já estava tudo aplicado.');
}

/**
 * Aviamentos que variam com o tamanho — vivo e elástico do pijama.
 *
 * Não cabiam no catálogo de rendimento, que só tem `metros` e `metros2`: o
 * pijama usa três materiais (tecido + vivo + elástico) e cada um tem consumo
 * próprio por tamanho. Aqui cada linha é um par tipo de produto + tamanho +
 * aviamento, e a quantidade multiplica o `valorPorMetro` do material.
 *
 * Medidas passadas pela Karolyne em 20/08/2026. O elástico é o mesmo no
 * verão e no inverno; o vivo muda bastante (o de inverno é menor porque a
 * manga longa e a calça levam menos acabamento vivo que o short).
 */
function setupPrecificacaoAviamentosTamanho_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_AVIAMENTOS_TAMANHO);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['tipoProduto', 'tamanho', 'aviamento', 'quantidade']);
  if (jaTinhaDados) return;

  const VERAO = 'Pijama Americano Manga Curta e Short';
  const INVERNO = 'Pijama Americano Manga Longa e Calça';
  // Manga Curta e Calça e Manga Longa e Shorts herdam as medidas do inverno
  // (confirmado pela Karolyne em 20/08/2026) — o que manda no vivo é a calça
  // e a manga longa, não o short.
  const HERDAM_INVERNO = [
    'Pijama Americano Manga Curta e Calça',
    'Pijama Americano Manga Longa e Shorts'
  ];

  const MEDIDAS = {
    verao: {
      'Vivo': { P: 3.75, M: 4.10, G: 4.30, GG: 4.50, G1: 5.00 },
      'Elástico': { P: 0.64, M: 0.66, G: 0.68, GG: 0.72, G1: 0.78 }
    },
    inverno: {
      'Vivo': { P: 2.89, M: 3.02, G: 3.22, GG: 3.25, G1: 4.00 },
      'Elástico': { P: 0.64, M: 0.66, G: 0.68, GG: 0.72, G1: 0.78 }
    }
  };

  const linhas = [];
  function espalhar_(tipoProduto, medidas) {
    Object.keys(medidas).forEach(function (aviamento) {
      const porTamanho = medidas[aviamento];
      Object.keys(porTamanho).forEach(function (tamanho) {
        linhas.push([tipoProduto, tamanho, aviamento, porTamanho[tamanho]]);
      });
    });
  }
  espalhar_(VERAO, MEDIDAS.verao);
  espalhar_(INVERNO, MEDIDAS.inverno);
  HERDAM_INVERNO.forEach(function (tipoProduto) { espalhar_(tipoProduto, MEDIDAS.inverno); });

  sheet.getRange(2, 1, linhas.length, 4).setValues(linhas);
  sheet.autoResizeColumns(1, 4);
}

/**
 * Acabamentos que a peça pode levar — renda, guipir, vivo. São opcionais e
 * combináveis: cada um marcado soma o seu custo.
 *
 * A quantidade é por aplicação, não por material: a mesma guipir tem três
 * linhas porque o que muda é ONDE ela vai. Manga e barra gasta 5 m; manga,
 * barra e revel gasta 9 m; a guipir larga gasta 3 m. Tratar "guipir" como
 * uma quantidade só erraria o custo em qualquer um dos três casos.
 *
 * `substituiTecido` marca quem sai do tecido principal em vez de somar. Só
 * o tule: a manga é de tule e não se corta manga de cetim. Guipir, chantily
 * e vivo são aplicados por cima da peça, o corte continua inteiro.
 *
 * Medidas passadas pela Karolyne em 20/08/2026.
 */
function setupPrecificacaoAcabamentos_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_PRECIFICACAO_ACABAMENTOS);
  const jaTinhaDados = sheet.getLastRow() > 1;
  ensureHeader_(sheet, ['acabamento', 'material', 'metros', 'substituiTecido', 'ativo']);
  if (jaTinhaDados) return;

  const linhas = [
    ['Tule na manga', 'Tule', 0.60, true, true],
    ['Renda Chantily', 'Renda Chantily', 0.30, false, true],
    ['Guipir na manga e barra', 'Guipir', 5.00, false, true],
    ['Guipir na manga, barra e revel', 'Guipir', 9.00, false, true],
    ['Guipir larga', 'Guipir larga', 3.00, false, true],
    ['Vivo no robe', 'Vivo', 9.00, false, true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 5);
}

/**
 * CONSERTO da _Precificacao_Config (20/08/2026). Roda uma vez.
 *
 * atualizarTaxasCanais_ gravou 10 valores numa aba que tinha 9 colunas,
 * porque contava com o cabecalho novo que o ensureHeader_ antigo nunca
 * chegou a escrever. Resultado nos quatro canais medidos: a taxa fixa caiu
 * dentro de despesasFixasPct e o confirmado foi empurrado pra uma decima
 * coluna sem nome. A Shopee ficou com "despesa fixa = 4".
 *
 * Reescreve a aba inteira com o cabecalho certo e os valores nas colunas
 * certas. Nao depende do que esta la: os numeros sao os medidos em jan-jul
 * de 2026, os mesmos de atualizarTaxasCanais_.
 */
function consertarConfigTaxas_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_PRECIFICACAO_CONFIG);
  if (!sheet) throw new Error('Aba ' + ABA_PRECIFICACAO_CONFIG + ' nao existe. Rode setupWorkbook antes.');

  const cabecalho = ['canal', 'impostosPct', 'comissaoPct', 'extra1Nome', 'extra1Pct',
    'extra2Nome', 'extra2Pct', 'taxaFixaReais', 'despesasFixasPct', 'confirmado'];

  // canal | impostos | comissao | extra1Nome | extra1Pct | extra2Nome | extra2Pct | taxaFixa | despFixa | confirmado
  const linhas = [
    ['NuvemShop_Cartao', 0.0742, 0.0314, 'Antecipação 10x', 0.1018, '', 0, 0.50, '', true],
    ['NuvemShop_Pix', 0.0742, 0.0069, '', 0, '', 0, 0.25, '', true],
    ['MercadoLivre', 0.07, 0.181, 'Frete subsidiado', 0.056, '', 0, 0, '', true],
    ['Shopee', 0.0742, 0.163, 'Acelera (antecipação)', 0.049, '', 0, 4.00, '', true],
    ['SHEIN', 0.07, 0.14, 'Antecipação', 0.038, '', 0, 0, '', false],
    ['TikTokShop', 0.07, 0.14, 'Antecipação', 0.038, '', 0, 0, '', false],
    ['_GLOBAL', '', '', '', '', '', '', '', 0.3494, true]
  ];

  const antes = sheet.getDataRange().getValues();
  Logger.log('ANTES (%s linhas x %s colunas):', antes.length, antes[0] ? antes[0].length : 0);
  antes.forEach(function (l) { Logger.log('  ' + l.join(' | ')); });

  sheet.clear();
  sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, cabecalho.length)
    .setFontWeight('bold').setBackground('#8E2A44').setFontColor('#FFFFFF');
  sheet.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);
  sheet.autoResizeColumns(1, cabecalho.length);
  SpreadsheetApp.flush();

  Logger.log('DEPOIS: %s canais reescritos com %s colunas.', linhas.length, cabecalho.length);
  Logger.log('Confira: Shopee deve estar com taxaFixaReais = 4 e despesasFixasPct vazio.');
  return linhas.length;
}

/** Wrapper pra rodar pelo menu do editor. */
function _rodarConsertarConfigTaxas() {
  Logger.log('Canais reescritos: ' + consertarConfigTaxas_());
}

function setupDespesasFixas_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_DESPESAS_FIXAS);
  ensureHeader_(sheet, ['id', 'descricao', 'valorMensal']);
}

/**
 * ATUALIZA AS TAXAS DOS CANAIS com os valores medidos em 20/08/2026.
 *
 * O setupPrecificacaoConfig_ so semeia quando a aba esta vazia
 * (`if (jaTinhaDados) return`), entao corrigir o seed nao muda nada
 * numa planilha que ja rodou. Esta funcao existe pra isso.
 *
 * Ela sobrescreve SO os quatro canais que foram medidos contra dado
 * real (Shopee, MercadoLivre, NuvemShop_Cartao, NuvemShop_Pix).
 * Nao toca em:
 *   _GLOBAL      - a despesa fixa e voce que define
 *   SHEIN        - sem medicao
 *   TikTokShop   - sem medicao
 *
 * Registra no log o valor ANTES e DEPOIS de cada linha, pra dar pra
 * voltar atras se algum numero nao fizer sentido.
 *
 * Rode por _rodarAtualizarTaxasCanais.
 */
function atualizarTaxasCanais_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_PRECIFICACAO_CONFIG);
  if (!sheet) { logSync_('atualizarTaxas', 'erro', 'aba ' + ABA_PRECIFICACAO_CONFIG + ' nao encontrada'); return; }

  // canal -> [impostosPct, comissaoPct, extra1Nome, extra1Pct,
  //           extra2Nome, extra2Pct, taxaFixaReais]
  const MEDIDOS = {
    'NuvemShop_Cartao': [0.0742, 0.0314, 'Antecipação 10x', 0.1018, '', 0, 0.50],
    'NuvemShop_Pix':    [0.0742, 0.0069, '', 0, '', 0, 0.25],
    'MercadoLivre':     [0.07,   0.181,  'Frete subsidiado', 0.056, '', 0, 0],
    'Shopee':           [0.0742, 0.163,  'Acelera (antecipação)', 0.049, '', 0, 4.00]
  };

  const ultima = sheet.getLastRow();
  if (ultima < 2) { logSync_('atualizarTaxas', 'erro', 'aba vazia'); return; }

  const dados = sheet.getRange(2, 1, ultima - 1, 10).getValues();
  let mexidas = 0;

  for (let i = 0; i < dados.length; i++) {
    const canal = String(dados[i][0] || '').trim();
    if (!Object.prototype.hasOwnProperty.call(MEDIDOS, canal)) continue;

    const antes = dados[i].slice(1, 8).join(' | ');
    const novo = MEDIDOS[canal];
    // colunas 2..8 = impostosPct .. taxaFixaReais
    sheet.getRange(i + 2, 2, 1, 7).setValues([novo]);
    // marca como confirmado (coluna 10)
    sheet.getRange(i + 2, 10).setValue(true);
    mexidas++;

    logSync_('atualizarTaxas', 'ok',
      canal + ' | ANTES: ' + antes + ' | DEPOIS: ' + novo.join(' | '));
  }

  logSync_('atualizarTaxas', 'ok', mexidas + ' canal(is) atualizado(s) com taxa medida');
  return mexidas;
}

function _rodarAtualizarTaxasCanais() {
  const n = atualizarTaxasCanais_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    n + ' canais atualizados com as taxas medidas', 'Precificação', 8);
}
