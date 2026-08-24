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

/**
 * Orcamento de tempo. O Apps Script mata a execucao aos 6 min.
 * Antes, sincronizarTipo_ podia consumir os 6 min inteiros e o
 * atualizarContasEmAberto_ NUNCA rodava - por isso o painel acumulava
 * conta "em atraso" que ja tinha sido baixada ou apagada no Bling.
 * Agora cada etapa tem teto proprio e as duas sempre rodam.
 * Tudo aqui e retomavel: o que sobrar sai no proximo sync.
 */
const INICIO_SYNC_ = { t: 0 };
const TETO_APPEND_MS = 2.5 * 60 * 1000;   // buscar contas novas
const TETO_TOTAL_MS  = 5.0 * 60 * 1000;   // limite geral, com folga pro Google

function tempoGasto_() { return INICIO_SYNC_.t ? (Date.now() - INICIO_SYNC_.t) : 0; }

function syncBling() {
  INICIO_SYNC_.t = Date.now();
  try {
    const token = getBlingAccessToken_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);

    // categoria nova criada no Bling entra no mapa sozinha (ver funcao)
    const categoriasNovas = sincronizarCategorias_(token);

    const existentes = getChavesExistentes_(sheet);
    const contasBancarias = getContasBancarias_(token);
    const mapaCategoria = getMapaCategoria_();

    let novos = 0;
    novos += sincronizarTipo_('pagar', token, sheet, existentes, contasBancarias, mapaCategoria);
    novos += sincronizarTipo_('receber', token, sheet, existentes, contasBancarias, mapaCategoria);

    const atualizadas = atualizarContasEmAberto_(token, sheet);
    const remapeadas = reaplicarMapaDre_(sheet, mapaCategoria);

    recalcularDre_();
    try { limparCachePrecificacao_(); } catch (e) { /* funcao pode nao existir ainda */ }
    logSync_('syncBling', 'ok',
      novos + ' nova(s), ' + atualizadas + ' atualizada(s), ' + remapeadas + ' remapeada(s)'
      + (categoriasNovas ? ', ' + categoriasNovas + ' categoria(s) nova(s)' : '')
      + ' [' + Math.round(tempoGasto_() / 1000) + 's]');
  } catch (err) {
    logSync_('syncBling', 'erro', String(err));
    throw err;
  }
}

/**
 * Mantem o _DRE_Mapa em dia com o Bling, sozinho.
 *
 * O mapa era uma lista fixa escrita em 23/07/2025. Toda categoria criada
 * depois disso ficava de fora, e como o detalhe da conta devolve a
 * categoria SO com o id (medido em 23/08/2026: {"id":14639321702}, sem
 * descricao nenhuma), o mapa e a unica fonte do nome. Sem ele a linha
 * caia como "(sem categoria)" / "(sem mapear)" - foi o que fez a
 * categoria parar de puxar no painel.
 *
 * Aqui so ACRESCENTA o que falta. Nunca reescreve linha existente, pra
 * nao desfazer ajuste manual dela. O grupo da categoria nova e herdado
 * do pai quando o pai ja esta mapeado; senao entra como "(sem mapear)",
 * que aparece visivel na DRE em vez de sumir calado.
 */
