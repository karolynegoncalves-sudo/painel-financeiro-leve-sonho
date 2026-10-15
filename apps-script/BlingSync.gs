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

/* Nomes das duas abas que alimentam a DRE por competencia. Declarados AQUI, e
   nao lidos do Setup.gs, de proposito: `recalcularDre_` roda dentro do
   syncBling a cada duas horas, e uma constante vinda de outro arquivo faz a
   DRE inteira estourar com ReferenceError se aquele arquivo estiver atrasado
   no projeto. Aconteceu em 10/09/2026. O valor e o mesmo do Setup.gs. */
const ABA_RECEITA_PEDIDOS_ = '_Receita_Pedidos';
const ABA_CMV_CONSUMO_ = '_CMV_Consumo';

/**
 * PROVISAO DE SIMPLES SOBRE A VENDA QUE NAO VAI PARA NOTA.
 *
 * Medido em 14/09/2026 contra o extrato do PGDAS-D e as guias do Simples: a
 * receita DECLARADA a Receita Federal e 18% menor que a do painel. Sao
 * R$ 71.600 em seis meses (jan a jun/2026). Mes a mes:
 *
 *   mes   painel    declarado   gap
 *   jan   64.567    36.997      27.570
 *   fev   68.080    53.008      15.072
 *   mar   84.716    74.180      10.537
 *   abr   74.159    62.433      11.726
 *   mai   54.917    54.250         667
 *   jun   45.212    39.182       6.030
 *
 * O gap E A VENDA DO SITE: a Nuvemshop somou R$ 64.206 no mesmo semestre, ou
 * seja 90% do gap. Mes a mes oscila porque o painel conta pela data do PEDIDO
 * e o DAS pela NOTA; no semestre fecha, e e o semestre que vale.
 *
 * POR QUE PROVISIONAR: o imposto e devido sobre a venda, nao sobre a nota. Se
 * o dinheiro entrou, a obrigacao existe. Uma DRE que mostra o site com 2% de
 * taxa contra 21,8% da Shopee esta dizendo que o site e o canal mais rentavel
 * - e parte dessa vantagem e imposto nao recolhido, nao eficiencia. Precificar
 * em cima disso e precificar em cima de uma margem que nao existe.
 *
 * A provisao entra em GRUPO PROPRIO, nao somada dentro das Deducoes. Ela e uma
 * estimativa, e estimativa misturada com numero de guia deixa de ser
 * auditavel. Em linha separada da para ver os dois e discordar de um.
 *
 * NAO ENTRA NA DFC de proposito: provisao nao move caixa. E como nao e conta,
 * nem chega la - a DFC e montada a partir das contas, nao desta aba.
 */
var GRUPO_PROVISAO_IMPOSTO_ = 'Provisão de Imposto (venda sem nota)';

/**
 * PROVISAO DE SIMPLES SOBRE A VENDA DO SITE, QUE NAO EMITE NOTA DE TUDO.
 *
 * LIGADO, DESLIGADO E RELIGADO em 14/09/2026. O vaivem esta registrado porque
 * o motivo de cada passo importa mais que a conclusao.
 *
 * MEDICAO: a receita declarada e 18% menor que a do painel - R$ 71.600 em
 * jan-jun/2026 (painel 391.651, declarado 320.051). No mesmo semestre a
 * Nuvemshop vendeu R$ 64.206, ou 90% do gap. E a NF emitida bate com o
 * declarado quase ao centavo (jan: R$ 70 de diferenca em R$ 37 mil), entao o
 * descolamento nao esta entre nota e declaracao - esta entre VENDA e NOTA.
 *
 * POR QUE EU DESLIGUEI E ESTAVA ERRADO: o gap de maio foi de R$ 667 enquanto a
 * Nuvemshop vendeu R$ 7.099, e eu tratei isso como refutacao. Nao e. A NF e
 * contada pela data de EMISSAO e o painel pela data do PEDIDO, entao um mes em
 * que se emitiu nota de pedido do mes anterior fecha o gap daquele mes e abre
 * no outro. O teste de um mes nao derruba um padrao que fecha em 90% no
 * semestre - e o semestre e o que vale.
 *
 * O QUE RESOLVEU: a Karolyne confirmou direto - "a gente vende no site sem
 * emitir NF de tudo mesmo, o faturamento sempre da mais que as notas fiscais".
 * Quem opera sabe o que faz, e a medicao concorda com ela.
 *
 * LICAO, que e a parte que vale guardar: eu tinha a conclusao certa, aceitei
 * uma refutacao de um unico mes e inverti. Um contraexemplo mensal num dado
 * que tem defasagem de emissao nao e contraexemplo - e ruido esperado.
 *
 * O QUE ISSO SIGNIFICA, e nao e pequeno: o imposto e devido sobre a VENDA, nao
 * sobre a nota. Se o dinheiro entrou, a obrigacao existe. Sao ~R$ 4.957 em
 * jan-jun e ~R$ 9.900 no ritmo de doze meses. E uma DRE que mostra o site com
 * 2,1% de taxa contra 21,8% da Shopee esta dizendo que o site e o canal mais
 * rentavel, quando metade dessa vantagem e imposto nao recolhido. Precificar
 * em cima disso e precificar em cima de margem que nao existe.
 *
 * A provisao entra em GRUPO PROPRIO, nao somada nas Deducoes: ela e estimativa,
 * e estimativa misturada com numero de guia deixa de ser auditavel.
 *
 * O QUE AINDA FALTA MEDIR: o consolidado de NFe tem aba "Mes x canal (valor)".
 * Cruzar canal a canal diz se o gap e TODO da Nuvemshop ou se ha pedido-clone
 * misturado - ha precedente de clone que inflou julho em 72%. Se for so o site,
 * esta tudo certo aqui; se houver clone, a receita do painel tambem precisa de
 * conserto e a provisao cai junto.
 */
var CANAIS_SEM_NOTA_ = { 'Nuvemshop': 1 };

/* ----------------------------------------------------------------------------
 * canalSemNota_(canal) - o canal emite nota?
 *
 * EXISTE POR CAUSA DE UM ERRO MEU, em 07/10/2026. A busca era por chave
 * EXATA: `CANAIS_SEM_NOTA_[canal.trim()]`. Quando refiz setembro na
 * _Receita_Pedidos, o canal passou a se chamar "Site (Nuvemshop)" (nome que o
 * syncVendas usa) em vez de "Nuvemshop" (nome que estava na aba, preenchida a
 * mao). A chave deixou de casar e a PROVISAO de setembro e outubro virou
 * zero, calada.
 *
 * Eu tinha dito a ela que a troca de nome era cosmetica "porque a DRE soma por
 * mes e ignora o canal". Era verdade para a DRE e falso para isto aqui - este
 * pedaco le o canal. Uma unica contra-exceção derruba um "ignora".
 *
 * O resultado nao muda (a provisao fica fora dele por decisao dela em
 * 15/09), mas o numero do RISCO some da tela - e ela tirou a provisao do
 * resultado justamente pra mante-la visivel. Risco que sai da tela deixa de
 * ser conhecido, que e pior que risco no lugar errado.
 *
 * Agora casa por CONTEUDO, sem acento e sem caixa: "Nuvemshop", "Site
 * (Nuvemshop)" e o que vier depois batem igual. O mapa continua sendo a fonte
 * de QUAIS canais nao emitem nota - muda so o jeito de reconhece-los.
 * -------------------------------------------------------------------------- */
