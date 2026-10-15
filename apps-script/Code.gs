/**
 * Code.gs — ponto de entrada do Web App. Duas funções:
 *  1) Callback OAuth do Bling (quando chega ?code=...&state=...).
 *  2) API JSON pro dashboard (quando chega ?view=...&token=...).
 */

/* ABA_RECEITA_PEDIDOS_ e ABA_CMV_CONSUMO_ sao declaradas no BlingSync.gs. Nao
   redeclarar aqui: no Apps Script todos os .gs dividem o mesmo escopo global, e
   um `const` repetido e SyntaxError que derruba o projeto inteiro. */

/**
 * QUAL VERSAO DO BACKEND ESTA IMPLANTADA.
 *
 * O Web App serve a VERSAO IMPLANTADA, nao o codigo do editor. Salvar nao
 * publica. Isso ja custou tempo tres vezes neste projeto: em 15/08/2026 a
 * implantacao estava presa na Versao 7 e o botao "Competencia" nao acendia; em
 * 14/09/2026 o imposto nao apareceu na DRE depois de republicar e passamos a
 * conversa sem saber se era codigo, dado ou implantacao.
 *
 * O sintoma e sempre o mesmo e sempre ambiguo: "nao atualizou". Sem carimbo, a
 * unica saida e adivinhar. Com carimbo, a tela responde.
 *
 * TROQUE ESTA STRING quando mexer no que o doGet devolve. O painel mostra o
 * valor e avisa em vermelho quando nao encontra a marca que ele espera.
 */
