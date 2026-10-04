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
  // conferirFaturas entra aqui porque o dropdown do editor fica preso nesta
  // funcao (ver manutencaoCompleta) - e a unica que consigo executar.
  const depois = conferirIPTU() + '\n\n' + conferirFaturas()
    + '\n\n' + conferirFaturasPorData()  // conferirFaturasPorPortador saiu: ver o comentario dela
    ;
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

/**
 * PONTO DE ENTRADA DE FATO.
 *
 * O dropdown "selecione a funcao" do editor do Apps Script nao troca de funcao
 * de forma confiavel: clicar no item da lista muda o rotulo, mas o botao
 * Executar continua rodando a escolha anterior - testado por coordenada, por
 * referencia de elemento e por teclado, em 09 e 10/09/2026. Ele fica preso em
 * recategorizarIPTU.
 *
 * Em vez de brigar com a ferramenta, recategorizarIPTU passou a imprimir
 * tambem a conferencia das faturas, e esta funcao junta as tres. Tudo aqui e
 * idempotente: rodar de novo nao muda nada.
 */
function manutencaoCompleta() {
  var msg = [manutencaoDre(), conferirIPTU(), conferirFaturas(),
             conferirFaturasPorData()].join(
    '\n\n----------------------------------------------------------\n\n');
  Logger.log(msg);
  return msg;
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
  '14744250501': 'Despesas Administrativas',      // IPTU e taxas municipais

  // "Cartao a ratear": a fatura de cartao entra no Bling como UM lancamento
  // generico no vencimento, e o rateio por categoria e feito a mao por volta do
  // dia 18 - a fatura fechada e o extrato so existem depois de vencer. Antes
  // desta categoria, o lancamento provisorio caia em "Compra de insumos e
  // materia prima", a maior categoria do cartao (71% do gasto do ano): a DRE do
  // mes corrente ficava errada calada. Fora do resultado ela fica incompleta e
  // VISIVEL, no quadro "Fora do resultado", cobrando o rateio.
  // Criada no Bling em 13/09/2026 pela sessao "Caixa" (raiz, tipo despesa).
  // SEM virgula na frente: a linha do IPTU acima ja termina com virgula. As
  // entradas abaixo usam virgula-na-frente porque a de cima NAO tem.
  '14744752723': 'Cartão a ratear (ignorar na DRE)'

  // Antecipacao de recebiveis, criada em 12/09/2026 sob o pai financeiro. Os
  // 1.477 lancamentos do Acelera (R$ 12.200,44) foram movidos para ela. E
  // custo FINANCEIRO, nao despesa operacional: antecipar e o preco de receber
  // antes, e jogar isso em despesa operacional afundava o EBITDA e escondia o
  // custo da divida. Sem esta linha ela fica em "(sem mapear)" e o valor
  // desaparece da DRE inteira.
  , '14744322372': 'Resultado Financeiro'

  // ---- as duas abaixo estao aqui porque DUPLICAM RECEITA se escorregarem ----
  //
  // A receita da DRE vem da aba _Receita_Pedidos, pela data do pedido e pelo
  // valor PRATICADO (o campo `total`, ja liquido de desconto). Entao a conta a
  // receber que a integracao cria para a mesma venda NAO pode entrar como
  // receita outra vez - vai para "Venda já contada pelo pedido (ignorar na DRE)", que
  // existe so para isso. Em 12/09/2026 foram 247 contas, R$ 17.563,96, que sem
  // este mapeamento apareceriam como receita nova.

  /* FRETE DE COMPRA (criada em 16/09/2026, id do Bling 14745004500).
   *
   * Frete de ENTRADA e custo de aquisicao do estoque: sem ele o tecido nao
   * chega, entao ele faz parte do que o tecido custou e volta pelo CMV quando a
   * peca vende. Fica no mesmo grupo da Faccao, que tem o mesmo pai
   * (14639321661 Custo dos servicos prestados).
   *
   * POR QUE NAO FICA EM "Fretes e seguros": aquela categoria esta em Despesas
   * Variaveis de Venda, que e o lugar do frete de SAIDA - o que varia com a
   * venda. Frete de compra nao tem relacao com o canal em que a peca vendeu, e
   * estava sendo rateado como se tivesse, piorando a margem de contribuicao POR
   * CANAL - a regua de decidir preco e canal.
   *
   * E TEM UM SEGUNDO EFEITO, apontado pela sessao do Caixa e maior que o
   * primeiro: se o frete do tecido nunca entrou no custo do rolo, o custo
   * unitario da peca no Bling esta BAIXO. Entao a margem por canal esta otimista
   * no numerador e no denominador ao mesmo tempo. Consertar o grupo aqui nao
   * conserta isso - exige reprocessar a valorizacao do estoque. */
  , '14745004500': 'Estoque (ignorar na DRE)'   // Frete de compra
  , '14745745467': 'Despesas Administrativas'   // Seguros (do imovel)
  , '14639321643': 'Venda já contada pelo pedido (ignorar na DRE)'   // Vendas de produtos
  // As irmas da 643. Estavam so no corrigirDreMapa_ do Code.gs, que e rotina
  // avulsa - entao o manutencaoDre nao as corrigia e elas ficariam com o nome
  // antigo no mapa depois do rename de 14/09/2026.
  , '14639321644': 'Venda já contada pelo pedido (ignorar na DRE)'   // Vendas de mercadorias
  , '14639321645': 'Venda já contada pelo pedido (ignorar na DRE)'   // Vendas de servicos
  //
  // Mesma logica para o desconto: se a receita ja entra liquida, deduzir o
  // desconto DE NOVO conta duas vezes. "Descontos incondicionais" fica fora do
  // resultado por isso. CUIDADO com a categoria 14639321695 ("Descontos
  // concedidos"), que esta mapeada como Despesas Variaveis de Venda porque
  // historicamente recebia COMISSAO da Shopee, nao desconto - se um espelho
  // novo passar a lancar desconto ali, o desconto volta a ser contado duas
  // vezes e o mapeamento dela tem que mudar junto.
  , '14639321657': 'Desconto de vitrine (ignorar na DRE)'   // Descontos incondicionais

  // "Participacao de parceiros", criada no Bling em 13/09/2026 (raiz, tipo 1).
  // Primeiro lancamento: R$ 1.039,21 para o Joao, 50% do lucro da venda de 180
  // fechos em 08/09 (conta 26861488477).
  //
  // Fica ABAIXO DO EBITDA de proposito. E divisao de lucro, nao custo de
  // operar: se entrar em despesa operacional, a margem de contribuicao e o
  // ponto de equilibrio pioram por causa de um pagamento que so existe PORQUE
  // houve lucro - o PE passaria a exigir volume para cobrir uma conta que so
  // nasce depois de o volume existir. Circular e errado.
  //
  // Consequencia pratica: quanto MAIS fecho vender, maior esta linha. Ela nao
  // e uma despesa a cortar; e a metade do socio.
  , '14744735213': 'Participacao de Parceiros'

  // "Mutuo de socio - devolucao", criada em 14/09/2026. O Vinicius adiantou
  // dinheiro para comprar mercadoria (pijamas) e para a reforma, e a empresa
  // devolveu. Emprestimo de socio sem juros NAO TEM DESPESA: devolver e baixa
  // de passivo - sai dinheiro, cai a divida com o socio, o resultado nao e
  // tocado. Vai para o mesmo grupo da amortizacao, fora da DRE e visivel em
  // "Fora do resultado", porque saida de caixa ela e.
  //
  // Ter categoria propria substitui a heuristica que existia no Emprestimos.gs,
  // que identificava essas parcelas por (mes, valor) - e foi exatamente assim
  // que eu atribui ao socio cinco parcelas que nao eram dele. Classificacao
  // mora no dado, nao no palpite.
  , '14744766135': 'Amortização de Dívida (ignorar na DRE)'

  // "Impostos sobre vendas" SAI DA DRE em 14/09/2026, e o motivo e que ela
  // misturava quatro coisas de naturezas diferentes:
  //   - o DAS pago, com competencia no mes do PAGAMENTO e nao da apuracao
  //   - as parcelas dos dois parcelamentos, que sao amortizacao de divida
  //   - uma provisao recorrente de R$ 4.867,34 sem guia que a lastreie
  //   - ICMS de parcelamento antigo
  // Nenhuma dessas e "imposto sobre a venda do mes", que e o que a linha de
  // Deducoes precisa ter.
  //
  // O imposto da DRE passa a vir da tabela DAS_POR_COMPETENCIA_ (BlingSync.gs),
  // que e a das GUIAS. Esta categoria continua visivel em "Fora do resultado",
  // mostrando o que foi PAGO - informacao de caixa, e no caixa ela pertence.
  , '14639321658': 'Imposto pago (ignorar na DRE)'
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
  '26591060145': 14639321671,
  // Mutuo do socio: 5 devolucoes ao Vinicius Negrao (16095855208), movidas no
  // Bling em 14/09/2026 para a categoria propria 14744766135. Quatro delas
  // estavam em "Impostos sobre vendas" (14639321658) - emprestimo de socio
  // contado como imposto, inflando as Deducoes de ago a nov/2025 em
  // R$ 3.588,40. A quinta estava em "Emprestimos", junto das do banco.
  '22333677160': 14744766135,   // 21/03/2025  2.583,00  "Emprestimo Pijamas"
  '23481675484': 14744766135,   // 29/08/2025    897,10
  '23481675486': 14744766135,   // 29/09/2025    897,10
  '23481675488': 14744766135,   // 20/10/2025    897,10
  '23481675490': 14744766135,   // 28/11/2025    897,10
  // As 3 faturas de cartao de setembro/2026, movidas no Bling pela sessao
  // "Caixa" em 14/09/2026 para "Cartao a ratear" (14744752723). Antes caiam em
  // "Compra de insumos e materia prima" e a DRE de setembro ficava errada
  // calada; agora ficam fora do resultado e VISIVEIS, cobrando o rateio.
  '23969868934': 14744752723,   // venc 11/09  1.409,25
  '23969868964': 14744752723,   // venc 17/09  4.953,38
  '23969868959': 14744752723,   // venc 10/09  3.853,47

  /* ------------------------------------------------------------------
   * FACCAO LANCADA COMO "SERVICOS DE TERCEIROS" EM JAN-ABR/2026.
   * 57 contas, R$ 24.593,20, para 14739931044 (Faccao / Mao de obra
   * terceirizada), que o mapa manda para "Estoque (ignorar na DRE)".
   *
   * DE ONDE VEIO: a Karolyne notou em 14/09/2026 que "Servicos de
   * terceiros" aparecia em Despesas Administrativas ate abril e depois
   * sumia da DRE. A categoria propria de faccao nasceu no meio do ano;
   * antes dela, o pagamento da costureira caia em Administrativas.
   *
   * POR QUE E DOBRA, e nao so classificacao feia: o CMV da DRE vem da
   * aba _CMV_Consumo, que e pecas vendidas x ficha tecnica, e a ficha JA
   * TEM a costura dentro. Conferido: 70 robes -> R$ 350,00 (R$ 5,00 cada)
   * e 75 pijamas -> R$ 825,00 (R$ 11,00 cada), exatamente a tabela da
   * Vilma que alimenta a ficha. Entao a mesma costura estava no CMV e em
   * Administrativas - jan-abr apareciam R$ 24.593,20 piores do que foram.
   *
   * AS 57 SAO TODAS FACCAO, sem excecao, e isso foi VERIFICADO em vez de
   * presumido: listarServicosTerceiros agrupou por quem recebeu e toda
   * descricao e trabalho por peca ("70 robes", "75 pijamas", "211
   * caseados", "500 xuxinhas", "36 camisetas"). Nenhum contador,
   * freelancer ou manutencao no meio.
   *
   * E OS TOTAIS FECHAM NO CENTAVO: janeiro da R$ 7.804,50 e abril
   * R$ 7.691,50, identicos ao total da categoria "Servicos de terceiros"
   * naqueles meses. Ou seja, nao sobra nada na categoria - ela fica
   * zerada em jan-abr, o que e a prova de que nao classifiquei junto
   * nada que nao era.
   *
   * ORDEM CONFERIDA ANTES DE MEXER: a aba _CMV_Consumo TEM abril
   * (R$ 20.366,93, 27,5% da receita, quebrado por canal), logo tirar a
   * costura de Administrativas nao deixa o custo sem lugar - ele volta
   * pelo CMV quando a peca vende. Se a aba estivesse vazia nesses meses,
   * esta reclassificacao teria deixado jan-abr bons demais.
   *
   * O QUE ISTO NAO FAZ: nao mexe no Bling. La as 57 continuam em
   * "Servicos de terceiros". Faccao nova deve ser lancada direto em
   * 14739931044 para nao voltar a divergir.
   * ------------------------------------------------------------------ */
  '25288696944': 14739931044, '25288701072': 14739931044, '25330048488': 14739931044, '25330520446': 14739931044,
  '25355966205': 14739931044, '25355981717': 14739931044, '25355993960': 14739931044, '25356037676': 14739931044,
  '25492128814': 14739931044, '25556459200': 14739931044, '25556562581': 14739931044, '25574893015': 14739931044,
  '25574907782': 14739931044, '25575181239': 14739931044, '24992992593': 14739931044, '24993002405': 14739931044,
  '24993029861': 14739931044, '24993041107': 14739931044, '24993046603': 14739931044, '24993054480': 14739931044,
  '25056189288': 14739931044, '25076589622': 14739931044, '25076598503': 14739931044, '25076604545': 14739931044,
  '25076618298': 14739931044, '25076646023': 14739931044, '25113841014': 14739931044, '25186055400': 14739931044,
  '25209298859': 14739931044, '25209306268': 14739931044, '25209312776': 14739931044, '25209315505': 14739931044,
  '25209316976': 14739931044, '25209319802': 14739931044, '25209353882': 14739931044, '25214251058': 14739931044,
  '25214271398': 14739931044, '25214276631': 14739931044, '25214309806': 14739931044, '25214340742': 14739931044,
  '24837308707': 14739931044, '24837310632': 14739931044, '24837319083': 14739931044, '24845594487': 14739931044,
  '24845641182': 14739931044, '24845762689': 14739931044, '24845769186': 14739931044, '24845780676': 14739931044,
  '24845785090': 14739931044, '24845797880': 14739931044, '24938959668': 14739931044, '24938964059': 14739931044,
  '24965150085': 14739931044, '24965305352': 14739931044, '24765285720': 14739931044, '24765524053': 14739931044,
  '25628593327': 14739931044,

  /* ------------------------------------------------------------------------
     AS 24 LINHAS ABAIXO ESTAVAM EM GRUPO_CANONICO_ E NUNCA FORAM APLICADAS.
     Movidas para ca em 27/09/2026 (achado da sessao "Queima de Estoque").

     POR QUE ERA BUG E NAO ESTILO: as duas tabelas tem CHAVES DE COISAS
     DIFERENTES. GRUPO_CANONICO_ e categoria -> nome de grupo, e o unico leitor
     dela e fixarGrupoCanonico_(), que casa a chave contra a COLUNA A do
     _DRE_Mapa - onde mora id de CATEGORIA. Estas 12 tem id de CONTA na chave,
     entao nunca casavam: caiam no `faltando` e produziam o alarme "NAO ACHADAS
     no mapa" todo mes, que e ruido que ensina a ignorar alarme.

     E havia um risco pior que o ruido: se um id de conta coincidisse com um id
     de categoria, fixarGrupoCanonico_ gravaria o NUMERO da categoria na coluna
     `grupo` do mapa. Grupo numerico nao casa com grupo nenhum da DRE, e a
     categoria inteira sumiria do resultado sem erro na tela.

     O EFEITO PRATICO de nunca terem rodado: o seguro do imovel (R$ 846,48) e os
     fretes do Bras (R$ 1.427,00) seguiam em Despesas Variaveis de Venda, que
     alimenta a margem de contribuicao POR CANAL. Custo fixo e frete de entrada
     ali dentro fazem todo canal parecer pior proporcionalmente ao faturamento.

     Os dois mapeamentos categoria -> grupo que ESTES consertos dependem
     ('14745745467' -> Despesas Administrativas e '14745004500' -> Estoque) ja
     estao em GRUPO_CANONICO_ e ficaram la, que e o lugar deles.
     ------------------------------------------------------------------------ */
  /* SEGURO DO IMOVEL: 6 parcelas que estavam em "Fretes e seguros".
   *
   * Categoria "Seguros" (14745745467, pai 14639321670 Despesas administrativas)
   * criada em 24/09/2026 pela sessao "Contas a Pagar e Receber", que tambem
   * moveu as 6 contas no Bling - entao painel e Bling nao divergem.
   *
   * POR QUE SAIU: seguro contra incendio do imovel nao varia com venda nenhuma.
   * Estava em Despesas Variaveis de Venda so porque o nome da categoria
   * 14639321667 tem a palavra "seguros". O dano nao era o valor (R$ 846,48 no
   * ano), era o LUGAR: Despesas Variaveis alimenta a margem de contribuicao POR
   * CANAL, que e a regua de decidir preco e canal. Custo fixo ali dentro faz
   * todo canal parecer pior, e proporcionalmente ao faturamento - o contrario
   * do que um seguro faz.
   *
   * ACHADO DE PASSAGEM, e maior que estas contas: eu li R$ 148,51 na parcela de
   * julho e o GET no Bling devolveu R$ 141,08. As seis sao identicas. A planilha
   * tem valor VELHO porque `atualizarContasEmAberto_` reconfere valor, situacao
   * e vencimento SO de conta em situacao 1 - a de julho esta baixada (sit 2) e
   * nunca foi reconferida. Ou seja: conta cujo valor muda no Bling DEPOIS de ser
   * baixada guarda o valor antigo no painel para sempre. Sao R$ 7,43 aqui;
   * ninguem sabe quanto no total. Mesma familia do congelamento de categoria. */
  '23531325615': 14745745467,   // 2026-07  141,08  (planilha dizia 148,51)
  '23750121089': 14745745467,   // 2026-08  141,08
  '23969868907': 14745745467,   // 2026-09  141,08
  '24250682983': 14745745467,   // 2026-10  141,08
  '24508098261': 14745745467,   // 2026-11  141,08
  '24777468958': 14745745467,   // 2026-12  141,08

  /* FRETE DE COMPRA: as idas ao Bras que estavam em "Fretes e seguros".
   *
   * 14639321667 "Fretes e seguros" esta mapeada em Despesas Variaveis de Venda,
   * que e o lugar do frete de SAIDA. Estas duas sao de ENTRADA - buscar tecido -
   * e por isso vao para Estoque, onde voltam pelo CMV quando a peca vende.
   *
   * VARREDURA COMPLETA do contato Coco (16119049417) em 24/09/2026: 8 contas no
   * total, todas baixadas. Seis em "Fretes e seguros" (R$ 1.427,00: R$ 887,00 em
   * 2025 e R$ 540,00 em 2026) e duas em "Compra de insumos e materia prima"
   * (R$ 525,50, ambas de 2025) - essas duas FICAM, porque ali ele comprou
   * tecido, nao transporte, e Insumos ja e Estoque.
   * A ida ao Bras custa R$ 60,00 TIPICAMENTE, nao invariavelmente: a conta mista
   * tem uma ida a R$ 40,00. Nao inferir quantidade a partir de valor.
   *
   * A segunda foi apontada pela sessao "Contas a Pagar e Receber" em 24/09/2026,
   * e ela corrige uma medicao minha: eu havia dito a Karolyne que so R$ 180,00
   * de 2026 era frete de compra, medido no listarFretes. Estava certo na data e
   * ficou errado no dia seguinte - o motoboy ("Coco", contato 16119049417) cobra
   * R$ 60,00 por ida e acumula varias numa conta, e as contas dele caem nessa
   * mesma categoria. Isso nao para de crescer.
   *
   * CUIDADO ao varrer por contato: nem tudo do Coco e frete. Quando a conta e do
   * TECIDO comprado no Bras, ela cai em 14639321655 "Compra de insumos e materia
   * prima" - que ja e Estoque e esta certa. Mover por nome de contato levaria
   * compra de tecido junto. O que separa e a natureza da conta, nao quem recebeu. */
  '23421205283': 14745004500,   // 2025-07  R$ 300,00  "5 Bras"
  '23783876158': 14745004500,   // 2025-09  R$ 120,00  "2 bras"
  '24197341890': 14745004500,   // 2025-10  R$ 240,00  "4 idas ao bras"
  '25267635131': 14745004500,   // 2026-03  R$ 180,00  "Frete Bras 3 idas"
  '26879636213': 14745004500,   // 2026-09  R$ 360,00  Coco, 6 idas discriminadas
  /* A CONTA MISTA, e ela nao precisa ser dividida - foi o que me travou por um
     dia e nao devia ter travado. Historico: "Bras 19/06 60,00 / Bras 23/06
     40,00 / Bras 25/06 60,00 / Cetim 10,00 / Moletom 56,90" = R$ 160,00 de
     frete + R$ 66,90 de material (mais R$ 0,10 de arredondamento).
     Os DOIS pedacos vao para o MESMO GRUPO: frete de compra -> Estoque, e
     compra de insumo -> Estoque. Categoria diferente, grupo igual. Entao mover
     a conta inteira poe 100% dela no lugar certo da DRE, e a unica imprecisao e
     de ROTULO: quem ler "Frete de compra" como medida de custo de transporte
     esta lendo R$ 66,90 a mais. Dividir exigiria criar duas contas no Bling
     para acertar um rotulo sem mudar nenhum numero do resultado. */
  '23194610781': 14745004500,   // 2025-06  R$ 227,00  MISTA (160 frete + 66,90 material)
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
  // O SYNC VEM PRIMEIRO, e a ordem importa. `fixarGrupoCanonico_` so corrige
  // linhas que JA existem no _DRE_Mapa - ele nao cria. Uma categoria criada
  // agora no Bling ainda nao esta no mapa, entao o fixar a reporta como "NAO
  // ACHADA" e o grupo dela nao entra na DRE.
  //
  // Foi exatamente o que aconteceu em 14/09/2026 com a 14744752723 ("Cartao a
  // ratear"): o sync rodava DEPOIS, dentro de recategorizarContas_, e por isso
  // so na segunda execucao a categoria pegava. Uma rotina que precisa ser
  // rodada duas vezes para funcionar e uma rotina quebrada.
  sincronizarCategorias_(getBlingAccessToken_());

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

/**
 * As faturas de cartao lancadas no Fluxo de Caixa, mes a mes.
 *
 * POR QUE: a fatura de cartao e rateada A MAO em varias categorias, e a
 * pergunta que aparece toda vez e "esse mes foi separado?". Auditado em
 * 10/09/2026: agosto bate ao centavo nos tres cartoes (Nubank R$ 4.540,32,
 * Mercado Pago R$ 3.144,48, Sicoob R$ 1.934,83), e setembro veio com tres
 * linhas de historico generico "Cartao de Credito", todas jogadas em insumos.
 *
 * Uma fatura BEM lancada aparece aqui com varias linhas e varios grupos. Uma
 * linha so, ou um grupo so, e sinal de que o rateio nao foi feito.
 */
function conferirFaturas() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  const ultimaLinha = sheet.getLastRow();
  const COL_DATA = 1, COL_NOME = 5, COL_GRUPO = 6, COL_DESC = 11, COL_VALOR = 12;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 15).getValues();

  const grupos = {};
  dados.forEach(function (l) {
    const desc = String(l[COL_DESC - 1] || '');
    if (!/fatura|cart[ãa]o de cr[ée]dito/i.test(desc)) return;
    const d = l[COL_DATA - 1];
    const txt = d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(d || '').trim().slice(0, 10);
    // "Fatura Nubank 17/08 - Insumos…" -> chave "Nubank 17/08"
    const m = desc.match(/Fatura\s+([A-Za-zÀ-ÿ ]+?)\s+(\d{2}\/\d{2})/i);
    const chave = m ? (m[1].trim() + ' ' + m[2]) : '(sem detalhe) ' + txt;
    const g = grupos[chave] || (grupos[chave] = { mes: txt.slice(0, 7), linhas: 0,
      total: 0, categorias: {}, gruposDre: {} });
    g.linhas++;
    g.total += Number(l[COL_VALOR - 1] || 0);
    g.categorias[String(l[COL_NOME - 1] || '?')] = true;
    g.gruposDre[String(l[COL_GRUPO - 1] || '?')] = true;
  });

  const chaves = Object.keys(grupos).sort(function (a, b) {
    return grupos[a].mes < grupos[b].mes ? -1 : 1;
  });
  const linhas = chaves.map(function (k) {
    const g = grupos[k];
    const nCat = Object.keys(g.categorias).length;
    const alerta = (g.linhas === 1 || nCat === 1) ? '   <-- NAO RATEADA' : '';
    return k + '  ' + g.mes + '  R$ ' + g.total.toFixed(2)
      + '  em ' + g.linhas + ' linha(s), ' + nCat + ' categoria(s)'
      + ' [' + Object.keys(g.gruposDre).join(' / ') + ']' + alerta;
  });
  const msg = 'FATURAS DE CARTAO NO FLUXO DE CAIXA\n' + linhas.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * As faturas de cartao de 2026 conferidas por VALOR e VENCIMENTO.
 *
 * POR QUE ASSIM: o historico das contas nunca chegou a planilha (a coluna
 * descricao recebia numeroDocumento, corrigido em 10/09/2026), entao nao da
 * para achar as faturas pelo texto nas linhas ja gravadas. Mas cada fatura tem
 * um total e um vencimento, e isso basta: se as contas daquele vencimento somam
 * o total da fatura, ela esta lancada; se estao em varias linhas e categorias,
 * esta rateada.
 *
 * Os totais abaixo foram lidos dos extratos originais - CSV do Nubank e PDF do
 * Sicoob e do Mercado Pago - nao do Bling. E por isso que isto e uma
 * conferencia e nao um relatorio: as duas pontas vem de fontes diferentes.
 */
