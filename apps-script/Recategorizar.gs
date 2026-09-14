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
  '23969868959': 14744752723    // venc 10/09  3.853,47
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
  out.push('  (nao e o resultado da tela: receita, CMV e imposto vem das abas');
  out.push('   _Receita_Pedidos, _CMV_Consumo e das guias, nao destes lancamentos)');
  out.push('');
  if (fora.length) bloco(fora, 'FORA DO RESULTADO (mexe no caixa, nao no lucro)');

  var msg = out.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg.slice(0, 6000)); } catch (e) {}
  return msg;
}

/** Atalhos sem argumento - o seletor do editor nao passa parametro. */
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
