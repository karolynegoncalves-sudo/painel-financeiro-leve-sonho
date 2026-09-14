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

/** Canais cuja venda nao gera nota fiscal. Conferir quando isso mudar. */
var CANAIS_SEM_NOTA_ = { 'Nuvemshop': 1 };

/**
 * Aliquota efetiva do Simples, medida nas seis guias de 2026 sobre a receita
 * DECLARADA (nao sobre a do painel - foi esse o meu erro inicial):
 *   jan 7,61% | fev 7,62% | mar 7,69% | abr 7,80% | mai 7,81% | jun 7,81%
 * Estavel. A media ponderada da 7,72%.
 *
 * Ela sobe conforme o RBT12 sobe, entao revisar quando o faturamento mudar de
 * faixa. RBT12 declarado em 06/2026: R$ 633.110,36.
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
  // agosto: ESTIMADO. Aliquota de 7,72% sobre a receita do painel menos a
  // venda do site (que nao entra na base declarada): 56.860 - 6.999 = 49.861.
  // TROCAR pelo valor da guia quando sair.
  '2026-08': 3849.28
};

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

/** Meses cujo valor acima e estimativa, nao guia. Aparecem no log. */
var DAS_ESTIMADO_ = { '2026-08': 1 };

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
      if (!CANAIS_SEM_NOTA_[String(canal || '').trim()]) return;
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
