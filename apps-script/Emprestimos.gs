/**
 * Emprestimos.gs — separa JUROS de AMORTIZACAO nas parcelas do Sicoob.
 *
 * O PROBLEMA: ate 13/09/2026 o painel jogava a PARCELA INTEIRA em Resultado
 * Financeiro. Isso erra duas coisas ao mesmo tempo:
 *   - amortizacao nao e despesa. E troca de patrimonio: sai dinheiro, cai
 *     divida. Na DRE ela afunda o resultado por algo que nao e perda. Em
 *     agosto/2026 eram R$ 1.734,24 de R$ 3.115,90 - mais da metade.
 *   - e a divida nunca diminui no balanco, porque o abatimento virou despesa.
 *
 * O SEGUNDO PROBLEMA, que apareceu junto: as parcelas do contrato grande foram
 * cadastradas de uma vez no Bling e ficaram todas com a COMPETENCIA DO DIA DO
 * CADASTRO. A parcela de 03/08/2026 esta com competencia 03/02/2026 e a de
 * 03/09 com 03/03. Por competencia, agosto so enxergava os R$ 374,22 do
 * contrato pequeno. Por isso este modulo usa o VENCIMENTO da parcela, nao a
 * competencia gravada: para emprestimo, o mes da parcela e o mes do
 * vencimento, e nao ha ambiguidade nenhuma nisso.
 *
 * FONTE dos numeros: fichas graficas e extratos do Sicoob emitidos em
 * 08/09/2026, em EXTRATOS\SICOOB\EMPRESTIMOS. Conferidos contra o Bling.
 *
 *   contrato 3397194 - TABELA PRICE
 *     R$ 10.343,84 em 19/01/2024 | 45 x R$ 374,22 | ate 15/12/2027
 *     2,10% a.m. contratual, CET 2,26% a.m. (31,25% a.a.)
 *     saldo p/ quitacao em 08/09/2026: R$ 5.111,79
 *
 *   contrato 4376284 - SAC DECRESCENTE
 *     R$ 71.411,76 em 03/07/2025 | 54 parcelas | ate 03/07/2030
 *     1,75% a.m. contratual, CET 2,02% a.m. (27,57% a.a.)
 *     saldo p/ quitacao em 08/09/2026: R$ 67.701,11
 *     No SAC a amortizacao e CONSTANTE (R$ 1.467,51, conferido em duas
 *     parcelas da ficha), entao juros = parcela - 1.467,51 sempre.
 */

/** Grupo que recebe a amortizacao. Sai da DRE e fica visivel em "Fora do resultado". */
var GRUPO_AMORTIZACAO_ = 'Amortização de Dívida (ignorar na DRE)';

/** Categorias do Bling que carregam parcela de emprestimo. */
var CATEGORIAS_EMPRESTIMO_ = { '14674413185': 1, '14674413186': 1 };

/**
 * Juros de cada parcela, por mes de VENCIMENTO.
 * As do contrato Price ate 08/2026 foram reconstruidas de tras para frente a
 * partir do saldo de quitacao (a ficha so publica o juros das parcelas em
 * aberto); da parcela 30 em diante sao o numero da propria ficha.
 * As do SAC saem de parcela - 1.467,51.
 */
var JUROS_POR_MES_ = {
  // mes: [juros do SAC 4376284, juros do Price 3397194]
  '2026-01': [null,    141.99],
  '2026-02': [1620.28, 137.35],
  '2026-03': [null,    132.62],
  '2026-04': [null,    127.79],
  '2026-05': [null,    122.86],
  '2026-06': [null,    117.84],
  '2026-07': [null,    112.72],
  '2026-08': [1274.17, 107.49],
  '2026-09': [1269.64, 102.16],
  '2026-10': [1260.84, 100.01],
  '2026-11': [1116.82, 100.60],
  '2026-12': [1129.99,  85.52]
};

/** Amortizacao constante do contrato SAC. */
var AMORTIZACAO_SAC_ = 1467.51;
/** Valor da parcela do contrato Price. */
var PARCELA_PRICE_ = 374.22;

/**
 * Dado um lancamento de emprestimo, devolve quanto e juros e quanto e
 * amortizacao. Devolve null quando a categoria nao e de emprestimo, ou quando
 * nao ha juros conhecido para aquele mes - e nesse caso o chamador mantem o
 * comportamento antigo (parcela inteira em Resultado Financeiro), que e errado
 * mas e melhor do que sumir com o valor.
 *
 * @param {string} categoriaId
 * @param {Date|string} vencimento  a data da parcela (NAO a competencia gravada)
 * @param {number} valor            valor da parcela, positivo
 * @return {?{juros:number, amortizacao:number}}
 */
function fatiarEmprestimo_(categoriaId, vencimento, valor) {
  if (!CATEGORIAS_EMPRESTIMO_[String(categoriaId).trim()]) return null;
  if (!vencimento) return null;
  var mes = Utilities.formatDate(new Date(vencimento), 'America/Sao_Paulo', 'yyyy-MM');
  var linha = JUROS_POR_MES_[mes];
  if (!linha) return null;

  var v = Math.abs(Number(valor) || 0);
  // qual dos dois contratos e esta parcela? O Price e sempre R$ 374,22; o SAC
  // e tudo o mais. Usar o valor e mais confiavel do que o dia do vencimento,
  // que escorrega para dia util.
  var ehPrice = Math.abs(v - PARCELA_PRICE_) < 1.00;
  var juros = ehPrice ? linha[1] : linha[0];
  if (juros === null || juros === undefined) return null;
  if (juros > v) return null;               // desconfia em vez de inventar
  return { juros: juros, amortizacao: v - juros };
}

/**
 * Confere a separacao mes a mes e imprime. Nao altera nada - serve para olhar
 * o efeito antes e depois de mexer na DRE.
 */
function conferirEmprestimos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var fluxo = ss.getSheetByName(ABA_FLUXO_CAIXA);
  var ult = fluxo.getLastRow();
  if (ult < 2) { Logger.log('Fluxo de Caixa vazio.'); return; }
  var nCols = Math.max(fluxo.getLastColumn(), 15);
  var dados = fluxo.getRange(2, 1, ult - 1, nCols).getValues();

  var porMes = {}, semRegra = [];
  dados.forEach(function (l) {
    var catId = String(l[3] || '').trim();
    if (!CATEGORIAS_EMPRESTIMO_[catId]) return;
    var venc = l[0];
    var valor = Number(l[11]) || 0;
    var f = fatiarEmprestimo_(catId, venc, valor);
    var mes = venc ? Utilities.formatDate(new Date(venc), 'America/Sao_Paulo', 'yyyy-MM') : '?';
    if (!f) { semRegra.push(mes + '  R$ ' + valor); return; }
    porMes[mes] = porMes[mes] || { parcela: 0, juros: 0, amort: 0 };
    porMes[mes].parcela += Math.abs(valor);
    porMes[mes].juros += f.juros;
    porMes[mes].amort += f.amortizacao;
  });

  var linhas = ['mes        parcela      juros   amortizacao'];
  Object.keys(porMes).sort().forEach(function (m) {
    var p = porMes[m];
    linhas.push(m + '  ' + p.parcela.toFixed(2) + '   ' + p.juros.toFixed(2) +
                '   ' + p.amort.toFixed(2));
  });
  if (semRegra.length) {
    linhas.push('');
    linhas.push('SEM REGRA (' + semRegra.length + ') - seguem inteiras em Resultado Financeiro:');
    semRegra.forEach(function (s) { linhas.push('  ' + s); });
  }
  Logger.log(linhas.join('\n'));
  return linhas.join('\n');
}
