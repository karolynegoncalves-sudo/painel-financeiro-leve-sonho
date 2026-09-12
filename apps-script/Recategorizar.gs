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
    + '\n\n' + conferirFaturasPorData()
    + '\n\n' + conferirFaturasPorPortador();
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
  // O id entra aqui quando a categoria for criada no Bling.
  // '<id>': 'Cartão a ratear (ignorar na DRE)'

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
  // receita outra vez - vai para "Receita pelo pedido (ignorar na DRE)", que
  // existe so para isso. Em 12/09/2026 foram 247 contas, R$ 17.563,96, que sem
  // este mapeamento apareceriam como receita nova.
  , '14639321643': 'Receita pelo pedido (ignorar na DRE)'   // Vendas de produtos
  //
  // Mesma logica para o desconto: se a receita ja entra liquida, deduzir o
  // desconto DE NOVO conta duas vezes. "Descontos incondicionais" fica fora do
  // resultado por isso. CUIDADO com a categoria 14639321695 ("Descontos
  // concedidos"), que esta mapeada como Despesas Variaveis de Venda porque
  // historicamente recebia COMISSAO da Shopee, nao desconto - se um espelho
  // novo passar a lancar desconto ali, o desconto volta a ser contado duas
  // vezes e o mapeamento dela tem que mudar junto.
  , '14639321657': 'Desconto de vitrine (ignorar na DRE)'   // Descontos incondicionais
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
  '26591060145': 14639321671
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

/**
 * As faturas conferidas por PORTADOR e mes, sem depender da data.
 *
 * conferirFaturasPorData tem um ponto cego: se a fatura foi lancada com outra
 * data que nao a do vencimento, a soma do dia nao a encontra e o resultado
 * parece "faltando" sem estar. Toda linha da fatura de um cartao carrega o
 * mesmo portador, em qualquer data - entao somar por (portador, mes) responde
 * sem adivinhar o dia.
 *
 * Imprime os dois lados: o total das faturas do mes (dos extratos, em
 * FATURAS_2026) e o que cada portador tem na planilha naquele mes.
 */
function conferirFaturasPorPortador() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  var ult = sheet.getLastRow();
  var COL_DATA = 1, COL_TIPO = 2, COL_PORT_NOME = 8, COL_VALOR = 12;
  var dados = sheet.getRange(2, 1, ult - 1, 15).getValues();

  var porta = {};      // portador -> mes -> {total, linhas}
  dados.forEach(function (l) {
    if (String(l[COL_TIPO - 1]).trim() !== 'saida') return;
    var d = l[COL_DATA - 1];
    var mes = (d instanceof Date
      ? Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy-MM')
      : String(d || '').trim().slice(0, 7));
    if (mes < '2026-01' || mes > '2026-08') return;
    var p = String(l[COL_PORT_NOME - 1] || '(sem portador)').trim();
    var a = porta[p] || (porta[p] = {});
    var b = a[mes] || (a[mes] = { total: 0, linhas: 0 });
    b.total += Number(l[COL_VALOR - 1] || 0);
    b.linhas++;
  });

  // o que os extratos dizem, por banco e mes
  var extrato = {};
  FATURAS_2026.forEach(function (f) {
    var mes = f.venc.slice(0, 7);
    (extrato[f.banco] || (extrato[f.banco] = {}))[mes] = f.total;
  });

  var meses = [];
  for (var m = 1; m <= 8; m++) meses.push('2026-0' + m);

  var out = ['FATURAS x PORTADOR (saidas de 2026, jan a ago)', '',
             'EXTRATOS - total de cada fatura:'];
  Object.keys(extrato).sort().forEach(function (b) {
    out.push(('  ' + b + '              ').slice(0, 16)
      + meses.map(function (m) {
        return ('         ' + (extrato[b][m] ? extrato[b][m].toFixed(2) : '-')).slice(-10);
      }).join(''));
  });
  out.push('');
  out.push('PLANILHA - saidas por portador:');
  out.push(('  portador        ') + meses.map(function (m) {
    return ('       ' + m.slice(5)).slice(-10); }).join(''));
  Object.keys(porta).sort().forEach(function (p) {
    out.push(('  ' + p + '                    ').slice(0, 18)
      + meses.map(function (m) {
        var b = porta[p][m];
        return ('         ' + (b ? b.total.toFixed(2) : '-')).slice(-10);
      }).join(''));
  });
  var msg = out.join('\n');
  Logger.log(msg);
  return msg;
}
