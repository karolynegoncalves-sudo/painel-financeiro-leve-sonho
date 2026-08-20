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
  setupDespesasFixas_(ss);

  SpreadsheetApp.flush();
  Logger.log('Setup concluído. Confira as abas: %s', ss.getSheets().map(s => s.getName()).join(', '));
}

function getOrCreateSheet_(ss, nome) {
  let sheet = ss.getSheetByName(nome);
  if (!sheet) sheet = ss.insertSheet(nome);
  return sheet;
}

function ensureHeader_(sheet, headers) {
  const range = sheet.getRange(1, 1, 1, headers.length);
  if (sheet.getLastRow() === 0 || range.getValues()[0].join('') === '') {
    range.setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#8E2A44').setFontColor('#FFFFFF');
  }
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
    'despesasFixasPct', 'confirmado'
  ]);
  if (jaTinhaDados) return;

  const linhas = [
    ['NuvemShop_Cartao', 0.0742, 0.03, 'TPV Nuvemshop', 0.01, 'Parcelamento Pagar.ME', 0.1305, '', true],
    ['NuvemShop_Pix', 0.0742, 0, 'Taxas', 0.0098, '', 0, '', true],
    ['MercadoLivre', 0.07, 0.14, 'Antecipação', 0.038, '', 0, '', true],
    ['Shopee', 0.0742, 0.14, 'Transporte', 0.06, 'Antecipa', 0.035, '', true],
    ['SHEIN', 0.07, 0.14, 'Antecipação', 0.038, '', 0, '', true],
    ['TikTokShop', 0.07, 0.14, 'Antecipação', 0.038, '', 0, '', false],
    ['_GLOBAL', '', '', '', '', '', '', 0.3494, true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 9);
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
  ensureHeader_(sheet, ['fornecedor', 'material', 'largura', 'rendimento', 'valor']);
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
    'familia', 'descricao', 'tipoProduto', 'tipoPeca', 'aviamentosJson', 'custoManual', 'ativo'
  ]);
  if (jaTinhaDados) return;

  // Aviamentos confirmados nas fichas FPV: linha 0,03 + fio 0,07 +
  // saquinho crystal 0,07 + envelope correio 0,56 = 0,73 em toda peça.
  // O pijama soma 5 botões a 0,024 = 0,12.
  const AVI_BASE = '[{"descricao":"Linha","valor":0.03},{"descricao":"Fio","valor":0.07},{"descricao":"Saquinho Crystal","valor":0.07},{"descricao":"Envelope Correio","valor":0.56}]';
  const AVI_PIJAMA = '[{"descricao":"Linha","valor":0.03},{"descricao":"Fio","valor":0.07},{"descricao":"Saquinho Crystal","valor":0.07},{"descricao":"Envelope Correio","valor":0.56},{"descricao":"Botão (5un)","valor":0.12}]';

  const linhas = [
    ['PMC-CUR', 'Pijama Americano Cetim - Manga Curta e Shorts', 'Pijama Americano Manga Curta e Short', 'Pijama', 2, AVI_PIJAMA, '', true],
    ['RMC-CUR', 'Robe de Cetim - Manga Curta', 'Robe manga curta', 'Robe', 1, AVI_BASE, '', true],
    ['RIF-CUR', 'Robe de Cetim - Infantil', 'Robe infantil', 'Robe', 1, AVI_BASE, '', true],
    ['PML-LON', 'Pijama Americano Cetim - Manga Longa e Calça', 'Pijama Americano Manga Longa e Calça', 'Pijama', 2, AVI_PIJAMA, '', true],
    ['PIF-CUR', 'Pijama Americano Cetim Infantil - Manga Curta e Shorts', 'Pijama Americano Infantil', 'Pijama', 2, AVI_PIJAMA, '', true],
    ['RME-CUR', 'Robe de Cetim com Elastano - Manga Curta', 'Robe manga curta', 'Robe', 1, AVI_BASE, '', true],
    ['KSC', 'Kit Saquinhos de Cetim', 'Saquinhos de Cetim', 'Saquinho', 1, '', '', true],
    // Sem rendimento cadastrado — dependem de custoManual até entrarem no catálogo.
    ['SCR', 'Scrunchie de Cetim', '', 'Scrunchie', 1, '', '', true],
    ['SCE', 'Scrunchie de Cetim (código alternativo)', '', 'Scrunchie', 1, '', '', true],
    ['FRN', 'Fronha de Cetim', '', '', 1, '', '', true],
    ['TCA', 'Touca de Cetim / Touca Mágica', '', '', 1, '', '', true],
    ['FXA-CNL', 'Faixa de Cabelo Canelada', '', '', 1, '', '', true],
    ['RGT-CUR', 'Regata Feminina Canelada', '', '', 1, '', '', true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 7);
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
    'canalGrupo', 'tipoPeca', 'material', 'materialSecundario', 'costuraValor', 'ativo'
  ]);
  if (jaTinhaDados) return;

  const linhas = [
    ['Marketplace', 'Robe', 'Cetim Poliéster', '', 5.00, true],
    ['Nuvemshop', 'Robe', 'Cetim Elastano', '', 8.00, true],
    ['Marketplace', 'Pijama', 'Cetim Elastano', '', 11.00, true],
    ['Nuvemshop', 'Pijama', 'Cetim Elastano', '', 11.00, true],
    ['Marketplace', 'Scrunchie', 'Cetim Poliéster', '', 0.30, true],
    ['Nuvemshop', 'Scrunchie', 'Cetim Elastano', '', 0.30, true],
    ['Marketplace', 'Saquinho', 'Cetim Poliéster', '', 0.30, true],
    ['Nuvemshop', 'Saquinho', 'Cetim Poliéster', '', 0.30, true]
  ];
  sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
  sheet.autoResizeColumns(1, 6);
}

function setupDespesasFixas_(ss) {
  const sheet = getOrCreateSheet_(ss, ABA_DESPESAS_FIXAS);
  ensureHeader_(sheet, ['id', 'descricao', 'valorMensal']);
}