function canalSemNota_(canal) {
  var c = String(canal || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  if (!c) return false;
  return Object.keys(CANAIS_SEM_NOTA_).some(function (k) {
    var n = String(k).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
    return n && c.indexOf(n) >= 0;
  });
}

/**
 * Aliquota efetiva do Simples, medida nas seis guias de 2026 sobre a receita
 * DECLARADA (nao sobre a do painel - foi esse o meu erro inicial):
 *   jan 7,61% | fev 7,62% | mar 7,69% | abr 7,80% | mai 7,81% | jun 7,81%
 * Estavel. A media ponderada da 7,72%.
 *
 * Ela sobe conforme o RBT12 sobe, entao revisar quando o faturamento mudar de
 * faixa. RBT12 declarado em 06/2026: R$ 633.110,36.
 *
 * CUIDADO AO COMPARAR: os seis numeros acima foram medidos sobre a receita
 * DECLARADA. O conferirImposto mede sobre a base do painel (receita da
 * _Receita_Pedidos menos a venda do site), que e uma APROXIMACAO da
 * declarada. Sao duas reguas: a guia de agosto da 8,01% na regua do painel,
 * e isso nao quer dizer que ela daria 8,01% na regua declarada. Comparar
 * sempre dentro da mesma coluna do conferirImposto.
 */
var ALIQUOTA_SIMPLES_ = 0.0772;

/**
 * IMPOSTO DO SIMPLES POR COMPETENCIA - a linha vem da GUIA, nao da conta.
 *
 * O PROBLEMA QUE ISSO RESOLVE, e sao quatro ao mesmo tempo:
 *
 *  1. o DAS era lancado com competencia no MES DO PAGAMENTO. Abril caia em
 *     maio, maio em junho, julho em agosto. Tres meses errados de uma vez.
 *  2. jan, fev, mar e jun NAO tinham DAS lancado em lugar nenhum - jan a mar
 *     porque foram parcelados, jun sem motivo aparente.
 *  3. as PARCELAS dos dois parcelamentos (R$ 483,51 do Simples e R$ 521,27 do
 *     ICMS) estavam dentro das Deducoes. Parcela de parcelamento e amortizacao
 *     de divida, nao despesa do mes: contando as duas coisas, o mesmo imposto
 *     entra duas vezes.
 *  4. havia uma PROVISAO RECORRENTE de R$ 4.867,34 - o valor do DAS de abril,
 *     repetido mes a mes de 09/2026 ate 08/2027 - sem guia que a lastreie.
 *
 * A SOLUCAO: a DRE deixa de somar a categoria "Impostos sobre vendas" e passa
 * a calcular o imposto a partir desta tabela, que e a das GUIAS do Simples. A
 * categoria sai da DRE e vai para um grupo visivel em "Fora do resultado",
 * onde continua mostrando o que foi PAGO - que e informacao de caixa, e no
 * caixa ela pertence.
 *
 * Com isso os quatro problemas somem juntos, sem apagar nem criar conta
 * nenhuma no Bling.
 *
 * FONTE: guias e recibo de parcelamento em EXTRATOS...\Impostos, lidos em
 * 14/09/2026. Os valores de 10/2025 a 03/2026 vem do recibo de adesao ao
 * parcelamento (saldo devedor ORIGINAL, sem multa e juros - encargo de mora e
 * despesa financeira, nao imposto sobre venda).
 */
var GRUPO_IMPOSTO_SIMPLES_ = 'Imposto do Simples (competência)';

var DAS_POR_COMPETENCIA_ = {
  '2025-10': 3886.75, '2025-11': 3164.91, '2025-12': 3874.66,
  '2026-01': 2813.74, '2026-02': 4036.83, '2026-03': 5704.90,
  '2026-04': 4867.34, '2026-05': 4236.31, '2026-06': 3060.45,
  // julho: guia 07.20.26239.9819789-5, lida em 14/09/2026. O TOTAL e R$ 4.580,21
  // mas so R$ 4.419,77 e imposto - os outros R$ 160,44 sao JUROS DE MORA,
  // porque a guia foi gerada em 27/08, depois do vencimento de 20/08. Juros de
  // mora e despesa financeira, nao imposto sobre venda: entra em
  // JUROS_MORA_IMPOSTO_ e vai para Resultado Financeiro.
  //
  // (minha estimativa anterior era 4.580,21 e acertou o total por acidente -
  //  eu tinha pego o valor da CONTA no Bling, que traz o total da guia.)
  '2026-07': 4419.77,
  // agosto: GUIA 07.20.26258.4983251-0, lida em 07/10/2026. Venceu em 21/09
  // porque o dia 20 caiu num domingo - ou seja, nao foi gerada em atraso e o
  // total NAO tem juros de mora (ao contrario de julho).
  '2026-08': 3993.05,
  /* setembro: ESTIMADO, com a receita JA CORRIGIDA de 07/10 (o mes estava
     pela metade na _Receita_Pedidos ate hoje).

        67.554,29 - 9.623,69 (site) = 57.930,60  x  7,76%  =  4.496,75

     OS 7,76% SAO A RAZAO AGREGADA, e isso importa: e a soma das oito guias
     dividida pela soma das oito bases, nao a aliquota de um mes. Eu cheguei a
     gravar aqui 4.639,31, estimado pelos 8,01% que a guia de agosto deu
     sozinha, dizendo que a aliquota tinha subido. Estava errado.

     A serie jan-ago na base do painel e: 5,83 | 7,04 | 8,01 | 7,76 | 8,86 |
     7,65 | 8,92 | 8,01. Tres pontos de amplitude. A aliquota do Simples
     SOBE DEVAGAR com o RBT12 e nao consegue pular de 8,86 pra 7,65 pra 8,92
     em tres meses - entao o que balanca nao e a aliquota, e a minha BASE.

     De onde vem o balanco: a base declarada e por NOTA EMITIDA e a minha e
     por DATA DO PEDIDO. Pedido que vira nota no mes seguinte sai de um mes e
     entra no outro. Medindo contra uma aliquota plana de 7,8%, o erro da
     base vai de +12.200 (jan) a -7.133 (jul) e soma so +2.063 em oito meses:
     erra para os dois lados e quase zera no agregado. Por isso a razao
     agregada presta e o mes solto nao presta.

     A estimativa de setembro carrega +-R$ 250 de incerteza por causa disso.
     Nao vale continuar calibrando: a guia sai dia 20/10 e troca o numero. */
  '2026-09': 4496.75
};

/* ----------------------------------------------------------------------------
 * QUAIS COMPETENCIAS SAO ESTIMATIVA, e nao guia lida.
 *
 * POR QUE VIROU DADO (07/10/2026): agosto estava estimado desde setembro e a
 * unica marca disso era um COMENTARIO no codigo. Na tela, estimativa e guia
 * sao o mesmo numero preto - a Karolyne nao sabia que agosto nao tinha guia, e
 * pediu setembro "so pra nao sujar dado", que e exatamente o risco que o
 * comentario nao cobre.
 *
 * Comentario avisa quem le o codigo. Quem olha a DRE nao le o codigo.
 *
 * Com a lista, "qual imposto e chute?" tem resposta de um clique
 * (verImpostoEstimado) em vez de depender de alguem lembrar.
 *
 * O MAPA NAO FICA AQUI: ele ja existia desde 36bb04b, logo abaixo do
 * JUROS_MORA_IMPOSTO_. Eu declarei um SEGUNDO neste ponto em 07/10/2026 sem
 * procurar pelo primeiro, e como `var` no escopo global do Apps Script deixa
 * a ULTIMA declaracao vencer, o antigo (que vem depois no arquivo)
 * sobrescrevia o meu - setembro aparecia como "guia" mesmo eu tendo marcado
 * como estimativa. Nenhum erro, so o valor errado.
 * Ver a memoria apps-script-nome-duplicado-sombreia: eu tinha essa armadilha
 * anotada e nao a apliquei. Procurar o nome ANTES de declarar e barato.
 * -------------------------------------------------------------------------- */

/* ============================================================================
 * conferirImposto() - a aliquota de 7,72% ainda vale?
 *
 * PEDIDO DELA EM 07/10/2026: "o DAS sempre vence dia 20, coloca uma rotina pra
 * validar o valor do imposto todo dia 20".
 *
 * Lembrete avisa que FALTA a guia. Isso tambem, mas a pergunta que decide
 * dinheiro e outra: a aliquota que a gente usa pra estimar ainda acompanha a
 * realidade? Ela SOBE conforme o faturamento dos 12 meses sobe, e uma
 * aliquota velha subestima imposto todo mes, calada.
 *
 * Da pra medir sem pedir nada a ninguem: para cada competencia que JA TEM
 * guia, calcular o que a formula teria estimado e comparar. A aliquota
 * implicita de cada mes (guia / base) e o numero que importa - se ela estiver
 * andando pra cima, o 7,72% precisa subir junto.
 *
 * A base NAO e a receita do painel: e a receita MENOS a venda do site, que
 * nao entra na base declarada. Foi esse o meu erro inicial em setembro, e por
 * isso a aliquota media que eu tinha calculado saia baixa demais.
 * ========================================================================== */
function conferirImposto() {
  var r = _relatorioImposto_();
  mostrarRelatorio_('Imposto: a aliquota ainda vale?', r.linhas);
}

/**
 * Monta o relatorio e NAO mostra nada. Separado do conferirImposto de
 * proposito: o gatilho do dia 20 roda sem navegador aberto, e la o
 * SpreadsheetApp.getUi() nao existe - mostrarRelatorio_ quebraria a execucao
 * inteira. Uma montagem so, dois jeitos de entregar.
 *
 * Devolve { linhas, pendencia }. `pendencia` e vazia quando nao ha nada
 * vencendo; e o que o assunto do e-mail usa.
 */
function _relatorioImposto_() {
  var L = [];
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_RECEITA_PEDIDOS_);
  if (!sh || sh.getLastRow() < 2) {
    return { linhas: ['_Receita_Pedidos vazia - sem base pra conferir'],
             pendencia: 'a _Receita_Pedidos esta vazia' };
  }
  var mesDe = function (v) {
    return v instanceof Date
      ? Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM')
      : String(v || '').trim().slice(0, 7);
  };

  var rec = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (l) {
    var m = mesDe(l[0]); if (!m) return;
    if (!rec[m]) rec[m] = { total: 0, site: 0 };
    var v = Math.abs(Number(l[2]) || 0);
    rec[m].total += v;
    if (canalSemNota_(l[1])) rec[m].site += v;
  });

  // ---- o aviso do dia 20, primeiro, porque e o que tem prazo
  var pendencia = '';
  var hoje = new Date();
  var dia = Number(Utilities.formatDate(hoje, 'America/Sao_Paulo', 'dd'));
  var compVencendo = Utilities.formatDate(
    new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1), 'America/Sao_Paulo', 'yyyy-MM');
  var faltaGuia = !DAS_POR_COMPETENCIA_[compVencendo] || !!DAS_ESTIMADO_[compVencendo];

  if (faltaGuia) {
    pendencia = 'a guia de ' + compVencendo + ' ' +
                (DAS_POR_COMPETENCIA_[compVencendo] ? 'ainda e estimativa' : 'nao esta lancada');
    L.push('>>> A guia de ' + compVencendo + ' ' +
           (DAS_POR_COMPETENCIA_[compVencendo] ? 'ainda e ESTIMATIVA.' : 'NAO esta lancada.'));
    L.push('    Vence dia 20 de ' + Utilities.formatDate(hoje, 'America/Sao_Paulo', 'MM/yyyy')
           + (dia >= 20 ? '  - JA VENCEU OU VENCE HOJE.' : '  - faltam ' + (20 - dia) + ' dia(s).'));
    L.push('');
  } else {
    L.push('A guia de ' + compVencendo + ' ja esta lancada. Nada vencendo.');
    L.push('');
  }

  // ---- a aliquota implicita, mes a mes
  L.push('A ALIQUOTA AINDA VALE? (guia dividida pela base declarada)');
  L.push('');
  L.push('comp     |     receita |      - site |        base |       guia | aliq. | ');
  var somaAliq = 0, nAliq = 0, somaGuia = 0, somaBase = 0, minA = 9, maxA = 0;
  Object.keys(DAS_POR_COMPETENCIA_).sort().forEach(function (m) {
    var r = rec[m];
    if (!r) { L.push('  ' + m + '  | (sem receita na _Receita_Pedidos)'); return; }
    var base = r.total - r.site;
    var guia = Number(DAS_POR_COMPETENCIA_[m]) || 0;
    var aliq = base > 0 ? guia / base : 0;
    var est = !!DAS_ESTIMADO_[m];
    if (!est && base > 0) {
      somaAliq += aliq; nAliq++;
      somaGuia += guia; somaBase += base;
      if (aliq < minA) minA = aliq;
      if (aliq > maxA) maxA = aliq;
    }
    var pad = function (x) { return ('            ' + Number(x).toFixed(2)).slice(-12); };
    L.push('  ' + m + ' |' + pad(r.total) + ' |' + pad(r.site) + ' |' + pad(base)
           + ' |' + pad(guia).slice(-11) + ' | ' + (aliq * 100).toFixed(2) + '% '
           + (est ? ' ESTIMADO' : ''));
  });

  /* A RAZAO AGREGADA, nao a media das razoes. Soma das guias sobre soma das
     bases. Em 07/10/2026 as duas deram 7,76% por coincidencia, mas quando os
     meses tem tamanhos diferentes elas divergem - e a agregada e a que
     responde "quanto de imposto por real de base", que e o uso aqui. */
  var media = somaBase > 0 ? somaGuia / somaBase : 0;
  var mediaSimples = nAliq ? somaAliq / nAliq : 0;
  var amplitude = nAliq ? maxA - minA : 0;
  L.push('');
  L.push('aliquota AGREGADA (soma/soma): ' + (media * 100).toFixed(2) + '%  (' + nAliq + ' guia(s))');
  L.push('media simples dos meses .....: ' + (mediaSimples * 100).toFixed(2) + '%');
  L.push('amplitude da coluna .........: ' + (minA * 100).toFixed(2) + '% a '
         + (maxA * 100).toFixed(2) + '%  = ' + (amplitude * 100).toFixed(2) + ' ponto(s)');
  L.push('aliquota que o painel usa ...: ' + (ALIQUOTA_SIMPLES_ * 100).toFixed(2) + '%');
  var dif = media - ALIQUOTA_SIMPLES_;
  L.push('diferenca ...................: ' + (dif * 100).toFixed(2) + ' ponto(s)');
  L.push('');

  /* A TRAVA QUE FALTOU EM 07/10. Eu peguei a aliquota de UM mes (agosto,
     8,01%), chamei de "a aliquota subiu" e reescrevi a estimativa de
     setembro com ela. A coluna inteira dizia o contrario: 3 pontos de
     amplitude. A aliquota do Simples sobe devagar com o RBT12 e NAO pula
     assim - amplitude larga quer dizer que a BASE esta errada mes a mes
     (nota emitida num mes, pedido em outro), nao que a aliquota mudou.
     Agora o relatorio diz isso antes de alguem ler a coluna errado. */
  if (amplitude > 0.01) {
    L.push('>>> A COLUNA BALANCA ' + (amplitude * 100).toFixed(1) + ' PONTOS. Isso nao e a aliquota');
    L.push('    mudando - o Simples sobe devagar e nao pula tanto em poucos meses.');
    L.push('    E a BASE que erra mes a mes: a declarada e por NOTA EMITIDA e a');
    L.push('    nossa e por DATA DO PEDIDO, e o pedido que vira nota no mes');
    L.push('    seguinte troca de mes. O erro vai para os dois lados e quase');
    L.push('    some no agregado.');
    L.push('    CONSEQUENCIA PRATICA: NAO estimar um mes pela aliquota do mes');
    L.push('    anterior. Usar sempre a AGREGADA acima.');
    L.push('');
  }

  if (Math.abs(dif) > 0.002) {
    L.push('>>> PASSOU DE 0,2 PONTO na AGREGADA. Vale trocar o ALIQUOTA_SIMPLES_');
    L.push('    para ' + (media * 100).toFixed(2) + '%. A aliquota sobe com o faturamento dos 12');
    L.push('    meses, e uma aliquota velha subestima imposto todo mes, calada.');
  } else {
    L.push('Dentro de 0,2 ponto na agregada - nao precisa mexer no parametro.');
  }
  L.push('');
  L.push('A TENDENCIA so da pra ler em janelas, nao mes a mes: se a agregada dos'); 
  L.push('ultimos 3 meses estiver acima da agregada do ano, o parametro ja esta');
  L.push('atrasado. Um mes sozinho nao diz nada - ver o aviso de amplitude.');
  /* AQUI TERMINAVA COM "olhe a coluna de aliquota: se ela estiver SUBINDO mes
     a mes...". Tirei em 07/10/2026 porque foi exatamente esse conselho que me
     fez errar: eu li agosto (8,01%) contra julho, vi "subindo" e regravei a
     estimativa de setembro. Numa coluna que balanca 3 pontos, "subindo mes a
     mes" e padrao em ruido - sempre tem um par de meses subindo. O aviso de
     amplitude e a janela de 3 meses acima substituem isso por algo que
     distingue tendencia de ruido. */
  return { linhas: L, pendencia: pendencia };
}