var FATURAS_2026 = [
  { venc: '2026-01-11', banco: 'Sicoob', total: 3377.12 },
  { venc: '2026-01-12', banco: 'Mercado Pago', total: 967.41 },
  { venc: '2026-01-17', banco: 'Nubank', total: 2534.78 },
  { venc: '2026-02-10', banco: 'Mercado Pago', total: 2134.93 },
  { venc: '2026-02-11', banco: 'Sicoob', total: 1631.99 },
  { venc: '2026-02-17', banco: 'Nubank', total: 1926.80 },
  { venc: '2026-03-10', banco: 'Mercado Pago', total: 1702.55 },
  { venc: '2026-03-11', banco: 'Sicoob', total: 875.50 },
  { venc: '2026-03-17', banco: 'Nubank', total: 2626.27 },
  { venc: '2026-04-10', banco: 'Mercado Pago', total: 2470.31 },
  { venc: '2026-04-11', banco: 'Sicoob', total: 591.11 },
  { venc: '2026-04-17', banco: 'Nubank', total: 6379.80 },
  { venc: '2026-05-11', banco: 'Mercado Pago', total: 2060.83 },
  { venc: '2026-05-11', banco: 'Sicoob', total: 844.92 },
  { venc: '2026-05-17', banco: 'Nubank', total: 4345.35 },
  { venc: '2026-06-10', banco: 'Mercado Pago', total: 4466.44 },
  { venc: '2026-06-11', banco: 'Sicoob', total: 908.49 },
  { venc: '2026-06-17', banco: 'Nubank', total: 4546.25 },
  { venc: '2026-07-10', banco: 'Mercado Pago', total: 2636.12 },
  { venc: '2026-07-11', banco: 'Sicoob', total: 1429.21 },
  { venc: '2026-07-17', banco: 'Nubank', total: 10127.60 },
  { venc: '2026-08-10', banco: 'Mercado Pago', total: 3144.48 },
  { venc: '2026-08-11', banco: 'Sicoob', total: 1934.83 },
  { venc: '2026-08-17', banco: 'Nubank', total: 4540.32 }
];

