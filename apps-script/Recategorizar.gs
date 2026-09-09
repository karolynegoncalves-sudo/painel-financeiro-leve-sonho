/**
 * Recategorizar.gs — traz para a planilha uma reclassificacao feita no Bling.
 *
 * POR QUE ISSO PRECISA EXISTIR: a coluna categoriaId da aba Fluxo de Caixa e
 * gravada UMA vez, no sync que trouxe a conta, e nunca mais e conferida.
 * `reaplicarMapaDre_` reescreve nome e grupo, mas partindo desse id congelado;
 * `atualizarContasEmAberto_` confere situacao, vencimento e valor - nao a
 * categoria, e so das contas em situacao 1.
 *
 * Resultado medido em 09/09/2026: as duas parcelas do IPTU foram movidas no
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
  const r = recategorizarContas_({
    '23750120910': 14744250501,   // parcela venc 20/08/2026
    '23969868738': 14744250501    // parcela venc 20/09/2026
  });
  const msg = 'IPTU: ' + r.linhas + ' linha(s) recategorizada(s)'
    + (r.contasSemLinha.length ? ' | SEM LINHA na planilha: ' + r.contasSemLinha.join(', ') : '')
    + ' | achadas: ' + JSON.stringify(r.contasAchadas);
  logSync_('recategorizarIPTU', 'ok', msg);
  Logger.log(msg);
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
