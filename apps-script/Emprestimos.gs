/**
 * Emprestimos.gs — separa JUROS de AMORTIZACAO nas parcelas do Sicoob.
 *
 * O PROBLEMA: ate 13/09/2026 o painel jogava a PARCELA INTEIRA em Resultado
 * Financeiro. Isso erra duas coisas ao mesmo tempo:
 *   - amortizacao nao e despesa. E troca de patrimonio: sai dinheiro, cai
 *     divida. Na DRE ela afunda o resultado por algo que nao e perda. Em
 *     agosto/2026 sao R$ 1.729,71 de R$ 3.111,37 - mais da metade.
 *   - e a divida nunca diminui no balanco, porque o abatimento virou despesa.
 *
 * O SEGUNDO PROBLEMA: as parcelas do contrato grande foram cadastradas de uma
 * vez no Bling e ficaram com a COMPETENCIA DO DIA DO CADASTRO. A de 03/08/2026
 * esta com competencia 03/02/2026. Por isso este modulo usa o VENCIMENTO, nao a
 * competencia gravada: para emprestimo, o mes da parcela e o mes do vencimento.
 *
 * FONTE: fichas graficas e extratos do Sicoob emitidos em 08/09/2026, em
 * EXTRATOS\SICOOB\EMPRESTIMOS.
 *
 *   contrato 3397194 - TABELA PRICE
 *     R$ 10.343,84 em 19/01/2024 | 45 x R$ 374,22 | 15/04/2024 a 15/12/2027
 *     2,10% a.m. contratual, CET 2,26% a.m. (31,25% a.a.)
 *     saldo p/ quitacao em 08/09/2026: R$ 5.111,79
 *
 *   contrato 4376284 - SAC DECRESCENTE
 *     R$ 71.411,76 em 03/07/2025 | 54 parcelas | 30/12/2025 a 03/07/2030
 *     1,75% a.m. contratual, CET 2,02% a.m. (27,57% a.a.)
 *     saldo p/ quitacao em 08/09/2026: R$ 67.701,11
 *
 * POR QUE O SAC NAO TEM TABELA, e o Price tem:
 *   No SAC a AMORTIZACAO E CONSTANTE - R$ 1.467,51, conferido em duas parcelas
 *   da ficha (2.728,35-1.260,84 e 2.584,33-1.116,82). Entao basta subtrair:
 *   vale para qualquer parcela, passada ou futura, sem tabela nenhuma. Isso
 *   tambem imuniza contra um problema que o conferirEmprestimos revelou em
 *   14/09/2026: a planilha guarda o valor PROVISIONADO da parcela, nao o pago
 *   (agosto esta com 2.737,15 quando o Bling pagou 2.741,68). Com amortizacao
 *   fixa, a diferenca cai no juros, que e onde ela pertence - era o contrario
 *   na primeira versao, que tabelava o juros e deixava a amortizacao absorver
 *   o erro.
 *   No Price a parcela e fixa (R$ 374,22) e o juros varia, entao ali a tabela
 *   e inevitavel.
 */

/** Grupo que recebe a amortizacao. Sai da DRE e fica visivel em "Fora do resultado". */
var GRUPO_AMORTIZACAO_ = 'Amortização de Dívida (ignorar na DRE)';

/** Categorias do Bling que carregam parcela de emprestimo. */
var CATEGORIAS_EMPRESTIMO_ = { '14674413185': 1, '14674413186': 1 };

/**
 * MUTUO DO SOCIO - a UNICA parcela de 2025 que e emprestimo do Vinicius.
 *
 * HISTORIA DESTE BLOCO, porque ele ja esteve errado: em 14/09/2026 eu inferi
 * que as SEIS parcelas que sobravam em "sem regra" eram devolucao de um
 * emprestimo do socio para a reforma, e montei a tabela com as seis. Ao puxar
 * TODAS as contas do contato "Vinicius Negrao de Oliveira" (16095855208), cinco
 * delas nao existem na lista dele - nao sao do Vinicius. A inferencia estava
 * errada; so a de R$ 2.583,00 de 21/03/2025 e dele, e o historico dela diz
 * "Emprestimo Pijamas": capital de giro para comprar mercadoria, nao obra.
 *
 * O TRATAMENTO, porem, e o mesmo e continua certo: emprestimo de socio sem
 * juros nao tem despesa. Devolver e BAIXA DE PASSIVO - sai dinheiro, cai a
 * divida com o socio, o resultado nao e tocado. Por isso 100% amortizacao.
 *
 * A REFORMA NAO ENTRA AQUI e nao precisa de lancamento: ela ja esta nos livros
 * como R$ 5.100,00 em quatro parcelas de jan a abr/2026 (R$ 1.200 x3 + R$ 1.500),
 * na categoria propria 14639321675 "Reforma". Lancar de novo dobraria o custo.
 */