/* ==========================================================================
 * A ROTINA DO DIA 20 - de verdade, nao item de menu.
 *
 * Ela pediu em 07/10/2026: "o DAS sempre vence dia 20, coloca uma rotina pra
 * validar o valor do imposto todo dia 20". Eu entreguei um item de menu com
 * "(rodar dia 20)" no nome, o que nao e rotina nenhuma: depende de alguem
 * lembrar. E a licao do dia foi justo essa - aviso que depende de leitura nao
 * e trava.
 *
 * MANDA O RELATORIO INTEIRO, nao um "confira o imposto". Lembrete sem
 * conteudo so transfere o trabalho; com a tabela dentro, ela decide no
 * proprio e-mail se precisa abrir a planilha.
 *
 * MANDA TODO MES, inclusive quando esta tudo certo - nesse caso com assunto
 * curto. Rotina que so fala quando ha problema nao da pra distinguir de
 * rotina que parou de rodar, e gatilho do Apps Script morre calado quando a
 * autorizacao expira.
 * ========================================================================== */
function avisarImpostoDia20() {
  var r = _relatorioImposto_();
  var assunto = r.pendencia
    ? 'Imposto dia 20: ' + r.pendencia
    : 'Imposto dia 20: nada pendente';
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: assunto,
    body: r.linhas.join('\n')
  });
}

/** Instala o gatilho mensal. Idempotente: limpa o antigo antes de criar. */
function instalarGatilhoImposto() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'avisarImpostoDia20') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('avisarImpostoDia20')
    .timeBased().onMonthDay(20).atHour(9).create();
  mostrarRelatorio_('Imposto', [
    'Gatilho instalado: todo dia 20, por volta das 9h.',
    'Manda o relatorio da aliquota para ' + Session.getEffectiveUser().getEmail() + '.',
    '',
    'Rodar de novo nao duplica - ele apaga o anterior antes de criar.'
  ]);
}

function verImpostoEstimado() {
  var L = [];
  L.push('IMPOSTO DO SIMPLES - guia lida  x  estimativa');
  L.push('');
  L.push('competencia |        valor | origem');
  var tg = 0, te = 0;
  Object.keys(DAS_POR_COMPETENCIA_).sort().forEach(function (m) {
    var v = Number(DAS_POR_COMPETENCIA_[m]) || 0;
    var est = !!DAS_ESTIMADO_[m];
    if (est) { te += v; } else { tg += v; }
    L.push('  ' + m + '   | ' + ('            ' + v.toFixed(2)).slice(-12)
           + ' | ' + (est ? 'ESTIMADO  <<<' : 'guia'));
  });
  L.push('');
  L.push('de guia ....: R$ ' + tg.toFixed(2));
  L.push('estimado ...: R$ ' + te.toFixed(2));
  L.push('');
  L.push('A ESTIMATIVA e 7,76% sobre a receita do painel MENOS a venda do site,');
  L.push('que nao entra na base declarada. A aliquota foi medida nas seis guias');
  L.push('de 2026 e a razao AGREGADA, nao a de um mes - ver o conferirImposto.');
  L.push('');
  L.push('Trocar pela guia assim que o boleto sair: o numero estimado acerta a');
  L.push('ordem de grandeza e nao acerta o centavo - em julho a minha');
  L.push('estimativa bateu o total por ACIDENTE, somando juros de mora que nao');
  L.push('sao imposto.');
  mostrarRelatorio_('Imposto: guia x estimativa', L);
}

/**
 * Juros de mora e multa das guias pagas em atraso, por competencia da
 * APURACAO. Nao e imposto sobre venda: e o preco de ter pago depois do
 * vencimento, e por isso vai para Resultado Financeiro.
 *
 * Nao confundir com os encargos dos PARCELAMENTOS (R$ 5.529,29 do Simples e
 * ~R$ 847 do ICMS), que foram capitalizados na adesao e pertencem ao mes da
 * adesao - nao a competencia de cada debito.
 */
var JUROS_MORA_IMPOSTO_ = {
  '2026-07': 160.44   // guia gerada em 27/08, venc era 20/08
};

/** Meses cujo valor acima e estimativa, nao guia. Aparecem no log, no
 *  verImpostoEstimado e no conferirImposto. ESTE e o unico mapa - nao criar
 *  outro em lugar nenhum (ver o comentario la em cima, perto do
 *  DAS_POR_COMPETENCIA_). */
var DAS_ESTIMADO_ = { '2026-09': 1 };   // agosto saiu daqui em 07/10: a guia chegou

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

    // E O MAPA SE CONSERTA SOZINHO. Ate 14/09/2026 os grupos canonicos so eram
    // aplicados por manutencaoCompleta, rodada a mao no editor - e toda vez que
    // uma categoria mudava de grupo aqui no codigo, a DRE ficava errada ate
    // alguem lembrar de rodar. Foi o que aconteceu com "Cartao a ratear", com
    // "Participacao de parceiros" e com "Impostos sobre vendas".
    //
    // Com a chamada aqui, o sync de duas em duas horas aplica sozinho. A funcao
    // e idempotente: quando nao ha nada para corrigir, devolve zero e nao
    // escreve nada.
    let gruposFixados = 0;
    try {
      gruposFixados = (fixarGrupoCanonico_() || {}).mudou || 0;
    } catch (e) {
      // nao derruba o sync por causa disso: sem o fixar, a DRE sai com o grupo
      // antigo, o que e ruim mas nao e fatal. O log denuncia.
      logSync_('syncBling', 'erro', 'fixarGrupoCanonico_ falhou: ' + e);
    }

    const existentes = getChavesExistentes_(sheet);
    const contasBancarias = getContasBancarias_(token);
    const mapaCategoria = getMapaCategoria_();

    let novos = 0;
    // metade do orcamento pra cada um: 'pagar' vem primeiro e, sem teto
    // proprio, engolia o tempo inteiro (ver comentario em sincronizarTipo_)
    novos += sincronizarTipo_('pagar', token, sheet, existentes, contasBancarias, mapaCategoria, TETO_APPEND_MS / 2);
    novos += sincronizarTipo_('receber', token, sheet, existentes, contasBancarias, mapaCategoria, TETO_APPEND_MS);

    const atualizadas = atualizarContasEmAberto_(token, sheet);
    const remapeadas = reaplicarMapaDre_(sheet, mapaCategoria);

    recalcularDre_();
    try { limparCachePrecificacao_(); } catch (e) { /* funcao pode nao existir ainda */ }
    logSync_('syncBling', 'ok',
      novos + ' nova(s), ' + atualizadas + ' atualizada(s), ' + remapeadas + ' remapeada(s)'
      + (categoriasNovas ? ', ' + categoriasNovas + ' categoria(s) nova(s)' : '')
      + (gruposFixados ? ', ' + gruposFixados + ' grupo(s) fixado(s)' : '')
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
    const resp = fetchBling_('https://api.bling.com.br/Api/v3/categorias/receitas-despesas?pagina='
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
  const resp = fetchBling_('https://api.bling.com.br/Api/v3/contatos/' + id, token);
  const nome = (resp && resp.data && resp.data.nome) || '';
  // So guarda no cache se ACHOU. Guardar vazio faz uma falha passageira
  // (timeout, 429) contaminar o resto da execucao inteira: o contato fica
  // marcado como 'sem nome' e todas as linhas seguintes dele saem vazias.
  // Foi o que deixou a coluna QUEM do painel meio preenchida - o MESMO
  // contato aparecia com nome numa linha e vazio na outra, so por causa de
  // em qual execucao cada linha foi gravada.
  if (nome) CACHE_CONTATOS_[id] = nome;
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
    const resp = fetchBling_('https://api.bling.com.br/Api/v3/depositos?pagina=' + pagina + '&limite=100', token);
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
 * JANELAS DE SYNC - refeitas em 02/09/2026, depois de medir na API.
 *
 * A versao anterior fatiava em 365 dias e filtrava com
 * dataEmissaoInicial/dataEmissaoFinal. Medido em 02/09/2026: esse par esta
 * na familia de parametros que o Bling ACEITA E IGNORA. Pedir um unico dia
 * de marco/2025 devolvia as MESMAS 100 contas que pedir sem filtro nenhum -
 * vencimentos de setembro a novembro de 2025.
 *
 * O efeito: as janelas nunca existiram. Toda execucao varria a lista
 * inteira, na ordem padrao do Bling, duas vezes (uma por "janela"). Sao
 * 6.897 contas a receber em 69 paginas, e o laco parava na pagina 60 -
 * cerca de 900 contas eram invisiveis para o sync, para sempre.
 *
 * O par que FUNCIONA e dataInicial + dataFinal + tipoFiltroData (E emissao,
 * V vencimento, P pagamento). Medido no mesmo dia: pedindo agosto/2026 com
 * tipoFiltroData=V voltaram so vencimentos de 01 a 04/08, zero fora.
 *
 * Agora a janela e MENSAL e a lista vem do mes MAIS NOVO para o mais velho:
 * lancamento novo entra na primeira janela varrida, em vez de esperar o
 * rastelo chegar em 2026 depois de atravessar 2025 inteiro.
 */
function janelasDeSync_(desde, ate) {
  const janelas = [];
  const fim = new Date(ate + 'T12:00:00');
  let ini = new Date(desde + 'T12:00:00');
  ini = new Date(ini.getFullYear(), ini.getMonth(), 1, 12, 0, 0);
  let guarda = 0;
  while (ini <= fim && guarda++ < 400) {
    const ultimoDia = new Date(ini.getFullYear(), ini.getMonth() + 1, 0, 12, 0, 0);
    const f = ultimoDia < fim ? ultimoDia : fim;
    janelas.push([
      Utilities.formatDate(ini, 'America/Sao_Paulo', 'yyyy-MM-dd'),
      Utilities.formatDate(f, 'America/Sao_Paulo', 'yyyy-MM-dd')
    ]);
    ini = new Date(ini.getFullYear(), ini.getMonth() + 1, 1, 12, 0, 0);
  }
  return janelas.reverse();
}

/*
 * CURSOR DA BUSCA POR CONTA NOVA (01/09/2026)
 *
 * Antes desta versao a varredura recomecava em JANELA_SYNC_DESDE
 * (01/01/2025), pagina 1, a CADA execucao — ela apenas pulava o que ja
 * existia. Conforme a planilha cresce, quase todo o orcamento de 2,5 min
 * vai embora re-lendo o que ja se sabe, e sobra cada vez menos pra achar o
 * que falta. O sync entao parece rodar sem erro e nao anda.
 *
 * Medido em 01/09/2026: depois de OITO execucoes seguidas, agosto travou em
 * R$ 34.569 de receita quando o espelho ja havia lancado R$ 46.811 so de
 * Shopee. As duas ultimas rodadas nao trouxeram uma linha sequer.
 *
 * Agora cada tipo guarda onde parou (janela + pagina) e retoma dali. Ao
 * terminar a volta inteira o cursor zera e ele recomeca do inicio — assim
 * conta antiga lancada depois nao fica orfa pra sempre.
 */
function cursorAppend_(tipo) {
  const bruto = PropertiesService.getScriptProperties().getProperty('CURSOR_APPEND_' + tipo) || '0|1';
  const p = String(bruto).split('|');
  const j = parseInt(p[0], 10);
  const pg = parseInt(p[1], 10);
  return { j: (j >= 0 ? j : 0), pagina: (pg >= 1 ? pg : 1) };
}

function gravarCursorAppend_(tipo, j, pagina) {
  PropertiesService.getScriptProperties().setProperty('CURSOR_APPEND_' + tipo, j + '|' + pagina);
}

/**
 * limiteMs: em quanto tempo de sync (contado desde o inicio do syncBling)
 * este tipo deve parar. Existe porque 'pagar' roda antes de 'receber': sem
 * um teto proprio, o primeiro consumia o orcamento inteiro e o segundo nunca
 * chegava a rodar — que foi exatamente o que segurou a receita de agosto.
 */
function sincronizarTipo_(tipo, token, sheet, existentes, contasBancarias, mapaCategoria, limiteMs) {
  const teto = limiteMs || TETO_APPEND_MS;
  // Ate 02/09/2026 a janela ia so ate hoje, mas o filtro de data era ignorado
  // e na pratica varria tudo. Agora que ele FUNCIONA, parar em hoje deixaria
  // de fora toda conta de vencimento futuro - e elas existem: parcelamento,
  // boleto a vencer, imposto adiado de proposito. Por isso o fim vai 12 meses
  // pra frente. Custa umas poucas janelas vazias, que fecham na primeira
  // pagina.
  const limite = new Date();
  limite.setMonth(limite.getMonth() + 12);
  const ate = Utilities.formatDate(limite, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const janelas = janelasDeSync_(JANELA_SYNC_DESDE, ate);
  const cur = cursorAppend_(tipo);
  const jInicial = cur.j < janelas.length ? cur.j : 0;
  let novos = 0;
  let parouPorTempo = false;

  for (let j = jInicial; j < janelas.length; j++) {
   const DE = janelas[j][0], ATE = janelas[j][1];
   let pagina = (j === jInicial) ? cur.pagina : 1;
   while (true) {
    // CADA ROTA TEM O SEU PARAMETRO, e ignora o da outra em silencio.
    // Medido em 02/09/2026 pedindo marco/2026 nas duas:
    //   /contas/receber  dataInicial+dataFinal+tipoFiltroData=V  -> 100/100 dentro
    //   /contas/pagar    dataVencimentoInicial/Final             -> 100/100 dentro
    // Em pagar, dataInicial+tipoFiltroData (V, E ou P) devolveu agosto inteiro
    // quando pedi marco - identico a nao filtrar. Em receber e o contrario.
    // Usar o par errado nao da erro: devolve a lista toda como se fosse a
    // janela pedida, que foi o que escondeu este bug por meses.
    const filtro = (tipo === 'pagar')
      ? '&dataVencimentoInicial=' + DE + '&dataVencimentoFinal=' + ATE
      : '&dataInicial=' + DE + '&dataFinal=' + ATE + '&tipoFiltroData=V';
    const url = 'https://api.bling.com.br/Api/v3/contas/' + tipo
      + '?pagina=' + pagina + '&limite=100' + filtro;
    const resp = fetchBling_(url, token);
    const lista = (resp && resp.data) || [];
    if (lista.length === 0) break;

    // CANARIO: se o Bling voltar a ignorar o filtro, ele nao da erro - so
    // devolve a lista inteira como se fosse a janela pedida. Foi assim que o
    // bug passou meses despercebido. Uma pagina INTEIRA fora da janela e o
    // sintoma exato disso, entao vale um aviso no log.
    if (pagina === 1) {
      let fora = 0;
      for (let k = 0; k < lista.length; k++) {
        const venc = String(lista[k].vencimento || '');
        if (venc && (venc < DE || venc > ATE)) fora++;
      }
      if (fora === lista.length && lista.length > 0) {
        logSync_('sincronizarTipo', 'erro', tipo + ': o filtro de data parou de'
          + ' funcionar - pedi ' + DE + ' a ' + ATE + ' e as ' + lista.length
          + ' contas da pagina 1 estao fora. Conferir os parametros na API.');
      }
    }

    lista.forEach(item => {
      const chave = tipo + ':' + item.id;
      if (existentes.has(chave)) return;

      const detalheResp = fetchBling_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + item.id, token);
      const d = (detalheResp && detalheResp.data) || item;

      extrairRateioCategorias_(d, token).forEach(rateio => {
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
          // HISTORICO, nao numeroDocumento (corrigido em 10/09/2026).
          // A coluna se chama "descricao" e recebia d.numeroDocumento, que na
          // pratica vem vazio quase sempre. O historico e onde mora TODO o
          // texto que a Karolyne digita no Bling - "Fatura Nubank 17/08 -
          // Insumos e materia prima (Italia, Aretha...)", "Saque Shopee ->
          // Nubank", "IPTU" - e nada disso chegava ao painel. Sintoma que
          // levou a achar: procurar as faturas de cartao de 2026 na planilha
          // nao devolveu nenhuma, embora estejam todas lancadas e rateadas no
          // Bling. As de 2025 aparecem porque entraram por outro caminho.
          // numeroDocumento fica como reserva para nao perder o que ja havia.
          d.historico || d.numeroDocumento || '',
          rateio.valor,
          d.id,
          tipo,
          // COMPETENCIA: quando o fato aconteceu, que nem sempre e
          // quando o dinheiro entrou. Na Shopee a venda e liberada
          // dias depois, entao a mesma linha alimenta as duas visoes
          // da DRE. Cai por ultimo pra nao mexer nos indices fixos
          // usados em atualizarContasEmAberto_.
          d.competencia || d.vencimento || d.dataEmissao || ''
        ]);
      });

      existentes.add(chave);
      novos++;
      Utilities.sleep(350);
    });

    // para de buscar conta nova pra sobrar tempo pro atualizarContasEmAberto_
    if (tempoGasto_() > teto) {
      gravarCursorAppend_(tipo, j, pagina);
      logSync_('sincronizarTipo', 'ok', tipo + ': parei em ' + DE + ' pagina ' + pagina
        + ' por tempo, retomo daqui no proximo sync');
      parouPorTempo = true;
      break;
    }

    if (lista.length < 100) break;
    pagina++;
    if (pagina > 60) break;
   }
   if (parouPorTempo) break;
  }
  // varreu tudo sem estourar o tempo: volta pro comeco na proxima execucao
  if (!parouPorTempo) gravarCursorAppend_(tipo, 0, 1);
  return novos;
}

