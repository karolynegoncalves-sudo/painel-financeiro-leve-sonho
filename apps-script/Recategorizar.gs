/**
 * Recategorizar.gs — traz para a planilha uma reclassificacao feita no Bling.
 *
 * POR QUE ISSO PRECISA EXISTIR: a coluna categoriaId da aba Fluxo de Caixa e
 * gravada UMA vez, no sync que trouxe a conta, e nunca mais e conferida.
 * `reaplicarMapaDre_` reescreve nome e grupo, mas partindo desse id congelado;
 * `atualizarContasEmAberto_` confere situacao, vencimento e valor - nao a
 * categoria, e so das contas em situacao 1.
 *
 * Resultado medido em 09/09/2026: as 11 parcelas do IPTU foram movidas no
 * Bling de "Imposto de renda" para "IPTU e taxas municipais" (14744250501) e o
 * painel continuou mostrando R$ 74,65 em Impostos sobre o Lucro - linha que num
 * Simples Nacional deveria ser sempre zero, porque IRPJ e CSLL ja estao no DAS.
 *
 * Duas coisas aqui:
 *   recategorizarContas_(mapa)  conserto pontual, por id de conta
 *   recategorizarPeriodo()      reconfere no Bling a categoria de um periodo
 */

/**
 * Troca o categoriaId das linhas de contas especificas e recalcula a DRE.
 * @param {Object} mapa  { '<idDaConta>': <novoIdDeCategoria>, ... }
 * @return {Object} { linhas, contasAchadas, contasSemLinha }
 */
function recategorizarContas_(mapa) {
  // O mapa precisa conhecer a categoria NOVA antes de qualquer coisa: sem isso a
  // linha fica com o id novo e o nome/grupo velhos, que e pior do que nao ter
  // mexido - o painel mostraria "Imposto de renda" apontando para outra coisa.
  // Deixo estourar de proposito se o token falhar.
  sincronizarCategorias_(getBlingAccessToken_());

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sheet) throw new Error('Aba ' + ABA_FLUXO_CAIXA + ' nao existe.');
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return { linhas: 0, contasAchadas: [], contasSemLinha: Object.keys(mapa) };

  const COL_CATEGORIA_ID = 4, COL_ORIGEM_ID = 13;
  const cats = sheet.getRange(2, COL_CATEGORIA_ID, ultimaLinha - 1, 1).getValues();
  const origens = sheet.getRange(2, COL_ORIGEM_ID, ultimaLinha - 1, 1).getValues();

  const achadas = {};
  let mudou = 0;
  for (let i = 0; i < origens.length; i++) {
    const conta = String(origens[i][0]).trim();
    if (!mapa.hasOwnProperty(conta)) continue;
    achadas[conta] = (achadas[conta] || 0) + 1;
    const novo = String(mapa[conta]);
    if (String(cats[i][0]).trim() === novo) continue;
    cats[i][0] = novo;
    mudou++;
  }
  if (mudou) sheet.getRange(2, COL_CATEGORIA_ID, cats.length, 1).setValues(cats);

  // sem isto a linha fica com o id novo e o NOME/GRUPO velhos
  reaplicarMapaDre_(sheet, getMapaCategoria_());
  recalcularDre_();

  const semLinha = Object.keys(mapa).filter(function (k) { return !achadas[k]; });
  return { linhas: mudou, contasAchadas: achadas, contasSemLinha: semLinha };
}

/**
 * O caso concreto de 09/09/2026: IPTU de Santo Andre saindo de Imposto de
 * renda. Fica registrado como funcao propria porque o numero da categoria e
 * dos contas nao se adivinha depois.
 */
