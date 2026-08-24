/**
 * Code.gs — ponto de entrada do Web App. Duas funções:
 *  1) Callback OAuth do Bling (quando chega ?code=...&state=...).
 *  2) API JSON pro dashboard (quando chega ?view=...&token=...).
 */

function doGet(e) {
  const params = (e && e.parameter) || {};

  if (params.code) {
    return handleBlingOAuthCallback_(params);
  }

  const view = params.view;
  if (!view) return jsonResponse_({ error: 'missing_view' });

  const email = verificarAcesso_(params.token);
  if (!email) return jsonResponse_({ error: 'not_authorized' });

  switch (view) {
    case 'fluxoCaixa': return jsonResponse_({ email: email, rows: getFluxoCaixaRows_() });
    case 'dre': return jsonResponse_({ email: email, rows: getDreRows_() });
    case 'precificacao': return jsonResponse_({ email: email, produtos: getPrecificacaoCatalogo_() });
    case 'precificacaoConfig': return jsonResponse_({ email: email, config: getPrecificacaoConfig_() });
    case 'precificacaoMateriais': return jsonResponse_({ email: email, materiais: getPrecificacaoMateriaisCatalogo_() });
    case 'precificacaoRendimento': return jsonResponse_({ email: email, rendimento: getPrecificacaoRendimentoCatalogo_() });
    case 'precificacaoFuncionarios': return jsonResponse_({ email: email, funcionarios: getPrecificacaoFuncionariosCatalogo_() });
    case 'precificacaoMaoDeObraPecas': return jsonResponse_({ email: email, maoDeObraPecas: getPrecificacaoMaoDeObraPecasCatalogo_() });
    case 'precificacaoCorte': return jsonResponse_({ email: email, corte: getPrecificacaoCorteCatalogo_() });
    // Estes dois getters ja existiam mas nunca tinham sido expostos. A Ficha
    // de Preco precisa deles: producao diz qual tecido e qual costura cada
    // grupo de canal usa, e aviamentos traz vivo/elastico por tamanho.
    case 'precificacaoProducao': return jsonResponse_({ email: email, producao: getPrecificacaoProducao_() });
    case 'precificacaoAviamentos': return jsonResponse_({ email: email, aviamentos: getPrecificacaoAviamentosTamanhoCatalogo_() });
    case 'precificacaoAcabamentos': return jsonResponse_({ email: email, acabamentos: getPrecificacaoAcabamentosCatalogo_() });
    case 'precificacaoModelos': return jsonResponse_({ email: email, modelos: getPrecificacaoModelosCatalogo_() });
    case 'precificacaoFicha': return jsonResponse_({ email: email, ficha: getPrecificacaoFichaCatalogo_() });
    // Uma chamada so, no lugar de 12. A aba de precificacao pedia doze
    // rotas ao mesmo tempo e estourava o limite de execucoes
    // concorrentes do Apps Script, que responde com pagina HTML de
    // erro - era o que derrubava a aba e a fazia demorar pra abrir.
    case 'precificacaoTudo': return jsonResponse_({
      email: email,
      produtos: getPrecificacaoCatalogo_(),
      config: getPrecificacaoConfig_(),
      materiais: getPrecificacaoMateriaisCatalogo_(),
      rendimento: getPrecificacaoRendimentoCatalogo_(),
      funcionarios: getPrecificacaoFuncionariosCatalogo_(),
      maoDeObraPecas: getPrecificacaoMaoDeObraPecasCatalogo_(),
      corte: getPrecificacaoCorteCatalogo_(),
      producao: getPrecificacaoProducao_(),
      aviamentos: getPrecificacaoAviamentosTamanhoCatalogo_(),
      acabamentos: getPrecificacaoAcabamentosCatalogo_(),
      modelos: getPrecificacaoModelosCatalogo_(),
      ficha: getPrecificacaoFichaCatalogo_()
    });
    case 'precificacaoSkuRegras': return jsonResponse_({ email: email, regras: getPrecificacaoSkuRegras_() });
    case 'despesasFixas': return jsonResponse_({ email: email, despesas: getDespesasFixasList_() });
    case 'kpis': return jsonResponse_({ email: email, kpis: getKpis_() });
    case 'vendas': return jsonResponse_({ email: email, rows: getVendasRows_() });
    default: return jsonResponse_({ error: 'unknown_view' });
  }
}