/**
 * A lista de rateio por categoria pode vir como d.categorias (array) ou
 * um único d.categoria — tenta os dois formatos e cai pro valor total
 * sem categoria se nenhum bater (fica visível como "(sem categoria)" na
 * planilha, fácil de achar e corrigir).
 */
/**
 * A categoria de uma conta pode morar em TRES lugares, e o Bling nao
 * avisa em qual:
 *   1. rateio (d.categorias) - conta dividida em varias categorias
 *   2. d.categoria - o caso comum
 *   3. o BORDERO da baixa - quando quem categorizou foi a baixa, nao a
 *      conta. Mesma familia do portador, que tambem mora la.
 *
 * Medido em 01/09/2026: as 10 despesas que apareciam como
 * '(sem categoria)' no painel tinham TODAS categoria no bordero -
 * faccao da Deise e Limpeza e manutencao da desentupidora. Nao havia
 * nada para classificar; era a leitura que estava incompleta.
 */
function extrairRateioCategorias_(d, token) {
  if (Array.isArray(d.categorias) && d.categorias.length) {
    return d.categorias.map(c => ({
      categoriaId: (c.categoria && c.categoria.id) || c.categoriaId,
      categoriaNome: (c.categoria && c.categoria.descricao) || c.categoriaNome,
      valor: c.valor != null ? c.valor : d.valor
    }));
  }
  if (d.categoria && d.categoria.id && String(d.categoria.id) !== '0') {
    return [{ categoriaId: d.categoria.id, categoriaNome: d.categoria.descricao, valor: d.valor }];
  }
  // ultimo recurso: o bordero. So tenta se recebeu token - assim quem
  // chama sem ele (algum uso antigo) continua funcionando igual.
  if (token && d.borderos) {
    const lista = Array.isArray(d.borderos) ? d.borderos : [d.borderos];
    for (let i = 0; i < lista.length; i++) {
      const b = fetchBling_('https://api.bling.com.br/Api/v3/borderos/' + lista[i], token);
      const cat = b && b.data && b.data.categoria;
      if (cat && cat.id && String(cat.id) !== '0') {
        Utilities.sleep(150);
        return [{ categoriaId: cat.id, categoriaNome: cat.descricao || '', valor: d.valor }];
      }
      Utilities.sleep(150);
    }
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

/**
 * Recalcula a aba DRE inteira a partir da Fluxo de Caixa + _DRE_Mapa,
 * nos DOIS regimes que a Karolyne pediu em 27/08/2026:
 *
 *   realizado   - pela data em que o dinheiro entrou ou saiu, e SO o que
 *                 foi efetivamente baixado. E o caixa.
 *   competencia - pela data do fato gerador (coluna 'competencia', que o
 *                 sync grava do campo homonimo do Bling), incluindo o que
 *                 ainda esta em aberto. E o resultado do mes.
 *
 * A diferenca nao e cosmetica: na Shopee a venda so e liberada dias
 * depois, entao em 27/08 agosto aparecia com R$ 11.270 a menos de
 * faturamento simplesmente porque o dinheiro ainda nao tinha chegado.
 * Pelo regime de competencia a venda conta no mes em que foi feita.
 *
 * Quando a competencia nao esta preenchida (lancamento antigo), ela cai
 * de volta para a data - ou seja, o pior caso e as duas visoes ficarem
 * iguais, nunca um valor inventado.
 */
function recalcularDre_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fluxo = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const dre = ss.getSheetByName(ABA_DRE);

  const ultimaLinha = fluxo.getLastRow();
  const totais = {}; // "regime|AAAA-MM|grupoDRE" -> valor

  if (ultimaLinha >= 2) {
    const nCols = Math.max(fluxo.getLastColumn(), 15);
    const dados = fluxo.getRange(2, 1, ultimaLinha - 1, nCols).getValues();
    dados.forEach(linha => {
      const data = linha[0];
      const tipo = linha[1];
      const situacao = String(linha[2] || '').trim();
      const grupoDRE = linha[5];
      const valor = Number(linha[11]) || 0;
      const competencia = linha[14] || data;   // coluna 15, com fallback
      // 5 = cancelada (ou conta apagada no Bling, que marcamos assim). O
      // painel ja ignorava na tela, mas a aba DRE somava - em 23/08/2026
      // eram 266 linhas contando como receita/despesa que nao existem.
      if (situacao === '5') return;
      if (!grupoDRE || grupoDRE.indexOf('ignorar') >= 0) return;
      const sinal = tipo === 'entrada' ? 1 : -1;
      const soma = (regime, quando, grupo, quanto) => {
        if (!quando) return;
        const mes = Utilities.formatDate(new Date(quando), 'America/Sao_Paulo', 'yyyy-MM');
        const chave = regime + '|' + mes + '|' + (grupo || grupoDRE);
        totais[chave] = (totais[chave] || 0) +
          sinal * Math.abs(quanto === undefined ? valor : quanto);
      };

      // Parcela de emprestimo nao e toda despesa: a amortizacao abate divida.
      // Ver Emprestimos.gs. Usamos o VENCIMENTO (linha[0]) de proposito - a
      // competencia gravada nas parcelas do contrato grande esta errada
      // (todas ficaram com a data do cadastro, em fev/mar de 2026).
      const fatia = (typeof fatiarEmprestimo_ === 'function')
        ? fatiarEmprestimo_(linha[3], data, valor) : null;
      if (fatia) {
        soma('competencia', data, 'Resultado Financeiro', fatia.juros);
        if (situacao === '2' || situacao === '3') {
          soma('realizado', data, 'Resultado Financeiro', fatia.juros);
        }
        // a amortizacao NAO entra na DRE; fica no grupo proprio, visivel
        // em "Fora do resultado", para nunca sumir calada
        soma('competencia', data, GRUPO_AMORTIZACAO_, fatia.amortizacao);
        if (situacao === '2' || situacao === '3') {
          soma('realizado', data, GRUPO_AMORTIZACAO_, fatia.amortizacao);
        }
        return;
      }
      // competencia conta mesmo o que ainda nao foi pago: o fato ja
      // aconteceu. Realizado so conta o que saiu/entrou de fato (2 =
      // baixada, 3 = parcial).
      soma('competencia', competencia);
      if (situacao === '2' || situacao === '3') soma('realizado', data);
    });
  }

  // ------------------------------------------------------------------
  // Receita e CMV nao saem mais das contas. Ver o comentario grande em
  // corrigirDreMapa_ (Code.gs): a conta a receber so nasce quando o
  // marketplace libera o dinheiro e cada espelho grava numa base
  // diferente; e compra de tecido e estoque, nao custo do vendido.
  //
  // As duas fontes novas sao lancadas por mes e canal, ja fechadas:
  //   _Receita_Pedidos  data do pedido, preco praticado
  //   _CMV_Consumo      pecas vendidas x ficha tecnica
  //
  // Entram nos DOIS regimes com o mesmo valor de proposito: sao numeros de
  // competencia, e repeti-los no realizado e menos errado do que deixar a
  // visao de caixa com receita zero e CMV zero. A visao de caixa de
  // verdade e o DFC, montado a partir do extrato bancario - nao esta aba.
  // ------------------------------------------------------------------
  const somaExterna = (aba, grupo) => {
    const s = ss.getSheetByName(aba);
    if (!s || s.getLastRow() < 2) return 0;
    const linhas = s.getRange(2, 1, s.getLastRow() - 1, 3).getValues();
    let n = 0;
    linhas.forEach(([mesBruto, canal, valor]) => {
      const mes = mesTexto_(mesBruto);
      const v = Number(valor) || 0;
      if (!mes || !v) return;
      const sinal = (grupo === 'CMV') ? -1 : 1;
      ['competencia', 'realizado'].forEach(regime => {
        const chave = regime + '|' + mes + '|' + grupo;
        totais[chave] = (totais[chave] || 0) + sinal * Math.abs(v);
      });
      n++;
    });
    return n;
  };
  const nRec = somaExterna(ABA_RECEITA_PEDIDOS_, 'Receita Bruta');
  const nCmv = somaExterna(ABA_CMV_CONSUMO_, 'CMV');

  // Provisao de imposto sobre a venda que nao vira nota. Ver o comentario
  // grande em GRUPO_PROVISAO_IMPOSTO_, no topo deste arquivo.
  const provisionarImpostoSemNota = () => {
    const s = ss.getSheetByName(ABA_RECEITA_PEDIDOS_);
    if (!s || s.getLastRow() < 2) return { linhas: 0, total: 0 };
    const dados = s.getRange(2, 1, s.getLastRow() - 1, 3).getValues();
    let n = 0, soma = 0;
    dados.forEach(([mesBruto, canal, valor]) => {
      const mes = mesTexto_(mesBruto);
      const v = Math.abs(Number(valor) || 0);
      if (!mes || !v) return;
      if (!canalSemNota_(canal)) return;
      const imposto = v * ALIQUOTA_SIMPLES_;
      soma += imposto;
      n++;
      ['competencia', 'realizado'].forEach(regime => {
        const chave = regime + '|' + mes + '|' + GRUPO_PROVISAO_IMPOSTO_;
        totais[chave] = (totais[chave] || 0) - imposto;
      });
    });
    return { linhas: n, total: soma };
  };
  // Imposto do Simples pela GUIA, na competencia da apuracao. Ver o comentario
  // de GRUPO_IMPOSTO_SIMPLES_ no topo deste arquivo.
  const lancarImpostoSimples = () => {
    let n = 0, soma = 0, estimados = [];
    Object.keys(DAS_POR_COMPETENCIA_).forEach(mes => {
      const v = Number(DAS_POR_COMPETENCIA_[mes]) || 0;
      if (!v) return;
      soma += v;
      n++;
      if (DAS_ESTIMADO_[mes]) estimados.push(mes);
      ['competencia', 'realizado'].forEach(regime => {
        const chave = regime + '|' + mes + '|' + GRUPO_IMPOSTO_SIMPLES_;
        totais[chave] = (totais[chave] || 0) - v;
      });
    });
    // juros de mora da guia paga em atraso: e custo financeiro, nao imposto
    let mora = 0;
    Object.keys(JUROS_MORA_IMPOSTO_).forEach(mes => {
      const j = Number(JUROS_MORA_IMPOSTO_[mes]) || 0;
      if (!j) return;
      mora += j;
      ['competencia', 'realizado'].forEach(regime => {
        const chave = regime + '|' + mes + '|Resultado Financeiro';
        totais[chave] = (totais[chave] || 0) - j;
      });
    });
    return { meses: n, total: soma, estimados: estimados, mora: mora };
  };
  const imp = lancarImpostoSimples();
  logSync_('recalcularDre', 'ok', 'imposto do Simples por competencia: R$ '
    + imp.total.toFixed(2) + ' em ' + imp.meses + ' mes(es)'
    + (imp.mora ? ' | juros de mora para o financeiro: R$ ' + imp.mora.toFixed(2) : '')
    + (imp.estimados.length ? ' | ESTIMADO (sem guia ainda): ' + imp.estimados.join(', ') : ''));

  const prov = provisionarImpostoSemNota();
  if (prov.linhas) {
    logSync_('recalcularDre', 'ok', 'provisao de imposto sobre venda sem nota: R$ '
      + prov.total.toFixed(2) + ' em ' + prov.linhas + ' mes(es)/canal, a '
      + (ALIQUOTA_SIMPLES_ * 100).toFixed(2) + '%');
  }
  if (!nRec) {
    logSync_('recalcularDre', 'erro', 'a aba ' + ABA_RECEITA_PEDIDOS_ + ' esta vazia:'
      + ' a DRE vai sair SEM RECEITA. Rode o alimentador antes.');
  }
  if (!nCmv) {
    logSync_('recalcularDre', 'erro', 'a aba ' + ABA_CMV_CONSUMO_ + ' esta vazia:'
      + ' a DRE vai sair SEM CMV e com lucro bruto inflado.');
  }

  dre.getRange(2, 1, Math.max(dre.getLastRow() - 1, 0), 4).clearContent();
  const linhas = Object.keys(totais).sort().map(chave => {
    const [regime, mes, grupoDRE] = chave.split('|');
    return [mes, grupoDRE, totais[chave], regime];
  });
  if (linhas.length) {
    /* O mes vai como "2026-08", que o Sheets converte em DATA sozinho se
       a coluna for automatica. Na volta vinha "Wed Aug 01 2026..." e quem
       ordenava por texto acabava ordenando pelo dia da semana - foi assim
       que a media dos "3 ultimos meses" pegou abril/2026, julho/2026 e
       outubro/2025, tudo que comecava com "Wed". Forcar texto na coluna
       resolve na origem. */
    dre.getRange(2, 1, linhas.length, 1).setNumberFormat('@');
    dre.getRange(2, 1, linhas.length, 4).setValues(linhas);
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

    const r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
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

    const resp = fetchBling_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + idConta, token);
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

  let consertadas = 0, semCatNoBling = 0, comRateio = 0, falhou = 0, restam = 0, apagadas = 0,
      aindaCanario = 0;
  const porStatus = {}; // pra saber DE VERDADE por que falhou

  for (let i = 0; i < dados.length; i++) {
    const catId = String(dados[i][COL_CAT_ID - 1] || '').trim();
    const catNome = String(dados[i][COL_CAT_NOME - 1] || '').trim();
    /* CATEGORIA CONGELADA: "A Classificar (revisar)" TAMBEM e candidata.
     *
     * O sync e append-only: linha que ja existe nunca tem a categoria lida de
     * novo. Ate 14/09/2026 esta fila olhava so linha com categoria VAZIA, e por
     * isso a conta que nascia em "A Classificar" ficava ali PARA SEMPRE mesmo
     * depois de a Karolyne classificar no Bling - a planilha guardava o valor
     * de quando a linha nasceu.
     *
     * O efeito pratico era eu pedir a mesma classificacao de novo a cada
     * revisao da DRE, como se o trabalho dela nao tivesse acontecido. Nao era
     * dado apagado, era dado ignorado - pior, porque parecia problema dela.
     *
     * A canario e a unica categoria que vale reler: por desenho ela existe para
     * ser temporaria, e sao poucas linhas (7 em 14/09/2026). Se a conta seguir
     * em "A Classificar" no Bling, a rotina simplesmente reescreve o mesmo
     * valor - custa uma chamada e nao trava a fila. Por isso ela NAO e marcada
     * para sair da fila, diferente da conta sem categoria no Bling. */
    const CANARIO_ = '14739989237';   // "A Classificar (revisar)"
    const precisa = !catId || !catNome || catNome === '(sem categoria)'
                    || catId === CANARIO_;
    if (!precisa) continue;
    if (String(dados[i][COL_SITUACAO - 1]).trim() === '5') continue; // ja cancelada

    if (Date.now() - INICIO_SYNC_.t > LIMITE_MS) { restam++; continue; }

    const id = dados[i][COL_ORIGEM_ID - 1];
    const tipo = String(dados[i][COL_ORIGEM_TIPO - 1] || '').trim();
    if (!id || (tipo !== 'pagar' && tipo !== 'receber')) continue;

    const r0 = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
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

    const rateio = extrairRateioCategorias_(d, token);

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

    // reler a canario e util so quando o Bling JA tem a categoria nova; se
    // voltar canario, a conta continua esperando classificacao la e isso tem de
    // aparecer no resumo em vez de contar como conserto
    if (String(r.categoriaId) === CANARIO_) aindaCanario++;
    else consertadas++;
    Utilities.sleep(300);
  }

  recalcularDre_();
  const resumo = consertadas + ' consertada(s), ' + apagadas + ' apagada(s) no Bling -> cancelada, '
    + semCatNoBling + ' sem categoria no proprio Bling, '
    + aindaCanario + ' ainda em "A Classificar" no Bling (classifique LA), '
    + comRateio + ' com rateio (pulei), '
    + falhou + ' falha(s)'
    + (restam ? ', ' + restam + ' pendente(s) - rode de novo' : ', terminou tudo')
    + ' | HTTP: ' + JSON.stringify(porStatus);
  logSync_('reprocessarSemCategoria', 'ok', resumo);
  Logger.log(resumo);
}

function _rodarReprocessarSemCategoria() {
  reprocessarLinhasSemCategoria_();
}

/**
 * Preenche a coluna QUEM (contatoNome) nas linhas que ficaram vazias.
 *
 * O sync e append-only: linha gravada sem nome fica sem nome pra sempre,
 * mesmo que a conta tenha contato no Bling. Isso acontecia quando a busca
 * do nome falhava na execucao que criou a linha.
 *
 * Aqui a gente varre a Fluxo de Caixa, pega as linhas com QUEM vazio e
 * reBusca pelo id da conta. Respeita o mesmo teto de tempo do resto:
 * se nao der pra terminar, para e avisa quantas faltaram - e so rodar
 * de novo.
 */
function reprocessarContatosVazios_() {
  const COL_CONTATO = 9, COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const LIMITE_MS = 4.5 * 60 * 1000;
  const inicio = Date.now();

  const token = getBlingAccessToken_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const ultima = sheet.getLastRow();
  if (ultima < 2) return 'planilha vazia';

  const dados = sheet.getRange(2, 1, ultima - 1, 14).getValues();
  let vazias = 0, preenchidas = 0, semContato = 0, restam = 0;

  for (let i = 0; i < dados.length; i++) {
    const nome = String(dados[i][COL_CONTATO - 1] || '').trim();
    if (nome) continue;
    vazias++;
    if (Date.now() - inicio > LIMITE_MS) { restam++; continue; }

    const id = dados[i][COL_ORIGEM_ID - 1];
    const tipo = String(dados[i][COL_ORIGEM_TIPO - 1] || '').trim();
    if (!id || !tipo) { semContato++; continue; }

    const resp = fetchBling_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    const d = resp && resp.data;
    if (!d) { semContato++; continue; }
    const achado = nomeDoContato_(d.contato, token);
    if (achado) {
      sheet.getRange(i + 2, COL_CONTATO).setValue(achado);
      preenchidas++;
    } else {
      semContato++;
    }
    Utilities.sleep(250);
  }

  const msg = vazias + ' linha(s) sem QUEM | ' + preenchidas + ' preenchida(s) | ' +
    semContato + ' sem contato na origem | ' + restam + ' pra proxima rodada';
  Logger.log(msg);
  return msg;
}

/** Atalho publico: a funcao acima termina em '_' e nao aparece no menu. */
function preencherQuemVazio() {
  const msg = reprocessarContatosVazios_();
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/* ============================================================================
 * LER O "CART-ACERTO-JANJUL" INTEIRO - o historico completo, do GET por id.
 *
 * O QUE TRAVOU JULHO. O Jobs achou um lancamento de -2.784,46 em 31/07/2026,
 * contato Shopee, categoria "Taxas do marketplace", historico
 * "CART-ACERTO-JANJUL". Pelo nome e um acerto de carteira de janeiro a julho
 * jogado inteiro em julho. Mas o nome e tudo que a gente tem, e decidir o que
 * fazer com R$ 2.784 pelo nome do lancamento e exatamente o tipo de inferencia
 * que ja me enganou tres vezes nesta investigacao.
 *
 * A LISTAGEM DO BLING VEM PODADA: `historico`, `numeroDocumento` e `origem`
 * chegam VAZIOS em /contas/pagar e cheios no GET por id. Entao achar na
 * listagem e, para o candidato, buscar o detalhe. Sao duas ou tres chamadas,
 * nao uma varredura - nao disputa o limite de 3 req/s com as outras sessoes.
 *
 * POR QUE IMPORTA SABER O QUE ELE CORRIGE: em 15/07/2026 o espelho da Shopee
 * trocou de metodo, de lancar pela data do PEDIDO para lancar pela data de
 * LIBERACAO. Pedido do comeco de julho que so liberou depois do dia 15 pode
 * ter entrado duas vezes. Medi o teto desse risco pela quebra por dia: R$ 937.
 * O acerto e R$ 2.784, quatro vezes maior - entao ele NAO e so o conserto da
 * virada, ou e e esta errado. O historico completo deve dizer.
 *
 * SO LE. Nao escreve nada no Bling nem na planilha.
 * ========================================================================== */
function verAcertoJulho() {
  var L = [];
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA_FLUXO_CAIXA);

  L.push('CART-ACERTO-JANJUL - o lancamento inteiro');
  L.push('');

  /* ACHO O ID NA PLANILHA, NAO VARRENDO A API.
   *
   * A versao anterior varria /contas/pagar por janela de vencimento e nao
   * achou - e o motivo nao era a natureza do lancamento, era eu estar
   * procurando pela chave errada. O Jobs lembrou do obvio: a linha JA ESTA na
   * aba Fluxo de Caixa, que o syncBling preenche, e as colunas 13 e 14 guardam
   * origemId e origemTipo. Ou seja, o id da conta esta a uma leitura de
   * planilha de distancia.
   *
   * Isso tambem mata a duvida que a busca por janela criava: procurar por
   * data e por valor deixa sempre a pergunta "sera que o filtro passou por
   * cima?". Buscar pelo ID nao tem essa pergunta. Quando o identificador
   * existe, procurar por atributo e escolher o caminho pior.
   *
   * E prova de passagem: se a linha esta na aba, ela veio do syncBling, que
   * so le contas a pagar e a receber. Entao o acerto E conta, nao movimento
   * de bordero - a hipotese que eu ia levantar estava descartada antes de eu
   * levanta-la. */
  if (!sh || sh.getLastRow() < 2) {
    mostrarRelatorio_('Acerto julho', ['A aba ' + ABA_FLUXO_CAIXA + ' esta vazia.']);
    return;
  }

  var n = sh.getLastRow() - 1;
  var dados = sh.getRange(2, 1, n, COLS_FLUXO_).getValues();
  var achados = [];
  for (var k = 0; k < n; k++) {
    var l = dados[k];
    var desc = String(l[10] || '');
    var val = Math.abs(Number(l[11]) || 0);
    /* Casa pelo HISTORICO, que e o que identifica o lancamento, e aceita
       tambem o valor exato - um dos dois basta. Dois criterios porque o
       historico pode ter vindo truncado e o valor pode mudar se alguem
       editar. */
    if (desc.toUpperCase().indexOf('ACERTO-JANJUL') >= 0 || Math.abs(val - 2784.46) < 0.011) {
      achados.push({ linha: k + 2, l: l });
    }
  }

  L.push('linhas na aba Fluxo de Caixa .............: ' + n);
  L.push('candidatos (historico ou valor) ..........: ' + achados.length);
  L.push('');

  if (!achados.length) {
    L.push('NAO ACHEI NA ABA. Isso e informativo, nao inconclusivo:');
    L.push('a aba e preenchida pelo syncBling, entao se a linha nao esta aqui,');
    L.push('ou o sync ainda nao rodou depois dela ser criada, ou ela foi');
    L.push('apagada no Bling. Rode "Sincronizar Bling" e tente de novo.');
    mostrarRelatorio_('Acerto julho', L);
    return;
  }

  var token = getBlingAccessToken_();
  achados.forEach(function (a) {
    var l = a.l;
    L.push('--- linha ' + a.linha + ' da aba -----------------------------');
    L.push('  data .............: ' + l[0]);
    L.push('  competencia ......: ' + (l[14] || '(VAZIA)'));
    /* Competencia vazia importa: a DRE agrupa por competencia e cai pra `data`
       quando ela falta. Entao este lancamento esta em julho por causa da DATA
       (31/07), nao por alguem ter dito que a competencia dele e julho - o que
       e justamente o que se esperaria de um acerto de jan a jul. */
    if (!l[14]) {
      L.push('      ^ sem competencia: a DRE usa a DATA (acima) pra posicionar.');
      L.push('        Num acerto de varios meses, isso significa que NINGUEM');
      L.push('        escolheu julho - julho e so onde ele foi lancado.');
    }
    L.push('  situacao .........: ' + l[2]);
    L.push('  categoria ........: ' + l[4] + '  (grupo: ' + l[5] + ')');
    L.push('  contato ..........: ' + l[8]);
    L.push('  valor ............: R$ ' + (Number(l[11]) || 0).toFixed(2));
    L.push('  descricao (aba) ..: ' + l[10]);
    L.push('  origem ...........: ' + l[13] + ' #' + l[12]);
    L.push('');

    /* O historico completo so existe no GET por id - a listagem de /contas
       devolve esse campo vazio. Por isso a ida a API, agora com o id na mao
       em vez de uma janela de datas. */
    if (!l[12]) { L.push('  (sem origemId na aba - nao da pra buscar o detalhe)'); return; }
    var rota = String(l[13] || '').toLowerCase().indexOf('receber') >= 0 ? 'receber' : 'pagar';
    var r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + rota + '/' + l[12], token);
    Utilities.sleep(350);
    if (r.status !== 200 || !r.json || !r.json.data) {
      L.push('  GET /contas/' + rota + '/' + l[12] + ' -> HTTP ' + r.status);
      /* MENSAGEM POR STATUS. A primeira versao imprimia a explicacao do 404
         qualquer que fosse o erro - e em 14/10 ela imprimiu "a conta foi
         apagada" num 429, que e limite de requisicao. Dizer a coisa errada
         com confianca e pior que nao dizer nada: ela quase registrou como
         conta apagada o que era so a API ocupada. */
      if (r.status === 429) {
        L.push('  429 = LIMITE DE REQUISICAO do Bling, que e de 3 por segundo e');
        L.push('  vale pra CONTA INTEIRA, somando todas as conversas. Outra');
        L.push('  sessao esta usando a API agora. A conta existe - so nao deu');
        L.push('  pra ler neste instante.');
        L.push('  >>> ESPERE UM MINUTO E RODE DE NOVO. Nada se perdeu.');
      } else if (r.status === 404) {
        L.push('  404 = a conta foi APAGADA no Bling depois do ultimo sync.');
        L.push('  A aba guarda o retrato; o Bling nao tem mais o original.');
      } else if (r.status === 401 || r.status === 403) {
        L.push('  ' + r.status + ' = token recusado. Rode "Reautorizar Bling".');
      } else {
        L.push('  Erro nao esperado. O retrato da aba (acima) continua valendo.');
      }
      L.push('');
      return;
    }
    var o = r.json.data;
    L.push('  DO BLING, pelo id ' + l[12] + ':');
    L.push('    vencimento .....: ' + (o.vencimento || '?'));
    L.push('    numeroDocumento : ' + (o.numeroDocumento || '(vazio)'));
    L.push('    HISTORICO COMPLETO:');
    String(o.historico || '(vazio)').split(String.fromCharCode(10)).forEach(function (t) {
      L.push('      ' + t);
    });
    L.push('');
  });

  L.push('O QUE PROCURAR: se o historico listar meses ou pedidos, da pra');
  L.push('ratear o valor pelos meses de origem. Se so disser "acerto", nao da');
  L.push('- e aí o certo e anotar que julho carrega um acerto de jan a jul e');
  L.push('parar de comparar julho com os outros meses, em vez de inventar um');
  L.push('rateio que ninguem consegue defender.');

  mostrarRelatorio_('Acerto julho', L);
}

