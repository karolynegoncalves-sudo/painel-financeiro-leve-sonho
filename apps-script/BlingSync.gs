/**
 * BlingSync.gs — puxa Contas a Pagar/Receber do Bling (financeiro:
 * caixas e bancos) e alimenta as abas "Fluxo de Caixa" e "DRE".
 *
 * syncBling() é o ponto de entrada. Rode manualmente uma vez pra testar
 * (menu Painel Financeiro > Sincronizar agora, ou direto no editor), e
 * depois instale o gatilho automático com criarGatilhoSync().
 *
 * Nota sobre os nomes de campo (categorias/portador): a lista de contas a
 * pagar/receber NÃO traz isso, só o detalhe (/{id}) traz. Os nomes exatos
 * dos campos aqui (CAMPO_CATEGORIAS, CAMPO_PORTADOR) foram deixados como
 * as variações mais prováveis e com fallback defensivo — ajuste depois de
 * ver o retorno real de financeiro_detalhe_dre_bling.ps1.
 */

const JANELA_SYNC_DESDE = '2025-01-01';

function syncBling() {
  try {
    const token = getBlingAccessToken_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
    const existentes = getChavesExistentes_(sheet);
    const contasBancarias = getContasBancarias_(token);
    const mapaCategoria = getMapaCategoria_();

    let novos = 0;
    novos += sincronizarTipo_('pagar', token, sheet, existentes, contasBancarias, mapaCategoria);
    novos += sincronizarTipo_('receber', token, sheet, existentes, contasBancarias, mapaCategoria);

    const atualizadas = atualizarContasEmAberto_(token, sheet);
    const remapeadas = reaplicarMapaDre_(sheet, mapaCategoria);

    recalcularDre_();
    logSync_('syncBling', 'ok', novos + ' nova(s), ' + atualizadas + ' atualizada(s), ' + remapeadas + ' remapeada(s)');
  } catch (err) {
    logSync_('syncBling', 'erro', String(err));
    throw err;
  }
}

function criarGatilhoSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncBling')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncBling').timeBased().everyHours(2).create();
  Logger.log('Gatilho criado: syncBling a cada 2 horas.');
}

function fetchBling_(url, token) {
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 400) {
    logSync_('fetchBling_', 'erro', url + ' -> ' + resp.getResponseCode() + ' ' + resp.getContentText());
    return null;
  }
  try { return JSON.parse(resp.getContentText()); } catch (e) { return null; }
}

function getContasBancarias_(token) {
  const mapa = {};
  let pagina = 1;
  while (true) {
    const resp = fetchBling_('https://www.bling.com.br/Api/v3/depositos?pagina=' + pagina + '&limite=100', token);
    const lista = (resp && resp.data) || [];
    lista.forEach(c => { mapa[c.id] = c.descricao; });
    if (lista.length < 100) break;
    pagina++;
    if (pagina > 20) break;
  }
  return mapa;
}

function getMapaCategoria_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DRE_MAPA);
  const dados = sheet.getDataRange().getValues();
  const mapa = {};
  for (let i = 1; i < dados.length; i++) {
    const [categoriaId, categoria, , , grupoDRE] = dados[i];
    if (categoriaId) mapa[String(categoriaId)] = { categoria, grupoDRE };
  }
  return mapa;
}

function getChavesExistentes_(sheet) {
  const chaves = new Set();
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return chaves;
  const origemIds = sheet.getRange(2, 13, ultimaLinha - 1, 2).getValues(); // origemId, origemTipo
  origemIds.forEach(([id, tipo]) => { if (id) chaves.add(tipo + ':' + id); });
  return chaves;
}