/**
 * Único ponto de escrita vindo do frontend (tudo mais é só leitura). O
 * dashboard manda o body como texto puro JSON (Content-Type text/plain)
 * de propósito — evita o preflight CORS que o Apps Script Web App não
 * responde bem, e a gente faz o JSON.parse manualmente aqui.
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const email = verificarAcesso_(body.token);
    if (!email) return jsonResponse_({ ok: false, error: 'not_authorized' });

    switch (body.action) {
      case 'salvarProduto':
        return jsonResponse_({ ok: true, email: email, produto: salvarPrecificacaoProduto_(body.produto, email) });
      case 'excluirProduto':
        return jsonResponse_({ ok: true, email: email, id: excluirPrecificacaoProduto_(body.id, email) });
      case 'salvarDespesaFixa':
        return jsonResponse_({ ok: true, email: email, despesa: salvarDespesaFixa_(body.despesa, email) });
      case 'excluirDespesaFixa':
        return jsonResponse_({ ok: true, email: email, id: excluirDespesaFixa_(body.id, email) });
      case 'seedDespesasFixas':
        seedDespesasFixasReais_();
        return jsonResponse_({ ok: true, email: email, despesas: getDespesasFixasList_() });
      case 'custosPorSku':
        return jsonResponse_({ ok: true, email: email, custos: custosPorSku_(body.produtos) });
      case 'diagnosticoCustoSku':
        return jsonResponse_({ ok: true, email: email, diagnostico: diagnosticoCustoSku_(body.produtos) });
      case 'arquivarPrecificacoesSemSku':
        return jsonResponse_({ ok: true, email: email, resultado: arquivarPrecificacoesSemSku_(email) });
      default:
        return jsonResponse_({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    logSync_('doPost', 'erro', String(err));
    return jsonResponse_({ ok: false, error: String(err) });
  }
}

/**
 * Atalho temporário: o arquivo ImportarNuvemShop.gs é grande demais pro
 * "menu de funções" do editor conseguir listar as funções dele direito
 * (é só um bug visual da interface, o código roda normal). Rode esta
 * função daqui — ela só chama a de verdade. Pode apagar os dois depois
 * de importar uma vez.
 */
function _rodarImportacaoNuvemShop() {
  importarProdutosNuvemShop_();
}

/**
 * Atalho temporário: funções terminadas em "_" não aparecem no menu de
 * funções pra rodar manualmente. Rode esta daqui — só chama a de baixo.
 * Pode apagar os dois depois de importar uma vez.
 */
function _rodarSeedDespesasFixas() {
  seedDespesasFixasReais_();
}

/**
 * Carga única dos custos fixos reais (aluguel, pró-labore, contas, folha
 * da Thayssa/Natália/Andréia). Limpa a aba `_Despesas_Fixas` e regrava do
 * zero — rode uma vez e pode apagar esta função depois.
 */
