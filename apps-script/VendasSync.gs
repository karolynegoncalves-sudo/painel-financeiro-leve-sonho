/**
 * VendasSync.gs — receita por COMPETÊNCIA (data da venda).
 *
 * Por que isso existe: `syncBling()` lê contas a pagar/receber, ou seja,
 * regime de CAIXA — a venda só aparece no dia em que o dinheiro entrou.
 * Uma venda da Shopee de 28/07 libera na carteira em agosto, então julho
 * parece ter vendido menos do que vendeu. Bom pra saúde financeira,
 * péssimo pra medir desempenho.
 *
 * Aqui a gente puxa os PEDIDOS e guarda pela data do pedido. As duas
 * visões convivem: caixa responde "tenho dinheiro?", competência responde
 * "vendi bem?".
 *
 * syncVendas() reconstrói a aba inteira a cada rodada, de propósito —
 * pedido muda de situação depois (cancelamento, principalmente), e
 * append incremental deixaria cancelado contando como venda pra sempre.
 */

const JANELA_VENDAS_DESDE = '2026-01-01';

/** Situações de venda do Bling. Cancelado não conta como receita. */
const SITUACAO_VENDA = {
  6: 'Em aberto',
  9: 'Atendido',
  12: 'Cancelado',
  24: 'Verificado',
  890573: 'Financeiro Auxiliar'
};

/*
 * NAO CONTAM COMO VENDA (07/09/2026):
 *   12     Cancelado          - a venda nao aconteceu
 *   890573 Financeiro Auxiliar - e PEDIDO-CLONE, nao venda
 *
 * O clone e uma copia financeira de uma venda real: existe so pra gerar conta
 * a receber e a receita aparecer na DRE (ver memoria
 * bling-migracao-lancamentos-unitarios). Contando o clone como venda, a
 * receita entra duas vezes - uma no pedido do canal, outra na copia.
 *
 * Medido em julho/2026: 1.140 pedidos, dos quais 383 sao clone (marca FIN- no
 * numeroPedidoCompra) somando R$ 27.223,94. O painel mostrava R$ 88.641,55 de
 * faturamento quando o real era R$ 61.417,61 - 31% a mais. E batia com o
 * relatorio do Bling, que conta os clones do mesmo jeito: bater nao provava
 * que estava certo, provava que erravam igual.
 *
 * LIMITE CONHECIDO: o filtro e pela SITUACAO porque a listagem de pedidos nao
 * traz numeroPedidoCompra - so o detalhe traz, e abrir 10 mil pedidos por sync
 * seria inviavel. Em julho isso pega 382 dos 383 clones. O que escapa e clone
 * que ficou noutra situacao (ex: o pedido 21239, em 'Em aberto'). Se aparecer
 * faturamento estranho num mes antigo, conferir com diag_clones_no_relatorio.ps1.
 */
const SITUACOES_NAO_CONTAM = [12, 890573];

/**
 * Lojas/canais. O endpoint /lojas responde 404 nessa conta, então o mapa
 * é fixo mesmo — ids conferidos direto nos pedidos.
 */
const CANAL_POR_LOJA = {
  '204420602': 'Shopee',
  '204420647': 'Mercado Livre',
  '204420594': 'Site (Nuvemshop)',
  '204763959': 'SHEIN',
  '205665721': 'TikTok Shop'
};