function conferirFaturasPorData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  var COL_DATA = 1, COL_TIPO = 2, COL_NOME = 5, COL_GRUPO = 6, COL_DESC = 11, COL_VALOR = 12;
  var dados = sheet.getRange(2, 1, ult - 1, 15).getValues();

  var porData = {};
  dados.forEach(function (l) {
    if (String(l[COL_TIPO - 1]).trim() !== 'saida') return;
    var d = l[COL_DATA - 1];
    var txt = d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(d || '').trim().slice(0, 10);
    var g = porData[txt] || (porData[txt] = { linhas: 0, total: 0, cats: {}, grupos: {} });
    g.linhas++;
    g.total += Number(l[COL_VALOR - 1] || 0);
    g.cats[String(l[COL_NOME - 1] || '?')] = true;
    g.grupos[String(l[COL_GRUPO - 1] || '?')] = true;
  });

  var out = ['FATURAS DE CARTAO 2026 - extrato x planilha',
             'venc        banco          fatura      na planilha  linhas cats  situacao'];
  var okN = 0, faltaN = 0;
  FATURAS_2026.forEach(function (f) {
    var g = porData[f.venc];
    var soma = g ? g.total : 0;
    var nCat = g ? Object.keys(g.cats).length : 0;
    var dif = soma - f.total;
    var sit;
    if (!g) { sit = 'NADA LANCADO nesse vencimento'; faltaN++; }
    else if (Math.abs(dif) < 0.02 && nCat > 1) { sit = 'ok, rateada'; okN++; }
    else if (Math.abs(dif) < 0.02) { sit = 'valor bate, 1 CATEGORIA SO'; faltaN++; }
    else if (soma >= f.total - 0.02) { sit = 'tem mais que a fatura (ha outras contas no dia)'; okN++; }
    else { sit = 'FALTA R$ ' + (f.total - soma).toFixed(2); faltaN++; }
    out.push(f.venc + '  ' + (f.banco + '            ').slice(0, 14)
      + ('          ' + f.total.toFixed(2)).slice(-12)
      + ('          ' + soma.toFixed(2)).slice(-14)
      + ('     ' + (g ? g.linhas : 0)).slice(-6) + ('    ' + nCat).slice(-5)
      + '  ' + sit);
  });
  out.push('');
  out.push(okN + ' conferem, ' + faltaN + ' com problema, de ' + FATURAS_2026.length + ' faturas');
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/*
 * conferirFaturasPorPortador FOI REMOVIDA em 14/09/2026. O porque vale mais
 * que a funcao - e a primeira versao deste comentario estava ERRADA, o que
 * tambem vale registrar.
 *
 * A ideia era boa: conferirFaturasPorData tem um ponto cego (se a fatura foi
 * paga depois do vencimento, somar o dia do vencimento nao a encontra e o
 * resultado diz "FALTA" sem faltar), e o portador seria o eixo imune a data.
 *
 * Rodada pela Karolyne, a funcao devolveu TUDO em "(sem portador)" - R$ 74 mil
 * a R$ 144 mil por mes, ou seja, todas as saidas. Eu escrevi aqui que "a aba
 * nao tem coluna de portador". ESTAVA ERRADO: a coluna existe (COL 8, nome do
 * portador) e a funcao lia a coluna certa. O que acontece e mais especifico:
 *
 *   a coluna de portador e preenchida nas ENTRADAS (Itau, Sicoob, Nubank
 *   aparecem nas contas a receber) e fica VAZIA nas SAIDAS.
 *
 * E saida e exatamente o que a auditoria de fatura precisa. A causa raiz e a
 * mesma de sempre: no Bling o portador vem do BORDERO, nao da conta, e no
 * export da API 1.640 das 1.716 contas a PAGAR tem portadorId = 0 (ver a
 * memoria bling-exportar-extrato-em-vez-de-varrer-api).
 *
 * Conclusao inalterada, motivo corrigido: o eixo portador nao serve para
 * conferir fatura enquanto a saida nao carregar portador. Trazer a coluna nao
 * resolve - ela ja esta la, vazia na metade que importa.
 *
 * QUEM RESPONDE A PERGUNTA:
 *   conferirFaturas()  - agrupa as linhas da fatura e mostra em quantas
 *                        categorias ela foi rateada. Foi assim que agosto/2026
 *                        foi auditado ao centavo nos tres cartoes.
 *
 * E o teste de 14/09/2026 que CONFIRMA que a fatura esta nos livros: procurei,
 * para cada uma das 6 faturas de jul e ago, uma conta de valor exatamente igual
 * ao total, com 20 dias de folga. NENHUMA existe - e essa e a boa noticia. A
 * fatura entra RATEADA em varias linhas por categoria, nenhuma isolada vale o
 * total. Uma linha igual ao total e que seria o defeito.
 */

/**
 * Lista, conta por conta, o que compoe um grupo da DRE num mes.
 *
 * POR QUE ISSO EXISTE: em 14/09/2026 eu tentei descobrir tres vezes, por
 * inferencia, o que compunha a linha de Deducoes da Receita - e errei duas.
 * Atribui ao socio cinco parcelas que nao eram dele; li uma provisao mensal
 * recorrente de R$ 4.867,34 como se fosse o DAS de abril em aberto. Os dois
 * erros tinham a mesma causa: adivinhar a natureza de um lancamento pelo valor
 * e pela data, sem ler o historico.
 *
 * Deduzir por valor e barato e parece funcionar, o que e justamente o perigo.
 * Esta funcao troca o palpite por leitura.
 *
 * @param {string} grupo    nome do grupo, sem precisar de acento nem caixa
 *                          ("deducoes" acha "Deduções da Receita")
 * @param {string} mes      'yyyy-MM'
 * @param {string=} regime  'competencia' (padrao) ou 'realizado'
 */
function listarGrupo(grupo, mes, regime) {
  grupo = semAcento_(grupo || '');
  mes = mes || '2026-08';
  regime = regime || 'competencia';
  if (!grupo) return 'informe o grupo, ex.: listarGrupo("deducoes", "2026-08")';

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) return 'Fluxo de Caixa vazio';
  var dados = sheet.getRange(2, 1, ult - 1, Math.max(sheet.getLastColumn(), 15)).getValues();

  var linhas = [], total = 0, porCat = {}, porSit = {};
  dados.forEach(function (l) {
    var g = semAcento_(l[5]);
    if (g.indexOf(grupo) < 0) return;
    var sit = String(l[2] || '').trim();
    if (sit === '5') return;                      // cancelada
    // no regime realizado so conta o que saiu de fato, e pela data do
    // pagamento; em competencia conta tudo, pela competencia
    var quando;
    if (regime === 'realizado') {
      if (sit !== '2' && sit !== '3') return;
      quando = l[0];
    } else {
      quando = l[14] || l[0];
    }
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (m !== mes) return;

    var v = Math.abs(Number(l[11]) || 0) * (String(l[1]).trim() === 'entrada' ? 1 : -1);
    total += v;
    var cat = String(l[3] || '0') + ' ' + String(l[4] || '(sem categoria)');
    porCat[cat] = (porCat[cat] || 0) + v;
    porSit[sit] = (porSit[sit] || 0) + v;
    var desc = [l[8], l[9], l[10]].filter(function (x) { return x; }).join(' ');
    linhas.push({
      v: v,
      txt: [(l[0] instanceof Date
              ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'dd/MM')
              : String(l[0]).slice(0, 10)),
            'sit' + sit,
            'R$ ' + v.toFixed(2),
            String(l[13] || '') + ':' + String(l[12] || ''),
            String(l[4] || ''),
            String(desc).slice(0, 60)].join('  ')
    });
  });

  linhas.sort(function (a, b) { return Math.abs(b.v) - Math.abs(a.v); });
  var out = ['GRUPO "' + grupo + '" em ' + mes + ' (' + regime + '): R$ ' + total.toFixed(2)
             + ' em ' + linhas.length + ' linha(s)', '', 'por categoria:'];
  Object.keys(porCat).sort(function (a, b) { return Math.abs(porCat[b]) - Math.abs(porCat[a]); })
    .forEach(function (k) { out.push('  ' + k + '  ->  R$ ' + porCat[k].toFixed(2)); });
  out.push('');
  out.push('por situacao (1=aberta 2=baixada 3=parcial):');
  Object.keys(porSit).sort().forEach(function (k) {
    out.push('  sit' + k + '  ->  R$ ' + porSit[k].toFixed(2));
  });
  out.push('');
  out.push('as linhas, da maior para a menor:');
  linhas.slice(0, 80).forEach(function (a) { out.push('  ' + a.txt); });
  if (linhas.length > 80) out.push('  ... e mais ' + (linhas.length - 80) + ' linha(s)');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/**
 * LINHA FANTASMA NAS DEDUCOES: conta apagada no Bling que continua na planilha.
 *
 * POR QUE O syncBling NAO RESOLVE: `atualizarContasEmAberto_` comeca com
 *
 *     if (String(linha[COL_SITUACAO - 1]).trim() !== '1') return;
 *
 * ou seja, so reconfere conta EM ABERTO. Devolucao de venda entra baixada, e
 * por isso nunca mais e reconferida - some do Bling e fica na planilha para
 * sempre. Em 14/09/2026 a sessao do Caixa apagou 57 duplicatas de devolucao do
 * Mercado Pago (R$ 4.391,50) e a DRE continuou mostrando -R$ 3.217,00 em
 * agosto, porque a tela remonta da aba Fluxo de Caixa.
 *
 * POR QUE NAO USEI O LAUDO FANTASMA: ele varre a aba inteira e chegou a achar
 * ~2.600 linhas. Serve, mas e amplo demais para um conserto de uma linha da
 * DRE - e operacao ampla no fim de um dia longo e como se erra feio. Esta aqui
 * olha SO o grupo Deducoes da Receita, e so no periodo pedido.
 *
 * NAO APAGA LINHA: marca situacao 5 (cancelada), que e o mesmo tratamento que
 * o reprocessarLinhasSemCategoria_ ja da a conta apagada no Bling. A linha sai
 * da DRE e do caixa mas continua na planilha, com o valor visivel - se a
 * exclusao no Bling tiver sido um erro, da para desfazer trocando o 5 de volta
 * por 2. Apagar linha nao tem volta.
 *
 * @param {string=} desde 'yyyy-MM' (padrao 2026-08)
 * @param {string=} ate   'yyyy-MM' (padrao = desde)
 */