function seedDespesasFixasReais_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet_(ss, ABA_DESPESAS_FIXAS);
  sheet.clear();

  const dados = [
    ['id', 'descricao', 'valorMensal'],
    ['cf01', 'Aluguel', 2900],
    ['cf02', 'Pró-Labore', 4000],
    ['cf03', 'Treinamentos/Cursos', 250],
    ['cf04', 'Freelancer', 0],
    ['cf05', 'Energia elétrica', 243],
    ['cf06', 'Água', 208],
    ['cf07', 'Internet e Telefone', 179.79],
    ['cf08', 'Despesas bancárias', 75],
    ['cf09', 'Honorários contador', 697],
    ['cf10', 'Bling ERP', 200],
    ['cf11', 'TitanPush', 40],
    ['cf12', 'Claude', 100],
    ['cf13', 'Google', 6.99],
    ['cf14', 'Nuvem Shop', 164],
    ['cf15', 'Financiamento', 3462],
    ['cf16', 'Marketing', 0],
    ['cf17', 'Motoboy', 180],
    ['cf18', 'IPTU', 71.31],
    ['cf19', 'Waspeed', 49.5],
    ['cf20', 'Thayssa - Salário', 1700],
    ['cf21', 'Thayssa - VR', 570],
    ['cf22', 'Natália - Salário', 2200],
    ['cf23', 'Natália - VR/VT', 800],
    ['cf24', 'Andréia - Salário', 1700],
    ['cf25', 'Andréia - VR/VT', 800]
  ];

  sheet.getRange(1, 1, dados.length, 3).setValues(dados);
  SpreadsheetApp.flush();
  Logger.log('Despesas fixas cadastradas: %s linhas.', dados.length - 1);
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Painel Financeiro')
    .addItem('Sincronizar Bling agora', 'syncBling')
    .addItem('Instalar sincronização automática (2h)', 'criarGatilhoSync')
    .addSeparator()
    .addItem('1) Configurar setup da planilha', 'setupWorkbook')
    .addItem('2) Importar produtos do NuvemShop (uma vez)', 'importarProdutosNuvemShop_')
    .addToUi();

  /* As manutenções de precificação ficam em menu próprio porque são de rodar
     uma vez e conferir o resultado, não rotina. Estão aqui em vez de só no
     seletor de funções do editor: pelo menu dá pra disparar direto da
     planilha, com o resultado já na frente. */
  ui.createMenu('Precificação (manutenção)')
    .addItem('Conserta a aba de taxas por canal', '_rodarConsertarConfigTaxas')
    .addItem('Atualiza tecidos e unidades de compra', '_rodarMigrarMateriais2026')
    .addItem('Separa o tule do tecido principal', '_rodarMigrarTuleFlare')
    .addSeparator()
    .addItem('Arquiva precificações sem SKU', '_rodarArquivarPrecificacoesSemSku')
    .addToUi();
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function htmlResponse_(msg) {
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">' + msg + '</p>');
}

function sheetData_(nomeAba) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nomeAba);
  if (!sheet || sheet.getLastRow() < 2) return { headers: [], rows: [] };
  const valores = sheet.getDataRange().getValues();
  return { headers: valores[0], rows: valores.slice(1) };
}

function getFluxoCaixaRows_() {
  return sheetData_(ABA_FLUXO_CAIXA);
}

function getDreRows_() {
  return sheetData_(ABA_DRE);
}

/** Lê o resumo de cada aba Precificação_<Canal> (espelhada via IMPORTRANGE). */
function getPrecificacaoResumo_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return FPVS_2026.map(fpv => {
    const sheet = ss.getSheetByName('Precificação_' + fpv.canal);
    if (!sheet) return { canal: fpv.canal, ok: false, motivo: 'aba não encontrada' };
    const primeiraCelula = sheet.getRange('A1').getValue();
    const erroImport = String(primeiraCelula).indexOf('#') === 0;
    return {
      canal: fpv.canal,
      ok: !erroImport,
      motivo: erroImport ? String(primeiraCelula) : '',
      linhas: sheet.getLastRow(),
      colunas: sheet.getLastColumn()
    };
  });
}

/** KPIs simples calculados em cima da DRE já agregada por mês. */
function getKpis_() {
  const { rows } = sheetData_(ABA_DRE);
  const porMes = {};
  rows.forEach(([mesBruto, grupo, valor]) => {
    // mesmo cuidado do getDespesasFixasPct_: a coluna pode voltar como Date
    const mes = mesTexto_(mesBruto);
    if (!mes) return;
    porMes[mes] = porMes[mes] || {};
    porMes[mes][grupo] = (porMes[mes][grupo] || 0) + Number(valor || 0);
  });
  const meses = Object.keys(porMes).sort();
  return meses.map(mes => {
    const g = porMes[mes];
    const receitaBruta = g['Receita Bruta'] || 0;
    const deducoes = g['Deduções da Receita'] || 0;
    const cmv = g['CMV'] || 0;
    const despesasOperacionais = (g['Despesas Comerciais'] || 0) + (g['Despesas Administrativas'] || 0) + (g['Despesas com Pessoal'] || 0);
    const resultadoFinanceiro = g['Resultado Financeiro'] || 0;
    const impostosLucro = g['Impostos sobre o Lucro'] || 0;
    const resultadoLiquido = receitaBruta + deducoes + cmv + despesasOperacionais + resultadoFinanceiro + impostosLucro;
    return {
      mes: mes,
      receitaBruta: receitaBruta,
      resultadoLiquido: resultadoLiquido,
      margemLiquidaPct: receitaBruta ? (resultadoLiquido / receitaBruta) : 0
    };
  });
}