function syncVendas() {
  try {
    const token = getBlingAccessToken_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet_(ss, ABA_VENDAS);
    ensureHeader_(sheet, [
      'pedidoId', 'data', 'numero', 'numeroLoja', 'lojaId', 'canal',
      'cliente', 'situacaoId', 'situacao', 'contaReceita', 'total'
    ]);

    const hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd');
    const linhas = [];
    let pagina = 1;

    while (true) {
      const url = 'https://api.bling.com.br/Api/v3/pedidos/vendas'
        + '?pagina=' + pagina + '&limite=100'
        + '&dataInicial=' + JANELA_VENDAS_DESDE + '&dataFinal=' + hoje;
      const resp = fetchBling_(url, token);
      const lista = (resp && resp.data) || [];
      if (lista.length === 0) break;

      lista.forEach(function (p) {
        const lojaId = (p.loja && p.loja.id) ? String(p.loja.id) : '';
        const situacaoId = (p.situacao && p.situacao.id) ? Number(p.situacao.id) : 0;
        linhas.push([
          p.id,
          p.data || '',
          p.numero || '',
          p.numeroLoja || '',
          lojaId,
          CANAL_POR_LOJA[lojaId] || (lojaId ? 'Loja ' + lojaId : 'Venda direta'),
          (p.contato && p.contato.nome) || '',
          situacaoId,
          SITUACAO_VENDA[situacaoId] || String(situacaoId),
          SITUACOES_NAO_CONTAM.indexOf(situacaoId) >= 0 ? 'nao' : 'sim',
          Number(p.total) || 0
        ]);
      });

      if (lista.length < 100) break;
      pagina++;
      if (pagina > 200) break; // trava de segurança
    }

    // reconstrói do zero (ver comentário no topo)
    if (sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    }
    if (linhas.length) {
      sheet.getRange(2, 1, linhas.length, linhas[0].length).setValues(linhas);
    }

    logSync_('syncVendas', 'ok', linhas.length + ' pedido(s)');
    return linhas.length;
  } catch (err) {
    logSync_('syncVendas', 'erro', String(err));
    throw err;
  }
}

/** Roda syncVendas junto com o sync financeiro, de 2 em 2 horas. */
function criarGatilhoSyncVendas() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'syncVendas'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('syncVendas').timeBased().everyHours(2).create();
  Logger.log('Gatilho criado: syncVendas a cada 2 horas.');
}

function getVendasRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_VENDAS);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues();
  const tz = 'America/Sao_Paulo';
  return dados.filter(function (l) { return l[0]; }).map(function (l) {
    const d = l[1] instanceof Date ? Utilities.formatDate(l[1], tz, 'yyyy-MM-dd') : String(l[1]).slice(0, 10);
    return {
      pedidoId: String(l[0]),
      data: d,
      numero: String(l[2]),
      numeroLoja: String(l[3]),
      canal: String(l[5]),
      cliente: String(l[6]),
      situacao: String(l[8]),
      contaReceita: String(l[9]) === 'sim',
      total: Number(l[10]) || 0
    };
  });
}

/* ============================================================================
 * _Receita_Pedidos: quem preenche passa a ser ESTE codigo (06/10/2026).
 *
 * POR QUE EXISTE: a aba alimenta a RECEITA da DRE inteira, e ate hoje ninguem
 * a escrevia. O Setup.gs so cria o cabecalho e diz "quem preenche e o script de
 * custo de fabricacao, fora deste projeto" - e esse script nao existe. Varri
 * o G:, o H: e o C:\Claude filtrando arquivos de script: as 8 ocorrencias das
 * duas abas sao leitura ou comentario. Elas vinham sendo preenchidas a mao,
 * e por isso paravam no ultimo mes que alguem calculou (2026-09, com outubro
 * ja vendendo R$ 6.775,01 em 81 pedidos).
 *
 * O sintoma era o ponto de equilibrio dizer "Sem receita no periodo" no mes
 * corrente - todo mes, justamente quando ele seria mais util.
 *
 * NAO PRECISA DA API DO BLING. A aba Vendas ja tem pedido, data, canal,
 * situacao e total, sincronizada de 2 em 2 horas pelo syncVendas. Receita por
 * mes e canal e agregacao dela. Sem chamada externa, sem teto de 3 req/s, sem
 * disputa de token com as outras sessoes - roda em segundos.
 *
 * O FILTRO E `contaReceita`, que o syncVendas ja resolve: exclui Cancelado
 * (12) e Financeiro Auxiliar (890573). O segundo e o pedido-CLONE, copia
 * financeira de uma venda real - conta-lo dobraria a receita. Em julho/2026
 * eram 383 clones e R$ 27.223,94, 31% a mais de faturamento.
 * ========================================================================== */