function recategorizarIPTU() {
  // As 11 parcelas do IPTU 2026 (fev a dez, dia 20). Comecei achando duas,
  // olhando so ago/set - conferirIPTU mostrou que a recorrencia cobre o ano.
  const r = recategorizarContas_({
    '22373684390': 14744250501,   // 20/02
    '22585956328': 14744250501,   // 20/03
    '22889972676': 14744250501,   // 20/04
    '23046460273': 14744250501,   // 20/05
    '23258238496': 14744250501,   // 20/06  R$ 75,39
    '23531325619': 14744250501,   // 20/07
    '23750120910': 14744250501,   // 20/08
    '23969868738': 14744250501,   // 20/09
    '24250682870': 14744250501,   // 20/10
    '24508098410': 14744250501,   // 20/11
    '24777469219': 14744250501    // 20/12
  });
  const msg = 'IPTU: ' + r.linhas + ' linha(s) recategorizada(s)'
    + (r.contasSemLinha.length ? ' | SEM LINHA na planilha: ' + r.contasSemLinha.join(', ') : '')
    + ' | achadas: ' + JSON.stringify(r.contasAchadas);
  // a propria funcao prova o resultado: sem isso a unica evidencia e "n linhas
  // recategorizadas", que nao diz onde o dinheiro foi parar
  const depois = conferirIPTU();
  logSync_('recategorizarIPTU', 'ok', msg);
  Logger.log(msg + '\n\n' + depois);
  try { SpreadsheetApp.getUi().alert('Recategorizar', msg, SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) {}
  return msg;
}

/**
 * Reconfere no Bling a categoria de TODAS as contas de um periodo e corrige a
 * planilha onde divergir. Use depois de uma faxina de categorias no Bling.
 *
 * Custa uma chamada por conta - por isso e por periodo, e por isso para sozinha
 * antes do limite de 6 minutos, guardando de onde continuar.
 *
 * @param {string} desde  'yyyy-MM-dd'
 * @param {string} ate    'yyyy-MM-dd'
 */
function recategorizarPeriodo(desde, ate) {
  desde = desde || '2026-08-01';
  ate = ate || '2026-09-30';
  INICIO_SYNC_.t = Date.now();
  const token = getBlingAccessToken_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return 'planilha vazia';

  const COL_DATA = 1, COL_CATEGORIA_ID = 4, COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 14).getValues();

  // uma conta pode ocupar varias linhas (rateio por categoria): nesse caso a
  // categoria da linha e a do rateio, nao a da conta - nao da pra sobrescrever.
  const porConta = {};
  dados.forEach(function (linha, i) {
    const d = linha[COL_DATA - 1];
    const txt = d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(d || '').trim().slice(0, 10);
    if (txt < desde || txt > ate) return;
    const chave = linha[COL_ORIGEM_TIPO - 1] + ':' + linha[COL_ORIGEM_ID - 1];
    if (!porConta[chave]) porConta[chave] = [];
    porConta[chave].push(i + 2);
  });

  const chaves = Object.keys(porConta).sort();
  const props = PropertiesService.getScriptProperties();
  let inicio = parseInt(props.getProperty('CURSOR_RECATEGORIZAR') || '0', 10);
  if (!(inicio >= 0) || inicio >= chaves.length) inicio = 0;

  let corrigidas = 0, vistas = 0, pulouRateio = 0, parou = false;
  for (let k = 0; k < chaves.length; k++) {
    const chave = chaves[(inicio + k) % chaves.length];
    if (tempoGasto_() > TETO_TOTAL_MS) {
      props.setProperty('CURSOR_RECATEGORIZAR', String((inicio + k) % chaves.length));
      parou = true;
      break;
    }
    const linhas = porConta[chave];
    if (linhas.length > 1) { pulouRateio++; continue; }
    const partes = chave.split(':');
    if (!partes[0] || !partes[1]) continue;
    vistas++;
    const r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + partes[0] + '/' + partes[1], token);
    Utilities.sleep(300);
    const d = r.json && r.json.data;
    if (!d || !d.categoria || !d.categoria.id) continue;
    const nova = String(d.categoria.id);
    const cel = sheet.getRange(linhas[0], COL_CATEGORIA_ID);
    if (String(cel.getValue()).trim() === nova) continue;
    cel.setValue(nova);
    corrigidas++;
  }
  if (!parou) props.setProperty('CURSOR_RECATEGORIZAR', '0');

  if (corrigidas) {
    reaplicarMapaDre_(sheet, getMapaCategoria_());
    recalcularDre_();
  }
  const msg = desde + '..' + ate + ': ' + vistas + '/' + chaves.length + ' conferidas, '
    + corrigidas + ' categoria(s) corrigida(s), ' + pulouRateio + ' com rateio (pulei)'
    + (parou ? ' - parei por tempo, rode de novo pra continuar' : ' - fila inteira');
  logSync_('recategorizarPeriodo', 'ok', msg);
  Logger.log(msg);
  return msg;
}