function sincronizarCategorias_(token) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DRE_MAPA);
  if (!sheet) return 0;

  const doBling = [];
  let pagina = 1;
  while (pagina <= 20) {
    const resp = fetchBling_('https://www.bling.com.br/Api/v3/categorias/receitas-despesas?pagina='
      + pagina + '&limite=100', token);
    const lista = (resp && resp.data) || [];
    lista.forEach(function (c) { doBling.push(c); });
    if (lista.length < 100) break;
    pagina++;
  }
  if (!doBling.length) return 0;

  const dados = sheet.getDataRange().getValues();
  const jaTem = {};
  const grupoPorId = {};
  for (let i = 1; i < dados.length; i++) {
    const id = String(dados[i][0]).trim();
    if (!id) continue;
    jaTem[id] = true;
    grupoPorId[id] = String(dados[i][4] || '').trim();
  }

  const novas = [];
  doBling.forEach(function (c) {
    const id = String(c.id);
    if (jaTem[id]) return;
    const pai = String(c.idCategoriaPai || '0');
    const grupo = grupoPorId[pai] || '(sem mapear)';
    novas.push([id, c.descricao || '', String(c.tipo || ''), pai, grupo]);
  });

  if (novas.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, novas.length, 5).setValues(novas);
    logSync_('sincronizarCategorias', 'ok',
      novas.length + ' categoria(s) nova(s): '
      + novas.map(function (n) { return n[1] + ' -> ' + n[4]; }).join('; '));
  }
  return novas.length;
}

/** Atalho pro menu: atualiza o _DRE_Mapa sem esperar o proximo sync. */
function _rodarSincronizarCategorias() {
  const n = sincronizarCategorias_(getBlingAccessToken_());
  Logger.log('Categorias acrescentadas ao _DRE_Mapa: ' + n);
}

function criarGatilhoSync() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncBling')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncBling').timeBased().everyHours(2).create();
  Logger.log('Gatilho criado: syncBling a cada 2 horas.');
}

/**
 * O detalhe de conta a PAGAR devolve o contato so com o id:
 *     contato = {"id": 16667893174}
 * enquanto o de conta a RECEBER devolve o objeto inteiro com nome.
 * Sem isso, toda saida aparecia como "-" no painel (medido em
 * 20/08/2026: 1.746 de 8.043 contas sem nome, todas a pagar).
 * Aqui resolvemos o id pelo cadastro de contatos, com cache pra
 * nao repetir chamada do mesmo fornecedor.
 */
const CACHE_CONTATOS_ = {};

function nomeDoContato_(contato, token) {
  if (!contato) return '';
  if (contato.nome) return contato.nome;
  const id = contato.id;
  if (!id) return '';
  if (Object.prototype.hasOwnProperty.call(CACHE_CONTATOS_, id)) return CACHE_CONTATOS_[id];
  const resp = fetchBling_('https://www.bling.com.br/Api/v3/contatos/' + id, token);
  const nome = (resp && resp.data && resp.data.nome) || '';
  CACHE_CONTATOS_[id] = nome;
  Utilities.sleep(200);
  return nome;
}

/**
 * Igual ao fetchBling_, mas devolve tambem o status HTTP.
 * Precisamos disso pra diferenciar "conta apagada no Bling" (404)
 * de "deu erro agora" (429, 500, timeout). Sem essa distincao, uma
 * conta apagada ficava marcada como em aberto pra sempre e o painel
 * acusava atraso que nao existia.
 */
function fetchBlingStatus_(url, token) {
  let resp = null, status = 0;
  for (let t = 1; t <= 4; t++) {
    resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    status = resp.getResponseCode();
    // 429 = passou do limite de requisicoes do Bling; 5xx = instabilidade.
    // Nos dois casos o dado existe, so nao veio agora - espera e repete.
    if (status !== 429 && status < 500) break;
    Utilities.sleep(1500 * t);
  }
  let json = null;
  try { json = JSON.parse(resp.getContentText()); } catch (e) { json = null; }
  return { status: status, json: json };
}

/**
 * Devolver null aqui nao e inofensivo: em sincronizarTipo_ o codigo cai
 * pro resumo da lista, que NAO traz categoria nem portador, e a linha
 * entra na planilha sem categoria pra sempre. Foi assim que apareceram
 * 413 linhas sem categoria (medido em 23/08/2026) - todas nascidas de
 * respostas 429. Por isso o 429 agora e repetido, nao engolido.
 */