/**
 * Atalho pro menu de funções (as terminadas em "_" não aparecem lá).
 */
function _rodarCorrigirDreMapa() {
  const r = corrigirDreMapa_();
  Logger.log('Categorias corrigidas: ' + r.corrigidas + ' | já certas: ' + r.jaCertas + ' | não encontradas: ' + r.naoAchadas);
}

/**
 * Conserta o agrupamento de categorias que estavam distorcendo a DRE.
 *
 * Diferente do seed, esta função ROLA MESMO por cima do que já existe —
 * mas só nas categorias listadas aqui, e só se o grupo estiver diferente.
 * Qualquer outro ajuste manual da Karolyne no `_DRE_Mapa` fica intacto.
 *
 * Motivo de cada troca (levantado do DRE real do Bling de julho/2026):
 *
 *  - "Rendimento de aplicação financeira" acumulava R$ 10.420,05 em julho,
 *    mas isso é resgate da Caixinha do Nubank: dinheiro dela voltando da
 *    poupança, não faturamento. Contar como receita inflava o resultado.
 *    (Perde-se o juro de verdade junto, que é centavos perto disso.)
 *
 *  - "Descontos concedidos" acumulava R$ 8.422,70, que é a comissão da
 *    Shopee — cada venda unitária entra bruta em "Vendas de produtos" e a
 *    taxa sai nessa categoria. É dedução da receita, não despesa
 *    financeira. Fica junto de "Taxas do marketplace" pra ficar coerente.
 *
 *  - "Retirada de socio" entrou sozinha no mapa em 23/08/2026, quando o
 *    sync passou a buscar as categorias novas do Bling. Não tem pai, então
 *    caiu como "(sem mapear)". Distribuição de lucro não é despesa da
 *    empresa: sai do resultado já apurado. Vai pra não operacional.
 *    (Pró-labore é outra coisa — esse é remuneração e continua em
 *    Despesas com Pessoal.)
 */
function corrigirDreMapa_() {
  const CORRECOES = {
    '14639321646': 'Não Operacional (ignorar na DRE)', // Rendimento de aplicação financeira
    '14639321695': 'Deduções da Receita',              // Descontos concedidos
    '14639321698': 'Deduções da Receita',              // Taxas do marketplace
    '14741903825': 'Não Operacional (ignorar na DRE)'  // Retirada de socio
  };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_DRE_MAPA);
  if (!sheet) throw new Error('Aba ' + ABA_DRE_MAPA + ' não existe. Rode o setup antes.');

  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) throw new Error('Aba ' + ABA_DRE_MAPA + ' está vazia.');

  const ids = sheet.getRange(2, 1, ultimaLinha - 1, 1).getValues();
  const grupos = sheet.getRange(2, 5, ultimaLinha - 1, 1).getValues();

  let corrigidas = 0, jaCertas = 0;
  const vistos = {};
  for (let i = 0; i < ids.length; i++) {
    const id = String(ids[i][0]).trim();
    if (!CORRECOES.hasOwnProperty(id)) continue;
    vistos[id] = true;
    if (String(grupos[i][0]).trim() === CORRECOES[id]) { jaCertas++; continue; }
    grupos[i][0] = CORRECOES[id];
    corrigidas++;
  }
  if (corrigidas) sheet.getRange(2, 5, grupos.length, 1).setValues(grupos);

  const naoAchadas = Object.keys(CORRECOES).filter(function (id) { return !vistos[id]; });
  return { corrigidas: corrigidas, jaCertas: jaCertas, naoAchadas: naoAchadas.join(', ') || '(nenhuma)' };
}