var MUTUO_SOCIO_ = {
  '2025-03': [2583.00]
};

/** Contrato 4376284 (SAC): amortizacao constante. */
var AMORTIZACAO_SAC_ = 1467.51;
/** Contrato 3397194 (Price): parcela fixa. */
var PARCELA_PRICE_ = 374.22;

/**
 * Juros de cada parcela do PRICE, por mes de vencimento (parcela 1 = 04/2024,
 * parcela 45 = 12/2027).
 *
 * De 09/2026 em diante sao os numeros PUBLICADOS na ficha. Os anteriores foram
 * reconstruidos andando de tras para frente a partir do saldo de quitacao
 * (R$ 5.111,79 apos a parcela 29) com a taxa que a propria ficha aplica:
 * 102,16 / 5.111,79 = 1,999% a.m.
 *
 * ATENCAO: a reconstrucao supoe taxa mensal constante, e o banco varia com o
 * numero de dias do mes. A soma dos juros da R$ 5.861,29 contra R$ 5.606,16 da
 * ficha - 4,5% para cima. Ou seja: 2024 e 2025 aqui sao ESTIMATIVA boa, nao
 * numero de banco. Para 2026 e 2027, que e o que a DRE usa hoje, os valores
 * sao os da ficha ou vizinhos dela.
 */
var JUROS_PRICE_ = {
  '2024-04': 220.96, '2024-05': 217.89, '2024-06': 214.77, '2024-07': 211.58,
  '2024-08': 208.33, '2024-09': 205.02, '2024-10': 201.63, '2024-11': 198.18,
  '2024-12': 194.67,
  '2025-01': 191.08, '2025-02': 187.42, '2025-03': 183.68, '2025-04': 179.88,
  '2025-05': 175.99, '2025-06': 172.03, '2025-07': 167.99, '2025-08': 163.87,
  '2025-09': 159.67, '2025-10': 155.38, '2025-11': 151.00, '2025-12': 146.54,
  '2026-01': 141.99, '2026-02': 137.35, '2026-03': 132.62, '2026-04': 127.79,
  '2026-05': 122.86, '2026-06': 117.84, '2026-07': 112.72, '2026-08': 107.49,
  '2026-09': 102.16, '2026-10': 100.01, '2026-11': 100.60, '2026-12': 85.52,
  '2027-01': 85.22, '2027-02': 78.94, '2027-03': 65.45, '2027-04': 65.83,
  '2027-05': 61.07, '2027-06': 48.93, '2027-07': 43.80, '2027-08': 39.35,
  '2027-09': 29.83, '2027-10': 22.60, '2027-11': 16.24, '2027-12': 7.52
};

/**
 * Dado um lancamento de emprestimo, devolve quanto e juros e quanto e
 * amortizacao. Devolve null quando nao reconhece a operacao - e nesse caso o
 * chamador mantem o comportamento antigo (parcela inteira em Resultado
 * Financeiro), errado mas melhor do que sumir com o valor. O
 * conferirEmprestimos lista esses casos.
 *
 * @param {string} categoriaId
 * @param {Date|string} vencimento  a data da parcela (NAO a competencia gravada)
 * @param {number} valor            valor da parcela
 * @return {?{juros:number, amortizacao:number, contrato:string}}
 */