function fetchBling_(url, token) {
  let resp = null;
  for (let t = 1; t <= 4; t++) {
    resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    const st = resp.getResponseCode();
    if (st !== 429 && st < 500) break;
    Utilities.sleep(1500 * t);
  }
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

/**
 * O Bling recusa filtro de data com janela maior que 366 dias:
 *   HTTP 400 BAD_REQUEST "O periodo do filtro por 'dataEmissao' e maior
 *   que o periodo permitido (366 dias)."
 * Como a janela do painel comeca em 2025-01-01, a chamada estourava o
 * limite e falhava na PRIMEIRA pagina - o sync fechava com "0 nova(s)"
 * sem parecer erro nenhum. Medido em 23/08/2026 direto na API.
 * Aqui a janela vira fatias de 365 dias.
 */
function janelasDeSync_(desde, ate) {
  const janelas = [];
  const fim = new Date(ate + 'T12:00:00');
  let ini = new Date(desde + 'T12:00:00');
  let guarda = 0;
  while (ini <= fim && guarda++ < 50) {
    const prox = new Date(ini.getTime());
    prox.setDate(prox.getDate() + 364);
    const f = prox < fim ? prox : fim;
    janelas.push([
      Utilities.formatDate(ini, 'America/Sao_Paulo', 'yyyy-MM-dd'),
      Utilities.formatDate(f, 'America/Sao_Paulo', 'yyyy-MM-dd')
    ]);
    ini = new Date(f.getTime());
    ini.setDate(ini.getDate() + 1);
  }
  return janelas;
}

function sincronizarTipo_(tipo, token, sheet, existentes, contasBancarias, mapaCategoria) {
  const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
  const janelas = janelasDeSync_(JANELA_SYNC_DESDE, hoje);
  let novos = 0;

  for (let j = 0; j < janelas.length; j++) {
   const DE = janelas[j][0], ATE = janelas[j][1];
   let pagina = 1;
   while (true) {
    const url = 'https://www.bling.com.br/Api/v3/contas/' + tipo
      + '?pagina=' + pagina + '&limite=100'
      + '&dataEmissaoInicial=' + DE + '&dataEmissaoFinal=' + ATE;
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
          nomeDoContato_(d.contato, token),
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

    // para de buscar conta nova pra sobrar tempo pro atualizarContasEmAberto_
    if (tempoGasto_() > TETO_APPEND_MS) {
      logSync_('sincronizarTipo', 'ok', tipo + ': parei em ' + DE + ' pagina ' + pagina
        + ' por tempo, continuo no proximo sync');
      break;
    }

    if (lista.length < 100) break;
    pagina++;
    if (pagina > 60) break;
   }
   if (tempoGasto_() > TETO_APPEND_MS) break;
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
      const situacao = String(linha[2] || '').trim();
      const grupoDRE = linha[5];
      const valor = Number(linha[11]) || 0;
      // 5 = cancelada (ou conta apagada no Bling, que marcamos assim). O
      // painel ja ignorava na tela, mas a aba DRE somava - em 23/08/2026
      // eram 266 linhas contando como receita/despesa que nao existem.
      if (situacao === '5') return;
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
    /* O mes vai como "2026-08", que o Sheets converte em DATA sozinho se
       a coluna for automatica. Na volta vinha "Wed Aug 01 2026..." e quem
       ordenava por texto acabava ordenando pelo dia da semana - foi assim
       que a media dos "3 ultimos meses" pegou abril/2026, julho/2026 e
       outubro/2025, tudo que comecava com "Wed". Forcar texto na coluna
       resolve na origem. */
    dre.getRange(2, 1, linhas.length, 1).setNumberFormat('@');
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

  const COL_DATA = 1, COL_SITUACAO = 3, COL_VALOR = 12, COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 14).getValues();

  // uma conta pode ocupar varias linhas (rateio por categoria)
  const linhasPorConta = {};
  dados.forEach(function (linha, i) {
    if (String(linha[COL_SITUACAO - 1]).trim() !== '1') return;
    const chave = linha[COL_ORIGEM_TIPO - 1] + ':' + linha[COL_ORIGEM_ID - 1];
    if (!linhasPorConta[chave]) linhasPorConta[chave] = [];
    linhasPorConta[chave].push(i + 2); // numero da linha na planilha
  });

  // Ponteiro rotativo: se o tempo acabar no meio, o proximo sync comeca de
  // onde este parou em vez de sempre reconferir as mesmas do topo e nunca
  // chegar no fim da fila.
  const chaves = Object.keys(linhasPorConta).sort();
  const props = PropertiesService.getScriptProperties();
  let inicio = parseInt(props.getProperty('CURSOR_CONTAS_ABERTO') || '0', 10);
  if (!(inicio >= 0) || inicio >= chaves.length) inicio = 0;

  let atualizadas = 0;
  let apagadas = 0;
  let editadas = 0;
  let vistas = 0;
  let parouPorTempo = false;

  for (let k = 0; k < chaves.length; k++) {
    const chave = chaves[(inicio + k) % chaves.length];

    if (tempoGasto_() > TETO_TOTAL_MS) {
      props.setProperty('CURSOR_CONTAS_ABERTO', String((inicio + k) % chaves.length));
      parouPorTempo = true;
      break;
    }

    vistas++;
    const partes = chave.split(':');
    const tipo = partes[0], id = partes[1];
    if (!tipo || !id) continue;

    const r = fetchBlingStatus_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    Utilities.sleep(300); // o Bling corta em ~3 req/s

    // 404 = a conta foi APAGADA no Bling. Marca como cancelada (5),
    // que o painel ja ignora. A linha continua na planilha como
    // historico, mas para de aparecer como conta em aberto.
    if (r.status === 404) {
      linhasPorConta[chave].forEach(function (linha) {
        sheet.getRange(linha, COL_SITUACAO).setValue('5');
      });
      apagadas++;
      continue;
    }
    // qualquer outro erro (429, 500, timeout): nao mexe, tenta na proxima
    const d = r.json && r.json.data;
    if (!d) continue;

    const situacaoNova = String(d.situacao || '1');
    const vencimentoNovo = d.vencimento || d.dataEmissao || '';

    // Conta que CONTINUA em aberto mas foi editada no Bling: antes a gente
    // saia fora aqui, e a planilha guardava o vencimento antigo pra sempre.
    // Era isso que fazia conta prorrogada aparecer como atrasada - medido
    // em 23/08/2026: tres contas a pagar remarcadas de 20/08 pra 24/08
    // (e com valor alterado) continuavam vencidas no painel.
    if (situacaoNova === '1') {
      const linhas = linhasPorConta[chave];
      let mexeu = false;

      if (vencimentoNovo) {
        const atual = linhas.map(function (l) { return sheet.getRange(l, COL_DATA).getValue(); })[0];
        const atualTxt = atual instanceof Date
          ? Utilities.formatDate(atual, 'America/Sao_Paulo', 'yyyy-MM-dd')
          : String(atual || '').trim().slice(0, 10);
        if (atualTxt !== vencimentoNovo) {
          linhas.forEach(function (l) { sheet.getRange(l, COL_DATA).setValue(vencimentoNovo); });
          mexeu = true;
        }
      }

      // Valor so quando a conta ocupa UMA linha. Com rateio por categoria
      // ela ocupa varias, e o valor de cada linha e a parte dela - escrever
      // o total em todas multiplicaria a despesa.
      if (linhas.length === 1 && d.valor != null) {
        const vAtual = Number(sheet.getRange(linhas[0], COL_VALOR).getValue() || 0);
        if (Math.abs(vAtual - Number(d.valor)) > 0.005) {
          sheet.getRange(linhas[0], COL_VALOR).setValue(Number(d.valor));
          mexeu = true;
        }
      }

      if (mexeu) editadas++;
      continue;
    }

    linhasPorConta[chave].forEach(function (linha) {
      sheet.getRange(linha, COL_SITUACAO).setValue(situacaoNova);
      if (vencimentoNovo) sheet.getRange(linha, COL_DATA).setValue(vencimentoNovo);
    });
    atualizadas++;
  }

  if (!parouPorTempo) props.setProperty('CURSOR_CONTAS_ABERTO', '0');

  logSync_('atualizarContas', 'ok',
    vistas + '/' + chaves.length + ' conferidas, ' + atualizadas + ' baixada(s), '
    + editadas + ' com data/valor corrigido, ' + apagadas + ' apagada(s) no Bling'
    + (parouPorTempo ? ' - parei por tempo, continuo no proximo sync' : ' - fila inteira'));

  return atualizadas;
}

/** Atalho pro menu: reconfere as em aberto sem esperar o proximo sync. */
function _rodarAtualizarContasEmAberto() {
  INICIO_SYNC_.t = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = atualizarContasEmAberto_(getBlingAccessToken_(), ss.getSheetByName(ABA_FLUXO_CAIXA));
  recalcularDre_();
  Logger.log('Contas atualizadas: ' + n);
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

  // Reescreve NOME e GRUPO. O nome tambem, porque o detalhe da conta so
  // devolve o id da categoria - se ela nao estava no mapa na hora do sync,
  // a linha ficou gravada como "(sem categoria)" pra sempre. Agora que o
  // mapa se completa sozinho, essas linhas antigas se curam aqui.
  const COL_CATEGORIA_ID = 4, COL_NOME = 5, COL_GRUPO = 6;
  const categorias = sheet.getRange(2, COL_CATEGORIA_ID, ultimaLinha - 1, 1).getValues();
  const nomes = sheet.getRange(2, COL_NOME, ultimaLinha - 1, 1).getValues();
  const grupos = sheet.getRange(2, COL_GRUPO, ultimaLinha - 1, 1).getValues();

  let mudouGrupo = 0, mudouNome = 0;
  for (let i = 0; i < categorias.length; i++) {
    const mapCat = mapaCategoria[String(categorias[i][0]).trim()];
    if (!mapCat) continue;

    if (mapCat.categoria && String(nomes[i][0]).trim() !== String(mapCat.categoria).trim()) {
      nomes[i][0] = mapCat.categoria;
      mudouNome++;
    }
    if (mapCat.grupoDRE && String(grupos[i][0]).trim() !== mapCat.grupoDRE) {
      grupos[i][0] = mapCat.grupoDRE;
      mudouGrupo++;
    }
  }
  if (mudouNome) sheet.getRange(2, COL_NOME, nomes.length, 1).setValues(nomes);
  if (mudouGrupo) sheet.getRange(2, COL_GRUPO, grupos.length, 1).setValues(grupos);
  return mudouGrupo + mudouNome;
}

/** Atalho pro menu: reaplica o mapa sem esperar o proximo sync. */
function _rodarReaplicarMapaDre() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const n = reaplicarMapaDre_(ss.getSheetByName(ABA_FLUXO_CAIXA), getMapaCategoria_());
  Logger.log('Linhas remapeadas: ' + n);
}