function limparDeducoesFantasma(desde, ate) {
  desde = desde || '2026-08';
  ate = ate || desde;
  var token = getBlingAccessToken_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) return 'Fluxo de Caixa vazio';
  var dados = sheet.getRange(2, 1, ult - 1, 15).getValues();

  var COL_SITUACAO = 3;
  var achadas = 0, fantasmas = 0, vivas = 0, falhou = 0, valorFantasma = 0;
  var detalhe = [];

  for (var i = 0; i < dados.length; i++) {
    var l = dados[i];
    if (semAcento_(l[5]).indexOf('deducoes') < 0) continue;
    var sit = String(l[2] || '').trim();
    if (sit === '5') continue;                       // ja cancelada
    var quando = l[14] || l[0];
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (m < desde || m > ate) continue;

    var id = l[12];
    var tipo = String(l[13] || '').trim();
    if (!id || (tipo !== 'pagar' && tipo !== 'receber')) continue;
    achadas++;

    var r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    if (r.status === 404) {
      sheet.getRange(i + 2, COL_SITUACAO).setValue('5');
      fantasmas++;
      valorFantasma += Math.abs(Number(l[11]) || 0);
      detalhe.push('  ' + m + '  R$ ' + Math.abs(Number(l[11]) || 0).toFixed(2)
                   + '  ' + tipo + ':' + id + '  ' + String(l[10] || '').slice(0, 40));
    } else if (r.status === 200) {
      vivas++;
    } else {
      // status inesperado NAO vira exclusao: 429 ou 500 marcariam conta boa
      // como cancelada, e isso apagaria devolucao real da DRE
      falhou++;
    }
    Utilities.sleep(250);
  }

  var out = ['DEDUCOES FANTASMA de ' + desde + ' a ' + ate,
             '  conferidas no Bling: ' + achadas,
             '  APAGADAS no Bling (marquei cancelada): ' + fantasmas
               + '  =  R$ ' + valorFantasma.toFixed(2),
             '  ainda existem: ' + vivas,
             '  sem resposta (NAO mexi): ' + falhou];
  if (fantasmas) { out.push(''); out.push('as que marquei:'); out = out.concat(detalhe); }
  if (falhou) {
    out.push('');
    out.push('ATENCAO: ' + falhou + ' conta(s) nao responderam. Rode de novo -');
    out.push('status inesperado nao vira exclusao de proposito, senao um 429 do');
    out.push('Bling apagaria devolucao boa da DRE.');
  }
  if (fantasmas) { recalcularDre_(); out.push(''); out.push('DRE recalculada.'); }
  var msg = out.join('\n');
  logSync_('limparDeducoesFantasma', 'ok',
           achadas + ' conferidas, ' + fantasmas + ' fantasma(s), ' + falhou + ' falha(s)');
  Logger.log(msg);
  /* MOSTRA NA TELA quando rodada pela planilha. Logger.log so aparece em
     Execucoes, no editor - a Karolyne rodou pelo menu, olhou a planilha e nao
     tinha nada para ver. Rotina disparada por menu tem de responder onde foi
     disparada; mandar a pessoa procurar o log em outra aba e defeito de quem
     escreveu o menu. try/catch porque getUi() nao existe quando a funcao roda
     por acionador ou pelo editor, e ai o alert derrubaria a execucao INTEIRA
     depois de o trabalho ja estar feito. */
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/** Atalho sem argumento: agosto e setembro, que e onde estao as duplicatas. */
function _rodarLimparDeducoesFantasma() {
  return limparDeducoesFantasma('2026-08', '2026-09');
}

/**
 * A DRE DE UM MES ABERTA POR CATEGORIA, em texto.
 *
 * POR QUE EXISTE, tendo a gaveta na tela: a gaveta e melhor para olhar, mas
 * depende de o JS novo ter chegado ao navegador - e em 14/09/2026 ela nao abria
 * na maquina da Karolyne (cache do index.html) justamente quando ela precisava
 * saber o que compunha Administrativas e Pessoal em abril. Isto roda na
 * planilha, nao depende de cache, de implantacao nem de navegador, e devolve
 * texto que se cola em qualquer lugar.
 *
 * E o mesmo recorte da DRE da tela: COMPETENCIA (coluna 15, caindo na data do
 * caixa quando nao ha competencia), cancelada de fora, sinal pelo tipo.
 *
 * Grupo "(ignorar na DRE)" aparece no fim, separado, porque nao entra no
 * resultado - mas esconder da uma resposta incompleta a "onde foi o dinheiro".
 *
 * @param {string=} mes 'yyyy-MM'. Padrao: mes anterior fechado.
 */
function detalharMes(mes) {
  if (!mes) {
    var d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - 1);
    mes = Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM');
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) return 'Fluxo de Caixa vazio';
  var dados = sheet.getRange(2, 1, ult - 1, 15).getValues();

  var grupos = {};      // grupo -> { total, cats: {cat: valor}, n }
  dados.forEach(function (l) {
    if (String(l[2] || '').trim() === '5') return;            // cancelada
    var quando = l[14] || l[0];
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (m !== mes) return;

    var g = String(l[5] || '(sem grupo)').trim();
    var cat = String(l[4] || '(sem categoria)').trim();
    var v = Math.abs(Number(l[11]) || 0) * (String(l[1]).trim() === 'entrada' ? 1 : -1);
    if (!grupos[g]) grupos[g] = { total: 0, cats: {}, n: 0 };
    grupos[g].total += v;
    grupos[g].cats[cat] = (grupos[g].cats[cat] || 0) + v;
    grupos[g].n++;
  });

  var nomes = Object.keys(grupos);
  var naDre = nomes.filter(function (g) { return g.indexOf('ignorar') < 0; })
    .sort(function (a, b) { return Math.abs(grupos[b].total) - Math.abs(grupos[a].total); });
  var fora = nomes.filter(function (g) { return g.indexOf('ignorar') >= 0; })
    .sort(function (a, b) { return Math.abs(grupos[b].total) - Math.abs(grupos[a].total); });

  var reais = function (v) {
    var t = Math.abs(v).toFixed(2).replace('.', ',');
    return (v < 0 ? '-' : ' ') + 'R$ ' + t;
  };
  var pad = function (t, n) { return (t + '                                        ').slice(0, n); };

  var out = ['DRE DE ' + mes + ' POR CATEGORIA (competencia)', ''];
  var soma = 0;
  var bloco = function (lista, titulo) {
    out.push('=== ' + titulo);
    lista.forEach(function (g) {
      var b = grupos[g];
      out.push('');
      out.push(pad(g, 44) + reais(b.total) + '   (' + b.n + ' lanc.)');
      Object.keys(b.cats)
        .sort(function (x, y) { return Math.abs(b.cats[y]) - Math.abs(b.cats[x]); })
        .forEach(function (c) {
          out.push('    ' + pad(c, 40) + reais(b.cats[c]));
        });
    });
    out.push('');
  };
  bloco(naDre, 'ENTRA NO RESULTADO');
  naDre.forEach(function (g) { soma += grupos[g].total; });
  out.push('SOMA DOS GRUPOS DA DRE: ' + reais(soma));
  out.push('');
  out.push('  ISTO NAO E A DRE. Quatro coisas que a DRE faz e este relatorio nao:');
  out.push('   1. receita vem da aba _Receita_Pedidos, nao das contas a receber;');
  out.push('   2. CMV vem da aba _CMV_Consumo (pecas vendidas x ficha tecnica);');
  out.push('   3. imposto vem da GUIA por competencia, nao do que foi pago;');
  out.push('   4. a PARCELA de emprestimo aparece aqui INTEIRA, e na DRE ela e');
  out.push('      fatiada: so o juro e despesa, a amortizacao sai do resultado');
  out.push('      (ver fatiarEmprestimo_ no Emprestimos.gs). Entao o Resultado');
  out.push('      Financeiro daqui e MAIOR que o da DRE.');
  out.push('  Use este relatorio para saber O QUE tem dentro de cada grupo, nao');
  out.push('  para conferir o total da DRE - eles nao fecham de proposito.');
  out.push('');
  /* SO AS CATEGORIAS DE TRANSFERENCIA, nao o grupo inteiro.
   *
   * A primeira versao somava "Nao Operacional" todo e acusava desequilibrio, e
   * em abril/2026 isso deu um alarme FALSO: o grupo fechou em -R$ 603,29, mas
   * as transferencias em si fecharam em +R$ 172,15 (recebidas 37.316,02 contra
   * saidas 37.143,87) e o resto era "Investimentos" (-725,44) e "Retirada de
   * socio" (-50,00) - que DEVEM ser diferentes de zero, porque sao saida de
   * dinheiro de verdade e nao movimento entre contas proprias.
   *
   * Alarme falso e pior que nenhum alarme: treina a pessoa a ignorar o
   * proximo, e o proximo pode ser o verdadeiro. */
  var transf = grupos['Não Operacional (ignorar na DRE)'];
  if (transf) {
    var saldoTransf = 0, achou = false;
    Object.keys(transf.cats).forEach(function (c) {
      if (semAcento_(c).indexOf('transfer') < 0) return;
      saldoTransf += transf.cats[c];
      achou = true;
    });
    if (achou && Math.abs(saldoTransf) > 1) {
      out.push('  ATENCAO: as TRANSFERENCIAS fecharam em ' + reais(saldoTransf)
               + ' em vez de perto de zero.');
      out.push('  Transferencia entre contas proprias tem duas pernas e deve somar');
      out.push('  zero. Sobra significa perna faltando - saida lancada sem a entrada');
      out.push('  correspondente, ou o contrario. Isso NAO afeta a DRE, mas afeta o');
      out.push('  saldo das carteiras no Bling.');
      out.push('  (Investimento e retirada de socio ficam FORA desta conta: sao');
      out.push('   saida de dinheiro de verdade e devem ser diferentes de zero.)');
      out.push('');
    }
  }
  out.push('');
  if (fora.length) bloco(fora, 'FORA DO RESULTADO (mexe no caixa, nao no lucro)');

  var msg = out.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 6000)); } catch (e) {}
  return msg;
}

/**
 * OS LANCAMENTOS DE UMA CATEGORIA AGRUPADOS POR QUEM RECEBEU.
 *
 * POR QUE AGRUPA POR QUEM: e o nome que separa naturezas que o valor nao
 * separa. Em "Servicos de terceiros" separou costureira de servico de terceiro
 * de verdade; em "Fretes e seguros" separa frete de COMPRA (Uber de tecido,
 * Lalamove, o coco indo ao Bras) de frete de VENDA (envio ao cliente). Sao
 * contas opostas: frete de compra e custo de aquisicao do ESTOQUE, que volta
 * pelo CMV quando a peca vende; frete de venda e despesa variavel do mes.
 *
 * Nasceu como listarServicosTerceiros em 14/09/2026 e virou generica no dia
 * seguinte, quando a Karolyne percebeu que o frete tinha o mesmo problema: uma
 * categoria guardando duas naturezas, e a DRE somando as duas no lugar de uma.
 *
 * Traz o ID DA CONTA de cada linha porque e o que o PENDENCIAS_ precisa para
 * reclassificar depois - sem ele a lista serve para entender e nao para
 * consertar.
 */
function listarCategoria(cat, desde, ate, rotulo) {
  cat = String(cat || '').trim();
  desde = desde || '2026-01';
  ate = ate || '2026-12';
  if (!cat) return 'informe o id da categoria';
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) return 'Fluxo de Caixa vazio';
  var dados = sheet.getRange(2, 1, ult - 1, 15).getValues();

  var porQuem = {}, total = 0, n = 0, nome = rotulo || cat;
  dados.forEach(function (l) {
    if (String(l[3] || '').trim() !== cat) return;
    if (String(l[2] || '').trim() === '5') return;
    var quando = l[14] || l[0];
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (m < desde || m > ate) return;
    if (!rotulo && l[4]) nome = String(l[4]).trim();

    var quem = String(l[8] || '(sem nome)').trim();
    var v = Math.abs(Number(l[11]) || 0);
    if (!porQuem[quem]) porQuem[quem] = { total: 0, linhas: [] };
    porQuem[quem].total += v;
    porQuem[quem].linhas.push('      ' + m + '  R$ ' + v.toFixed(2)
      + '  conta ' + String(l[13] || '') + ':' + String(l[12] || '')
      + '  ' + String(l[10] || '').slice(0, 45));
    total += v;
    n++;
  });

  var out = [nome + ' (' + cat + ') de ' + desde + ' a ' + ate,
             'R$ ' + total.toFixed(2) + ' em ' + n + ' lancamento(s)', '',
             'POR QUEM RECEBEU:'];
  Object.keys(porQuem).sort(function (a, b) { return porQuem[b].total - porQuem[a].total; })
    .forEach(function (q) {
      out.push('');
      out.push('  ' + q + '   ->  R$ ' + porQuem[q].total.toFixed(2)
               + '  (' + porQuem[q].linhas.length + ')');
      porQuem[q].linhas.forEach(function (t) { out.push(t); });
    });
  if (!n) out.push('  (nenhum lancamento no periodo)');

  var msg = out.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 6000)); } catch (e) {}
  return msg;
}