/* ============================================================================
 * ZUMBIS: linha na aba que aponta pra conta que NAO EXISTE MAIS no Bling.
 *
 * O CASO QUE REVELOU ISTO (14/10/2026). O CART-ACERTO-JANJUL de R$ 2.784,46
 * esta na aba Fluxo de Caixa, com categoria, contato e valor, pesando na DRE
 * de julho - e o GET pelo id dele devolve 404. A conta foi apagada no Bling
 * depois do ultimo sync.
 *
 * POR QUE ISSO E ESTRUTURAL E NAO UM CASO. O sincronizarTipo_ e APPEND-ONLY:
 *     if (existentes.has(chave)) return;
 * Ele nunca revisita o que ja esta la. Isso foi escolha deliberada e boa - e
 * o que torna a aba imune a varredura incompleta e a janela mal escolhida.
 * Mas tem o avesso: conta APAGADA no Bling fica na aba PARA SEMPRE, e
 * continua somando na DRE. Ninguem ve, porque o sync nao reclama do que nao
 * encontra - ele so nao encontra.
 *
 * ANTES DE CONSERTAR, MEDIR. Pode ser uma linha ou podem ser centenas, e o
 * tamanho muda o que fazer: uma linha se trata na mao, um padrao precisa de
 * rotina. Entao isto NAO apaga nada - so conta e lista.
 *
 * COMO EVITA O FALSO POSITIVO QUE ME PEGOU HOJE DE MANHA. Comparar "ids da
 * aba" contra "ids que a listagem devolveu" acusaria como apagada toda conta
 * cujo VENCIMENTO caia fora da janela da listagem - e vencimento nao e a data
 * da aba. Foi assim que eu conclui errado que a minha busca estava quebrada.
 * Por isso sao DUAS etapas: a listagem so levanta CANDIDATOS, e cada
 * candidato e confirmado por um GET individual. Zumbi so entra no relatorio
 * com 404 na mao.
 *
 * SO LE.
 * ========================================================================== */