function sincronizarTipo_(tipo, token, sheet, existentes, contasBancarias, mapaCategoria) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  let pagina = 1;
  let novos = 0;

  while (true) {
    const url = 'https://www.bling.com.br/Api/v3/contas/' + tipo
      + '?pagina=' + pagina + '&limite=100'
      + '&dataEmissaoInicial=' + JANELA_SYNC_DESDE + '&dataEmissaoFinal=' + hoje;
    const resp = fetchBling_(url, token);
    const lista = (resp && resp.data) || [];
    if (lista.length === 0) break;

    lista.forEach(item => {
      const chave = tipo + ':' + item.id;
      if (existentes.has(chave)) return;

      const detalheResp = fetchBling_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + item.id, token);
      const d = (detalheResp && detalheResp.data) || item;

      extrairRateioCategorias_(d).forEach(rateio => {
        const mapCat = mapaCategoria[String(rateio.categoriaId)] || { categoria: rateio.categoriaNome || '(sem categoria)', grupoDRE: '(sem mapear)' };
        const portador = extrairPortador_(d, contasBancarias);
        sheet.appendRow([
          d.vencimento || d.dataEmissao || '',
          tipo === 'pagar' ? 'saida' : 'entrada',
          d.situacao || '',
          rateio.categoriaId || '',
          mapCat.categoria,
          mapCat.grupoDRE,
          portador.id || '',
          portador.nome || '',
          (d.contato && d.contato.nome) || '',
          (d.formaPagamento && d.formaPagamento.descricao) || '',
          d.numeroDocumento || '',
          rateio.valor,
          d.id,
          tipo
        ]);
      });

      existentes.add(chave);
      novos++;
      Utilities.sleep(350);
    });

    if (lista.length < 100) break;
    pagina++;
    if (pagina > 60) break;
  }
  return novos;
}

/**
 * A lista de rateio por categoria pode vir como d.categorias (array) ou
 * um único d.categoria — tenta os dois formatos e cai pro valor total
 * sem categoria se nenhum bater (fica visível como "(sem categoria)" na
 * planilha, fácil de achar e corrigir).
 */
function extrairRateioCategorias_(d) {
  if (Array.isArray(d.categorias) && d.categorias.length) {
    return d.categorias.map(c => ({
      categoriaId: (c.categoria && c.categoria.id) || c.categoriaId,
      categoriaNome: (c.categoria && c.categoria.descricao) || c.categoriaNome,
      valor: c.valor != null ? c.valor : d.valor
    }));
  }
  if (d.categoria && d.categoria.id) {
    return [{ categoriaId: d.categoria.id, categoriaNome: d.categoria.descricao, valor: d.valor }];
  }
  return [{ categoriaId: '', categoriaNome: '(sem categoria)', valor: d.valor }];
}

function extrairPortador_(d, contasBancarias) {
  const portador = d.portador || d.contaBancaria || d.deposito || null;
  if (portador && portador.id) {
    return { id: portador.id, nome: portador.descricao || contasBancarias[portador.id] || '' };
  }
  return { id: '', nome: '' };
}

/** Recalcula a aba DRE inteira a partir da Fluxo de Caixa + _DRE_Mapa. */
function recalcularDre_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fluxo = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const dre = ss.getSheetByName(ABA_DRE);

  const ultimaLinha = fluxo.getLastRow();
  const totais = {}; // "AAAA-MM|grupoDRE" -> valor

  if (ultimaLinha >= 2) {
    const dados = fluxo.getRange(2, 1, ultimaLinha - 1, 12).getValues(); // até a coluna "valor"
    dados.forEach(linha => {
      const data = linha[0];
      const tipo = linha[1];
      const grupoDRE = linha[5];
      const valor = Number(linha[11]) || 0;
      if (!data || !grupoDRE || grupoDRE.indexOf('ignorar') >= 0) return;
      const mes = Utilities.formatDate(new Date(data), 'America/Sao_Paulo', 'yyyy-MM');
      const chave = mes + '|' + grupoDRE;
      const sinal = tipo === 'entrada' ? 1 : -1;
      totais[chave] = (totais[chave] || 0) + sinal * Math.abs(valor);
    });
  }

  dre.getRange(2, 1, Math.max(dre.getLastRow() - 1, 0), 3).clearContent();
  const linhas = Object.keys(totais).sort().map(chave => {
    const [mes, grupoDRE] = chave.split('|');
    return [mes, grupoDRE, totais[chave]];
  });
  if (linhas.length) {
    dre.getRange(2, 1, linhas.length, 3).setValues(linhas);
  }
}