/**
 * PREENCHE RETROATIVAMENTE o nome do contato nas linhas antigas.
 *
 * O sync so grava linha nova, entao corrigir nomeDoContato_ nao
 * conserta o que ja esta na planilha. Esta funcao varre a aba
 * Fluxo, acha as linhas com contatoNome vazio e resolve o nome
 * pelo detalhe da conta.
 *
 * Respeita o limite de 6 minutos do Apps Script: para sozinha aos
 * 4,5 min e grava o que ja fez. E so rodar de novo que ela continua
 * de onde parou - as linhas ja preenchidas nao voltam a ser lidas.
 *
 * Rode por _rodarPreencherContatos.
 */
function preencherContatosFaltantes_() {
  const COL_CONTATO = 9;
  const COL_ORIGEM_ID = 13;
  const COL_ORIGEM_TIPO = 14;
  const LIMITE_MS = 4.5 * 60 * 1000;

  const inicio = Date.now();
  const token = getBlingAccessToken_();
  if (!token) { logSync_('preencherContatos', 'erro', 'sem token'); return; }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sheet) { logSync_('preencherContatos', 'erro', 'aba ' + ABA_FLUXO_CAIXA + ' nao encontrada'); return; }

  const ultima = sheet.getLastRow();
  if (ultima < 2) return;

  const dados = sheet.getRange(2, 1, ultima - 1, COL_ORIGEM_TIPO).getValues();
  let preenchidos = 0, semNome = 0, parouEm = 0;

  for (let i = 0; i < dados.length; i++) {
    if (String(dados[i][COL_CONTATO - 1] || '').trim() !== '') continue;
    const idConta = dados[i][COL_ORIGEM_ID - 1];
    const tipo = String(dados[i][COL_ORIGEM_TIPO - 1] || '').trim();
    if (!idConta || (tipo !== 'pagar' && tipo !== 'receber')) continue;

    if (Date.now() - inicio > LIMITE_MS) { parouEm = i + 2; break; }

    const resp = fetchBling_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + idConta, token);
    const d = (resp && resp.data) || null;
    const nome = d ? nomeDoContato_(d.contato, token) : '';
    if (nome) {
      sheet.getRange(i + 2, COL_CONTATO).setValue(nome);
      preenchidos++;
    } else {
      semNome++;
    }
    Utilities.sleep(300);
  }

  logSync_('preencherContatos', 'ok',
    preenchidos + ' nomes preenchidos, ' + semNome + ' sem nome no Bling'
    + (parouEm ? ', parei na linha ' + parouEm + ' por tempo - rode de novo' : ', terminou tudo'));
}