const ABA_ZUMBI_ = '_Zumbis';

function _zumbis_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(ABA_ZUMBI_);
  if (!sh) {
    sh = ss.insertSheet(ABA_ZUMBI_);
    sh.getRange(1, 1, 1, 9).setValues([[
      'tipo', 'origemId', 'data', 'valor', 'categoria', 'grupoDRE', 'descricao',
      'conferidoEm', 'status'
    ]]);
    sh.setFrozenRows(1);
    sh.hideSheet();
  } else if (sh.getRange(1, 9).getValue() !== 'status') {
    /* Aba criada antes da coluna de status existir: tudo que esta la e 404
       confirmado, entao o padrao vazio ja significa 'zumbi'. */
    sh.getRange(1, 9).setValue('status');
  }
  return sh;
}

/**
 * Procura zumbis num intervalo de meses. `de` e `ate` no formato '2026-07'.
 * Retomavel: o que ja foi conferido fica na _Zumbis e nao e conferido de novo.
 */
function procurarZumbis(de, ate) {
  de = String(de || '').trim();
  ate = String(ate || '').trim();
  if (!/^\d{4}-\d{2}$/.test(de) || !/^\d{4}-\d{2}$/.test(ate)) {
    mostrarRelatorio_('Zumbis', ['uso: procurarZumbis("2026-07", "2026-08")']);
    return;
  }

  const L = [];
  INICIO_SYNC_.t = Date.now();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sh || sh.getLastRow() < 2) {
    mostrarRelatorio_('Zumbis', ['A aba ' + ABA_FLUXO_CAIXA + ' esta vazia.']);
    return;
  }

  const tz = 'America/Sao_Paulo';
  const mesDe = function (v) {
    return v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM')
                             : String(v || '').trim().slice(0, 7);
  };

  // ---- 1. as linhas da aba no periodo
  const n = sh.getLastRow() - 1;
  const dados = sh.getRange(2, 1, n, COLS_FLUXO_).getValues();
  const candidatos = [];
  dados.forEach(function (l) {
    const m = mesDe(l[14] || l[0]);          // competencia, ou data quando falta
    if (m < de || m > ate) return;
    if (!l[12]) return;                      // sem origemId nao da pra conferir
    candidatos.push({
      tipo: String(l[13] || '').toLowerCase().indexOf('receber') >= 0 ? 'receber' : 'pagar',
      id: String(l[12]).trim(),
      data: l[0], valor: Number(l[11]) || 0,
      cat: l[4], grupo: l[5], desc: l[10]
    });
  });

  L.push('ZUMBIS em ' + de + ' a ' + ate);
  L.push('');
  L.push('linhas da aba no periodo .................: ' + candidatos.length);

  // ---- 2. o que ja foi conferido antes
  const shZ = _zumbis_();
  /* ANOTA TAMBEM OS VIVOS, e isto era um bug que fazia a varredura NUNCA
   * TERMINAR.
   *
   * Antes a aba so guardava os 404. Resultado: a cada rodada os mesmos
   * suspeitos VIVOS voltavam pra fila, na mesma ordem, consumiam o
   * orcamento de tempo e os ultimos da fila nunca eram alcancados. Medido
   * nas quatro rodadas de julho: a lista de suspeitos caiu 579 -> 483 ->
   * 290 -> 172, exatamente pelos zumbis de cada rodada, nunca pelos vivos.
   * A quarta rodada achou ZERO zumbis novos e ainda dizia "faltam 53" - a
   * quinta faria o mesmo, pra sempre.
   *
   * Conferir e um resultado, mesmo quando a resposta e "esta vivo". Guardar
   * so o achado e esquecer o descartado e o que transforma varredura
   * retomavel em esteira infinita. */
  const jaConferido = {};
  if (shZ.getLastRow() > 1) {
    shZ.getRange(2, 1, shZ.getLastRow() - 1, 9).getValues().forEach(function (l) {
      if (l[1]) jaConferido[l[0] + ':' + String(l[1]).trim()] = String(l[8] || 'zumbi');
    });
  }

  /* 3. CACHE DE VIVOS, pra nao gastar um GET por linha. A listagem de um mes
     custa poucas chamadas e resolve a maioria; so quem NAO aparecer nela vira
     suspeito e leva um GET individual. Sem este passo seriam centenas de
     chamadas e o teto de 6 minutos mataria a funcao no meio. */
  const vivos = {};
  const token = getBlingAccessToken_();
  ['pagar', 'receber'].forEach(function (tipo) {
    var pagina = 1;
    while (true) {
      if (tempoGasto_() > TETO_TOTAL_MS) break;
      var url = 'https://api.bling.com.br/Api/v3/contas/' + tipo
        + '?pagina=' + pagina + '&limite=100'
        + '&dataVencimentoInicial=' + de + '-01'
        + '&dataVencimentoFinal=' + ate + '-28';
      var r = fetchBlingStatus_(url, token);
      if (r.status !== 200 || !r.json || !r.json.data) break;
      var bloco = r.json.data;
      bloco.forEach(function (c) { vivos[tipo + ':' + c.id] = 1; });
      if (bloco.length < 100) break;
      pagina++;
      Utilities.sleep(350);
      if (pagina > 60) break;
    }
  });
  L.push('contas vivas na listagem do periodo ......: ' + Object.keys(vivos).length);

  const suspeitos = candidatos.filter(function (c) {
    return !vivos[c.tipo + ':' + c.id] && !jaConferido[c.tipo + ':' + c.id];
  });
  L.push('suspeitos (nao vieram na listagem) .......: ' + suspeitos.length);
  var jaZ = 0, jaV = 0;
  candidatos.forEach(function (c) {
    var st = jaConferido[c.tipo + ':' + c.id];
    if (st === 'vivo') jaV++; else if (st) jaZ++;
  });
  L.push('ja conferidos: zumbis ' + jaZ + ', vivos ' + jaV
         + '  (vivos tambem ficam anotados, senao voltariam pra fila)');
  L.push('');

  // ---- 4. confirma um a um. Suspeito nao e zumbi ate dar 404.
  const agora = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  const confirmados = [];
  const vivosRegistro = [];
  let vivosNoGet = 0, erros = 0, parou = false;
  for (var i = 0; i < suspeitos.length; i++) {
    if (tempoGasto_() > TETO_TOTAL_MS) { parou = true; break; }
    var c = suspeitos[i];
    var g = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + c.tipo + '/' + c.id, token);
    Utilities.sleep(350);
    if (g.status === 404) {
      confirmados.push([c.tipo, c.id, c.data, c.valor, c.cat, c.grupo, c.desc, agora, 'zumbi']);
    } else if (g.status === 200) {
      vivosNoGet++;
      // registra o descarte: sem isto ele volta pra fila na proxima rodada
      vivosRegistro.push([c.tipo, c.id, c.data, c.valor, c.cat, c.grupo, c.desc, agora, 'vivo']);
    } else {
      erros++;          // 429 e afins: nao conclui nada, tenta na proxima rodada
    }
  }

  const gravar = confirmados.concat(vivosRegistro);
  if (gravar.length) {
    shZ.getRange(shZ.getLastRow() + 1, 1, gravar.length, 9).setValues(gravar);
  }

  L.push('NESTA RODADA:');
  L.push('  apagadas no Bling (404) ................: ' + confirmados.length);
  L.push('  vivas, so fora da janela da listagem ...: ' + vivosNoGet);
  L.push('  sem resposta (429 e afins) .............: ' + erros
         + (erros ? '   <- rode de novo pra estes' : ''));
  L.push('');

  if (confirmados.length) {
    /* QUEBRA POR GRUPO, e nao um total so.
     *
     * A primeira versao imprimia "PESO DOS ZUMBIS NA DRE: R$ X" somando tudo,
     * e esse rotulo estava ERRADO - exatamente o tipo de numero plausivel que
     * eu passei a semana caçando. A Receita Bruta da DRE NAO vem do Fluxo de
     * Caixa: ela e sobrescrita a partir da _Receita_Pedidos. Entao zumbi que
     * e conta a RECEBER num grupo de recebimento nao mexe no resultado - mexe
     * na tela de caixa, no "recebi" dos KPIs e no prazo medio de recebimento.
     *
     * Chamar os dois de "peso na DRE" juntaria um erro de R$ 6 mil que existe
     * com um que nao existe, e quem lesse decidiria errado nos dois sentidos. */
    var porGrupo = {}, somaTudo = 0, nPagar = 0, nReceber = 0;
    confirmados.forEach(function (z) {
      var v = Math.abs(Number(z[3]) || 0);
      var g = String(z[5] || '(sem grupo)');
      if (!porGrupo[g]) porGrupo[g] = { n: 0, v: 0 };
      porGrupo[g].n++; porGrupo[g].v += v;
      somaTudo += v;
      if (z[0] === 'pagar') nPagar++; else nReceber++;
    });

    L.push('TOTAL CONFIRMADO: R$ ' + somaTudo.toFixed(2)
           + '   (' + nPagar + ' a pagar, ' + nReceber + ' a receber)');
    L.push('');
    L.push('POR GRUPO DA DRE - e so a primeira coluna que mexe no resultado:');
    Object.keys(porGrupo).sort(function (a, b) { return porGrupo[b].v - porGrupo[a].v; })
      .forEach(function (g) {
        var mexe = g.indexOf('ignorar na DRE') < 0 && g.indexOf('(sem mapear)') < 0;
        L.push('  ' + (mexe ? 'MEXE  ' : 'nao   ') + ('           R$ ' + porGrupo[g].v.toFixed(2)).slice(-14)
               + '  ' + porGrupo[g].n + 'x  ' + g);
      });
    L.push('');
    L.push('Lembrete do porque: a Receita Bruta da DRE vem da _Receita_Pedidos,');
    L.push('nao do Fluxo de Caixa. Zumbi de RECEBER infla a tela de caixa, o');
    L.push('"recebi" dos KPIs e o prazo medio - nao o resultado.');
    L.push('');
    confirmados.slice(0, 12).forEach(function (z) {
      L.push('  ' + z[0] + ' #' + z[1] + '  R$ ' + Math.abs(Number(z[3]) || 0).toFixed(2)
             + '  ' + z[4] + '  ' + String(z[6] || '').slice(0, 26));
    });
    if (confirmados.length > 12) L.push('  ... e mais ' + (confirmados.length - 12) + '. Veja a aba ' + ABA_ZUMBI_ + '.');
    L.push('');
  }

  /* ACUMULADO DE TODAS AS RODADAS, lido da aba.
   *
   * O relatorio mostrava so o que a rodada corrente achou, e na segunda
   * rodada isso imprimiu "193" logo abaixo de "ja conferidos: 96" - convite
   * pra ler 193 como o total quando o total era 289. Mesma familia do "100
   * contas" que era o limite e nao a contagem: numero parcial apresentado
   * sem dizer que e parcial. Quem le o relatorio quer saber o tamanho do
   * problema, nao o tamanho da rodada. */
  var totN = 0, totV = 0, totPorGrupo = {};
  if (shZ.getLastRow() > 1) {
    shZ.getRange(2, 1, shZ.getLastRow() - 1, 9).getValues().forEach(function (z) {
      if (!z[1]) return;
      if (String(z[8] || 'zumbi') === 'vivo') return;   // descarte registrado
      totN++;
      var v = Math.abs(Number(z[3]) || 0);
      totV += v;
      var g = String(z[5] || '(sem grupo)');
      if (!totPorGrupo[g]) totPorGrupo[g] = { n: 0, v: 0 };
      totPorGrupo[g].n++; totPorGrupo[g].v += v;
    });
  }
  L.push('ACUMULADO DE TODAS AS RODADAS: ' + totN + ' zumbis, R$ ' + totV.toFixed(2));
  Object.keys(totPorGrupo).sort(function (a, b) { return totPorGrupo[b].v - totPorGrupo[a].v; })
    .forEach(function (g) {
      var mexe = g.indexOf('ignorar na DRE') < 0 && g.indexOf('(sem mapear)') < 0;
      L.push('  ' + (mexe ? 'MEXE  ' : 'nao   ')
             + ('           R$ ' + totPorGrupo[g].v.toFixed(2)).slice(-14)
             + '  ' + totPorGrupo[g].n + 'x  ' + g);
    });
  L.push('');

  var faltam = suspeitos.length - (confirmados.length + vivosNoGet + erros);
  /* FECHOU a janela? So quando nao parou por tempo E nao sobrou 429 pra
     retentar. Erro de rede deixa suspeito sem veredito, e um mes com
     suspeito sem veredito nao esta varrido. */
  var completo = !parou && erros === 0 && faltam <= 0;
  if (!completo) {
    L.push('*** AINDA NAO FECHOU. Faltam ~' + Math.max(0, faltam + erros) + ' suspeitos nesta janela.');
    L.push('    Rode de novo - ele continua de onde parou. ***');
  } else {
    L.push('JANELA COMPLETA: todos os suspeitos de ' + de + ' a ' + ate + ' foram conferidos.');
  }
  L.push('NAO APAGUEI NADA. So li e anotei na aba ' + ABA_ZUMBI_ + '.');
  mostrarRelatorio_('Zumbis ' + de + ' a ' + ate, L);
  return completo;
}