function agregarReceitaDeVendas_() {
  const porMesCanal = {};
  getVendasRows_().forEach(function (v) {
    if (!v.contaReceita) return;
    const mes = String(v.data || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(mes)) return;
    const k = mes + '|' + v.canal;
    if (!porMesCanal[k]) porMesCanal[k] = { mes: mes, canal: v.canal, valor: 0, pedidos: 0 };
    porMesCanal[k].valor += v.total;
    porMesCanal[k].pedidos += 1;
  });
  return porMesCanal;
}

/* ----------------------------------------------------------------------------
 * conferirReceitaPedidos() - SO LEITURA, e e a funcao que importa.
 *
 * Antes de qualquer gravacao, provar que o calculo REPRODUZ os meses que ja
 * estao na aba. Esses meses vieram de outro processo, feito a mao, e podem ter
 * criterio diferente do meu - liquido de desconto, outra data, outro filtro de
 * situacao. Se os meses antigos baterem, o metodo esta validado e outubro pode
 * ser gravado com confianca. Se nao baterem, a diferenca aparece ANTES de eu
 * escrever por cima de historico que sustenta a DRE do ano.
 *
 * Gravar primeiro e conferir depois seria inverter o unico momento em que a
 * verificacao e barata.
 * -------------------------------------------------------------------------- */
/* ----------------------------------------------------------------------------
 * mostrarRelatorio_(titulo, linhas) - relatorio que aparece na TELA.
 *
 * POR QUE (06/10/2026, segunda vez): ela clicou no menu e disse "rodei porem
 * nao saiu log". Rodando pelo MENU da planilha o `Logger.log` nao aparece em
 * lugar nenhum visivel - so em Extensoes > Apps Script > Execucoes. Eu ja
 * tinha batido nisso em 04/10 com o recategorizarJanAgo, consertei COM alert,
 * e dois dias depois escrevi outra funcao de relatorio sem o mesmo cuidado.
 *
 * Alert nao serve aqui: relatorio de comparacao tem dezenas de linhas e
 * alinhamento em colunas. Dialogo modal com <pre> serve, e ainda da pra
 * selecionar e copiar o texto - que e como ela me manda o resultado.
 *
 * Continua gravando no Logger tambem: quem rodar pelo editor ainda ve.
 * -------------------------------------------------------------------------- */
function mostrarRelatorio_(titulo, linhas) {
  const txt = linhas.join('\n');
  Logger.log(txt);
  const html = '<pre style="font:12px/1.45 Menlo,Consolas,monospace;white-space:pre;'
             + 'overflow:auto;margin:0;">' + txt.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</pre>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(900).setHeight(560), titulo);
}

function conferirReceitaPedidos() {
  const L = [];
  const calc = agregarReceitaDeVendas_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_RECEITA_PEDIDOS_);
  if (!sheet) { mostrarRelatorio_('Receita', ['aba ' + ABA_RECEITA_PEDIDOS_ + ' nao existe']); return; }

  const atual = {};
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues().forEach(function (l) {
      const mes = l[0] instanceof Date
        ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'yyyy-MM')
        : String(l[0] || '').trim().slice(0, 7);
      if (!mes) return;
      const k = mes + '|' + String(l[1] || '').trim();
      atual[k] = { mes: mes, canal: String(l[1] || '').trim(), valor: Number(l[2]) || 0 };
    });
  }

  const meses = {};
  Object.keys(calc).forEach(function (k) { meses[calc[k].mes] = 1; });
  Object.keys(atual).forEach(function (k) { meses[atual[k].mes] = 1; });

  L.push('RECEITA: o que a aba tem  x  o que a aba Vendas calcula');
  L.push('(so leitura - nada foi gravado)');
  L.push('');
  L.push('mes       |        NA ABA |     CALCULADO |     DIFERENCA');
  L.push('----------+---------------+---------------+--------------');
  const pad = function (n) { const s = Number(n).toFixed(2); return '              '.slice(s.length) + s; };
  let faltando = 0, divergindo = 0;
  Object.keys(meses).sort().forEach(function (m) {
    let a = 0, c = 0;
    Object.keys(atual).forEach(function (k) { if (atual[k].mes === m) a += atual[k].valor; });
    Object.keys(calc).forEach(function (k) { if (calc[k].mes === m) c += calc[k].valor; });
    const d = c - a;
    let marca;
    if (a === 0) { marca = '   <- A ABA NAO TEM ESTE MES'; faltando++; }
    else if (Math.abs(d) < 0.01) { marca = '   OK'; }
    else if (Math.abs(d) / (a || 1) < 0.01) { marca = '   ~ (menos de 1%)'; }
    else { marca = '   <<< DIVERGE'; divergindo++; }
    L.push(m + '   |' + pad(a) + ' |' + pad(c) + ' |' + pad(d) + marca);
  });

  L.push('');
  L.push('VEREDITO: ' + divergindo + ' mes(es) divergindo, ' + faltando + ' mes(es) faltando na aba.');
  L.push('');
  L.push('COMO LER: mes que fecha OK prova que o calculo reproduz o criterio de');
  L.push('quem preencheu antes, a mao. Mes marcado DIVERGE precisa de explicacao');
  L.push('ANTES de gravar - pode ser desconto, data ou situacao contados de outro');
  L.push('jeito, e eu nao escrevo por cima de historico sem saber o porque.');
  L.push('');
  L.push('Se nenhum divergir: menu > "Receita: gravar o mes corrente".');
  mostrarRelatorio_('Receita: conferencia', L);
}