/**
 * Faccao lancada como "Servicos de terceiros" - o caso que originou a funcao.
 * Resolvido em 15/09/2026: as 57 contas de jan-abr foram para 14739931044 pelo
 * PENDENCIAS_. Fica para conferir que a categoria continua limpa.
 */
function listarServicosTerceiros(desde, ate) {
  return listarCategoria('14639321680', desde || '2026-01', ate || '2026-04',
                         'Servicos de terceiros');
}

/**
 * "Fretes e seguros" do ano, para separar frete de COMPRA de frete de VENDA.
 *
 * A categoria esta mapeada em "Despesas Variaveis de Venda", que e o lugar do
 * frete de SAIDA - o que varia com a venda. Mas a Karolyne apontou em
 * 15/09/2026 que na pratica quase tudo ali e ENTRADA: Uber e Lalamove para
 * buscar tecido, e o coco indo ao Bras comprar.
 *
 * Frete de entrada e custo de aquisicao do estoque: sem ele o tecido nao chega,
 * entao ele faz parte do que o tecido custou, e volta pelo CMV quando a peca
 * vende. No lugar errado ele faz duas coisas ruins de uma vez - joga no mes uma
 * despesa que era ativo, e piora a margem de contribuicao POR CANAL, que e a
 * regua de decidir preco e canal.
 */
function listarFretes(desde, ate) {
  return listarCategoria('14639321667', desde || '2026-01', ate || '2026-12',
                         'Fretes e seguros');
}

/** Atalho sem argumento - o seletor do editor nao passa parametro. */
function fretes2026() { return listarFretes('2026-01', '2026-12'); }

/** Quanto a aba _CMV_Consumo tem por mes - responde se jan-abr esta coberto. */
function conferirCmvPorMes() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('_CMV_Consumo');
  if (!sheet || sheet.getLastRow() < 2) return 'A aba _CMV_Consumo esta VAZIA.';
  var d = sheet.getRange(2, 1, sheet.getLastRow() - 1, 5).getValues();
  var porMes = {};
  d.forEach(function (l) {
    var m = l[0] instanceof Date
      ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'yyyy-MM')
      : String(l[0] || '').trim().slice(0, 7);
    if (!m) return;
    if (!porMes[m]) porMes[m] = { valor: 0, pecas: 0, semFicha: 0 };
    porMes[m].valor += Number(l[2]) || 0;
    porMes[m].pecas += Number(l[3]) || 0;
    porMes[m].semFicha += Number(l[4]) || 0;
  });
  var out = ['_CMV_Consumo por mes', '', 'mes        CMV          pecas   sem ficha'];
  Object.keys(porMes).sort().forEach(function (m) {
    var b = porMes[m];
    out.push('  ' + m + '  R$ ' + b.valor.toFixed(2) + '   ' + b.pecas + '   ' + b.semFicha);
  });
  out.push('');
  out.push('Mes que NAO aparece aqui tem CMV zero na DRE - e se a faccao daquele');
  out.push('mes tambem sair de Administrativas, o custo da costura desaparece.');
  var msg = out.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 6000)); } catch (e) {}
  return msg;
}

/** Atalhos sem argumento - o seletor do editor nao passa parametro. */
function terceirosJanAbr() { return listarServicosTerceiros('2026-01', '2026-04'); }
function detalharAbril()    { return detalharMes('2026-04'); }
function detalharJaneiro()  { return detalharMes('2026-01'); }
function detalharAgosto()   { return detalharMes('2026-08'); }

/** Atalho: a linha de Deducoes da Receita de um mes, conta por conta. */
function listarDeducoes(mes) {
  return listarGrupo('deducoes', mes || '2026-08');
}

/**
 * Atalho: o que caiu em "(sem mapear)". A unica categoria mapeada para esse
 * grupo e a 14739989237 "A Classificar (revisar)", entao por construcao e
 * conta que ninguem classificou no Bling.
 *
 * O risco ali nao e o valor, e o rotulo: a receita da DRE vem inteira da aba
 * _Receita_Pedidos, entao se alguem "consertar" essas linhas para dentro da
 * Receita Bruta o faturamento dobra.
 */
function listarSemMapear(mes) {
  return listarGrupo('sem mapear', mes || '2026-09');
}

/**
 * TODO o "(sem mapear)" do ano, separado pelo que resolve cada caso.
 *
 * A primeira versao agrupava so por categoria, e isso escondia a diferenca que
 * importa. Rodada em 14/09/2026, a saida foi R$ 17.789,44 em "0 (sem
 * categoria)" e -R$ 1.291,38 em "A Classificar (revisar)" - dois numeros no
 * mesmo bolo, com consertos OPOSTOS:
 *
 *   FILA (categoria em branco ou 0): a conta TEM categoria no Bling, a planilha
 *   e que ainda nao buscou o detalhe dela. O sync e append-only e a busca de
 *   detalhe roda por fila com teto de 4,5 min, entao o mes mais novo sempre
 *   fica atras. NAO se resolve escrevendo no _DRE_Mapa - se resolve rodando
 *   _rodarReprocessarSemCategoria ate "restam 0".
 *
 *   DECISAO (categoria existe e aponta para "(sem mapear)"): alguem precisa
 *   dizer o que aquilo e. A unica categoria nessa situacao por desenho e a
 *   14739989237 "A Classificar (revisar)", que e canario: tem de ficar
 *   apontando para "(sem mapear)" para nunca sumir calada. O conserto e no
 *   BLING, trocando a categoria da conta.
 *
 * ARMADILHA ao mapear: a receita da DRE vem inteira da aba _Receita_Pedidos,
 * pelo pedido. Se uma conta a receber for "arrumada" para dentro de Receita
 * Bruta, o faturamento dobra. Venda vai para "Venda ja contada pelo pedido
 * (ignorar na DRE)", nunca para Receita Bruta.
 */
function semMapearAno(ano) {
  ano = String(ano || 2026);
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) return 'Fluxo de Caixa vazio';
  var dados = sheet.getRange(2, 1, ult - 1, Math.max(sheet.getLastColumn(), 15)).getValues();

  var balde = {
    fila:    { nome: 'FILA - detalhe nao buscado (conserto: _rodarReprocessarSemCategoria)',
               total: 0, n: 0, porMes: {}, linhas: [] },
    decisao: { nome: 'DECISAO - categoria aponta para (sem mapear) (conserto: no Bling)',
               total: 0, n: 0, porMes: {}, linhas: [] }
  };

  dados.forEach(function (l) {
    if (semAcento_(l[5]).indexOf('sem mapear') < 0) return;
    if (String(l[2] || '').trim() === '5') return;                   // cancelada
    var quando = l[14] || l[0];
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (m.slice(0, 4) !== ano) return;

    var catId = String(l[3] || '').trim();
    var b = (!catId || catId === '0') ? balde.fila : balde.decisao;
    var v = Math.abs(Number(l[11]) || 0) * (String(l[1]).trim() === 'entrada' ? 1 : -1);
    b.total += v;
    b.n++;
    b.porMes[m] = (b.porMes[m] || 0) + v;
    b.linhas.push({
      v: v,
      txt: ['R$ ' + v.toFixed(2),
            (l[0] instanceof Date
              ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'dd/MM')
              : String(l[0]).slice(0, 10)),
            String(l[1]).trim(),
            'cat:' + (catId || 'vazia'),
            String(l[13] || '') + ':' + String(l[12] || ''),
            [l[8], l[9], l[10]].filter(function (x) { return x; }).join(' ').slice(0, 55)
           ].join('  ')
    });
  });

  var out = ['(SEM MAPEAR) em ' + ano + ' - dois baldes, dois consertos diferentes', ''];
  ['fila', 'decisao'].forEach(function (k) {
    var b = balde[k];
    out.push('== ' + b.nome);
    out.push('   R$ ' + b.total.toFixed(2) + ' em ' + b.n + ' linha(s)');
    if (!b.n) { out.push('   (vazio)', ''); return; }
    out.push('   por mes: ' + Object.keys(b.porMes).sort().map(function (m) {
      return m + ' ' + b.porMes[m].toFixed(2);
    }).join(' | '));
    b.linhas.sort(function (a, c) { return Math.abs(c.v) - Math.abs(a.v); });
    out.push('   as maiores:');
    b.linhas.slice(0, 25).forEach(function (a) { out.push('     ' + a.txt); });
    if (b.linhas.length > 25) out.push('     ... e mais ' + (b.linhas.length - 25) + ' linha(s)');
    out.push('');
  });
  out.push('Venda -> "Venda já contada pelo pedido (ignorar na DRE)". NUNCA Receita Bruta.');

  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/* ------------------------------------------------------------------------
 * ATALHOS SEM ARGUMENTO.
 *
 * O dropdown do editor do Apps Script NAO passa argumento: ele so executa a
 * funcao selecionada, e o parametro fica no padrao. Escrevi listarGrupo com
 * (grupo, mes) e a Karolyne nao tinha como pedir julho - e eu ja conhecia esse
 * gotcha, esta documentado em manutencaoCompleta e foi o motivo de
 * recategorizarIPTU imprimir tudo de uma vez.
 *
 * Duas saidas, e as duas valem:
 *   1. da planilha, em qualquer celula vazia: =listarDeducoes("2026-07")
 *      a funcao devolve o texto e ele aparece na celula.
 *   2. do editor, estas funcoes sem parametro nenhum.
 * ---------------------------------------------------------------------- */
function deducoesJulho()    { return listarDeducoes('2026-07'); }
function deducoesAgosto()   { return listarDeducoes('2026-08'); }
function deducoesSetembro() { return listarDeducoes('2026-09'); }
function deducoesResumo()   { return resumoDeducoes(2026); }

/**
 * As Deducoes de TODOS os meses de um ano, so os totais e a contagem - para
 * achar o mes que esta fora do padrao antes de abrir conta por conta.
 */
function resumoDeducoes(ano) {
  ano = String(ano || 2026);
  var out = ['DEDUCOES DA RECEITA por mes, ' + ano, '', 'mes        total       linhas'];
  for (var i = 1; i <= 12; i++) {
    var mes = ano + '-' + (i < 10 ? '0' + i : i);
    var r = listarGrupo('deducoes', mes) || '';
    var m = r.match(/R\$ (-?[\d.]+) em (\d+) linha/);
    out.push('  ' + mes + '  ' + (m ? m[1] : '?') + '  ' + (m ? m[2] : '?'));
  }
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}

/* ============================================================================
 * verTaxasCanais() - SO LEITURA da _Precificacao_Config.
 *
 * POR QUE EXISTE: em 27/09/2026 a tarefa era trocar a taxa da Shopee por
 * 26,96% + R$ 0,00 (all-in 34,38%, decisao da Karol em 25/09). Mas o Setup.gs
 * carrega TRES modelos diferentes de Shopee - 0.163+4.00 (linhas 395/1114/1182),
 * 0.1429 + "Taxa de servico" 0.0998 (linha 1562) e, pior, aplicarFaixasShopee_
 * (linha 1659, migracao de 25/08/2026) que SUBSTITUI a linha unica da Shopee por
 * VARIAS linhas de faixa de preco.
 *
 * Entao nao se sabe, de fora, o que a aba tem hoje: uma linha ou faixas. Gravar
 * 26,96% numa linha unica quando a aba esta em faixas apagaria o modelo por
 * faixa; e gravar faixa por faixa quando ha uma linha so criaria linha morta.
 * Ler custa um Run e evita as duas.
 *
 * Nao grava nada. Rode pelo seletor de funcao do editor e me mande o log.
 * ========================================================================== */