function procurarZumbisJulho() { return procurarZumbis('2026-07', '2026-07'); }

/* ============================================================================
 * REMOVER ZUMBI da aba Fluxo de Caixa, e varrer o resto dos meses.
 *
 * Ela autorizou em 14/10/2026: "tira o acerto e varre os outros meses".
 *
 * O QUE "TIRAR" SIGNIFICA AQUI, e e importante nao confundir: a conta ja NAO
 * EXISTE no Bling - foi apagada la por alguem, e o 404 confirma. O que sobra
 * e a linha na PLANILHA, que o sync nunca remove porque e append-only. Entao
 * remover e alinhar o painel com a origem, nao apagar dado do Bling. Nada
 * nesta parte toca na API a nao ser pra LER.
 * ========================================================================== */

/**
 * Remove UMA linha da aba Fluxo de Caixa, pelo origemId.
 *
 * RECONFIRMA O 404 NA HORA. A varredura pode ter rodado horas antes, e
 * apagar linha de uma conta que voltou a existir perderia dado de verdade.
 * Custa uma chamada e compra o direito de apagar - sem ela, isto seria
 * "apagar porque um relatorio antigo disse".
 *
 * GUARDA O RETRATO ANTES. A linha inteira vai pra _Zumbis com carimbo de
 * remocao, entao da pra reconstruir se alguem mudar de ideia. Remocao sem
 * trilha e o tipo de coisa que ninguem consegue auditar seis meses depois.
 */
