/**
 * Code.gs — ponto de entrada do Web App. Duas funções:
 *  1) Callback OAuth do Bling (quando chega ?code=...&state=...).
 *  2) API JSON pro dashboard (quando chega ?view=...&token=...).
 */

/* ABA_RECEITA_PEDIDOS_ e ABA_CMV_CONSUMO_ sao declaradas no BlingSync.gs. Nao
   redeclarar aqui: no Apps Script todos os .gs dividem o mesmo escopo global, e
   um `const` repetido e SyntaxError que derruba o projeto inteiro. */

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
    // O login precisa das duas coisas, e cada chamada ao Web App custa ~2s
    // de pedagio fixo (o 302 do Apps Script mais o tempo de acordar).
    // Medido em 24/08/2026: despesasFixas le 24 linhas e leva 2,26s. Vem
    // junto, entao, e o login passa a fazer uma chamada em vez de duas.
    case 'fluxoCaixa': {
      const r = getFluxoCaixaRows_();
      // dreFontes vem no mesmo pacote pelo mesmo motivo de despesasFixas: cada
      // chamada ao Web App custa ~2s de pedágio fixo, e a DRE precisa das duas
      // logo na primeira tela.
      return jsonResponse_({ email: email, rows: r, despesas: getDespesasFixasList_(),
                             dreFontes: getDreFontes_() });
    }
    case 'dre': return jsonResponse_({ email: email, rows: getDreRows_(e && e.parameter && e.parameter.regime) });
    case 'dreFontes': return jsonResponse_(Object.assign({ email: email }, getDreFontes_()));
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
    case 'precificacaoTudo': return jsonResponse_(precificacaoTudo_(email));
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

/**
 * As duas fontes que a DRE passou a usar no lugar das contas (08/09/2026):
 * receita pela data do pedido a preço praticado, e CMV por consumo.
 *
 * Vêm em rota separada de propósito. A `Fluxo de Caixa` continua sendo espelho
 * do razão do Bling — receita e CMV reconstruídos não são lançamento, e
 * misturá-los ali contaminaria a DFC, que lê a mesma aba e passaria a contar
 * a venda duas vezes: uma no recebimento real e outra na linha sintética.
 */
function getDreFontes_() {
  const ler = (aba, cols) => {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(aba);
    if (!sheet || sheet.getLastRow() < 2) return [];
    const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, cols).getValues();
    return dados
      .map(l => ({ mes: mesTexto_(l[0]), canal: String(l[1] || ''), valor: Number(l[2]) || 0,
                   qtd: Number(l[3]) || 0, alerta: Number(l[4]) || 0 }))
      .filter(r => r.mes && r.valor);
  };
  return {
    receita: ler(ABA_RECEITA_PEDIDOS_, 4),
    cmv: ler(ABA_CMV_CONSUMO_, 5)
  };
}

/**
 * A aba DRE passou a guardar os DOIS regimes (coluna 'regime': realizado
 * e competencia) desde 27/08/2026. Quem le sem filtrar soma os dois e
 * DOBRA tudo. Por isso o filtro mora aqui, e o padrao e 'realizado',
 * que e o comportamento que existia antes.
 */