function verTaxasCanais() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRECIFICACAO_CONFIG);
  if (!sh) { Logger.log('Aba ' + ABA_PRECIFICACAO_CONFIG + ' nao existe.'); return; }
  var vals = sh.getDataRange().getValues();
  if (!vals.length) { Logger.log('Aba vazia.'); return; }
  var cab = vals[0].map(function (c) { return String(c).trim(); });
  Logger.log('ABA: ' + ABA_PRECIFICACAO_CONFIG + ' | ' + (vals.length - 1) + ' linha(s) de dado');
  Logger.log('COLUNAS: ' + cab.join(' | '));
  Logger.log('');
  var nShopee = 0;
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[0]).trim() === '') continue;
    var partes = [];
    for (var c = 0; c < cab.length; c++) {
      var v = r[c];
      /* Mostra o valor CRU e o tipo. A escala e a duvida central: 0,163 e
         16,3% mas 16,3 tambem pode ser 16,3% em pontos - e gravar na escala
         errada erra a taxa por 100x sem dar erro. */
      partes.push(cab[c] + '=' + (v === '' ? '(vazio)' : v) + '[' + (typeof v) + ']');
    }
    Logger.log((i + 1) + ': ' + partes.join('  '));
    if (String(r[0]).indexOf('Shopee') === 0) nShopee++;
  }
  Logger.log('');
  Logger.log('LINHAS DE SHOPEE: ' + nShopee + (nShopee > 1 ? '  -> a aba esta em FAIXAS DE PRECO' : '  -> linha unica'));
}

/* ============================================================================
 * gravarTaxaShopee() - grava a linha da Shopee na _Precificacao_Config com a
 * taxa MEDIDA em 28/09/2026.
 *
 * DE ONDE VEM CADA NUMERO (medicao de 3.417 pedidos liquidados, jan-ago/2026,
 * get_escrow_detail um por um; ver [[base-taxas-custos-precificacao]]):
 *
 *   impostosPct   7,74%   aliquota de OUTUBRO informada pelo departamento
 *                         fiscal (Karen) - nao e medicao nossa, e a guia.
 *                         A config tinha 7,42%.
 *   comissaoPct  16,71%   commission_fee do escrow, trimestre jun+jul+ago
 *   extra1       11,41%   service_fee, mesmo trimestre
 *   extra2        0,77%   ads 0,69 + frete da loja 0,08
 *   taxaFixa      R$ 0    seller_order_processing_fee = 0 em 3.417 de 3.417
 *   ------------------------------------------------------------------
 *   plataforma   28,89%   all-in com imposto: 36,63%
 *
 * O ACELERA (5,06%) FICA FORA, DE PROPOSITO - e a correcao mais importante
 * desta funcao. Ele JA esta classificado em "Resultado Financeiro" (categoria
 * 14744322372 do Bling, decisao de 12/09/2026, ver a entrada dela em
 * GRUPO_CANONICO_ neste mesmo arquivo). Antecipar recebivel e custo FINANCEIRO,
 * nao taxa do canal: e escolha que se liga e desliga, e de fato so aparece em
 * 57% dos pedidos.
 *
 * SE ELE ENTRASSE AQUI SERIA CONTADO DUAS VEZES: uma na margem de contribuicao
 * (via esta taxa) e outra no resultado financeiro da DRE. A memoria
 * espelho-shopee-v2-carteira registra o motivo com estas palavras: "Misturado,
 * inflava a taxa que alimenta a Ficha de Preco". Eu quase repeti o erro que
 * essa decisao ja tinha corrigido em agosto.
 *
 * Consequencia para quem for ler um numero de retencao: a retencao TOTAL do
 * escrow e 33,95% e esta certa como retencao. Mas a taxa que vai na Ficha de
 * Preco e 28,89%, porque os 5,06% de Acelera ja sao cobrados noutro lugar da
 * DRE. Os dois numeros estao certos e medem coisas diferentes.
 *
 * POR QUE O TRIMESTRE E NAO O ANO: a taxa SUBIU de forma monotonica, 29,07% em
 * marco para 34,50% em agosto - 5,43 pontos, ~0,5 ponto por mes. A media do ano
 * (31,47%) descreve um passado que nao volta. Custou R$ 6.158 de jan a ago; o
 * run-rate da alta e R$ 21.048/ano a volume constante.
 *
 * ENTAO ESTE NUMERO TEM PRAZO DE VALIDADE. Recalcular por TRIMESTRE e olhar a
 * inclinacao, nao so o nivel. A serie mensal fica no comentario abaixo para a
 * proxima pessoa comparar em vez de remedir do zero:
 *   jan 31,14 · fev 29,96 · mar 29,07 · abr 30,55
 *   mai 31,82 · jun 33,23 · jul 33,86 · ago 34,50
 *
 * O QUE ESTAVA GRAVADO E ERA ERRADO: comissao 14,29 + "Taxa de servico" 9,98 +
 * "Frete e nao detalhado (medido)" 19,09 = 43,36% de plataforma. Os 19,09% eram
 * erro de DENOMINADOR - a retencao foi medida sobre o preco cheio (ancora) em
 * vez do que o cliente pagou, e o desconto da propria loja entrou como taxa da
 * Shopee. Medir certo da residuo ZERO: (bruto - desconto) - taxa = escrow.
 *
 * NAO EXISTE LINHA DE FRETE na Shopee: a loja bancou R$ 75,62 em 3.417 pedidos
 * (R$ 0,02/pedido). A Shopee subsidia 13,06% e o comprador paga 2,81%.
 *
 * So mexe na linha da Shopee. Mostra antes e depois e nao apaga coluna nenhuma.
 * ========================================================================== */
function gravarTaxaShopee() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRECIFICACAO_CONFIG);
  if (!sh) { Logger.log('Aba ' + ABA_PRECIFICACAO_CONFIG + ' nao existe.'); return; }
  var vals = sh.getDataRange().getValues();
  var cab = vals[0].map(function (c) { return String(c).trim(); });
  function col(nome) { var i = cab.indexOf(nome); if (i < 0) throw new Error('coluna ' + nome + ' nao existe'); return i; }
  var iCanal = col('canal'), iImp = col('impostosPct'), iCom = col('comissaoPct'),
      iE1n = col('extra1Nome'), iE1 = col('extra1Pct'), iE2n = col('extra2Nome'),
      iE2 = col('extra2Pct'), iFix = col('taxaFixaReais'), iConf = col('confirmado');

  var linha = -1;
  for (var i = 1; i < vals.length; i++) {
    if (String(vals[i][iCanal]).trim() === 'Shopee') {
      /* Se houver MAIS de uma linha de Shopee, a aba esta no modelo por FAIXA
         DE PRECO (aplicarFaixasShopee_ no Setup.gs) e gravar uma linha unica
         apagaria o modelo mais detalhado. Para em vez de estragar. */
      if (linha >= 0) { Logger.log('MAIS DE UMA linha de Shopee - a aba esta em FAIXAS. Nao vou gravar.'); return; }
      linha = i;
    }
  }
  if (linha < 0) { Logger.log('Nao achei a linha da Shopee.'); return; }

  var antes = vals[linha].slice();
  Logger.log('ANTES : imposto=' + antes[iImp] + ' comissao=' + antes[iCom] +
             ' | ' + antes[iE1n] + '=' + antes[iE1] +
             ' | ' + antes[iE2n] + '=' + antes[iE2] +
             ' | taxaFixa=' + antes[iFix] + ' confirmado=' + antes[iConf]);

  var r = linha + 1;
  sh.getRange(r, iImp + 1).setValue(0.0774);
  sh.getRange(r, iCom + 1).setValue(0.1671);
  sh.getRange(r, iE1n + 1).setValue('Taxa de serviço');
  sh.getRange(r, iE1 + 1).setValue(0.1141);
  sh.getRange(r, iE2n + 1).setValue('Ads + frete (medido)');
  sh.getRange(r, iE2 + 1).setValue(0.0077);
  sh.getRange(r, iFix + 1).setValue(0);
  sh.getRange(r, iConf + 1).setValue(true);
  SpreadsheetApp.flush();

  var d = sh.getRange(r, 1, 1, cab.length).getValues()[0];
  Logger.log('DEPOIS: imposto=' + d[iImp] + ' comissao=' + d[iCom] +
             ' | ' + d[iE1n] + '=' + d[iE1] +
             ' | ' + d[iE2n] + '=' + d[iE2] +
             ' | taxaFixa=' + d[iFix] + ' confirmado=' + d[iConf]);
  var pl = Number(d[iCom]) + Number(d[iE1]) + Number(d[iE2]);
  Logger.log('plataforma ' + (pl * 100).toFixed(2) + '%  |  all-in ' +
             ((pl + Number(d[iImp])) * 100).toFixed(2) + '%');

  /* O imposto e da EMPRESA, nao do canal: os 7,74% de outubro valem para todos.
     Nao mexo nas outras linhas sem a Karolyne pedir, mas mostro para ela ver
     que ficaram atras. */
  Logger.log('');
  Logger.log('impostosPct das OUTRAS linhas (a aliquota e da empresa, nao do canal):');
  for (var j = 1; j < vals.length; j++) {
    var c = String(vals[j][iCanal]).trim();
    if (!c || c === 'Shopee' || c === '_GLOBAL') continue;
    Logger.log('   ' + c + ': ' + vals[j][iImp] + (Number(vals[j][iImp]) !== 0.0774 ? '   <- atrasado' : ''));
  }
}

/* ============================================================================
 * receitaEDevolucaoPorMes() - SO LEITURA. Serve para responder UMA pergunta:
 * o buraco entre a devolucao MEDIDA nas APIs e a linha "Devolucoes de vendas"
 * da DRE e defasagem de data ou e buraco permanente?
 *
 * Medido nas APIs, jan-ago/2026 (sessao DRE, 28/09):
 *   cancelamento  Shopee R$ 24.576,80 + ML R$ 11.052,11 = R$ 35.628,91
 *   devolucao     Shopee R$ 14.867,27 + ML R$    290,10 = R$ 15.157,37
 *   (no ML 191 dos 193 pedidos reembolsados sao CANCELAMENTO, nao devolucao)
 *
 * COMO A RESPOSTA SE LE:
 *  - se o TOTAL do ano bate e so os meses individuais divergem -> e defasagem
 *    de data (devolucao pedida no fim do mes sai no mes seguinte), e e benigna;
 *  - se o total do ano fica CURTO -> ha devolucao que nunca chega ao Bling, e
 *    ai importa saber se a receita correspondente chegou. Cancelamento do ML
 *    nao chega ao Bling (o ML so importa pedido confirmado), e se a receita
 *    tambem nao chegou, nao deduzir esta CERTO - as duas pernas faltam juntas.
 *    Por isso esta funcao imprime RECEITA e DEVOLUCAO lado a lado: uma sozinha
 *    nao responde.
 *
 * Descobre o layout da aba de receita pelo cabecalho em vez de assumir indice -
 * o BlingSync enderessa por indice fixo e eu nao quero depender disso aqui.
 * ========================================================================== */
