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
  24: 'Verificado'
};
const SITUACOES_NAO_CONTAM = [12];

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
      const url = 'https://www.bling.com.br/Api/v3/pedidos/vendas'
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
