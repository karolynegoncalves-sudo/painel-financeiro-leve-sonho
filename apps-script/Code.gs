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
    case 'precificacao': return jsonResponse_({ email: email, canais: getPrecificacaoResumo_() });
    case 'kpis': return jsonResponse_({ email: email, kpis: getKpis_() });
    default: return jsonResponse_({ error: 'unknown_view' });
  }
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Painel Financeiro')
    .addItem('Sincronizar Bling agora', 'syncBling')
    .addItem('Instalar sincronização automática (2h)', 'criarGatilhoSync')
    .addSeparator()
    .addItem('1) Configurar setup da planilha', 'setupWorkbook')
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
  rows.forEach(([mes, grupo, valor]) => {
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