/* ----------------------------------------------------------------------------
 * gravarReceitaPedidos(mes) - grava UM mes, e so se a aba ainda nao o tiver.
 *
 * Recusa sobrescrever mes existente de proposito. Esses meses sustentam a
 * receita da DRE do ano inteiro; trocar um deles por engano seria estragar
 * historico fechado. Para refazer um mes de verdade, apagar a linha na mao
 * primeiro - o gesto manual e a confirmacao.
 * -------------------------------------------------------------------------- */
function gravarReceitaPedidos(mes) {
  mes = String(mes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) { Logger.log('informe o mes: gravarReceitaPedidos("2026-10")'); return; }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_RECEITA_PEDIDOS_);
  if (!sheet) { Logger.log('aba ' + ABA_RECEITA_PEDIDOS_ + ' nao existe'); return; }

  if (sheet.getLastRow() > 1) {
    const existentes = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
    const jaTem = existentes.some(function (l) {
      const m = l[0] instanceof Date
        ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'yyyy-MM')
        : String(l[0] || '').trim().slice(0, 7);
      return m === mes;
    });
    if (jaTem) {
      Logger.log('A aba JA TEM ' + mes + '. Nao sobrescrevo historico.');
      Logger.log('Rode conferirReceitaPedidos() pra ver se o calculo bate com o que esta la.');
      Logger.log('Para refazer mesmo assim, apague as linhas desse mes na mao antes.');
      return;
    }
  }

  const calc = agregarReceitaDeVendas_();
  const linhas = [];
  const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  let total = 0, pedidos = 0;
  Object.keys(calc).sort().forEach(function (k) {
    const r = calc[k];
    if (r.mes !== mes) return;
    linhas.push([r.mes, r.canal, r.valor, r.pedidos, agora]);
    total += r.valor; pedidos += r.pedidos;
  });

  if (!linhas.length) {
    Logger.log('Nenhuma venda em ' + mes + ' na aba Vendas. Rode syncVendas primeiro.');
    return;
  }

  sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, 5).setValues(linhas);
  recalcularDre_();

  Logger.log('GRAVADO ' + mes + ': ' + linhas.length + ' canal(is), '
             + pedidos + ' pedido(s), R$ ' + total.toFixed(2));
  linhas.forEach(function (l) {
    Logger.log('   ' + l[1] + ': R$ ' + Number(l[2]).toFixed(2) + ' em ' + l[3] + ' pedido(s)');
  });
  Logger.log('');
  Logger.log('O CMV deste mes continua faltando - _CMV_Consumo e outra aba e');
  Logger.log('ainda nao tem quem a escreva. Entao o lucro bruto de ' + mes + ' sai');
  Logger.log('OTIMISTA ate ela ser preenchida: receita sem o custo do produto.');
}

