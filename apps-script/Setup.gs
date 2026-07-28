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