function getDreRows_(regime) {
  // O padrão virou 'competencia' em 08/09/2026. O 'realizado' desta aba data
  // pelo VENCIMENTO, não pela data do pagamento (que mora no borderô), então
  // nunca foi uma visão de caixa — e chegava a ficar MAIOR que a competência,
  // o que é aritmeticamente impossível. Caixa é o DFC, feito pelo extrato.
  const alvo = regime || 'competencia';
  const { headers, rows } = sheetData_(ABA_DRE);
  const iReg = headers.indexOf('regime');
  if (iReg < 0) return { headers: headers, rows: rows };   // planilha antiga
  return { headers: headers, rows: rows.filter(r => String(r[iReg] || 'realizado') === alvo) };
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

/**
 * KPIs calculados em cima da DRE já agregada por mês.
 *
 * Passou a ler COMPETÊNCIA em 08/09/2026. O regime "realizado" desta aba
 * nunca foi caixa: ele data o lançamento pelo VENCIMENTO, porque a data em
 * que o dinheiro entrou mora no borderô e o sync não lê. O sintoma que
 * denunciou foi aritmético — em agosto o "realizado" (R$ 70.914) ficou maior
 * que a competência (R$ 59.041), o que é impossível numa DRE sã, já que
 * competência inclui o que ainda não foi pago. Caixa de verdade é o DFC,
 * montado a partir do extrato bancário.
 */
function getKpis_() {
  const { rows } = getDreRows_('competencia');
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
    // grupo novo (08/09/2026): taxa de marketplace e frete saíram das
    // deduções e passaram a compor o custo variável de venda, abaixo do
    // lucro bruto. É o que faz existir margem de contribuição.
    const variaveis = g['Despesas Variáveis de Venda'] || 0;
    const fixas = (g['Despesas Comerciais'] || 0) + (g['Despesas Administrativas'] || 0) + (g['Despesas com Pessoal'] || 0);
    const resultadoFinanceiro = g['Resultado Financeiro'] || 0;
    const impostosLucro = g['Impostos sobre o Lucro'] || 0;

    const receitaLiquida = receitaBruta + deducoes;
    const lucroBruto = receitaLiquida + cmv;
    const margemContribuicao = lucroBruto + variaveis;
    const ebitda = margemContribuicao + fixas;
    const resultadoLiquido = ebitda + resultadoFinanceiro + impostosLucro;
    const pct = (v) => receitaBruta ? (v / receitaBruta) : 0;
    return {
      mes: mes,
      receitaBruta: receitaBruta,
      receitaLiquida: receitaLiquida,
      lucroBruto: lucroBruto,
      margemBrutaPct: pct(lucroBruto),
      margemContribuicao: margemContribuicao,
      margemContribuicaoPct: pct(margemContribuicao),
      custoFixo: -fixas,
      ebitda: ebitda,
      margemEbitdaPct: pct(ebitda),
      resultadoLiquido: resultadoLiquido,
      margemLiquidaPct: pct(resultadoLiquido),
      // ponto de equilíbrio = custo fixo ÷ margem de contribuição %.
      // Sem MC positiva ele não existe: não há faturamento que empate.
      pontoEquilibrio: (margemContribuicao > 0 && receitaBruta)
        ? (-fixas) / (margemContribuicao / receitaBruta) : null
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
    '14741903825': 'Não Operacional (ignorar na DRE)', // Retirada de socio

    // ---- revisão de 08/09/2026, medida sobre agosto ----
    //
    // COMPRA NÃO É CUSTO DO VENDIDO. As quatro categorias abaixo somavam
    // R$ 16.975 em agosto e caíam inteiras em CMV. Comprar malha no Brás é
    // estoque; vira custo quando a peça sai. Enquanto isso valia, julho
    // fechou com CMV de R$ 186 e agosto com R$ 16.815 — uma oscilação de
    // R$ 57 mil no resultado sem causa econômica. O CMV agora vem de
    // _CMV_Consumo (peças vendidas × ficha técnica).
    // Facção entra aqui junto: a costura já está dentro da ficha, então
    // contar também o pagamento à costureira seria dobra.
    '14639321654': 'Estoque (ignorar na DRE)',         // Compras de fornecedores
    '14639321655': 'Estoque (ignorar na DRE)',         // Compra de insumos e matéria prima
    '14739930076': 'Estoque (ignorar na DRE)',         // Embalagem e Insumos de Produção
    '14739931044': 'Estoque (ignorar na DRE)',         // Facção / Mão de obra terceirizada
    '14639321661': 'Estoque (ignorar na DRE)',         // Custo dos serviços prestados

    // RECEITA NÃO VEM MAIS DA CONTA A RECEBER. A conta só nasce quando o
    // marketplace libera o dinheiro, e cada espelho grava numa base
    // diferente (Shopee a preço de lista, ML a preço praticado), com a
    // integração do Bling lançando por cima. Em agosto as contas somavam
    // R$ 64.929 para uma venda real de R$ 56.860. Agora vem de
    // _Receita_Pedidos, pela data do pedido e a preço praticado.
    '14639321643': 'Receita pelo pedido (ignorar na DRE)', // Vendas de produtos
    '14639321644': 'Receita pelo pedido (ignorar na DRE)', // Vendas de mercadorias
    '14639321645': 'Receita pelo pedido (ignorar na DRE)', // Vendas de serviços

    // DESCONTO DE VITRINE NÃO É DEDUÇÃO. O espelho gravava receita a preço
    // de lista e o desconto como dedução; em agosto isso injetou R$ 19.600
    // de receita que ninguém faturou e a mesma quantia de dedução. Como a
    // receita agora já entra a preço praticado, o desconto sai da conta.
    // (Que o preço de lista é ficção se vê no contraste: 37,3% de desconto
    // na Shopee contra 0,1% no Mercado Livre.)
    '14639321657': 'Desconto de vitrine (ignorar na DRE)', // Descontos incondicionais

    // TAXA DE CANAL É DESPESA VARIÁVEL DE VENDA, não dedução da receita.
    // Somada ao desconto de vitrine, era o que levava a linha de deduções a
    // 64% da receita em agosto. Some abaixo do lucro bruto, junto do frete.
    '14639321698': 'Despesas Variáveis de Venda',      // Taxas do marketplace
    '14639321695': 'Despesas Variáveis de Venda',      // Descontos concedidos (comissão Shopee legada)
    '14639321667': 'Despesas Variáveis de Venda'       // Fretes e seguros
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


/**
 * Tudo que a Ficha de Preço precisa, numa resposta só.
 *
 * Duas economias, medidas com o testarRotas:
 *
 *  - NÃO devolve mais o catálogo de produtos (1.369 ms, a leitura mais
 *    cara) nem a lista de funcionários. Os dois alimentavam o editor
 *    antigo de precificação, que saiu do ar quando a Ficha entrou — o
 *    elemento que eles preenchiam nem existe mais no HTML.
 *
 *  - o resultado fica 5 minutos em cache. Cada aba lida custa uma ida e
 *    volta à planilha, independente do tamanho; são dez abas, e nenhuma
 *    delas muda de um minuto pro outro. Cinco minutos é curto o bastante
 *    pra uma edição sua aparecer logo, e o syncBling limpa o cache assim
 *    que roda. Pra ver na hora, rode _rodarLimparCachePrecificacao.
 */
const CACHE_PRECIF_ = 'precif_tudo_v1';

function precificacaoTudo_(email) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_PRECIF_);
  if (guardado) {
    try {
      const d = JSON.parse(guardado);
      d.email = email;
      return d;
    } catch (e) { /* cache corrompido: refaz abaixo */ }
  }

  const d = {
    config: getPrecificacaoConfig_(),
    materiais: getPrecificacaoMateriaisCatalogo_(),
    rendimento: getPrecificacaoRendimentoCatalogo_(),
    maoDeObraPecas: getPrecificacaoMaoDeObraPecasCatalogo_(),
    corte: getPrecificacaoCorteCatalogo_(),
    producao: getPrecificacaoProducao_(),
    aviamentos: getPrecificacaoAviamentosTamanhoCatalogo_(),
    acabamentos: getPrecificacaoAcabamentosCatalogo_(),
    modelos: getPrecificacaoModelosCatalogo_(),
    ficha: getPrecificacaoFichaCatalogo_()
  };

  // O cache tem teto de 100 KB por chave; se estourar, segue sem cache.
  try {
    const txt = JSON.stringify(d);
    if (txt.length < 95000) cache.put(CACHE_PRECIF_, txt, 300);
  } catch (e) { /* sem cache, so mais lento */ }

  d.email = email;
  return d;
}

function limparCachePrecificacao_() {
  CacheService.getScriptCache().remove(CACHE_PRECIF_);
}

function _rodarLimparCachePrecificacao() {
  limparCachePrecificacao_();
  Logger.log('Cache da precificação limpo. A próxima abertura lê a planilha de novo.');
}