const BACKEND_VERSAO_ = '2026-10-15 saldos+fantasmas';

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
      /* `de` e `ate` vem da tela: ela pede o periodo do filtro mais o
         anterior comparavel. Ausentes, cai na janela de 13 meses - cliente
         antigo continua funcionando. */
      /* Os tres pesos do pacote, cronometrados separados (04/10/2026). Vem no
         proprio carimbo porque o Logger nao chega a quem abre o painel, e
         porque medir pelo relogio do navegador mistura servidor com rede. */
      const tA_ = Date.now();
      const r = getFluxoCaixaRows_(params.de, params.ate);
      const msFluxo_ = Date.now() - tA_;
      const tB_ = Date.now();
      const despesasFixas_ = getDespesasFixasList_();
      const msDespesas_ = Date.now() - tB_;
      const tC_ = Date.now();
      // dreFontes vem no mesmo pacote pelo mesmo motivo de despesasFixas: cada
      // chamada ao Web App custa ~2s de pedágio fixo, e a DRE precisa das duas
      // logo na primeira tela.
      /* O carimbo MEDE, nao so se nomeia. Em 14/09/2026 a Karolyne republicou
         varias vezes e o imposto nao apareceu; o carimbo de versao chegou certo
         na tela, o que provou que a implantacao estava boa e que meu aviso
         culpava a coisa errada. Faltava saber ONDE o imposto se perde: a tabela
         nao existe no projeto implantado, ou existe e o valor nao chega.
         Carimbo que so diz o proprio nome nao responde isso. */
      const fontes = getDreFontesV2_();
      const msFontes_ = Date.now() - tC_;
      const mf_ = (r.ms || {});
      const diag = BACKEND_VERSAO_ + ' fontesV2'
        + ' | das=' + (typeof DAS_POR_COMPETENCIA_ === 'undefined' ? 'UNDEF'
                       : Object.keys(DAS_POR_COMPETENCIA_).length)
        + ' imp=' + (fontes.imposto || []).length
        + ' prov=' + (fontes.provisao || []).length
        + ' rec=' + (fontes.receita || []).length;
      /* `despesas` chamava getDespesasFixasList_() DE NOVO aqui, depois de ela
         ja ter rodado acima - duas leituras da mesma aba por requisicao, o
         tempo todo. Apareceu so porque eu precisei da variavel pra cronometrar:
         medir achou o desperdicio antes de medir qualquer coisa. */
      /* SALDOS no mesmo pacote, pelo motivo de sempre: cada chamada ao Web
         App custa ~2s de pedagio fixo. Le um CSV pequeno da pasta da
         planilha; se nao existir, devolve [] e o motivo em saldosErro, pra
         tela dizer "indisponivel" e NUNCA mostrar zero. Zero e um numero, e
         numero errado sobre dinheiro em conta e pior que a ausencia dele. */
      const sal_ = getSaldosConferidos_();
      return jsonResponse_({ email: email, rows: r, despesas: despesasFixas_,
                             dreFontes: fontes,
                             saldos: sal_.saldos, saldosErro: sal_.saldosErro,
                             fantasmas: getFantasmasInfo_(),
                             backend: diag + ' | janela=' + r.desde
                                      + ' ' + (r.rows || []).length + '/' + r.total
                                      + ' (li ' + (r.lidas || 0) + ', '
                                      + (r.cols || 0) + ' cols)'
                                      + ' | ms: fluxo=' + msFluxo_
                                      + ' (f1=' + (mf_.f1 || 0)
                                      + ' f2=' + (mf_.f2 || 0)
                                      + ' proj=' + (mf_.proj || 0) + ')'
                                      + ' despesas=' + msDespesas_
                                      + ' fontes=' + msFontes_,
                             janelaDesde: r.desde, linhasNaAba: r.total });
    }
    case 'dre': return jsonResponse_({ email: email, rows: getDreRows_(e && e.parameter && e.parameter.regime) });
    case 'dreFontes': return jsonResponse_(Object.assign({ email: email }, getDreFontesV2_()));
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
  /* MENU EM TRES NIVEIS, reorganizado em 15/10/2026 a pedido dela: "ja tem
   * varias que nao usamos mais... organizar essa lista e deixar em cima as
   * que ainda nao rodamos".
   *
   * Eram 58 itens numa lista plana, misturando o que ela precisa clicar HOJE
   * com diagnostico de uma vez so de tres semanas atras. Num menu assim o
   * custo nao e o tamanho - e ela ter que LER 58 linhas pra achar uma.
   *
   * NADA FOI APAGADO. O que ja rodou foi pro submenu "Ja rodados", porque
   * funcao de medicao antiga e o que permite refazer a conta quando alguem
   * duvida do numero - e esta semana inteira foi feita disso. O que sai do
   * topo e a ATENCAO dela, nao a ferramenta.
   *
   * COMO MANTER: quando um item do topo for concluido, mover pra "Ja
   * rodados". Quando surgir pendencia nova, ela entra no topo numerada. O
   * topo e a lista de trabalho, nao um indice. */
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('Painel Financeiro')

    /* ---- O QUE FALTA FAZER. Numerado na ordem que faz sentido rodar. ---- */
    .addItem('1. Cofre 2025: congelar dezembro', 'congelarVendas2025Dez')
    .addItem('2. CMV de dezembro/2025 (repetir ate fechar)', 'gerarCmvDez25')
    .addItem('3. CMV de novembro/2025 (repetir ate fechar)', 'gerarCmvNov25')
    .addItem('4. Zumbis: marcar pela LISTA DE IDS do Caixa', 'marcarZumbisPorIds')
    .addItem('5. Quais pecas estao sem ficha (agosto)', 'semFichaAgosto')
    .addItem('6. Series clonadas (provisao) - so le', 'seriesClonadas24m')
    .addItem('7. Saldos: onde o Caixa deve gravar o CSV', 'ondeGravarSaldos')
    .addSeparator()

    /* ---- O que se usa toda semana ---- */
    .addSubMenu(ui.createMenu('Rotina')
      .addItem('Sincronizar Bling agora', 'syncBling')
      .addItem('Receita: REFRESCAR o mes corrente', 'gravarReceitaMesCorrente')
      .addItem('Buscar categoria das contas novas (repetir ate restar 0)',
               '_rodarReprocessarSemCategoria')
      .addItem('Manutencao da DRE (mapa + pendencias + recalculo)', 'manutencaoDre')
      .addItem('O que ainda esta (sem mapear)', 'semMapearAno'))

    .addSubMenu(ui.createMenu('Imposto')
      .addItem('A aliquota ainda vale? (dia 20)', 'conferirImposto')
      .addItem('Guia lida x estimativa', 'verImpostoEstimado'))

    .addSubMenu(ui.createMenu('Receita e CMV')
      .addItem('Receita: conferir calculo x o que esta na aba', '_rodarConferirReceita')
      .addItem('Conferir CMV por mes (_CMV_Consumo)', 'conferirCmvPorMes')
      .addItem('CMV: CONFERIR agosto (calcula, nao grava)', 'conferirCmvAgosto')
      .addItem('CMV: CONFERIR julho (calcula, nao grava)', 'conferirCmvJulho')
      .addItem('Cofre 2025: o que ja esta congelado', 'verCofre2025'))

    .addSubMenu(ui.createMenu('Zumbis e limpeza')
      .addItem('Varrer TODOS os meses (repetir ate fechar)', 'procurarZumbisTodos')
      .addItem('Quais meses ja fecharam', 'verProgressoZumbis')
      .addItem('RODAR SOZINHO de 10 em 10 min', 'instalarGatilhoZumbis')
      .addItem('PARAR o automatico', 'pararGatilhoZumbis')
      .addItem('Limpar devolucoes apagadas no Bling (ago-set)',
               '_rodarLimparDeducoesFantasma'))

    .addSubMenu(ui.createMenu('Investigar um mes')
      .addItem('Comparar um GRUPO mes a mes: Pessoal (abr-jul)', 'pessoalAbrJul')
      .addItem('Comparar um GRUPO mes a mes: Administrativas (jan-jul)',
               'administrativasJanJul')
      .addItem('Despesas variaveis mes a mes', 'variaveisResumo')
      .addItem('Despesas variaveis - abrir agosto/2026', 'variaveisAgosto')
      .addItem('Fretes e seguros 2026 (quem recebeu)', 'fretes2026')
      .addItem('Receita e devolucao por mes', 'receitaEDevolucaoPorMes')
      .addItem('Taxa: ler o acerto de julho por inteiro', 'verAcertoJulho'))

    .addSubMenu(ui.createMenu('Custo e ficha')
      .addItem('Quais SKUs estao sem ficha tecnica', 'skusSemFicha')
      .addItem('Rendimento: o que ja esta medido (metros por peca)', 'verRendimento')
      .addItem('Producao: quem decide o tecido de cada peca', 'verProducao')
      .addItem('Ver taxas por canal (_Precificacao_Config)', 'verTaxasCanais'))

    .addSubMenu(ui.createMenu('Instalar gatilhos')
      .addItem('Sincronizacao automatica do Bling (2h)', 'criarGatilhoSync')
      .addItem('Aviso do imposto, todo dia 20', 'instalarGatilhoImposto')
      .addItem('Varredura de zumbis, de 10 em 10 min', 'instalarGatilhoZumbis'))

    /* ---- Ja rodaram. Ficam pra refazer a medicao se alguem duvidar. ---- */
    .addSubMenu(ui.createMenu('Ja rodados (historico)')
      .addItem('2025: gravar receita de nov e dez', 'gravarReceita2025')
      .addItem('Cofre 2025: congelar novembro', 'congelarVendas2025Nov')
      .addItem('Sondar 2025 (nov e dez)', 'sondar2025')
      .addItem('Receita: REFAZER setembro/2026', 'refazerReceitaSetembro')
      .addItem('CMV: GERAR setembro/2026', 'gerarCmvSetembro')
      .addItem('Zumbis: julho/2026', 'procurarZumbisJulho')
      .addItem('Zumbis: REMOVER o acerto de julho', 'removerAcertoJulho')
      .addItem('Abrir abril/2026 por categoria', 'detalharAbril')
      .addItem('Abrir janeiro/2026 por categoria', 'detalharJaneiro')
      .addItem('Abrir agosto/2026 por categoria', 'detalharAgosto')
      .addItem('Servicos de terceiros jan-abr', 'terceirosJanAbr')
      .addItem('Servicos de terceiros jan-AGO', 'terceirosJanAgo')
      .addItem('FACCAO: trazer a troca feita no Bling', '_rodarResincronizarFaccao')
      .addItem('FACCAO: como estava e como ficou', 'antesDepoisFaccao')
      .addItem('(lento) Conferir TODAS as contas jan-ago', '_rodarRecategorizarJanAgo')
      .addItem('Tecidos do site: gravar preco por metro', 'gravarTecidosDoSite')
      .addItem('Saquinho: ver as duas pontas do custo', 'verSaquinho')
      .addItem('Saquinho: CORRIGIR as duas', 'corrigirSaquinho')
      .addItem('Medir: formatDate x getter nativo', 'conferirFormatDate'))

    .addSubMenu(ui.createMenu('Setup (uma vez so)')
      .addItem('1) Configurar setup da planilha', 'setupWorkbook')
      .addItem('2) Importar produtos do NuvemShop', 'importarProdutosNuvemShop_'))

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