function fatiarEmprestimo_(categoriaId, vencimento, valor) {
  if (!CATEGORIAS_EMPRESTIMO_[String(categoriaId).trim()]) return null;
  if (!vencimento) return null;
  var v = Math.abs(Number(valor) || 0);
  if (!v) return null;

  var mesRef = Utilities.formatDate(new Date(vencimento), 'America/Sao_Paulo', 'yyyy-MM');

  // MUTUO DO SOCIO: 100% amortizacao, zero juros. Ver MUTUO_SOCIO_.
  var lista = MUTUO_SOCIO_[mesRef];
  if (lista) {
    for (var i = 0; i < lista.length; i++) {
      if (Math.abs(v - lista[i]) < 0.05) {
        return { juros: 0, amortizacao: v, contrato: 'mutuo-vinicius' };
      }
    }
  }

  // PRICE: parcela fixa de R$ 374,22. A tolerancia de R$ 1,00 cobre
  // arredondamento, nao confunde com nada - a outra parcela e 7x maior.
  if (Math.abs(v - PARCELA_PRICE_) < 1.00) {
    var j = JUROS_PRICE_[mesRef];
    if (j === undefined || j > v) return null;
    return { juros: j, amortizacao: v - j, contrato: '3397194' };
  }

  // SAC: amortizacao constante, juros e o resto.
  //
  // A GUARDA DE DATA e obrigatoria, nao cosmetica: sem ela, uma parcela de
  // R$ 2.583,00 de MARCO/2025 era classificada como SAC, e o SAC so passou a
  // ser pago em 30/12/2025 (contratado em 03/07/2025, com carencia). Pegar
  // uma operacao antiga como se fosse esta inventa juros de R$ 1.115,49 num
  // contrato que ainda nao existia.
  //
  // O piso de valor tambem fica, para as parcelas de R$ 1.159,22 e R$ 1.447,30
  // de 2025, que nao sao de nenhum dos dois contratos: ficam em "sem regra" de
  // proposito, ate sabermos de que operacao sao.
  var SAC_PRIMEIRA = '2025-12', SAC_ULTIMA = '2030-07';
  if (mesRef >= SAC_PRIMEIRA && mesRef <= SAC_ULTIMA &&
      v >= 2000 && v > AMORTIZACAO_SAC_) {
    return { juros: v - AMORTIZACAO_SAC_, amortizacao: AMORTIZACAO_SAC_,
             contrato: '4376284' };
  }
  return null;
}

/**
 * Confere a separacao mes a mes e imprime. Nao altera nada - serve para olhar
 * o efeito antes e depois de mexer na DRE, e para listar o que ficou sem regra.
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
    var mes = venc ? Utilities.formatDate(new Date(venc), 'America/Sao_Paulo', 'yyyy-MM') : '?';
    var f = fatiarEmprestimo_(catId, venc, valor);
    if (!f) {
      // mostra o historico e o id da conta: foi inferindo sem isso que eu
      // errei em 14/09/2026, atribuindo ao socio cinco parcelas que nao eram
      // dele. Adivinhar pela data e pelo valor nao serve.
      var desc = [l[8], l[9], l[10]].filter(function (x) { return x; }).join(' ');
      semRegra.push(mes + '  R$ ' + Math.abs(valor).toFixed(2)
                    + '  ' + String(l[13] || '') + ':' + String(l[12] || '')
                    + '  ' + String(desc).slice(0, 70));
      return;
    }
    porMes[mes] = porMes[mes] || { parcela: 0, juros: 0, amort: 0, quais: {} };
    porMes[mes].parcela += Math.abs(valor);
    porMes[mes].juros += f.juros;
    porMes[mes].amort += f.amortizacao;
    porMes[mes].quais[f.contrato] = 1;
  });

  var out = ['mes         parcela      juros  amortizacao  contratos'];
  var tj = 0, ta = 0;
  Object.keys(porMes).sort().forEach(function (m) {
    var p = porMes[m];
    tj += p.juros; ta += p.amort;
    out.push(m + '   ' + p.parcela.toFixed(2) + '   ' + p.juros.toFixed(2) +
             '   ' + p.amort.toFixed(2) + '   ' + Object.keys(p.quais).sort().join('+'));
  });
  out.push('');
  out.push('TOTAL reconhecido: juros ' + tj.toFixed(2) + ' | amortizacao ' + ta.toFixed(2));
  if (semRegra.length) {
    out.push('');
    out.push('SEM REGRA (' + semRegra.length + ') - seguem inteiras em Resultado Financeiro:');
    semRegra.sort().forEach(function (s) { out.push('  ' + s); });
  }
  Logger.log(out.join('\n'));
  return out.join('\n');
}