function removerZumbiPorId(tipo, id) {
  tipo = String(tipo || 'pagar').trim().toLowerCase();
  id = String(id || '').trim();
  var L = [];
  if (!id) { mostrarRelatorio_('Remover zumbi', ['informe o id']); return; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sh || sh.getLastRow() < 2) {
    mostrarRelatorio_('Remover zumbi', ['A aba ' + ABA_FLUXO_CAIXA + ' esta vazia.']);
    return;
  }

  var n = sh.getLastRow() - 1;
  var dados = sh.getRange(2, 1, n, COLS_FLUXO_).getValues();
  var linhas = [];
  for (var k = 0; k < n; k++) {
    if (String(dados[k][12] || '').trim() === id) linhas.push(k + 2);
  }

  L.push('REMOVER ZUMBI ' + tipo + ' #' + id);
  L.push('');
  L.push('linhas encontradas na aba ...: ' + linhas.length);
  if (!linhas.length) {
    /* "Nada a fazer" era resposta ambigua, e as duas leituras pedem acoes
     * opostas: ou a linha JA FOI REMOVIDA (e esta tudo certo, so rodou duas
     * vezes), ou ela NUNCA ESTEVE LA (e aí o id esta errado e o acerto
     * continua pesando na DRE em outro lugar).
     *
     * A _Zumbis guarda o carimbo de remocao justamente pra responder isso.
     * Ferramenta que diz "nada a fazer" sem dizer POR QUE obriga quem le a
     * adivinhar - e adivinhar errado aqui significa deixar R$ 2.784 na DRE
     * achando que ja resolveu. */
    var shZv = _zumbis_();
    var jaRemovida = null;
    if (shZv.getLastRow() > 1) {
      shZv.getRange(2, 1, shZv.getLastRow() - 1, 9).getValues().forEach(function (z) {
        if (String(z[1] || '').trim() !== id) return;
        if (String(z[6] || '').indexOf('REMOVIDO DA ABA') === 0) jaRemovida = z;
      });
    }
    if (jaRemovida) {
      L.push('');
      L.push('JA FOI REMOVIDA, e esta tudo certo - voce rodou duas vezes.');
      L.push('  removida em .....: ' + jaRemovida[7]);
      L.push('  valor ...........: R$ ' + Math.abs(Number(jaRemovida[3]) || 0).toFixed(2));
      L.push('  categoria .......: ' + jaRemovida[4] + '  (' + jaRemovida[5] + ')');
      L.push('');
      L.push('O retrato esta na aba ' + ABA_ZUMBI_ + ' se precisar reconstruir.');
    } else {
      L.push('');
      L.push('*** E NAO HA REGISTRO DE REMOCAO. ***');
      L.push('Entao a linha nunca esteve na aba com este id, e o id pode estar');
      L.push('errado - o que significa que o lancamento continua em algum lugar.');
      L.push('Rode "Taxa: ler o acerto de julho por inteiro" pra reachar o id.');
    }
    mostrarRelatorio_('Remover zumbi', L);
    return;
  }

  // ---- reconfirma que a conta continua inexistente
  var token = getBlingAccessToken_();
  var r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
  L.push('GET /contas/' + tipo + '/' + id + ' -> HTTP ' + r.status);
  if (r.status === 200) {
    L.push('');
    L.push('*** NAO REMOVI. A conta EXISTE no Bling. ***');
    L.push('A varredura que a marcou como zumbi esta desatualizada, ou alguem');
    L.push('recriou a conta. Rode a varredura de novo antes de decidir.');
    mostrarRelatorio_('Remover zumbi', L);
    return;
  }
  if (r.status !== 404) {
    L.push('');
    L.push('*** NAO REMOVI. So removo com 404 na mao. ***');
    L.push(r.status === 429
      ? 'Foi 429: limite de requisicao, outra sessao usando a API. Tente em 1 min.'
      : 'Status inesperado - nao da pra afirmar que a conta sumiu.');
    mostrarRelatorio_('Remover zumbi', L);
    return;
  }

  // ---- guarda o retrato e remove
  var shZ = _zumbis_();
  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm');
  var guardadas = [];
  linhas.forEach(function (ln) {
    var l = sh.getRange(ln, 1, 1, COLS_FLUXO_).getValues()[0];
    guardadas.push([tipo, id, l[0], l[11], l[4], l[5],
                    'REMOVIDO DA ABA | ' + String(l[10] || ''), agora]);
    L.push('  linha ' + ln + ': R$ ' + (Number(l[11]) || 0).toFixed(2)
           + '  ' + l[4] + '  ' + String(l[10] || '').slice(0, 30));
  });
  shZ.getRange(shZ.getLastRow() + 1, 1, guardadas.length, 8).setValues(guardadas);

  /* De baixo pra cima: apagar de cima desloca as linhas de baixo e os indices
     que eu guardei deixariam de valer. */
  linhas.sort(function (a, b) { return b - a; }).forEach(function (ln) { sh.deleteRow(ln); });

  L.push('');
  L.push('REMOVIDAS: ' + linhas.length + ' linha(s). O retrato ficou na aba ' + ABA_ZUMBI_ + '.');
  L.push('');
  L.push('NAO VOLTA SOZINHO: o sync so adiciona o que a listagem do Bling');
  L.push('devolve, e o Bling nao tem mais essa conta.');

  if (typeof recalcularDre_ === 'function') { recalcularDre_(); L.push('DRE recalculada.'); }
  mostrarRelatorio_('Remover zumbi', L);
}

/** O acerto de julho: a unica linha de Despesas Variaveis sem lastro no Bling. */
function removerAcertoJulho() { return removerZumbiPorId('pagar', '26577539313'); }

/* ==========================================================================
 * VARRER TODOS OS MESES, retomavel.
 *
 * Julho sozinho levou tres rodadas. O periodo inteiro e 2025-01 ate hoje, uns
 * 22 meses - clicar mes a mes seria dezenas de cliques e alguem perderia a
 * conta de onde parou. Aqui o progresso fica em ScriptProperties: cada mes
 * que FECHA e registrado, e a proxima rodada pula ele.
 *
 * Mes so e dado como fechado quando a janela termina sem sobrar suspeito -
 * marcar como fechado um mes que parou por tempo esconderia justamente o que
 * faltou olhar.
 * ========================================================================== */
var ZUMBI_PROGRESSO_ = 'ZUMBIS_MESES_FEITOS';

function procurarZumbisTodos() {
  var props = PropertiesService.getScriptProperties();
  var feitos = {};
  try { feitos = JSON.parse(props.getProperty(ZUMBI_PROGRESSO_) || '{}'); } catch (e) { feitos = {}; }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sh || sh.getLastRow() < 2) {
    mostrarRelatorio_('Zumbis', ['A aba ' + ABA_FLUXO_CAIXA + ' esta vazia.']);
    return;
  }

  // meses presentes na aba
  var tz = 'America/Sao_Paulo';
  var col = sh.getRange(2, 1, sh.getLastRow() - 1, COLS_FLUXO_).getValues();
  var meses = {};
  col.forEach(function (l) {
    var v = l[14] || l[0];
    var m = v instanceof Date ? Utilities.formatDate(v, tz, 'yyyy-MM')
                              : String(v || '').trim().slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m)) meses[m] = 1;
  });
  var lista = Object.keys(meses).sort();
  var faltando = lista.filter(function (m) { return !feitos[m]; });

  if (!faltando.length) {
    mostrarRelatorio_('Zumbis - todos os meses', [
      'TODOS OS ' + lista.length + ' MESES JA FORAM VARRIDOS.',
      '',
      'Resultado acumulado esta na aba ' + ABA_ZUMBI_ + '.',
      'Pra varrer de novo do zero, apague a propriedade ' + ZUMBI_PROGRESSO_ + '.'
    ]);
    return;
  }

  var alvo = faltando[0];
  /* SO MARCA O MES QUANDO ELE FECHOU DE VERDADE.
   *
   * A primeira versao disto incrementava um contador a cada rodada e tratava
   * qualquer mes com contador > 0 como pronto. Julho levou TRES rodadas -
   * ou seja, teria sido dado como varrido depois da primeira, com 470
   * suspeitos por conferir, e os meses seguintes esconderiam o buraco sem
   * ninguem perceber. Marcar progresso que nao aconteceu e pior que nao
   * marcar progresso nenhum: o relatorio fica limpo e errado.
   *
   * Agora o procurarZumbis devolve se fechou, e so o `true` registra. */
  var fechou = procurarZumbis(alvo, alvo);
  if (fechou) {
    feitos[alvo] = 1;
    props.setProperty(ZUMBI_PROGRESSO_, JSON.stringify(feitos));
  }
}

/** Diz quais meses ja fecharam e quantos faltam. So le. */
function verProgressoZumbis() {
  var props = PropertiesService.getScriptProperties();
  var feitos = {};
  try { feitos = JSON.parse(props.getProperty(ZUMBI_PROGRESSO_) || '{}'); } catch (e) {}
  var L = ['PROGRESSO DA VARREDURA DE ZUMBIS', ''];
  var ks = Object.keys(feitos).sort();
  if (!ks.length) { L.push('nenhum mes FECHADO ainda.'); }
  ks.forEach(function (m) { L.push('  FECHADO  ' + m); });
  L.push('');
  L.push('Pra recomecar do zero, apague a propriedade ' + ZUMBI_PROGRESSO_);
  L.push('em Configuracoes do projeto > Propriedades do script.');
  mostrarRelatorio_('Progresso zumbis', L);
}