/**
 * Reconfere no Bling as contas que a planilha ainda tem como EM ABERTO.
 *
 * Por que isso e necessario: sincronizarTipo_ e append-only — se a conta
 * ja existe na planilha, ele pula. Entao uma conta gravada em aberto
 * ficava em aberto pra sempre, mesmo depois de baixada no Bling. Foi o
 * que fez o painel acusar 38 contas vencidas (incluindo o pro-labore da
 * Karolyne, ja pago) quando o Bling so tinha 1 conta a pagar vencida.
 *
 * So reconfere as em aberto: sao poucas perto do total e sao justamente
 * as unicas cujo status ainda pode mudar.
 */
function atualizarContasEmAberto_(token, sheet) {
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return 0;

  const COL_DATA = 1, COL_SITUACAO = 3, COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 14).getValues();

  // uma conta pode ocupar varias linhas (rateio por categoria)
  const linhasPorConta = {};
  dados.forEach(function (linha, i) {
    if (String(linha[COL_SITUACAO - 1]).trim() !== '1') return;
    const chave = linha[COL_ORIGEM_TIPO - 1] + ':' + linha[COL_ORIGEM_ID - 1];
    if (!linhasPorConta[chave]) linhasPorConta[chave] = [];
    linhasPorConta[chave].push(i + 2); // numero da linha na planilha
  });

  let atualizadas = 0;
  Object.keys(linhasPorConta).forEach(function (chave) {
    const partes = chave.split(':');
    const tipo = partes[0], id = partes[1];
    if (!tipo || !id) return;

    const resp = fetchBling_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    const d = resp && resp.data;
    if (!d) return; // conta apagada no Bling ou erro: deixa como esta

    const situacaoNova = String(d.situacao || '1');
    const vencimentoNovo = d.vencimento || d.dataEmissao || '';
    if (situacaoNova === '1') return; // continua em aberto, nada a fazer

    linhasPorConta[chave].forEach(function (linha) {
      sheet.getRange(linha, COL_SITUACAO).setValue(situacaoNova);
      if (vencimentoNovo) sheet.getRange(linha, COL_DATA).setValue(vencimentoNovo);
    });
    atualizadas++;
  });

  return atualizadas;
}

/**
 * Reescreve a coluna grupoDRE de TODAS as linhas a partir do _DRE_Mapa atual.
 *
 * O grupo e gravado na linha no momento do sync. Como o sync nunca
 * reescrevia, corrigir o mapa so valia pras linhas novas — a Caixinha do
 * Nubank continuava contando como Resultado Financeiro no historico
 * inteiro, mesmo depois de reclassificada. Isso aqui e so planilha, nao
 * chama a API, entao roda rapido e pode rodar sempre.
 */
function reaplicarMapaDre_(sheet, mapaCategoria) {
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return 0;

  const COL_CATEGORIA_ID = 4, COL_GRUPO = 6;
  const categorias = sheet.getRange(2, COL_CATEGORIA_ID, ultimaLinha - 1, 1).getValues();
  const grupos = sheet.getRange(2, COL_GRUPO, ultimaLinha - 1, 1).getValues();

  let mudou = 0;
  for (let i = 0; i < categorias.length; i++) {
    const mapCat = mapaCategoria[String(categorias[i][0]).trim()];
    if (!mapCat || !mapCat.grupoDRE) continue;
    if (String(grupos[i][0]).trim() === mapCat.grupoDRE) continue;
    grupos[i][0] = mapCat.grupoDRE;
    mudou++;
  }
  if (mudou) sheet.getRange(2, COL_GRUPO, grupos.length, 1).setValues(grupos);
  return mudou;
}

/** Atalho pro menu: reaplica o mapa sem esperar o proximo sync. */
function _rodarReaplicarMapaDre() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = reaplicarMapaDre_(ss.getSheetByName(ABA_FLUXO_CAIXA), getMapaCategoria_());
  Logger.log('Linhas remapeadas: ' + n);
}