/**
 * Quantos meses de Fluxo de Caixa o painel baixa, contados para tras a partir
 * do mes corrente, inclusive.
 *
 * POR QUE EXISTE ESTE LIMITE: getFluxoCaixaRows_ devolvia a ABA INTEIRA, sem
 * recorte de data nem de coluna, e essa aba nao para de crescer - o espelho da
 * Shopee sozinho lancou 8.376 linhas, mais o Mercado Pago, mais as parcelas
 * provisionadas ate 2030. Em 14/09/2026 a Karolyne reclamou que o painel
 * demorava para carregar, e era isso: megabytes de JSON montados no Apps
 * Script, transferidos e reinterpretados no navegador a cada login, para
 * desenhar uma tela que mostra um mes.
 *
 * TREZE meses e nao doze: com treze, comparar o mes com o mesmo mes do ano
 * anterior ainda funciona. Com doze, o mes mais antigo cai fora justamente
 * quando se quer compara-lo.
 *
 * O CORTE E VISIVEL, nao silencioso: a resposta leva `desde` e o painel avisa
 * em vermelho quando o periodo escolhido comeca antes disso. Dado que falta sem
 * avisar e o pior defeito que este projeto teve - foi assim que o imposto
 * sumiu da DRE por um dia inteiro sem a tela dizer nada.
 *
 * NAO AFETA a aba _DRE nem o balanco: recalcularDre_ le a planilha direto, do
 * lado do servidor, e continua com o historico completo.
 */
const JANELA_PAINEL_MESES = 13;

/** Primeiro dia do mes a partir do qual o painel le lancamento ('yyyy-MM-dd'). */
function janelaPainelDesde_() {
  const hoje = new Date();
  const d = new Date(hoje.getFullYear(), hoje.getMonth() - (JANELA_PAINEL_MESES - 1), 1);
  return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd');
}

/**
 * O Fluxo de Caixa recortado pela janela. Filtra pela DATA (coluna 1) OU pela
 * COMPETENCIA (coluna 15): a DRE por competencia le a segunda, e uma conta paga
 * fora da janela pode ter competencia dentro dela - cortar so pela data sumiria
 * com ela da DRE.
 */
const COLS_FLUXO_ = 15;   // data..competencia; o painel nao usa nada alem disso

/**
 * O Fluxo de Caixa recortado pela janela, LIDO EM DUAS FASES.
 *
 * POR QUE DUAS FASES, e nao um getDataRange().getValues():
 *
 * Ler a aba inteira dessa planilha leva ~2,5 MINUTOS - medido em 07/09/2026,
 * quando esse mesmo custo dentro do getChavesExistentes_ comia o teto de tempo
 * do syncBling e travava o sync de abril. Em 14/09/2026 o efeito reapareceu do
 * lado do painel, e pior: o login levava 3 minutos, e enquanto essa execucao
 * ocupava o slot, clicar em Precificacao batia no limite de execucoes
 * simultaneas do Google e a tela dizia "nao consegui falar com a planilha".
 * Um problema so, com tres sintomas que pareciam tres bugs.
 *
 * Dois desperdicios foram cortados:
 *
 *   1. getDataRange() devolve TODA coluna que tenha qualquer coisa - inclusive
 *      resto de formatacao a direita da coluna 15. O painel usa 15 colunas, e
 *      agora le exatamente 15.
 *
 *   2. Ler as 15 colunas de 19 mil linhas para jogar fora a maioria e absurdo.
 *      A fase 1 le SO as duas colunas de data (1 cel/linha cada) e descobre em
 *      que faixa de linhas a janela mora; a fase 2 le as 15 colunas apenas
 *      dessa faixa. Como a aba e append-only, os lancamentos recentes ficam no
 *      fim - na pratica a fase 2 le uma fracao da aba.
 *
 * PIOR CASO E EMPATE, nao regressao: se houver linha da janela na linha 2 e
 * outra na ultima, a faixa e a aba inteira e o custo volta ao de antes. Nunca
 * fica mais lento, porque a fase 1 custa 2 colunas.
 *
 * NAO USEI "ler as ultimas N linhas": a aba nao esta ordenada por data. As
 * parcelas provisionadas ate 2030 foram gravadas quando o contrato foi lancado,
 * entao data futura convive com linha antiga. Cortar pelo fim da aba pareceria
 * funcionar e perderia lancamento sem avisar.
 */
/**
 * @param {string=} pedidoDe  'yyyy-MM-dd' inicio do periodo pedido pela tela
 * @param {string=} pedidoAte 'yyyy-MM-dd' fim
 *
 * PERIODO PEDIDO PELA TELA, e nao a janela inteira.
 *
 * Medido em 15/09/2026: a resposta inteira sao 19.405 linhas e ~4,1 MB, contra
 * 252 KB de todo o codigo do painel - o dado e 16x o programa. O servidor
 * levava 19s e o login da Karolyne levava 3 MINUTOS, ou seja, quase tudo era
 * trafegar e reinterpretar JSON no navegador.
 *
 * A comparacao que fechou o diagnostico foi com o painel de financas da
 * familia, que abre rapido porque o Apps Script SOMA e manda ~18 objetos
 * prontos. O da Leve Sonho manda linha crua porque precisa: a aba Fluxo de
 * Caixa tem busca e filtro por lancamento. A troca escolhida foi baixar menos
 * linha, nao parar de mandar linha.
 *
 * DUAS COISAS ENTRAM SEMPRE, INDEPENDENTE DO PERIODO, e esquecer qualquer uma
 * delas quebraria tela sem dar erro:
 *
 *   1. CONTA EM ABERTO (situacao 1) de QUALQUER data. A aba "Hoje" lista
 *      atrasadas ("r.aberta && r.date < hoje", sem limite para tras), vencendo
 *      hoje e proximos 7 dias, e a projecao de caixa vai a 30 dias - nada disso
 *      obedece ao filtro. Recortar pelo periodo faria a conta atrasada de
 *      janeiro desaparecer da tela que existe justamente para cobra-la.
 *
 *   2. O PERIODO ANTERIOR comparavel, que a TELA pede somando-o ao intervalo:
 *      os KPIs mostram "x% vs. periodo anterior" e leem FLUXO_ROWS para isso.
 *      Sem ele a comparacao viraria "sem periodo anterior comparavel" calada.
 *
 * O PISO DE 13 MESES CONTINUA valendo como teto de quanto se pode pedir: pedir
 * 2024 nao traz 2024, e a tela avisa em vermelho (avisoJanela_) em vez de
 * mostrar zero.
 */