function receitaEDevolucaoPorMes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var CAT_DEVOLUCAO = '14639321656';

  // ---- 1) a aba de receita, com o cabecalho impresso para conferencia ----
  var shR = ss.getSheetByName('_Receita_Pedidos');
  if (!shR) { Logger.log('aba _Receita_Pedidos nao existe'); }
  else {
    var vr = shR.getDataRange().getValues();
    var cr = vr[0].map(function (c) { return String(c).trim(); });
    Logger.log('_Receita_Pedidos | ' + (vr.length - 1) + ' linhas');
    Logger.log('  COLUNAS: ' + cr.join(' | '));
    function ix(nomes) {
      for (var k = 0; k < nomes.length; k++) { var i = cr.indexOf(nomes[k]); if (i >= 0) return i; }
      return -1;
    }
    var iData = ix(['data', 'dataPedido', 'dataEmissao']);
    var iVal = ix(['total', 'valor', 'receita', 'totalPedido']);
    var iSit = ix(['situacao', 'situacaoId']);
    var iLoja = ix(['loja', 'lojaNome', 'canal']);
    Logger.log('  usando: data=' + cr[iData] + ' valor=' + cr[iVal] +
               ' situacao=' + (iSit >= 0 ? cr[iSit] : '(nao tem)') +
               ' loja=' + (iLoja >= 0 ? cr[iLoja] : '(nao tem)'));
    var rec = {}, sits = {};
    for (var i = 1; i < vr.length; i++) {
      var d = vr[i][iData]; if (!d) continue;
      var mes = Utilities.formatDate(new Date(d), 'America/Sao_Paulo', 'yyyy-MM');
      if (mes < '2026-01' || mes > '2026-08') continue;
      rec[mes] = (rec[mes] || 0) + (Number(vr[i][iVal]) || 0);
      if (iSit >= 0) {
        var s = String(vr[i][iSit]).trim();
        sits[s] = (sits[s] || 0) + (Number(vr[i][iVal]) || 0);
      }
    }
    Logger.log('  receita por mes:');
    Object.keys(rec).sort().forEach(function (m) { Logger.log('    ' + m + '  R$ ' + rec[m].toFixed(2)); });
    if (iSit >= 0) {
      /* A pergunta que isto responde: a receita INCLUI pedido cancelado? Se
         incluir, a deducao de devolucao/cancelamento e obrigatoria; se nao
         incluir, deduzir seria contar o cancelamento duas vezes. */
      Logger.log('  receita por SITUACAO (a de cancelado aparece aqui?):');
      Object.keys(sits).sort().forEach(function (s) { Logger.log('    situacao "' + s + '"  R$ ' + sits[s].toFixed(2)); });
    }
  }

  // ---- 2) a linha de devolucao, pelas duas datas ----
  var shF = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!shF) { Logger.log('aba ' + ABA_FLUXO_CAIXA + ' nao existe'); return; }
  var vf = shF.getDataRange().getValues();
  var porData = {}, porComp = {}, qtd = {};
  for (var j = 1; j < vf.length; j++) {
    if (String(vf[j][3]).trim() !== CAT_DEVOLUCAO) continue;
    if (String(vf[j][2]).trim() === '5') continue;   // 5 = cancelada, o painel ignora
    var v = Math.abs(Number(vf[j][11]) || 0);
    var dd = vf[j][0], dc = vf[j][14] || vf[j][0];
    if (dd) { var m1 = Utilities.formatDate(new Date(dd), 'America/Sao_Paulo', 'yyyy-MM');
              porData[m1] = (porData[m1] || 0) + v; qtd[m1] = (qtd[m1] || 0) + 1; }
    if (dc) { var m2 = Utilities.formatDate(new Date(dc), 'America/Sao_Paulo', 'yyyy-MM');
              porComp[m2] = (porComp[m2] || 0) + v; }
  }
  Logger.log('');
  Logger.log('Devolucoes de vendas (categoria ' + CAT_DEVOLUCAO + '), 2026:');
  Logger.log('mes       por DATA (caixa)   por COMPETENCIA   lanc.');
  var tD = 0, tC = 0;
  for (var m = 1; m <= 8; m++) {
    var k = '2026-' + (m < 10 ? '0' + m : m);
    var a = porData[k] || 0, b = porComp[k] || 0;
    tD += a; tC += b;
    Logger.log('  ' + k + '   ' + a.toFixed(2) + '   ' + b.toFixed(2) + '   ' + (qtd[k] || 0));
  }
  Logger.log('  TOTAL     ' + tD.toFixed(2) + '   ' + tC.toFixed(2));
  Logger.log('');
  Logger.log('MEDIDO nas APIs no mesmo periodo: devolucao R$ 15.157,37 | cancelamento R$ 35.628,91');
  Logger.log('Se o total acima estiver perto de 15.157 -> defasagem de data, benigna.');
  Logger.log('Se estiver muito abaixo -> conferir se a RECEITA tambem exclui esses pedidos.');
}

/* ============================================================================
 * recategorizarJanAgo() - atalho para recategorizarPeriodo em jan-ago/2026.
 *
 * POR QUE EXISTE: a Karolyne reclassificou lancamentos de "Servicos de
 * terceiros" para "Faccao" no Bling, de janeiro a agosto, e o editor do Apps
 * Script nao deixa passar argumento no botao Run. Sem este atalho ela rodaria
 * recategorizarPeriodo sem argumento, que cobre so 01/08 a 30/09 - e os meses
 * de janeiro a julho ficariam com a categoria velha, calados.
 *
 * ROTAR ATE DAR "fila inteira". A funcao tem cursor e para no teto de tempo do
 * Google; oito meses de conta e muita chamada ao Bling. O log termina em
 * "parei por tempo, rode de novo pra continuar" ou "fila inteira".
 *
 * O QUE ELA MEXE NO RESULTADO, e nao e lucro novo: "Servicos de terceiros" esta
 * em Despesas Administrativas, DENTRO do resultado. "Faccao" esta em
 * "Estoque (ignorar na DRE)", FORA - o custo passa a entrar so pelo CMV, quando
 * a peca vende. Entao o resultado do mes MELHORA, e o custo tem que reaparecer
 * no CMV.
 *
 * CONFERIR DEPOIS com conferirCmvPorMes(). Se o resultado melhorou e o CMV NAO
 * subiu, o custo desapareceu - e ai e o problema espelhado do que consertamos
 * em 27/09, quando a faccao estava contada DUAS VEZES (Administrativas + CMV,
 * R$ 24.593,20 em jan-abr).
 *
 * Nao disputa token com as sessoes de PowerShell: o Apps Script tem refresh
 * token proprio em ScriptProperties (BLING_REFRESH_TOKEN), separado do
 * bling_config.json.
 * ========================================================================== */
function recategorizarJanAgo() {
  return recategorizarPeriodo('2026-01-01', '2026-08-31');
}

/* ============================================================================
 * resincronizarCategoria() - re-le no Bling SO as contas que ainda estao numa
 * categoria especifica. Nasceu de um erro meu, em 04/10/2026.
 *
 * O QUE DEU ERRADO: mandei ela rodar recategorizarJanAgo pra trazer a troca de
 * "Servicos de terceiros" -> "Faccao". A primeira rodada voltou
 * "462/17170 conferidas, 0 categoria(s) corrigida(s)". 17.170 e TODA conta de
 * oito meses - a funcao confere a planilha inteira, uma chamada ao Bling por
 * conta, 300ms cada. Daria ~37 cliques e quase 3 horas pra achar algumas
 * dezenas de linhas. A ferramenta certa pra "sincronizar tudo" e a errada pra
 * "ela mudou UMA categoria".
 *
 * A LICAO, que vale alem daqui: quando se sabe O QUE mudou, varrer tudo nao e
 * conservador, e desperdicio - e desperdicio que faz a pessoa desistir no meio
 * e ficar com meia correcao aplicada, que e pior que nenhuma.
 *
 * O FILTRO: a conta que precisa ser relida e exatamente a que ainda esta com a
 * categoria VELHA na planilha. Se o Bling ja diz outra coisa, grava; se diz a
 * mesma, nao mexe. Quem ja foi corrigido nao volta pra fila.
 *
 * RATEIO continua de fora: conta com varias linhas tem a categoria do rateio e
 * nao a da conta - sobrescrever apagaria a divisao. Elas sao contadas e
 * avisadas, pra sumirem como numero e nao em silencio.
 * ========================================================================== */
function resincronizarCategoria(idCategoria, desde, ate) {
  idCategoria = String(idCategoria || '').trim();
  desde = desde || '2026-01-01';
  ate = ate || '2026-08-31';
  if (!idCategoria) return 'informe a categoria';

  INICIO_SYNC_.t = Date.now();
  const token = getBlingAccessToken_();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  const ultimaLinha = sheet.getLastRow();
  if (ultimaLinha < 2) return 'planilha vazia';

  const COL_DATA = 1, COL_CATEGORIA_ID = 4, COL_ORIGEM_ID = 13, COL_ORIGEM_TIPO = 14;
  const dados = sheet.getRange(2, 1, ultimaLinha - 1, 14).getValues();

  // Agrupa por CONTA, igual ao recategorizarPeriodo - mas so entra na fila a
  // conta que tem pelo menos uma linha na categoria procurada.
  const porConta = {}, alvo = {};
  dados.forEach(function (linha, i) {
    const d = linha[COL_DATA - 1];
    const txt = d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM-dd')
      : String(d || '').trim().slice(0, 10);
    if (txt < desde || txt > ate) return;
    const chave = linha[COL_ORIGEM_TIPO - 1] + ':' + linha[COL_ORIGEM_ID - 1];
    if (!porConta[chave]) porConta[chave] = [];
    porConta[chave].push(i + 2);
    if (String(linha[COL_CATEGORIA_ID - 1] || '').trim() === idCategoria) alvo[chave] = 1;
  });

  const fila = Object.keys(alvo).sort();
  let corrigidas = 0, vistas = 0, pulouRateio = 0, parou = false, semId = 0;
  const destinos = {};

  for (let k = 0; k < fila.length; k++) {
    if (tempoGasto_() > TETO_TOTAL_MS) { parou = true; break; }
    const chave = fila[k];
    const linhas = porConta[chave];
    if (linhas.length > 1) { pulouRateio++; continue; }
    const partes = chave.split(':');
    if (!partes[0] || !partes[1]) { semId++; continue; }
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
    destinos[nova] = (destinos[nova] || 0) + 1;
  }

  if (corrigidas) {
    reaplicarMapaDre_(sheet, getMapaCategoria_());
    recalcularDre_();
  }

  let msg = 'categoria ' + idCategoria + ' em ' + desde + '..' + ate + ': '
    + fila.length + ' conta(s) na fila, ' + vistas + ' lida(s) no Bling, '
    + corrigidas + ' corrigida(s)';
  if (pulouRateio) msg += ', ' + pulouRateio + ' com rateio (pulei - a categoria da linha e a do rateio)';
  if (semId) msg += ', ' + semId + ' sem id de origem';
  const ids = Object.keys(destinos);
  if (ids.length) {
    msg += '. Foram para: ' + ids.map(function (x) { return x + ' (' + destinos[x] + ')'; }).join(', ');
  }
  msg += parou ? ' - PAREI POR TEMPO, rode de novo' : ' - fila inteira';
  logSync_('resincronizarCategoria', 'ok', msg);
  Logger.log(msg);
  return msg;
}

/* "Servicos de terceiros" = 14639321680. E a categoria que ela esvaziou no
   Bling passando tudo para Faccao; por isso a fila sao exatamente as contas
   que ainda estao nela aqui. */
function resincronizarFaccao() {
  return resincronizarCategoria('14639321680', '2026-01-01', '2026-08-31');
}

function _rodarResincronizarFaccao() {
  var msg = resincronizarFaccao();
  var falta = String(msg).indexOf('fila inteira') < 0;
  SpreadsheetApp.getUi().alert(
    falta ? 'Parei por tempo - rode de novo' : 'Terminou',
    String(msg) + '\n\n'
      + (falta
         ? 'Clique no mesmo item outra vez.'
         : 'Agora rode "Conferir CMV por mes". O resultado de jan-ago vai\n'
           + 'MELHORAR (a faccao sai de Despesas Administrativas), e o CMV tem\n'
           + 'que SUBIR junto. Se o CMV nao subir, o custo sumiu - me avise.'),
    SpreadsheetApp.getUi().ButtonSet.OK);
  return msg;
}

/* ----------------------------------------------------------------------------
 * _rodarRecategorizarJanAgo() - o que o MENU chama.
 *
 * POR QUE EXISTE (04/10/2026): ela clicou no menu e disse "rodei mas nao saiu
 * log". O log saiu - em dois lugares que ela nao estava olhando. Rodando pelo
 * MENU da planilha, `Logger.log` nao aparece em lugar nenhum da tela: so em
 * Extensoes > Apps Script > Execucoes. E `logSync_` grava na aba _Sync_Log,
 * que e oculta.
 *
 * Funcao que a pessoa dispara por botao tem que responder na tela do botao.
 * Como `recategorizarPeriodo` ja DEVOLVE a mensagem pronta, basta mostra-la -
 * e o alert ainda resolve a parte mais importante, que e saber se precisa
 * rodar de novo: a mensagem termina em "parei por tempo, rode de novo pra
 * continuar" ou em "fila inteira".
 * -------------------------------------------------------------------------- */
function _rodarRecategorizarJanAgo() {
  var msg = recategorizarJanAgo();
  var falta = String(msg).indexOf('fila inteira') < 0;
  SpreadsheetApp.getUi().alert(
    falta ? 'Ainda falta - rode de novo' : 'Terminou: fila inteira',
    String(msg) + '\n\n'
      + (falta
         ? 'A fila nao acabou. Clique no mesmo item do menu outra vez, ate a\n'
           + 'mensagem terminar em "fila inteira".'
         : 'Pode seguir para "Conferir CMV por mes".')
      + '\n\nEste mesmo texto fica gravado na aba _Sync_Log (oculta).',
    SpreadsheetApp.getUi().ButtonSet.OK);
  return msg;
}