/**
 * Conferencia: onde as linhas de uma categoria estao caindo na DRE.
 *
 * Existe porque o painel exige login Google e a planilha nao se deixa consultar
 * por gviz de fora - depois de recategorizar, esta e a forma barata de ver se o
 * dinheiro andou mesmo de linha.
 */
function conferirCategoria_(idCategoria, desde, ate) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  const ultimaLinha = sheet.getLastRow();
  const COL_DATA = 1, COL_CATEGORIA_ID = 4, COL_NOME = 5, COL_GRUPO = 6, COL_VALOR = 12,
        COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 14).getValues();
  const achadas = [];
  let total = 0;
  dados.forEach(function (l) {
    if (String(l[COL_CATEGORIA_ID - 1]).trim() !== String(idCategoria)) return;
    const d = l[COL_DATA - 1];
    const txt = d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(d || '').trim().slice(0, 10);
    if (desde && txt < desde) return;
    if (ate && txt > ate) return;
    total += Number(l[COL_VALOR - 1] || 0);
    // o id da conta vai junto: e por ele que se corrige do lado do Bling, e
    // procurar conta por conta na tela do Bling e o que custa tempo de verdade
    achadas.push(txt + ' R$ ' + Number(l[COL_VALOR - 1] || 0).toFixed(2)
      + ' | ' + l[COL_NOME - 1] + ' | ' + l[COL_GRUPO - 1]
      + ' | ' + l[COL_ORIGEM_TIPO - 1] + ':' + l[COL_ORIGEM_ID - 1]);
  });
  return { total: total, linhas: achadas };
}

/** O caso de 09/09/2026: conferir que o IPTU saiu de Imposto de renda. */
function conferirIPTU() {
  const nova = conferirCategoria_('14744250501', '2026-01-01', '2026-12-31');
  const velha = conferirCategoria_('14639321700', '2026-01-01', '2026-12-31');
  const msg = 'IPTU e taxas municipais: R$ ' + nova.total.toFixed(2) + ' em ' + nova.linhas.length + ' linha(s)\n'
    + nova.linhas.join('\n')
    + '\n\nImposto de renda (deveria ficar ZERO no Simples): R$ ' + velha.total.toFixed(2)
    + ' em ' + velha.linhas.length + ' linha(s)\n' + velha.linhas.join('\n');
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------- manutencao */

/**
 * Grupos do _DRE_Mapa que JA FORAM MOTIVO DE DIVERGENCIA e por isso ficam
 * fixados aqui, com o porque. Quem discordar muda neste arquivo, nao na
 * planilha - senao a proxima rodada desfaz e ninguem entende por que.
 */
var GRUPO_CANONICO_ = {
  // Taxa de canal e DESPESA VARIAVEL DE VENDA, nao deducao da receita.
  // Deducao e o que nunca foi seu: imposto sobre venda, devolucao, desconto
  // incondicional. A comissao do marketplace e preco de acesso ao canal - some
  // abaixo do lucro bruto, junto do frete, e e justamente ela que a Margem de
  // Contribuicao precisa enxergar para responder "quanto sobra por venda".
  // Joga-la em Deducoes zera o efeito na MC mas ESTRAGA a Margem Bruta, que e
  // uma das tres margens do painel.
  // (O idGrupoDre 9 do Bling - "despesa financeira", derivado do pai e nao
  // editavel - nao vale nada aqui: o painel le a coluna grupo do _DRE_Mapa,
  // nunca aquele campo. Nao ha motivo para contorcer a DRE por causa dele.)
  '14639321698': 'Despesas Variaveis de Venda',   // Taxas do marketplace
  '14639321695': 'Despesas Variaveis de Venda',   // Descontos concedidos (comissao Shopee legada)
  '14639321667': 'Despesas Variaveis de Venda',   // Fretes e seguros
  '14744250501': 'Despesas Administrativas'       // IPTU e taxas municipais
};

/** Forca os grupos de GRUPO_CANONICO_ no _DRE_Mapa. Devolve o que mudou. */
function fixarGrupoCanonico_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DRE_MAPA);
  if (!sheet) throw new Error('Aba ' + ABA_DRE_MAPA + ' nao existe.');
  var ult = sheet.getLastRow();
  var ids = sheet.getRange(2, 1, ult - 1, 1).getValues();
  var grupos = sheet.getRange(2, 5, ult - 1, 1).getValues();
  var mudou = 0, log = [], achados = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0]).trim();
    if (!GRUPO_CANONICO_.hasOwnProperty(id)) continue;
    achados[id] = true;
    var atual = String(grupos[i][0] || '').trim();
    var certo = GRUPO_CANONICO_[id];
    // comparacao sem acento/caixa: o mesmo grupo ja apareceu escrito das duas
    // formas e a divergencia so de acento ja escondeu R$ 14.676,67 numa linha
    // de "Fora do resultado"
    if (semAcento_(atual) === semAcento_(certo)) continue;
    grupos[i][0] = certo;
    log.push(id + ': "' + atual + '" -> "' + certo + '"');
    mudou++;
  }
  if (mudou) sheet.getRange(2, 5, grupos.length, 1).setValues(grupos);
  var faltando = [];
  for (var k in GRUPO_CANONICO_) { if (!achados[k]) faltando.push(k); }
  return { mudou: mudou, log: log, faltando: faltando };
}