/* ============================================================================
 * refazerReceitaMes(mes) - APAGA as linhas de um mes e regrava pelo calculo.
 *
 * Existe porque a conferencia de 06/10/2026 achou setembro com
 * R$ 24.534,07 na aba contra R$ 67.554,29 calculado - R$ 43.020,22 de receita
 * faltando na DRE. O calculo bateu ao CENTAVO em jan-jul e em outubro, e
 * errou 0,16% em agosto; errado era o mes, nao o metodo. A causa provavel e
 * setembro ter sido preenchido a mao no MEIO do mes e nunca refeito no
 * fechamento - a Shopee aparecia com R$ 12.725 quando faz o triplo.
 *
 * O `gravarReceitaPedidos` recusa sobrescrever de proposito, e continua
 * recusando. Esta e a porta separada, que exige dizer o mes e mostra o que
 * esta substituindo - a diferenca entre as duas e a confirmacao.
 *
 * O RELATORIO TRAZ O ANTES, linha a linha, pra dar pra desfazer na mao se o
 * numero novo nao convencer. Apagar sem guardar o que havia e o unico jeito
 * de transformar um conserto em perda.
 *
 * Apaga de baixo pra cima: apagar de cima desloca as linhas seguintes e os
 * indices seguintes passam a apontar pra linha errada.
 * ========================================================================== */