/* ============================================================================
 * skusSemFicha() - SO LEITURA. Acha QUAIS produtos saem sem ficha tecnica.
 *
 * POR QUE IMPORTA: peca sem ficha entra no CMV com custo ZERO. Logo o CMV fica
 * subestimado e o resultado da DRE sai OTIMISTA - em todo mes. Medido pelo
 * conferirCmvPorMes de 29/09/2026:
 *
 *   mes    pecas  s/ficha    %     CMV que falta (ao custo medio do mes)
 *   jan     1292      50    3,9%        700,37
 *   fev     1243      60    4,8%      1.031,14
 *   mar     1666     376   22,6%      6.735,36
 *   abr     1390     150   10,8%      2.463,74
 *   mai     1059     146   13,8%      2.295,26
 *   jun      874      91   10,4%      1.408,74
 *   jul     1320     346   26,2%      5.059,24
 *   ago     1189      28    2,4%        383,16
 *   set      621     267   43,0%      3.702,84
 *   TOTAL                            23.779,85
 *
 * R$ 23.780 de custo que nao esta em DRE nenhuma. O prejuizo apurado de 2026 e
 * R$ 11.576 - entao o real e mais perto de R$ 35 mil. E setembro, com 43%, e o
 * mes corrente: esta piorando.
 *
 * ESTA FUNCAO NAO ASSUME O LAYOUT. Imprime o cabecalho e uma amostra crua,
 * porque eu NAO ACHEI quem escreve a _CMV_Consumo - nem no repo do painel nem
 * nos scripts do Drive. Pode ser colagem manual ou outro projeto. Sem saber
 * quem escreve, chutar nome de coluna produziria uma lista errada com cara de
 * certa. Primeiro ver, depois listar.
 *
 * Se a aba nao tiver coluna de SKU, o caminho e outro: cruzar as pecas vendidas
 * contra _Precificacao_SKU e achar as que nao casam. Esta funcao tambem conta
 * quantos SKU existem em _Precificacao_SKU, para dimensionar isso.
 * ========================================================================== */
function skusSemFicha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName('_CMV_Consumo');
  if (!sh || sh.getLastRow() < 2) { Logger.log('_CMV_Consumo vazia ou inexistente'); return; }

  var nCol = sh.getLastColumn(), nLin = sh.getLastRow();
  Logger.log('_CMV_Consumo: ' + (nLin - 1) + ' linhas x ' + nCol + ' colunas');
  var cab = sh.getRange(1, 1, 1, nCol).getValues()[0];
  Logger.log('CABECALHO: ' + cab.map(function (c, i) { return (i + 1) + '=' + String(c).trim(); }).join(' | '));
  Logger.log('');

  var d = sh.getRange(2, 1, nLin - 1, nCol).getValues();
  Logger.log('AMOSTRA (3 primeiras linhas, valor cru e tipo):');
  for (var i = 0; i < Math.min(3, d.length); i++) {
    Logger.log('  linha ' + (i + 2) + ': ' + d[i].map(function (v) {
      return (v === '' ? '(vazio)' : v) + '[' + (typeof v) + ']';
    }).join('  '));
  }
  Logger.log('');

  /* A coluna 5 e a que o conferirCmvPorMes soma como "sem ficha". Se a aba for
     por SKU, cada linha com coluna5 > 0 nomeia um produto; se for agregada por
     mes, vai ter ~9 linhas e nao ha SKU aqui. O numero de linhas ja diz qual e
     o caso, e por isso imprimo antes de tentar listar. */
  var semF = [];
  for (var j = 0; j < d.length; j++) if ((Number(d[j][4]) || 0) > 0) semF.push(j + 2);
  Logger.log('linhas com "sem ficha" > 0: ' + semF.length);
  if (semF.length <= 40) {
    for (var k = 0; k < semF.length; k++) {
      var L = d[semF[k] - 2];
      Logger.log('  L' + semF[k] + ': ' + L.map(function (v) { return v === '' ? '-' : v; }).join(' | '));
    }
  } else {
    Logger.log('  (muitas - mostrando as 20 com mais pecas sem ficha)');
    semF.sort(function (a, b) { return (Number(d[b-2][4])||0) - (Number(d[a-2][4])||0); });
    for (var k2 = 0; k2 < 20; k2++) {
      var L2 = d[semF[k2] - 2];
      Logger.log('  L' + semF[k2] + ': ' + L2.map(function (v) { return v === '' ? '-' : v; }).join(' | '));
    }
  }

  // dimensiona o outro caminho
  var shS = ss.getSheetByName('_Precificacao_SKU');
  if (shS && shS.getLastRow() > 1) {
    Logger.log('');
    Logger.log('_Precificacao_SKU tem ' + (shS.getLastRow() - 1) + ' linha(s) - e o catalogo de fichas.');
    Logger.log('CABECALHO: ' + shS.getRange(1, 1, 1, shS.getLastColumn()).getValues()[0].join(' | '));
  }
}

/* ============================================================================
 * variaveisPorMes() - SO LEITURA. Por que agosto teve tanta Despesa Variavel
 * de Venda, e se tem duplicidade.
 *
 * PERGUNTA DA KAROLYNE EM 04/10/2026: "em agosto tivemos muita despesa
 * variavel em relacao aos outros meses, precisamos ver qual a diferenca pra
 * ver se nao tem duplicidade tambem".
 *
 * POR QUE PELA PLANILHA E NAO PELA API DO BLING: a listagem de contas do Bling
 * devolve categoria SEMPRE VAZIA (medido: 0 preenchidos em 584 registros) - so
 * o detalhe conta por conta traz, e seriam milhares de chamadas. A planilha ja
 * tem categoria e grupo em cada linha.
 *
 * O GRUPO TEM TRES CATEGORIAS, e elas misturam naturezas opostas:
 *   14639321698 Taxas do marketplace   - comissao, servico, ads, e os ACERTOS
 *   14639321695 Descontos concedidos   - comissao Shopee legada
 *   14639321667 Fretes e seguros       - frete de VENDA e de COMPRA juntos
 *
 * O NUMERO CONTRA O QUAL ISTO TEM QUE BATER: medi taxa+frete+ads direto nas
 * APIs da Shopee e do ML (jan-ago/2026). Agosto deu R$ 13.804,70 (taxa
 * 10.787,76 + frete 2.836,86 + ads 180,08) e NAO foi o pico - abril deu
 * R$ 16.853,11. Se a planilha mostrar agosto muito acima de 13.804, a
 * diferenca nao veio do marketplace e nasceu aqui dentro.
 *
 * DUAS FONTES CONHECIDAS DE LANCAMENTO QUE NAO E TAXA DE PEDIDO, e as duas
 * cairam nesta categoria de proposito no passado:
 *   - ACERTO da carteira Shopee (o Acelera so aparece no extrato da carteira,
 *     nunca no relatorio de vendas). Teve um de R$ 2.784,46 em 31/07/2026.
 *   - FRETE DE COMPRA (Bras, Uber, coco) que mora em "Fretes e seguros".
 * Por isso o relatorio separa por categoria E lista por descricao: acerto e
 * frete de compra se denunciam pelo nome, nao pelo valor.
 *
 * COMO LER A DUPLICIDADE: agrupa por valor absoluto + descricao normalizada
 * dentro do mes. Duas linhas com mesmo valor e mesma descricao sao CANDIDATAS,
 * nao prova - taxa de dois pedidos do mesmo preco e legitima e comum. Por isso
 * imprime data e situacao de cada uma: duplicata de verdade costuma ter a
 * MESMA data; taxa de pedido diferente, nao. Ver tambem
 * bling-retry-duplica-lancamento: retry em timeout grava 2x.
 *
 * Nao muda nada. Nenhuma escrita, nenhuma chamada ao Bling.
 * ========================================================================== */
function variaveisPorMes(mesFoco) {
  var ALVO = 'despesas variaveis de venda';
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  if (ult < 2) { Logger.log('Fluxo de Caixa vazio'); return; }
  var dados = sheet.getRange(2, 1, ult - 1, Math.max(sheet.getLastColumn(), 15)).getValues();

  var porMes = {}, porMesCat = {}, linhasDoFoco = [];

  dados.forEach(function (l) {
    if (semAcento_(l[5]).indexOf(ALVO) < 0) return;
    var sit = String(l[2] || '').trim();
    if (sit === '5') return;                       // cancelada nao aconteceu
    // COMPETENCIA, igual a DRE: coluna 14, com fallback no vencimento quando
    // o sync nao gravou competencia.
    var quando = l[14] || l[0];
    var m = quando instanceof Date
      ? Utilities.formatDate(quando, 'America/Sao_Paulo', 'yyyy-MM')
      : String(quando || '').trim().slice(0, 7);
    if (!m) return;

    var v = Math.abs(Number(l[11]) || 0);
    var cat = String(l[4] || '(sem categoria)');
    porMes[m] = (porMes[m] || 0) + v;
    porMesCat[m] = porMesCat[m] || {};
    porMesCat[m][cat] = (porMesCat[m][cat] || 0) + v;

    if (m === mesFoco) {
      var dt = l[0] instanceof Date
        ? Utilities.formatDate(l[0], 'America/Sao_Paulo', 'dd/MM')
        : String(l[0] || '').slice(0, 10);
      linhasDoFoco.push({
        data: dt, v: v, cat: cat, sit: sit,
        desc: [l[8], l[9], l[10]].filter(function (x) { return x; }).join(' ')
      });
    }
  });

  var meses = Object.keys(porMes).sort();
  var cats = {};
  meses.forEach(function (m) {
    Object.keys(porMesCat[m]).forEach(function (c) { cats[c] = 1; });
  });
  var listaCats = Object.keys(cats).sort();

  Logger.log('=== DESPESAS VARIAVEIS DE VENDA, por competencia ===');
  Logger.log('mes      | ' + listaCats.map(function (c) { return c.slice(0, 20); }).join(' | ') + ' | TOTAL');
  var soma = 0, pico = '', vpico = 0;
  meses.forEach(function (m) {
    var partes = listaCats.map(function (c) { return (porMesCat[m][c] || 0).toFixed(2); });
    Logger.log(m + ' | ' + partes.join(' | ') + ' | ' + porMes[m].toFixed(2));
    soma += porMes[m];
    if (porMes[m] > vpico) { vpico = porMes[m]; pico = m; }
  });
  Logger.log('TOTAL do periodo: ' + soma.toFixed(2));
  Logger.log('MES MAIS ALTO: ' + pico + ' com ' + vpico.toFixed(2));
  Logger.log('');
  Logger.log('REFERENCIA MEDIDA NAS APIs (Shopee + ML, taxa+frete+ads):');
  Logger.log('  abr 16.853,11 / mai 13.060,44 / jun 10.235,19 / jul 13.013,15 / ago 13.804,70');
  Logger.log('  Linha da planilha MUITO acima da referencia = sobra que nao e taxa de pedido.');

  if (!mesFoco) {
    Logger.log('');
    Logger.log('Para abrir um mes: variaveisPorMes("' + pico + '")');
    return;
  }

  // ------------------------------------------- o mes aberto, por descricao
  Logger.log('');
  Logger.log('=== ' + mesFoco + ' ABERTO (' + linhasDoFoco.length + ' lancamento(s)) ===');

  var chave = {};
  linhasDoFoco.forEach(function (x) {
    var k = x.v.toFixed(2) + ' | ' + semAcento_(x.desc).slice(0, 60);
    chave[k] = chave[k] || [];
    chave[k].push(x);
  });

  var dups = Object.keys(chave).filter(function (k) { return chave[k].length > 1; });
  dups.sort(function (a, b) {
    return chave[b].length * chave[b][0].v - chave[a].length * chave[a][0].v;
  });

  Logger.log('');
  Logger.log('--- CANDIDATAS A DUPLICIDADE (mesmo valor + mesma descricao) ---');
  if (!dups.length) {
    Logger.log('  nenhuma. Se o mes esta alto, nao e linha repetida - e valor grande.');
  } else {
    var suspeito = 0;
    dups.forEach(function (k) {
      var g = chave[k];
      var datas = {};
      g.forEach(function (x) { datas[x.data] = 1; });
      var mesmaData = Object.keys(datas).length === 1;
      if (mesmaData) { suspeito += g[0].v * (g.length - 1); }
      Logger.log('  ' + (mesmaData ? '[MESMA DATA] ' : '[datas diferentes] ')
                 + g.length + 'x ' + g[0].v.toFixed(2)
                 + '  ' + g[0].cat.slice(0, 24)
                 + '  ' + g[0].desc.slice(0, 50));
      Logger.log('      datas: ' + Object.keys(datas).join(', ')
                 + '   situacoes: ' + g.map(function (x) { return x.sit; }).join(','));
    });
    Logger.log('');
    Logger.log('  SE todas as [MESMA DATA] forem duplicata, sobrariam ' + suspeito.toFixed(2));
    Logger.log('  (nao apagar nada sem conferir no Bling: taxa de dois pedidos do');
    Logger.log('   mesmo preco no mesmo dia e legitima.)');
  }

  // os maiores lancamentos do mes - e onde mora um acerto
  linhasDoFoco.sort(function (a, b) { return b.v - a.v; });
  Logger.log('');
  Logger.log('--- OS 15 MAIORES DO MES (acerto e frete de compra aparecem aqui) ---');
  linhasDoFoco.slice(0, 15).forEach(function (x) {
    Logger.log('  ' + x.data + '  ' + x.v.toFixed(2) + '  ' + x.cat.slice(0, 22)
               + '  ' + x.desc.slice(0, 55));
  });
}

function variaveisResumo() { return variaveisPorMes(); }
function variaveisAgosto() { return variaveisPorMes('2026-08'); }