function getFluxoCaixaRows_(pedidoDe, pedidoAte) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  const ultima = sheet ? sheet.getLastRow() : 0;
  if (!sheet || ultima < 2) return { headers: [], rows: [], desde: null, total: 0 };

  const headers = sheet.getRange(1, 1, 1, COLS_FLUXO_).getValues()[0];
  const data8 = function (v) {
    const t = String(v || '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '';
  };
  const piso = janelaPainelDesde_();
  const pedido = data8(pedidoDe);
  /* max(pedido, piso): a tela nao pode pedir mais fundo que a janela. */
  const desde = (pedido && pedido > piso) ? pedido : piso;
  const ate = data8(pedidoAte) || '9999-12-31';
  const n = ultima - 1;

  /* A coluna da competencia vem do CABECALHO, nao fixa no indice 14. O resto do
     projeto usa l[14] direto, e aqui isso seria perigoso de um jeito novo: este
     filtro decide o que o painel inteiro ve, e um indice errado descartaria
     linha sem dizer nada - o mesmo tipo de falha silenciosa que fez o imposto
     sumir da DRE. Se a coluna nao existir, cai no 14 conhecido. */
  const iComp = headers.indexOf('competencia') >= 0 ? headers.indexOf('competencia') : 14;

  /* O GARGALO DO LOGIN MORAVA AQUI (trocado em 07/10/2026).
   *
   * Era `Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd')`. Cada
   * chamada dessas e uma ida ao SERVICO do Apps Script, nao uma conta local.
   * A fase 1 faz duas passadas (data e competencia) sobre a aba inteira, ou
   * seja ~44 mil chamadas por login.
   *
   * MEDIDO na planilha de verdade, 22.274 linhas (conferirFormatDate, no
   * Diagnostico.gs):
   *      Utilities.formatDate ..: 12.782 ms   (0,574 ms/linha)
   *      getter nativo .........:      2 ms
   *      divergencias ..........:      0
   *
   * Zero divergencia em 22 mil linhas - o fuso do script (America/Sao_Paulo,
   * no appsscript.json) vale para o Date no V8, entao os getters locais dao o
   * mesmo texto. Duas passadas = ~25,6 s de login devolvidos.
   *
   * A hipotese foi da sessao Jobs, e o argumento que a sustentou antes de
   * qualquer medicao foi bom: a fase 1 le 3 colunas em 15-22 s e a fase 2 le
   * as mesmas linhas com 15 colunas em 3 s. Ler MENOS nao pode demorar mais -
   * logo o peso nao estava na leitura de celula.
   *
   * SE UM DIA O FUSO DO SCRIPT MUDAR, isto passa a datar errado em silencio
   * (toda data depois das 21h viraria o dia seguinte, e na virada de mes a
   * linha muda de mes). Rode o conferirFormatDate de novo antes de mexer no
   * appsscript.json. */
  const p2_ = function (x) { return x < 10 ? '0' + x : String(x); };
  const texto = function (v) {
    if (v instanceof Date) return v.getFullYear() + '-' + p2_(v.getMonth() + 1) + '-' + p2_(v.getDate());
    return String(v || '').trim().slice(0, 10);
  };

  /* CRONOMETRO POR FASE (04/10/2026). A sessao Jobs mediu o fluxoCaixa em
     32 s duas vezes seguidas, com a rota leve em 3-4 s - ou seja, ~28 s sao
     trabalho aqui dentro, e nao o Apps Script acordando. Antes de otimizar
     qualquer coisa, saber ONDE: a fase 1 le 3 colunas inteiras da aba, a
     fase 2 le a faixa primeira..ultima com 15 colunas, e a projecao percorre
     o bloco em JavaScript. Os tres sao candidatos e so a medicao separa. */
  const T_ = { f1: 0, f2: 0, proj: 0 };
  let tm_ = Date.now();

  /* UMA LEITURA SO, em vez de quatro (07/10/2026).
   *
   * Antes eram duas fases: a fase 1 lia TRES colunas inteiras em chamadas
   * separadas (data, competencia, situacao) so pra descobrir a faixa de linhas
   * que interessa, e a fase 2 lia as 15 colunas dessa faixa. Depois da troca
   * do formatDate, a sessao Jobs mediu o que sobrou e isolou o problema: o f1
   * ficou em 5 a 7 s e o `proj` caiu pra 12 ms - ou seja, o que restava no f1
   * nao era conta, era a ida a aba. Tres getValues de coluna inteira custam
   * tres vezes o pedagio de alcancar 22 mil linhas.
   *
   * A observacao que fecha o caso e dela: o bloco da fase 2 JA CONTEM as tres
   * colunas da fase 1. E, como conta em aberto entra sempre e as provisoes vao
   * ate 2027, a faixa `primeira..ultima` ja e quase a aba inteira (21.908 de
   * 22.274 na ultima medicao) - entao ler tudo de uma vez custa praticamente o
   * mesmo que a fase 2 sozinha, e as leituras da fase 1 somem.
   *
   * Medido antes: f1 5-7 s + f2 ~3 s. Esperado depois: ~3-4 s no total.
   *
   * SE UM DIA A FAIXA ENCOLHER - se alguem resolver o problema das linhas em
   * aberto espalhadas - esta troca passa a ser ruim: ler a aba inteira pra
   * devolver 1.300 linhas seria desperdicio. O ganho de hoje existe PORQUE a
   * faixa e quase tudo. Vale reconferir se o `li` do carimbo cair muito. */
  const iSit = headers.indexOf('situacao') >= 0 ? headers.indexOf('situacao') : 2;
  const bloco = sheet.getRange(2, 1, n, COLS_FLUXO_).getValues();
  T_.f1 = Date.now() - tm_;

  tm_ = Date.now();
  let primeira = -1, ultimaLinha = -1;
  const dentro = new Array(n);
  for (let i = 0; i < n; i++) {
    const linha = bloco[i];
    const d = texto(linha[0]);
    const c = texto(linha[iComp]);
    const noPeriodo = (d && d >= desde && d <= ate) || (c && c >= desde && c <= ate);
    /* Em aberto entra sempre - ver o cabecalho desta funcao, item 1. */
    const emAberto = String(linha[iSit] || '').trim() === '1';
    dentro[i] = noPeriodo || emAberto;
    if (dentro[i]) { if (primeira < 0) primeira = i; ultimaLinha = i; }
  }
  T_.f2 = Date.now() - tm_;
  if (primeira < 0) return { headers: headers, rows: [], desde: desde, total: n, ms: T_ };

  tm_ = Date.now();

  /* SO AS COLUNAS QUE A TELA USA, e o motivo veio de uma medicao.
   *
   * Em 14/09/2026 o testarRotas mostrou fluxoCaixa em 19 SEGUNDOS no servidor
   * devolvendo 19.405 linhas, enquanto o login da Karolyne levava 3 MINUTOS.
   * Ou seja: o servidor nao era o gargalo - os outros ~2,5 min estavam em
   * trafegar e reinterpretar o JSON no navegador. A janela de 13 meses nao
   * ajudou porque nao havia o que cortar: os espelhos da Shopee e do Mercado
   * Pago sao todos de 2026, e as parcelas provisionadas ate 2030 tem data
   * FUTURA, entao tambem passam por um filtro de "desde".
   *
   * Se o corte nao pode ser em LINHA, tem de ser em COLUNA e em BYTE:
   *
   *   1. O parseFluxoRows_ do painel usa 10 colunas com nome. categoriaId,
   *      portadorId, origemId, origemTipo e numeroDocumento NUNCA sao lidos -
   *      e tres deles sao ids de 11 digitos, ou seja, caros por linha.
   *   2. Data serializada por JSON.stringify vira ISO completo de 24 caracteres
   *      ("2026-08-14T03:00:00.000Z"). O painel usa os 10 primeiros. Mandar
   *      'yyyy-MM-dd' economiza 14 caracteres por data, em duas colunas, em
   *      19 mil linhas.
   *
   * O painel continua resolvendo coluna por NOME (headers.indexOf), entao esta
   * projecao nao exige nenhuma mudanca do lado dele - e coluna que eu remover
   * por engano daria -1 no indexOf, que o parse ja trata, em vez de quebrar.
   */
  const USADAS_ = ['data', 'tipo', 'situacao', 'grupoDRE', 'categoriaNome',
                   'contatoNome', 'contaBancariaNome', 'valor', 'competencia',
                   'descricao'];
  const proj = [];
  const hOut = [];
  USADAS_.forEach(function (nome) {
    const j = headers.indexOf(nome);
    if (j >= 0) { proj.push(j); hOut.push(nome); }
  });
  /* Mesmo motivo do `texto` acima: este roda uma vez por linha DEVOLVIDA (as
     1.261 do periodo, nao as 22 mil), entao pesava bem menos - mas e a mesma
     chamada de servico e o nativo da o mesmo texto, provado em 22.274 linhas
     com zero divergencia. Trocar os dois junto evita a pergunta "por que um
     sim e o outro nao" daqui a seis meses. */
  const ymd = function (v) {
    if (v instanceof Date) return v.getFullYear() + '-' + p2_(v.getMonth() + 1) + '-' + p2_(v.getDate());
    return v;
  };
  const iDataOut = hOut.indexOf('data'), iCompOut = hOut.indexOf('competencia');

  const rows = [];
  /* `bloco` agora comeca na LINHA 2 da aba, nao na `primeira` - entao o indice
     dele e o mesmo do `dentro`, sem deslocamento. O `primeira + i` de antes
     existia porque a leitura comecava na faixa; mantido por engano aqui, ele
     pularia linhas e devolveria menos dados sem erro nenhum. Percorre so a
     faixa util, que e o que o `primeira`/`ultimaLinha` servem agora. */
  for (let i = primeira; i <= ultimaLinha; i++) {
    if (!dentro[i]) continue;
    const orig = bloco[i];
    const linha = new Array(proj.length);
    for (let k = 0; k < proj.length; k++) linha[k] = orig[proj[k]];
    if (iDataOut >= 0) linha[iDataOut] = ymd(linha[iDataOut]);
    if (iCompOut >= 0) linha[iCompOut] = ymd(linha[iCompOut]);
    rows.push(linha);
  }
  T_.proj = Date.now() - tm_;
  return { headers: hOut, rows: rows, desde: desde, ate: ate, total: n,
           lidas: (ultimaLinha - primeira + 1), cols: hOut.length, ms: T_ };
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
/* NOME NOVO, e o motivo e um bug de 14/09/2026 que custou meia hora.
 *
 * No Apps Script todos os .gs dividem o mesmo escopo global, e a ULTIMA
 * declaracao de uma funcao vence. O projeto ao vivo tinha uma copia antiga de
 * `getDreFontes_` num arquivo que nao foi substituido, e essa copia - sem a
 * linha de imposto - era a que rodava. O sintoma era impossivel de ler: o
 * carimbo do doGet media `das=11` (a tabela de guias estava la) e ao mesmo
 * tempo `imp=0` (nenhuma linha de imposto saiu). Codigo certo no editor,
 * comportamento de codigo velho na resposta, e a Karolyne republicando varias
 * vezes sem que nada mudasse.
 *
 * Renomear resolve de raiz: copia velha do nome ANTIGO nao consegue sombrear
 * um nome que existe uma vez so. A copia velha fica orfa e inofensiva - vale
 * apagar quando aparecer, mas o painel nao depende mais disso.
 *
 * LICAO GERAL: quando o codigo do editor esta certo e o comportamento e de
 * codigo velho, suspeitar de nome duplicado ANTES de suspeitar de implantacao.
 */
function getDreFontesV2_() {
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
  /* IMPOSTO E PROVISAO VEM JUNTO, e o motivo e um bug que custou caro em
     14/09/2026: a tela da DRE nao le a aba _DRE - ela REMONTA a DRE a partir
     do Fluxo de Caixa, e so recebe de fora o que vier por aqui.

     Quando a categoria "Impostos sobre vendas" saiu das Deducoes para
     "Imposto pago (ignorar na DRE)", o imposto desapareceu da tela: a linha
     substituta existia na aba _DRE, que a tela nao le. O resultado do ano
     apareceu em -R$ 104,82 em vez de -R$ 24.933 - erro de vinte e cinco mil
     reais numa tela que parecia certa.

     Regra que fica: TUDO que recalcularDre_ inventa e nao e lancamento tem de
     passar por getDreFontes_, senao existe na planilha e nao na tela. */
  const impostoPorMes = [];
  if (typeof DAS_POR_COMPETENCIA_ !== 'undefined') {
    Object.keys(DAS_POR_COMPETENCIA_).forEach(function (mes) {
      const v = Number(DAS_POR_COMPETENCIA_[mes]) || 0;
      if (v) impostoPorMes.push({ mes: mes, canal: 'DAS', valor: v });
    });
  }

  /* A provisao e calculada aqui e nao lida de aba: ela e derivada da receita
     dos canais que nao emitem nota (CANAIS_SEM_NOTA_) pela aliquota medida nas
     guias. Recalcular e mais seguro que guardar - se a receita mudar, a
     provisao acompanha sozinha. */
  const provisaoPorMes = [];
  if (typeof CANAIS_SEM_NOTA_ !== 'undefined' && typeof ALIQUOTA_SIMPLES_ !== 'undefined') {
    const acc = {};
    ler(ABA_RECEITA_PEDIDOS_, 4).forEach(function (r) {
      /* Casa por conteudo, nao por chave exata - ver canalSemNota_ no
         BlingSync.gs. "Site (Nuvemshop)" e "Nuvemshop" sao o mesmo canal. */
      if (!canalSemNota_(r.canal)) return;
      acc[r.mes] = (acc[r.mes] || 0) + Math.abs(r.valor) * ALIQUOTA_SIMPLES_;
    });
    Object.keys(acc).forEach(function (mes) {
      provisaoPorMes.push({ mes: mes, canal: 'provisao', valor: acc[mes] });
    });
  }

  /* O CMV vai com a QUEBRA quando a aba tiver: tecido, corte, costura e
     aviamentos (colunas 7 a 10). Sao opcionais - vazias, a gaveta mostra pecas
     e custo medio e diz de onde viria a quebra. Le por NOME de coluna porque
     elas nasceram depois das cinco primeiras e podem nao existir. */
  const lerCmv = function () {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_CMV_CONSUMO_);
    if (!sh || sh.getLastRow() < 2) return [];
    const nCols = Math.max(sh.getLastColumn(), 5);
    const tudo = sh.getRange(1, 1, sh.getLastRow(), nCols).getValues();
    const h = tudo[0].map(function (x) { return String(x).trim(); });
    const j = function (nome) { return h.indexOf(nome); };
    const iT = j('tecido'), iC = j('corte'), iS = j('costura'), iA = j('aviamentos');
    const out = [];
    for (let i = 1; i < tudo.length; i++) {
      const l = tudo[i];
      const mes = mesTexto_(l[0]);
      const valor = Number(l[2]) || 0;
      if (!mes || !valor) continue;
      const r = { mes: mes, canal: String(l[1] || ''), valor: valor,
                  qtd: Number(l[3]) || 0, alerta: Number(l[4]) || 0 };
      if (iT >= 0) r.tecido = Number(l[iT]) || 0;
      if (iC >= 0) r.corte = Number(l[iC]) || 0;
      if (iS >= 0) r.costura = Number(l[iS]) || 0;
      if (iA >= 0) r.aviamentos = Number(l[iA]) || 0;
      out.push(r);
    }
    return out;
  };

  return {
    receita: ler(ABA_RECEITA_PEDIDOS_, 4),
    cmv: lerCmv(),
    imposto: impostoPorMes,
    provisao: provisaoPorMes
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

  /* LINHA COM REGIME VAZIO E LIXO, NAO E "realizado".
   *
   * Este `|| 'realizado'` custou caro: linha gravada antes de 27/08/2026, quando
   * a coluna regime nasceu, tem a celula vazia, e o default a jogava dentro do
   * realizado. Onde existiam as duas versoes do mesmo mes, a receita DOBRAVA.
   *
   * O efeito nao apareceu na DRE (que le competencia e portanto ignorava as
   * vazias) e sim na FICHA DE PRECO: getDespesasFixasPct_ divide o custo fixo
   * pela receita media, leu receita dobrada, e aplicava 19,4% de custo fixo por
   * peca em vez de ~38,8%. Metade. Toda peca parecia lucrar o dobro do que
   * lucra - erro de precificacao, que e pior que erro de relatorio, porque vira
   * decisao de preco. A Karolyne perguntou "aqui ta 19% pq?" e era isso.
   *
   * Agora vazio so conta se NENHUMA linha tiver regime (planilha de fato
   * antiga). Havendo regime em qualquer linha, vazio e sobra de schema velho e
   * fica fora. */
  const temRegime = rows.some(r => String(r[iReg] || '').trim());
  return {
    headers: headers,
    rows: rows.filter(function (r) {
      const v = String(r[iReg] || '').trim();
      if (!v) return !temRegime;
      return v === alvo;
    })
  };
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
    // grupo novo (13/09/2026): divisão de lucro com o dono da marca dos fechos
    // (50/50). Entra DEPOIS do EBITDA de propósito — só existe porque houve
    // lucro, então não pode entrar no custo fixo nem na MC: o ponto de
    // equilíbrio passaria a exigir volume para cobrir uma conta que só nasce
    // depois de o volume existir.
    const parceiros = g['Participação de Parceiros'] || 0;

    const receitaLiquida = receitaBruta + deducoes;
    const lucroBruto = receitaLiquida + cmv;
    const margemContribuicao = lucroBruto + variaveis;
    const ebitda = margemContribuicao + fixas;
    const resultadoLiquido = ebitda + resultadoFinanceiro + impostosLucro + parceiros;
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
    // frete de ENTRADA: custo de aquisição do estoque, não despesa de venda
    '14745004500': 'Estoque (ignorar na DRE)',         // Frete de compra

    // RECEITA NÃO VEM MAIS DA CONTA A RECEBER. A conta só nasce quando o
    // marketplace libera o dinheiro, e cada espelho grava numa base
    // diferente (Shopee a preço de lista, ML a preço praticado), com a
    // integração do Bling lançando por cima. Em agosto as contas somavam
    // R$ 64.929 para uma venda real de R$ 56.860. Agora vem de
    // _Receita_Pedidos, pela data do pedido e a preço praticado.
    '14639321643': 'Venda já contada pelo pedido (ignorar na DRE)', // Vendas de produtos
    '14639321644': 'Venda já contada pelo pedido (ignorar na DRE)', // Vendas de mercadorias
    '14639321645': 'Venda já contada pelo pedido (ignorar na DRE)', // Vendas de serviços

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

/* CRONOMETRO E DIAGNOSTICO DE CACHE (06/10/2026).
 *
 * A sessao Jobs mediu o app de Precificacao: 9,2 s nesta rota mesmo "quente",
 * contra 3-4 s da precificacaoConfig, que devolve 2 KB. Levantou a hipotese
 * certa: ou o cache nao acerta, ou algo antes do switch pesa.
 *
 * O cache tem teto de 100 KB por CHAVE e esta funcao so grava se o JSON ficar
 * abaixo de 95.000 caracteres - silenciosamente. Se o catalogo cresceu e
 * passou disso, TODA abertura remonta os dez getters e ninguem fica sabendo:
 * o `if` nao reclama, so nao guarda. Cache que nunca acerta se parece com
 * cache lento.
 *
 * `_diag` responde as duas perguntas de uma vez - se veio do cache, e, quando
 * nao veio, quanto cada getter custou e qual o tamanho do JSON contra o teto.
 * Vai no proprio payload porque o Logger nao chega a quem abre o app. */
function precificacaoTudo_(email) {
  const t0 = Date.now();
  const cache = CacheService.getScriptCache();
  const guardado = cache.get(CACHE_PRECIF_);
  if (guardado) {
    try {
      const d = JSON.parse(guardado);
      d.email = email;
      d._diag = 'cache HIT | ' + guardado.length + ' chars | ' + (Date.now() - t0) + 'ms';
      return d;
    } catch (e) { /* cache corrompido: refaz abaixo */ }
  }

  const ms = {};
  const cronometrar = function (nome, fn) {
    const t = Date.now();
    const r = fn();
    ms[nome] = Date.now() - t;
    return r;
  };

  const d = {
    config: cronometrar('config', getPrecificacaoConfig_),
    materiais: cronometrar('materiais', getPrecificacaoMateriaisCatalogo_),
    rendimento: cronometrar('rendimento', getPrecificacaoRendimentoCatalogo_),
    maoDeObraPecas: cronometrar('maoObra', getPrecificacaoMaoDeObraPecasCatalogo_),
    corte: cronometrar('corte', getPrecificacaoCorteCatalogo_),
    producao: cronometrar('producao', getPrecificacaoProducao_),
    aviamentos: cronometrar('aviamentos', getPrecificacaoAviamentosTamanhoCatalogo_),
    acabamentos: cronometrar('acabamentos', getPrecificacaoAcabamentosCatalogo_),
    modelos: cronometrar('modelos', getPrecificacaoModelosCatalogo_),
    ficha: cronometrar('ficha', getPrecificacaoFichaCatalogo_)
  };

  // O cache tem teto de 100 KB por chave; se estourar, segue sem cache.
  let tam = 0, guardou = false;
  try {
    const txt = JSON.stringify(d);
    tam = txt.length;
    if (tam < 95000) { cache.put(CACHE_PRECIF_, txt, 300); guardou = true; }
  } catch (e) { /* sem cache, so mais lento */ }

  d.email = email;
  d._diag = 'cache MISS | ' + tam + '/95000 chars | '
    + (guardou ? 'GUARDOU' : 'NAO GUARDOU (estourou o teto - toda abertura remonta)')
    + ' | total ' + (Date.now() - t0) + 'ms | '
    + Object.keys(ms).map(function (k) { return k + '=' + ms[k]; }).join(' ');
  return d;
}

function limparCachePrecificacao_() {
  CacheService.getScriptCache().remove(CACHE_PRECIF_);
}

function _rodarLimparCachePrecificacao() {
  limparCachePrecificacao_();
  Logger.log('Cache da precificação limpo. A próxima abertura lê a planilha de novo.');
}

/* ============================================================================
 * SALDOS CONFERIDOS - lidos de um CSV que o Caixa grava.
 *
 * POR QUE EXISTE. A API do Bling nao expoe Caixas e Bancos, entao o painel
 * nunca mostrou saldo de conta - a aba Hoje diz isso de proposito. A Karol
 * pediu o saldo em 15/10. O caminho combinado: o Caixa grava o que ele JA
 * confere em cada fecho, o painel so le e mostra com a data ao lado.
 *
 * A PASTA SE ACHA SOZINHA. Nao tem id de pasta no codigo nem caminho
 * digitado: o CSV mora na MESMA pasta da planilha, e o script descobre qual e
 * pelo proprio arquivo. Caminho hardcoded quebra quando alguem move a pasta,
 * e quebra em silencio - o leitor devolve "nao encontrei" e parece que o
 * Caixa nao gravou. Pra ninguem precisar adivinhar, o ondeGravarSaldos()
 * imprime o nome, o id e o link da pasta.
 *
 * SALDO VELHO NAO PODE PARECER SALDO NOVO. Por isso `conferidoAte` vem por
 * CONTA e nao um carimbo geral: Sicoob conferido hoje e Nubank de tres dias
 * atras nao podem ser somados sem distincao - e vao querer somar, porque
 * somar e o natural.
 *
 * E ARQUIVO AUSENTE NAO VIRA ZERO. Devolve lista vazia mais `saldosErro` com
 * o motivo, pra tela dizer "indisponivel". Zero e um numero, e um numero
 * errado sobre dinheiro em conta e pior que a ausencia dele.
 * ========================================================================== */
const ARQ_SALDOS_ = 'saldos_conferidos.csv';

/* ============================================================================
 * O ULTIMO ZERAMENTO DAS CONTAS FANTASMA - um fato, nao duas datas.
 *
 * Tem geracao automatica de conta a receber rodando no Bling (causa
 * desconhecida, ~19,3/dia, medida de zero a zero entre 07 e 14/10). Elas
 * nascem com vencimento em +30 dias, entao as janelas do painel so comecam a
 * ficar sujas 30 dias depois do ultimo zeramento - e o aviso tem que ligar
 * nessa data, nem antes nem depois.
 *
 * POR QUE A DATA MORA AQUI E NAO LA. O Jobs tinha duas constantes na tela,
 * SUJA_7D_DESDE_ e SUJA_15D_DESDE_, que estavam certas. Mas as duas sao
 * DERIVADAS de um unico fato: a data do zeramento. Valor derivado guardado a
 * mao em dois lugares diverge no dia em que alguem atualiza um e esquece o
 * outro - e aqui o esquecimento e silencioso, porque as duas datas continuam
 * parecendo plausiveis.
 *
 * Com o fato aqui, quando o Contas zerar de novo muda UMA data num lugar e as
 * duas janelas se corrigem sozinhas. Guardar o fato e deixar a tela derivar e
 * a diferenca entre "lembrar de atualizar duas coisas" e "nao precisar
 * lembrar".
 * ========================================================================== */
var FANTASMAS_ZERADAS_EM_ = '2026-10-14';   // Contas apagou 135 (R$ 9.553,43)
var FANTASMAS_POR_DIA_ = 19.29;             // medido de zero a zero, Shopee+ML
var FANTASMA_TICKET_ = 70.77;
var FANTASMA_PRAZO_DIAS_ = 30;              // vencimento nasce em +30d

/** O que a tela precisa pra decidir sozinha quando avisar. */
function _fantasmas_() {
  var z = new Date(FANTASMAS_ZERADAS_EM_ + 'T12:00:00');
  var primeiroVenc = new Date(z.getTime() + FANTASMA_PRAZO_DIAS_ * 86400000);
  var iso = function (d) { return Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd'); };
  return {
    zeradasEm: FANTASMAS_ZERADAS_EM_,
    primeiroVencimento: iso(primeiroVenc),
    porDia: FANTASMAS_POR_DIA_ * FANTASMA_TICKET_,
    // a janela de N dias comeca a sujar N dias antes do primeiro vencimento
    sujaEm: function (n) { return iso(new Date(primeiroVenc.getTime() - n * 86400000)); }
  };
}

/** Versao serializavel, pro pacote do fluxoCaixa. */
function getFantasmasInfo_() {
  try {
    var f = _fantasmas_();
    return {
      zeradasEm: f.zeradasEm,
      primeiroVencimento: f.primeiroVencimento,
      reaisPorDia: Math.round(f.porDia * 100) / 100,
      suja7d: f.sujaEm(7),
      suja15d: f.sujaEm(15),
      suja30d: f.sujaEm(30)
    };
  } catch (e) {
    return null;        // tela mantem o aviso ligado se nao souber a data
  }
}

/** A pasta da planilha. E onde o CSV tem que estar. */
function _pastaDoPainel_() {
  const arq = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  const pais = arq.getParents();
  return pais.hasNext() ? pais.next() : null;
}

/** Menu: diz exatamente onde gravar, pra ninguem adivinhar caminho. */
function ondeGravarSaldos() {
  const p = _pastaDoPainel_();
  if (!p) {
    mostrarRelatorio_('Saldos', ['Nao consegui achar a pasta da planilha.']);
    return;
  }
  mostrarRelatorio_('Onde gravar os saldos', [
    'O CSV tem que se chamar exatamente:',
    '    ' + ARQ_SALDOS_,
    '',
    'e ficar nesta pasta:',
    '    nome: ' + p.getName(),
    '    id ..: ' + p.getId(),
    '    link: ' + p.getUrl(),
    '',
    'CABECALHO (separador ponto e virgula):',
    '    conta;tipo;saldo;conferido_ate;origem;movimenta_diario;gravado_em',
    '',
    'tipo ............: banco ou carteira',
    'saldo ...........: aceita 1234.56 ou 1.234,56',
    'conferido_ate ...: AAAA-MM-DD, POR CONTA (nao um carimbo geral)',
    'movimenta_diario : S ou N',
    '',
    'O arquivo e reescrito inteiro a cada fecho. Se ele nao existir, o painel',
    'mostra "saldos indisponiveis" - nunca zero.'
  ]);
}

/**
 * Le o CSV. Devolve { saldos: [...], saldosErro: string|null }.
 * Nunca lanca: erro de leitura vira saldosErro, porque isto roda dentro do
 * pacote do login e nao pode derrubar a tela inteira por causa de um CSV.
 */
function getSaldosConferidos_() {
  try {
    const pasta = _pastaDoPainel_();
    if (!pasta) return { saldos: [], saldosErro: 'nao achei a pasta da planilha' };

    const it = pasta.getFilesByName(ARQ_SALDOS_);
    if (!it.hasNext()) {
      return { saldos: [], saldosErro: 'arquivo ' + ARQ_SALDOS_ + ' nao encontrado em "'
               + pasta.getName() + '"' };
    }
    const arq = it.next();
    const txt = arq.getBlob().getDataAsString('UTF-8');
    const linhas = txt.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; });
    if (linhas.length < 2) {
      return { saldos: [], saldosErro: ARQ_SALDOS_ + ' esta vazio ou so tem cabecalho' };
    }

    const cab = linhas[0].split(';').map(function (c) { return c.trim().toLowerCase(); });
    const col = function (nome) { return cab.indexOf(nome); };
    const iConta = col('conta'), iSaldo = col('saldo'), iAte = col('conferido_ate');
    if (iConta < 0 || iSaldo < 0 || iAte < 0) {
      return { saldos: [], saldosErro: 'cabecalho sem conta/saldo/conferido_ate. Veio: ' + cab.join(';') };
    }
    const iTipo = col('tipo'), iOrig = col('origem'),
          iMov = col('movimenta_diario'), iGrav = col('gravado_em');

    /* NUMERO BRASILEIRO E AMERICANO NO MESMO ARQUIVO. "1.234,56" e "1234.56"
       sao os dois plausiveis dependendo de quem exportou, e trocar um pelo
       outro muda o saldo por mil. Decide pela ULTIMA pontuacao: se a virgula
       vier depois do ponto, ela e o decimal. */
    const num = function (t) {
      var s = String(t || '').trim().replace(/[R$\s]/g, '');
      if (!s) return 0;
      var ultVirg = s.lastIndexOf(','), ultPonto = s.lastIndexOf('.');
      if (ultVirg > ultPonto) s = s.replace(/\./g, '').replace(',', '.');
      else s = s.replace(/,/g, '');
      var v = Number(s);
      return isNaN(v) ? 0 : v;
    };

    const saldos = [];
    const ruins = [];
    for (var i = 1; i < linhas.length; i++) {
      const c = linhas[i].split(';');
      const nome = String(c[iConta] || '').trim();
      if (!nome) continue;
      const ate = String(c[iAte] || '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ate)) ruins.push(nome + ' (conferido_ate "' + ate + '")');
      saldos.push({
        conta: nome,
        tipo: iTipo >= 0 ? String(c[iTipo] || '').trim() : '',
        saldo: num(c[iSaldo]),
        conferidoAte: ate,
        origem: iOrig >= 0 ? String(c[iOrig] || '').trim() : '',
        movimentaDiario: iMov >= 0 ? String(c[iMov] || '').trim().toUpperCase() === 'S' : null,
        gravadoEm: iGrav >= 0 ? String(c[iGrav] || '').trim() : ''
      });
    }

    /* Data invalida NAO vira saldo silencioso: sem a data, a tela nao tem como
       avisar que o numero e velho, e saldo velho sem aviso e o erro que este
       campo inteiro existe pra evitar. */
    if (ruins.length) {
      return { saldos: saldos, saldosErro: 'conferido_ate invalido em: ' + ruins.join(', ') };
    }
    return { saldos: saldos, saldosErro: null };
  } catch (e) {
    return { saldos: [], saldosErro: 'erro lendo ' + ARQ_SALDOS_ + ': ' + String(e) };
  }
}