function refazerReceitaMes(mes, forcar) {
  mes = String(mes || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    mostrarRelatorio_('Receita', ['informe o mes: refazerReceitaMes("2026-09")']);
    return;
  }
  const L = [];
  let antesPedidos = 0;
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_RECEITA_PEDIDOS_);
  if (!sheet) { mostrarRelatorio_('Receita', ['aba nao existe']); return; }

  const mesDaLinha = function (v) {
    return v instanceof Date
      ? Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM')
      : String(v || '').trim().slice(0, 7);
  };

  // --- o ANTES, guardado no relatorio antes de qualquer escrita
  const alvo = [];
  let antesTotal = 0;
  if (sheet.getLastRow() > 1) {
    const dados = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
    dados.forEach(function (l, i) {
      if (mesDaLinha(l[0]) !== mes) return;
      alvo.push(i + 2);
      antesTotal += Number(l[2]) || 0;
      antesPedidos += Number(l[3]) || 0;
      L.push('  ANTES  ' + String(l[1]) + ': R$ ' + (Number(l[2]) || 0).toFixed(2)
             + ' em ' + (l[3] || '?') + ' pedido(s)   [gravado ' + (l[4] || '?') + ']');
    });
  }

  L.unshift('');
  L.unshift('REFAZENDO ' + mes + ' - ' + alvo.length + ' linha(s) serao substituidas');
  L.unshift('');

  // --- o DEPOIS, calculado da aba Vendas
  const calc = agregarReceitaDeVendas_();
  const agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  const linhas = [];
  let depoisTotal = 0, pedidos = 0;
  Object.keys(calc).sort().forEach(function (k) {
    const r = calc[k];
    if (r.mes !== mes) return;
    linhas.push([r.mes, r.canal, r.valor, r.pedidos, agora]);
    depoisTotal += r.valor; pedidos += r.pedidos;
  });

  if (!linhas.length) {
    L.push('');
    L.push('A aba Vendas NAO tem venda nenhuma em ' + mes + '. Nao apaguei nada.');
    L.push('Rode syncVendas e tente de novo - apagar o que ha pra gravar vazio');
    L.push('seria trocar um numero errado por nenhum numero.');
    mostrarRelatorio_('Receita: refazer ' + mes, L);
    return;
  }

  /* ------------------------------------------------------------------------
   * TRAVA DE DADO QUE SUMIU (07/10/2026).
   *
   * POR QUE: a Karolyne avalia apagar pedidos antigos no Bling pra liberar
   * espaco. A aba Vendas e RECONSTRUIDA do zero a cada 2 horas, lendo o Bling
   * de 2026-01-01 pra frente - entao pedido apagado la some daqui sozinho. Se
   * alguem rodar esta funcao num mes antigo depois disso, ela grava quase zero
   * por cima de um numero bom, em silencio, e o jeito de perceber seria a DRE
   * do mes desabar sem motivo.
   *
   * A TRAVA OLHA A CONTAGEM DE PEDIDOS, nao so o valor. Valor pode cair por
   * motivo legitimo (devolucao, cancelamento tardio); contagem de pedidos de
   * um mes FECHADO so cai se o dado sumiu. Foi assim que setembro se denunciou
   * hoje pelo lado oposto: 197 pedidos gravados contra 671 reais.
   *
   * Nao bloqueia correcao pra CIMA - era esse o caso de setembro, e e o caso
   * normal de um mes preenchido pela metade.
   * --------------------------------------------------------------------- */
  if (!forcar && antesPedidos > 0) {
    const quedaPedidos = 1 - (pedidos / antesPedidos);
    const quedaValor = antesTotal > 0 ? 1 - (depoisTotal / antesTotal) : 0;
    if (quedaPedidos > 0.10 || quedaValor > 0.30) {
      L.push('');
      L.push('*** NAO APAGUEI NADA. O calculado esta MENOR que o gravado. ***');
      L.push('');
      L.push('   pedidos:  gravado ' + antesPedidos + '   calculado ' + pedidos
             + '   (' + (quedaPedidos * 100).toFixed(0) + '% a menos)');
      L.push('   valor  :  gravado ' + antesTotal.toFixed(2) + '   calculado '
             + depoisTotal.toFixed(2) + '   (' + (quedaValor * 100).toFixed(0) + '% a menos)');
      L.push('');
      L.push('Mes fechado nao perde pedido sozinho. As causas provaveis sao:');
      L.push('  1. pedidos antigos APAGADOS no Bling (a aba Vendas e refeita do');
      L.push('     zero a cada 2h lendo o Bling - o que sumiu la some aqui);');
      L.push('  2. o syncVendas falhou no meio e a aba esta incompleta;');
      L.push('  3. a janela do syncVendas (hoje 2026-01-01) passou na frente do mes.');
      L.push('');
      L.push('Confira a aba Vendas ANTES de insistir. Se o numero menor for');
      L.push('mesmo o certo: refazerReceitaMes("' + mes + '", true).');
      logSync_('refazerReceitaMes', 'bloqueado', mes + ': calculado menor que o gravado');
      mostrarRelatorio_('Receita: BLOQUEADO em ' + mes, L);
      return;
    }
  }

  // apaga de baixo pra cima
  alvo.sort(function (a, b) { return b - a; }).forEach(function (linha) {
    sheet.deleteRow(linha);
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, linhas.length, 5).setValues(linhas);
  recalcularDre_();

  L.push('');
  linhas.forEach(function (l) {
    L.push('  DEPOIS ' + l[1] + ': R$ ' + Number(l[2]).toFixed(2) + ' em ' + l[3] + ' pedido(s)');
  });
  L.push('');
  L.push('TOTAL ANTES ..: R$ ' + antesTotal.toFixed(2));
  L.push('TOTAL DEPOIS .: R$ ' + depoisTotal.toFixed(2) + '  (' + pedidos + ' pedidos)');
  L.push('DIFERENCA ....: R$ ' + (depoisTotal - antesTotal).toFixed(2));
  L.push('');
  L.push('A DRE de ' + mes + ' foi recalculada. A receita sobe nesse valor.');
  L.push('');
  L.push('O CMV de ' + mes + ' NAO mudou - _CMV_Consumo e outra aba e ainda nao');
  L.push('tem quem a escreva. Entao o lucro bruto do mes sobe junto com a');
  L.push('receita, e parte dessa melhora e custo que ainda falta aparecer.');
  L.push('');
  L.push('Se o numero novo nao convencer, as linhas ANTES estao ai em cima.');
  logSync_('refazerReceitaMes', 'ok', mes + ': ' + antesTotal.toFixed(2)
           + ' -> ' + depoisTotal.toFixed(2));
  mostrarRelatorio_('Receita: refazer ' + mes, L);
}

function refazerReceitaSetembro() { return refazerReceitaMes('2026-09'); }

function _rodarConferirReceita() { return conferirReceitaPedidos(); }
function gravarReceitaMesCorrente() {
  return gravarReceitaPedidos(Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM'));
}