function semAcento_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

/**
 * Reclassificacoes feitas no Bling que ainda precisam alcancar a planilha.
 * Idempotente: rodar de novo nao faz nada. Depois que o mes fecha, pode sair
 * daqui - fica so como registro do que foi mexido e quando.
 */
var PENDENCIAS_ = {
  // 11 parcelas do IPTU 2026 (fev a dez, dia 20) saindo de "Imposto de renda"
  '22373684390': 14744250501, '22585956328': 14744250501, '22889972676': 14744250501,
  '23046460273': 14744250501, '23258238496': 14744250501, '23531325619': 14744250501,
  '23750120910': 14744250501, '23969868738': 14744250501, '24250682870': 14744250501,
  '24508098410': 14744250501, '24777469219': 14744250501,
  // SABESP (agua, R$ 185,98, venc 10/07/2026) estava em "Compra de insumos e
  // materia prima" e inflava o CMV de julho. Vai para "Agua" (14639321671).
  '26591060145': 14639321671
};

/**
 * ENTRADA UNICA da manutencao da DRE. Faz, nesta ordem:
 *   1. fixa os grupos canonicos do _DRE_Mapa
 *   2. aplica as reclassificacoes pendentes nas linhas do Fluxo de Caixa
 *   3. reaplica o mapa e recalcula a DRE
 *   4. imprime a conferencia
 *
 * E uma funcao so de proposito: o dropdown "selecione a funcao" do editor
 * costuma reverter para a escolha anterior, e trocar de funcao entre passos e
 * onde se perde tempo e se roda a coisa errada sem perceber.
 */
function manutencaoDre() {
  var fix = fixarGrupoCanonico_();
  var r = recategorizarContas_(PENDENCIAS_);
  var msg = '_DRE_Mapa: ' + fix.mudou + ' grupo(s) corrigido(s)'
    + (fix.log.length ? ' [' + fix.log.join(' ; ') + ']' : '')
    + (fix.faltando.length ? ' | NAO ACHADAS no mapa: ' + fix.faltando.join(', ') : '')
    + '\nLinhas: ' + r.linhas + ' recategorizada(s)'
    + (r.contasSemLinha.length ? ' | sem linha na planilha: ' + r.contasSemLinha.join(', ') : '');
  logSync_('manutencaoDre', 'ok', msg);
  Logger.log(msg + '\n\n' + conferirIPTU());
  return msg;
}