function _rodarPreencherContatos() {
  preencherContatosFaltantes_();
}

/**
 * REPARO das linhas que ficaram sem categoria.
 *
 * Quando o Bling responde 429, o fetchBling_ devolvia null e o
 * sincronizarTipo_ caia pro resumo da lista - que nao traz categoria nem
 * portador. A linha entrava na planilha como "(sem categoria)" e ficava
 * assim pra sempre, porque o sync so grava linha nova. Em 23/08/2026
 * eram 413 linhas de 7.286.
 *
 * O 429 ja esta tratado no fetchBling_, entao isso aqui e so pra limpar
 * o passivo. Busca o detalhe de novo e preenche categoria, grupo e
 * portador. Para sozinha aos 4,5 min: e so rodar de novo que continua,
 * porque linha consertada deixa de ser candidata.
 *
 * Rode por _rodarReprocessarSemCategoria.
 */
function reprocessarLinhasSemCategoria_() {
  const COL_SITUACAO = 3, COL_CAT_ID = 4, COL_CAT_NOME = 5, COL_GRUPO = 6,
        COL_PORT_ID = 7, COL_PORT_NOME = 8,
        COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const LIMITE_MS = 4.5 * 60 * 1000;

  INICIO_SYNC_.t = Date.now();
  const token = getBlingAccessToken_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const ultima = sheet.getLastRow();
  if (ultima < 2) return;

  const mapaCategoria = getMapaCategoria_();
  const contasBancarias = getContasBancarias_(token);
  const dados = sheet.getRange(2, 1, ultima - 1, COL_ORIGEM_TIPO).getValues();

  let consertadas = 0, semCatNoBling = 0, comRateio = 0, falhou = 0, restam = 0, apagadas = 0;
  const porStatus = {}; // pra saber DE VERDADE por que falhou

  for (let i = 0; i < dados.length; i++) {
    const catId = String(dados[i][COL_CAT_ID - 1] || '').trim();
    const catNome = String(dados[i][COL_CAT_NOME - 1] || '').trim();
    const precisa = !catId || !catNome || catNome === '(sem categoria)';
    if (!precisa) continue;
    if (String(dados[i][COL_SITUACAO - 1]).trim() === '5') continue; // ja cancelada

    if (Date.now() - INICIO_SYNC_.t > LIMITE_MS) { restam++; continue; }

    const id = dados[i][COL_ORIGEM_ID - 1];
    const tipo = String(dados[i][COL_ORIGEM_TIPO - 1] || '').trim();
    if (!id || (tipo !== 'pagar' && tipo !== 'receber')) continue;

    const r0 = fetchBlingStatus_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    porStatus[r0.status] = (porStatus[r0.status] || 0) + 1;

    // 404 = conta apagada no Bling. Nao da pra recuperar categoria de
    // algo que nao existe mais: marca a linha como cancelada (5), que e
    // o mesmo tratamento do atualizarContasEmAberto_, e ela sai do
    // painel em vez de ficar rodando nesta fila pra sempre.
    if (r0.status === 404) {
      sheet.getRange(i + 2, COL_SITUACAO).setValue('5');
      apagadas++;
      Utilities.sleep(250);
      continue;
    }

    const d = r0.json && r0.json.data;
    if (!d) { falhou++; Utilities.sleep(300); continue; }

    const rateio = extrairRateioCategorias_(d);

    // Conta rateada em varias categorias nao cabe numa linha so. Sao
    // poucas; deixo passar e registro em vez de inventar um rateio.
    if (rateio.length > 1) { comRateio++; Utilities.sleep(300); continue; }

    const r = rateio[0];

    // A conta existe e realmente nao tem categoria no Bling. Marco a linha
    // pra ela sair da fila - senao toda rodada gasta tempo nas mesmas.
    // Fica visivel no painel como "(sem categoria no Bling)", que e
    // diferente de "(sem categoria)" e diz onde e o conserto: no Bling.
    if (!r.categoriaId) {
      sheet.getRange(i + 2, COL_CAT_ID).setValue('0');
      sheet.getRange(i + 2, COL_CAT_NOME).setValue('(sem categoria no Bling)');
      sheet.getRange(i + 2, COL_GRUPO).setValue('(sem mapear)');
      semCatNoBling++;
      Utilities.sleep(300);
      continue;
    }

    const mapCat = mapaCategoria[String(r.categoriaId)]
      || { categoria: r.categoriaNome || '(sem categoria)', grupoDRE: '(sem mapear)' };
    const linha = i + 2;
    sheet.getRange(linha, COL_CAT_ID).setValue(r.categoriaId);
    sheet.getRange(linha, COL_CAT_NOME).setValue(mapCat.categoria);
    sheet.getRange(linha, COL_GRUPO).setValue(mapCat.grupoDRE);

    if (!String(dados[i][COL_PORT_NOME - 1] || '').trim()) {
      const port = extrairPortador_(d, contasBancarias);
      if (port.id) sheet.getRange(linha, COL_PORT_ID).setValue(port.id);
      if (port.nome) sheet.getRange(linha, COL_PORT_NOME).setValue(port.nome);
    }

    consertadas++;
    Utilities.sleep(300);
  }

  recalcularDre_();
  const resumo = consertadas + ' consertada(s), ' + apagadas + ' apagada(s) no Bling -> cancelada, '
    + semCatNoBling + ' sem categoria no proprio Bling, ' + comRateio + ' com rateio (pulei), '
    + falhou + ' falha(s)'
    + (restam ? ', ' + restam + ' pendente(s) - rode de novo' : ', terminou tudo')
    + ' | HTTP: ' + JSON.stringify(porStatus);
  logSync_('reprocessarSemCategoria', 'ok', resumo);
  Logger.log(resumo);
}

function _rodarReprocessarSemCategoria() {
  reprocessarLinhasSemCategoria_();
}

