/**
 * Diagnostico.gs — arquivo AVULSO de conferencia. Nao mexe em nada.
 *
 * Cola como arquivo NOVO no Apps Script (+ > Script > nome "Diagnostico"),
 * salva, escolhe `diagnosticar` no seletor de funcoes e roda.
 * Depois abre "Registro de execucao" e me manda o texto inteiro.
 *
 * Ele responde, em ordem:
 *  1) o BlingSync.gs novo foi mesmo colado e salvo?
 *  2) a conexao com o Bling ainda esta viva?
 *  3) quantas linhas a planilha tem como em aberto e vencidas (as "57")
 *  4) o que o Bling responde sobre 5 delas, uma por uma
 *  5) o _DRE_Mapa tem as categorias novas?
 *  6) quantas linhas ainda estao sem categoria
 *  7) as ultimas 8 linhas do log de sync
 */
function diagnosticar() {
  const L = [];
  const diz = function (t) { L.push(t); };

  diz('===== 1) o codigo novo esta no projeto? =====');
  const novas = ['sincronizarCategorias_', 'tempoGasto_', '_rodarSincronizarCategorias',
                 '_rodarAtualizarContasEmAberto', '_rodarReaplicarMapaDre', 'reaplicarMapaDre_'];
  novas.forEach(function (n) {
    var existe;
    try { existe = (eval('typeof ' + n) === 'function'); } catch (e) { existe = false; }
    diz('   ' + (existe ? 'OK   ' : 'FALTA') + '  ' + n);
  });
  try {
    diz('   TETO_APPEND_MS = ' + (typeof TETO_APPEND_MS !== 'undefined' ? TETO_APPEND_MS : 'NAO EXISTE'));
  } catch (e) { diz('   TETO_APPEND_MS = NAO EXISTE'); }

  diz('');
  diz('===== 2) o Bling responde? =====');
  var token = null;
  try {
    token = getBlingAccessToken_();
    diz('   token obtido: ' + (token ? 'SIM (' + String(token).length + ' chars)' : 'NULO'));
  } catch (e) {
    diz('   ERRO AO PEGAR TOKEN: ' + e);
  }
  if (token) {
    var teste = UrlFetchApp.fetch('https://api.bling.com.br/Api/v3/contas/pagar?pagina=1&limite=1',
      { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true });
    diz('   GET /contas/pagar -> HTTP ' + teste.getResponseCode());
    if (teste.getResponseCode() >= 400) diz('   corpo: ' + teste.getContentText().slice(0, 300));
  }

  diz('');
  diz('===== 3) o que a planilha tem =====');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  diz('   planilha: ' + ss.getName());
  diz('   id: ' + ss.getId());
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  if (!sheet) { diz('   !! aba ' + ABA_FLUXO_CAIXA + ' nao existe'); Logger.log(L.join('\n')); return; }

  const ultima = sheet.getLastRow();
  const dados = sheet.getRange(2, 1, ultima - 1, 14).getValues();
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);

  var abertas = 0, vencidas = [], semCat = 0, semGrupo = 0;
  const porSituacao = {};
  dados.forEach(function (l) {
    const sit = String(l[2]).trim();
    porSituacao[sit] = (porSituacao[sit] || 0) + 1;
    const nome = String(l[4] || '').trim();
    const grupo = String(l[5] || '').trim();
    if (!nome || nome.indexOf('sem categoria') >= 0) semCat++;
    if (!grupo || grupo.indexOf('sem mapear') >= 0) semGrupo++;
    if (sit !== '1') return;
    abertas++;
    const d = l[0] instanceof Date ? l[0] : new Date(l[0]);
    if (d && d < hoje) vencidas.push(l);
  });
  diz('   linhas: ' + (ultima - 1));
  diz('   por situacao: ' + JSON.stringify(porSituacao));
  diz('   em aberto: ' + abertas + '   |   em aberto E vencidas: ' + vencidas.length);
  diz('   sem nome de categoria: ' + semCat + '   |   sem grupo DRE: ' + semGrupo);

  diz('');
  diz('===== 4) o Bling confirma essas vencidas? =====');
  if (!token) {
    diz('   (sem token, pulei)');
  } else {
    vencidas.slice(0, 5).forEach(function (l) {
      const tipo = String(l[13] || '').trim();
      const id = l[12];
      const url = 'https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id;
      const r = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }, muteHttpExceptions: true });
      var sit = '?';
      try { sit = JSON.parse(r.getContentText()).data.situacao; } catch (e) {}
      diz('   ' + tipo + '/' + id + '  planilha diz "1"  |  Bling HTTP ' + r.getResponseCode() + ' situacao ' + sit
          + '   [' + Utilities.formatDate(l[0] instanceof Date ? l[0] : new Date(l[0]), 'America/Sao_Paulo', 'dd/MM/yyyy')
          + ' ' + l[8] + ' ' + l[11] + ']');
      Utilities.sleep(300);
    });
    if (!vencidas.length) diz('   (nenhuma vencida na planilha)');
  }

  diz('');
  diz('===== 5) o _DRE_Mapa =====');
  const mapa = ss.getSheetByName(ABA_DRE_MAPA);
  if (!mapa) { diz('   !! aba nao existe'); }
  else {
    const m = mapa.getDataRange().getValues();
    diz('   linhas no mapa: ' + (m.length - 1));
    const procurar = ['14739931044', '14739930076', '14639321702', '14741903825'];
    procurar.forEach(function (id) {
      var achou = null;
      for (var i = 1; i < m.length; i++) if (String(m[i][0]).trim() === id) { achou = m[i]; break; }
      diz('   ' + id + ': ' + (achou ? achou[1] + '  ->  ' + achou[4] : 'NAO ESTA NO MAPA'));
    });
  }

  diz('');
  diz('===== 6) ultimas linhas do log =====');
  const log = ss.getSheetByName(ABA_SYNC_LOG);
  if (!log) { diz('   (aba de log nao encontrada)'); }
  else {
    const u = log.getLastRow();
    const n = Math.min(8, u - 1);
    if (n > 0) {
      log.getRange(u - n + 1, 1, n, log.getLastColumn()).getValues().forEach(function (l) {
        diz('   ' + l.join(' | ').slice(0, 240));
      });
    } else diz('   (log vazio)');
  }

  diz('');
  diz('===== 7) quanto tem nas linhas sem categoria =====');
  var somaSem = 0, nSem = 0;
  const porAno = {};
  const maiores = [];
  dados.forEach(function (l) {
    if (String(l[2]).trim() === '5') return;
    const nome = String(l[4] || '').trim();
    if (nome && nome.indexOf('sem categoria') < 0) return;
    const v = Math.abs(Number(l[11]) || 0);
    somaSem += v; nSem++;
    const d = l[0] instanceof Date ? l[0] : new Date(l[0]);
    const ano = isNaN(d.getTime()) ? '?' : Utilities.formatDate(d, 'America/Sao_Paulo', 'yyyy');
    porAno[ano] = (porAno[ano] || 0) + v;
    maiores.push([v, l]);
  });
  diz('   ' + nSem + ' linha(s), R$ ' + somaSem.toFixed(2) + ' no total');
  Object.keys(porAno).sort().forEach(function (a) {
    diz('     ' + a + ': R$ ' + porAno[a].toFixed(2));
  });
  diz('   as 12 maiores:');
  maiores.sort(function (x, y) { return y[0] - x[0]; });
  maiores.slice(0, 12).forEach(function (m) {
    const l = m[1];
    const d = l[0] instanceof Date ? l[0] : new Date(l[0]);
    diz('     ' + (isNaN(d.getTime()) ? '?' : Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM/yyyy'))
        + '  ' + l[1] + '  R$ ' + Number(l[11]).toFixed(2)
        + '  ' + (l[8] || '(sem nome)') + '  [' + l[13] + '/' + l[12] + ']');
  });

  Logger.log(L.join('\n'));
}


/**
 * Lista as contas SEM CATEGORIA agrupadas por fornecedor.
 *
 * Essas contas nao tem categoria no proprio Bling - o painel nao tem de
 * onde tirar. O conserto e la, e o jeito rapido e por fornecedor: entra
 * em Financeiro > Contas a pagar, filtra pelo nome, marca tudo e usa
 * "Alterar categorias".
 *
 * O nome do fornecedor nao esta na planilha nessas linhas (elas nasceram
 * de respostas 429, que vinham sem contato), entao ele e resolvido pela
 * API na hora. Nao altera nada.
 */
function listarSemCategoriaPorFornecedor() {
  const token = getBlingAccessToken_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ABA_FLUXO_CAIXA);
  const ultima = sheet.getLastRow();
  const dados = sheet.getRange(2, 1, ultima - 1, 14).getValues();

  const cacheNome = {};
  function nomeDe(tipo, id) {
    const chave = tipo + ':' + id;
    if (cacheNome[chave] !== undefined) return cacheNome[chave];
    const r = fetchBlingStatus_('https://api.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    let nome = '';
    const d = r.json && r.json.data;
    if (d && d.contato) {
      nome = d.contato.nome || '';
      if (!nome && d.contato.id) {
        const c = fetchBling_('https://api.bling.com.br/Api/v3/contatos/' + d.contato.id, token);
        nome = (c && c.data && c.data.nome) || ('id ' + d.contato.id);
        Utilities.sleep(250);
      }
    }
    cacheNome[chave] = nome || '(sem contato)';
    Utilities.sleep(250);
    return cacheNome[chave];
  }

  const porFornecedor = {};
  let n = 0;
  const inicio = Date.now();
  for (let i = 0; i < dados.length; i++) {
    const l = dados[i];
    if (String(l[2]).trim() === '5') continue;
    const nomeCat = String(l[4] || '').trim();
    if (nomeCat && nomeCat.indexOf('sem categoria') < 0) continue;
    if (Date.now() - inicio > 4.5 * 60 * 1000) break;

    const tipo = String(l[13] || '').trim();
    const id = l[12];
    if (!id || (tipo !== 'pagar' && tipo !== 'receber')) continue;

    let nome = String(l[8] || '').trim();
    if (!nome) nome = nomeDe(tipo, id);

    const k = nome + ' | ' + tipo;
    if (!porFornecedor[k]) porFornecedor[k] = { n: 0, total: 0 };
    porFornecedor[k].n++;
    porFornecedor[k].total += Math.abs(Number(l[11]) || 0);
    n++;
  }

  const linhas = Object.keys(porFornecedor).map(function (k) {
    return [k, porFornecedor[k].n, porFornecedor[k].total];
  }).sort(function (a, b) { return b[2] - a[2]; });

  const L = ['CONTAS SEM CATEGORIA, POR FORNECEDOR (' + n + ' linha(s))', ''];
  let soma = 0;
  linhas.forEach(function (x) {
    soma += x[2];
    L.push('  R$ ' + x[2].toFixed(2) + '   ' + x[1] + ' conta(s)   ' + x[0]);
  });
  L.push('');
  L.push('  TOTAL: R$ ' + soma.toFixed(2));
  Logger.log(L.join('\n'));
}


/**
 * Confere a precificacao depois do setupWorkbook.
 *
 * Refaz aqui dentro a mesma resolucao de heranca que o painel faz no
 * navegador, e imprime o resultado. Se os numeros baterem com o que o
 * painel mostra, os dois lados estao falando a mesma lingua.
 *
 * Nao altera nada. Rode `conferirPrecificacao` e me mande o log.
 */
function conferirPrecificacao() {
  const L = [];
  const diz = function (t) { L.push(t); };
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  diz('===== abas novas =====');
  [ABA_PRECIFICACAO_MODELOS, ABA_PRECIFICACAO_FICHA].forEach(function (nome) {
    const sh = ss.getSheetByName(nome);
    if (!sh) { diz('   FALTA  ' + nome + ' - o setupWorkbook nao criou'); return; }
    diz('   OK     ' + nome + ': ' + Math.max(sh.getLastRow() - 1, 0) + ' linha(s), cabecalho ['
        + sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].join(', ') + ']');
  });

  const modelos = getPrecificacaoModelosCatalogo_();
  const ficha = getPrecificacaoFichaCatalogo_();
  const mats = getPrecificacaoMateriaisCatalogo_();
  const mdo = getPrecificacaoMaoDeObraPecasCatalogo_();
  const corte = getPrecificacaoCorteCatalogo_();

  const porNome = {};
  mats.forEach(function (m) { porNome[m.material] = m; });

  diz('');
  diz('===== modelos sem tipo definido =====');
  const semTipo = modelos.filter(function (m) { return !m.tipoPeca || m.tipoPeca === '(confirmar)'; });
  diz('   ' + modelos.length + ' modelo(s) cadastrado(s), ' + semTipo.length + ' pendente(s)');
  semTipo.forEach(function (m) { diz('     (confirmar)  ' + m.modelo); });

  diz('');
  diz('===== tipos usados sem corte, costura ou tecido padrao =====');
  // Quem manda na costura e no tecido da ficha e a _Precificacao_Producao,
  // nao a tabela por costureira - por isso a conferencia e aqui.
  const producao = getPrecificacaoProducao_();
  const tiposCorte = {};
  corte.forEach(function (c) { tiposCorte[c.tipoPeca] = true; });
  const prodPor = {};
  producao.forEach(function (x) { prodPor[x.canalGrupo + '|' + x.tipoPeca] = x; });

  let orfaos = 0;
  const vistos = {};
  modelos.forEach(function (m) {
    const t = m.tipoPeca;
    if (!t || t === '(confirmar)' || vistos[t]) return;
    vistos[t] = true;
    const falta = [];
    if (!tiposCorte[t]) falta.push('corte');
    ['Marketplace', 'Nuvemshop'].forEach(function (g) {
      const p = prodPor[g + '|' + t];
      if (!p) { falta.push('produção em ' + g); return; }
      if (!p.costuraValor) falta.push('costura em ' + g);
      if (!p.material) falta.push('tecido padrão em ' + g);
    });
    if (falta.length) { diz('     ' + t + ' -> falta ' + falta.join(', ')); orfaos++; }
  });
  if (!orfaos) diz('     nenhum - todo tipo em uso tem corte, costura e tecido padrao');

  diz('');
  diz('===== material com nome repetido no catalogo =====');
  const conta = {};
  mats.forEach(function (m) { conta[m.material] = (conta[m.material] || 0) + 1; });
  let repetidos = 0;
  Object.keys(conta).forEach(function (nome) {
    if (conta[nome] < 2) return;
    repetidos++;
    const quais = mats.filter(function (m) { return m.material === nome; })
      .map(function (m) { return (m.fornecedor || '(sem fornecedor)') + ' R$ ' + Number(m.valorPorMetro).toFixed(2) + '/m'; });
    diz('     "' + nome + '": ' + quais.join('  |  '));
  });
  if (!repetidos) diz('     nenhum');

  diz('');
  diz('===== ficha resolvida por tipo =====');
  function unitDe(l) {
    if (l.fonte === 'material') {
      const m = porNome[l.refNome];
      return m ? { u: m.valorPorMetro, n: l.refNome } : { u: 0, n: 'FALTA material ' + l.refNome };
    }
    if (l.fonte === 'maodeobra') {
      const c = mdo.filter(function (x) { return x.tipoPeca === l.refNome; });
      if (!c.length) return { u: 0, n: 'FALTA mao de obra ' + l.refNome };
      const menor = c.reduce(function (a, b) { return b.valor < a.valor ? b : a; });
      return { u: menor.valor, n: menor.funcionario };
    }
    return { u: l.valorUnit, n: '' };
  }

  const tipos = {};
  ficha.forEach(function (l) { tipos[l.aplicaA] = true; });
  Object.keys(tipos).sort().forEach(function (alvo) {
    const linhas = ficha.filter(function (l) { return l.aplicaA === alvo && l.quantidade > 0; });
    if (!linhas.length) return;
    let fab = 0, emb = 0;
    diz('   ' + alvo + ':');
    linhas.forEach(function (l) {
      const u = unitDe(l);
      const v = l.quantidade * u.u;
      if (l.grupo === 'Embalagem') { emb += v; } else { fab += v; }
      diz('     ' + (l.grupo + '            ').slice(0, 12) + ' ' + (l.item + '                    ').slice(0, 20)
          + ' ' + l.quantidade + ' x ' + u.u.toFixed(3) + ' = ' + v.toFixed(2) + (u.n ? '   [' + u.n + ']' : ''));
    });
    diz('     -> fabricacao R$ ' + fab.toFixed(2) + '  +  embalagem R$ ' + emb.toFixed(2)
        + '  =  R$ ' + (fab + emb).toFixed(2));
  });

  diz('');
  diz('===== confere com o que era antes =====');
  function totalDe(alvo) {
    let t = 0;
    ficha.filter(function (l) { return l.aplicaA === alvo && l.quantidade > 0; })
      .forEach(function (l) { t += l.quantidade * unitDe(l).u; });
    return t;
  }
  [['Robe', 0.73], ['Pijama', 3.85]].forEach(function (par) {
    const t = totalDe(par[0]);
    const bate = Math.abs(t - par[1]) < 0.005;
    diz('   ' + par[0] + ': R$ ' + t.toFixed(2) + ' (antes R$ ' + par[1].toFixed(2) + ') '
        + (bate ? 'BATE' : '<<< MUDOU, conferir'));
  });

  Logger.log(L.join('\n'));
}


/**
 * De onde saem os % de custo fixo da Ficha de Preco.
 *
 * getDespesasFixasPct_ divide o total do custo fixo pela media da Receita
 * Bruta dos TRES ULTIMOS meses da aba DRE - e o mes corrente entra nessa
 * conta. Se ele ainda esta pela metade, a media cai e o % sobe, fazendo
 * cada peca parecer carregar mais custo fixo do que carrega.
 *
 * Aqui a gente ve os meses um a um em vez de supor. Nao altera nada.
 */
function conferirCustoFixo() {
  const L = [];
  const diz = function (t) { L.push(t); };

  const { headers, rows: despesas } = sheetData_(ABA_DESPESAS_FIXAS);
  const iValor = headers.indexOf('valorMensal');
  const total = despesas.reduce(function (s, r) { return s + (Number(r[iValor]) || 0); }, 0);
  diz('custo fixo cadastrado: R$ ' + total.toFixed(2) + ' em ' + despesas.length + ' item(ns)');

  const { rows: dre } = sheetData_(ABA_DRE);
  const porMes = {};
  let vieramComoData = 0;
  dre.forEach(function (r) {
    if (r[1] !== 'Receita Bruta') return;
    if (r[0] instanceof Date) vieramComoData++;
    const m = mesTexto_(r[0]);
    if (!m) return;
    porMes[m] = (porMes[m] || 0) + (Number(r[2]) || 0);
  });
  const mesAtual = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  const todos = Object.keys(porMes).sort();
  const fechados = todos.filter(function (m) { return m < mesAtual; });
  const usados = fechados.slice(-3);

  diz('');
  diz('coluna mes ainda vem como Date em ' + vieramComoData + ' linha(s)'
      + (vieramComoData ? ' - roda o syncBling que ele regrava como texto' : ' - ja e texto'));

  diz('');
  diz('Receita Bruta por mes (* = usado na media):');
  todos.forEach(function (m) {
    let marca = '  ';
    if (usados.indexOf(m) >= 0) marca = '* ';
    let obs = '';
    if (m === mesAtual) obs = '   <<< mes corrente, incompleto - fora da media';
    else if (m > mesAtual) obs = '   <<< FUTURO (conta a receber a vencer) - fora da media';
    diz('   ' + marca + m + '  R$ ' + porMes[m].toFixed(2) + obs);
  });

  const media = usados.reduce(function (s, m) { return s + porMes[m]; }, 0) / (usados.length || 1);
  diz('');
  diz('media dos 3 meses fechados (' + usados.join(', ') + '): R$ ' + media.toFixed(2));
  diz('  -> custo fixo por peca = ' + (media ? (total / media * 100).toFixed(2) : '0') + '%');

  Logger.log(L.join('\n'));
}


/**
 * Testa TODAS as rotas do doGet, uma a uma, medindo o tempo.
 *
 * Quando uma rota estoura, o Apps Script devolve uma pagina HTML de erro
 * em vez de JSON, e o painel morre com "SyntaxError: Unexpected token
 * '<'" - que nao diz nada sobre qual rota falhou. Aqui cada uma e chamada
 * isolada, com o erro capturado e o tempo medido, entao da pra ver tanto
 * quem quebra quanto quem esta perto do limite de tempo.
 *
 * Nao altera nada.
 */
function testarRotas() {
  const rotas = [
    ['fluxoCaixa', function () { return getFluxoCaixaRows_(); }],
    ['dre', function () { return getDreRows_(); }],
    ['vendas', function () { return getVendasRows_(); }],
    ['kpis', function () { return getKpis_(); }],
    ['despesasFixas', function () { return getDespesasFixasList_(); }],
    ['precificacao', function () { return getPrecificacaoCatalogo_(); }],
    ['precificacaoConfig', function () { return getPrecificacaoConfig_(); }],
    ['precificacaoMateriais', function () { return getPrecificacaoMateriaisCatalogo_(); }],
    ['precificacaoRendimento', function () { return getPrecificacaoRendimentoCatalogo_(); }],
    ['precificacaoFuncionarios', function () { return getPrecificacaoFuncionariosCatalogo_(); }],
    ['precificacaoMaoDeObraPecas', function () { return getPrecificacaoMaoDeObraPecasCatalogo_(); }],
    ['precificacaoCorte', function () { return getPrecificacaoCorteCatalogo_(); }],
    ['precificacaoProducao', function () { return getPrecificacaoProducao_(); }],
    ['precificacaoAviamentos', function () { return getPrecificacaoAviamentosTamanhoCatalogo_(); }],
    ['precificacaoAcabamentos', function () { return getPrecificacaoAcabamentosCatalogo_(); }],
    ['precificacaoModelos', function () { return getPrecificacaoModelosCatalogo_(); }],
    ['precificacaoFicha', function () { return getPrecificacaoFichaCatalogo_(); }],
    ['precificacaoSkuRegras', function () { return getPrecificacaoSkuRegras_(); }]
  ];

  const L = ['ROTA                          TEMPO   RESULTADO', ''];
  let quebradas = 0;
  rotas.forEach(function (r) {
    const t0 = Date.now();
    let res;
    try {
      const v = r[1]();
      let tam = '';
      if (v && v.rows) tam = v.rows.length + ' linha(s)';
      else if (v && v.length !== undefined) tam = v.length + ' item(ns)';
      else if (v) tam = 'ok';
      res = 'OK   ' + tam;
    } catch (e) {
      res = '>>> ERRO: ' + e;
      quebradas++;
    }
    const ms = Date.now() - t0;
    L.push((r[0] + '                              ').slice(0, 30)
      + (ms + 'ms       ').slice(0, 9) + res);
  });

  L.push('');
  L.push(quebradas ? (quebradas + ' rota(s) quebrada(s) - e a(s) de cima com ERRO')
    : 'nenhuma rota quebrou aqui. Se o painel continua com erro, o problema '
      + 'esta na VERSAO IMPLANTADA, nao na salva: publique uma nova versao.');

  // a versao implantada e a mesma que esta salva?
  L.push('');
  L.push('URL do Web App: ' + ScriptApp.getService().getUrl());

  Logger.log(L.join('\n'));
}

/* ============================================================================
 * conferirFormatDate() - SO LEITURA. O Utilities.formatDate e o gargalo do
 * login, e trocar por getter nativo do Date da o MESMO texto?
 *
 * A HIPOTESE, da sessao Jobs em 06/10/2026, e boa porque explica um numero que
 * nao fechava: a fase 1 do getFluxoCaixaRows_ le 3 colunas e leva 15-22 s; a
 * fase 2 le as mesmas 21.821 linhas com 15 colunas e leva 3 s. Ler MENOS nao
 * pode demorar 5 a 7 vezes mais - entao o peso nao esta na leitura de celula,
 * esta no que o laco faz depois. E o laco chama texto() duas vezes por linha,
 * cada uma com um Utilities.formatDate: ~44 mil chamadas de SERVICO por login,
 * que a ~0,4 ms dao ~18 s. Bate com o f1.
 *
 * MEDIR ANTES DE TROCAR, por dois motivos:
 *   1. a hipotese pode estar certa na direcao e errada no tamanho - e trocar
 *      codigo por 2 s nao vale o risco que trocar por 18 s vale;
 *   2. o getter nativo so devolve o mesmo texto se o fuso do script valer para
 *      o Date no V8. O appsscript.json esta em America/Sao_Paulo, mas isso e
 *      premissa, nao medicao. Se divergir num unico dia, o painel passa a
 *      jogar linha pro mes errado, calado - e dado no mes errado e pior que
 *      login lento.
 *
 * Roda os dois jeitos nas linhas de verdade, conta DIVERGENCIAS e cronometra
 * cada um. Divergencia tem que dar ZERO.
 * ========================================================================== */
/* ============================================================================
 * verRendimento() - SO LEITURA. O que a tabela de metros ja tem, e qual o
 * degrau entre tamanhos.
 *
 * POR QUE (06/10/2026): a Karolyne esclareceu que o rendimento NAO depende do
 * tecido - "se usa 1,40 P manga curta no cetim, no Amanda tambem". A tabela ja
 * e assim, indexada por (tipoProduto, tamanho), sem coluna de material. Isso
 * significa que os tres tecidos novos do site NAO precisam de medicao nenhuma:
 * so os CORTES que ainda nao existem precisam.
 *
 * Antes de pedir numero a ela, saber o que ja esta medido - e, principalmente,
 * se o degrau de um tamanho pro outro e regular. Se for, basta ela medir UM
 * tamanho de cada corte novo e eu derivo os outros aplicando o mesmo degrau.
 * Se nao for regular, derivar seria inventar, e aí nao da pra encurtar.
 *
 * Imprime o degrau em metros e em % de um tamanho para o seguinte, dentro de
 * cada tipoProduto, justamente pra essa pergunta ter resposta medida.
 * ========================================================================== */
function verRendimento() {
  const L = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRECIFICACAO_RENDIMENTO);
  if (!sheet || sheet.getLastRow() < 2) {
    mostrarRelatorio_('Rendimento', ['aba ' + ABA_PRECIFICACAO_RENDIMENTO + ' vazia ou inexistente']);
    return;
  }
  const cab = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const iTipo = cab.indexOf('tipoProduto'), iTam = cab.indexOf('tamanho'), iM = cab.indexOf('metros');
  if (iTipo < 0 || iTam < 0 || iM < 0) {
    mostrarRelatorio_('Rendimento', ['cabecalho inesperado: ' + cab.join(' | ')]);
    return;
  }

  const porTipo = {};
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues().forEach(function (l) {
    const t = String(l[iTipo] || '').trim();
    if (!t) return;
    if (!porTipo[t]) porTipo[t] = [];
    porTipo[t].push({ tam: String(l[iTam] || '').trim(), m: Number(l[iM]) || 0 });
  });

  L.push('RENDIMENTO - metros de tecido por peca, por modelo e tamanho');
  L.push('(nao depende do tecido: o mesmo corte gasta o mesmo em cetim ou crepe)');
  L.push('');
  Object.keys(porTipo).sort().forEach(function (t) {
    const linhas = porTipo[t];
    L.push(t + '   (' + linhas.length + ' tamanho(s))');
    let ant = null;
    linhas.forEach(function (r) {
      let degrau = '';
      if (ant !== null && ant > 0 && r.m > 0) {
        degrau = '   degrau +' + (r.m - ant).toFixed(3) + ' m  (+'
               + (100 * (r.m - ant) / ant).toFixed(1) + '%)';
      }
      L.push('    ' + ('     ' + r.tam).slice(-5) + ' : ' + r.m.toFixed(3) + ' m' + degrau);
      ant = r.m;
    });
    L.push('');
  });

  L.push('JA CONFERIDO, NAO E ERRO (06/10/2026): nos tres modelos "longo", os');
  L.push('valores de G pra cima sao iguais entre modelos diferentes, e o G1 sai');
  L.push('MENOR que o GG. Parece copiado e nao e - a Karolyne confirmou que foi');
  L.push('medido na mesa. Nas grades grandes o encaixe muda, e a manga sai da');
  L.push('sobra do mesmo comprimento de tecido; por isso dois modelos podem');
  L.push('consumir igual e um tamanho maior pode consumir menos. Nao alterar.');
  L.push('');
  L.push('COMO ISSO ENCURTA O TRABALHO: se o degrau entre tamanhos for parecido');
  L.push('dentro de cada modelo, ela mede UM tamanho de cada corte novo e eu');
  L.push('derivo os outros aplicando o mesmo degrau. Se os degraus forem');
  L.push('irregulares, derivar seria inventar - e aí tem que medir tamanho a');
  L.push('tamanho mesmo.');
  mostrarRelatorio_('Rendimento: o que ja esta medido', L);
}

/* ============================================================================
 * verSaquinho() - SO LEITURA. As DUAS pontas do custo do saquinho.
 *
 * POR QUE AS DUAS JUNTAS (06/10/2026): a memoria registra que o painel esta
 * desatualizado em DOIS numeros do saquinho, e eles andam em sentidos
 * OPOSTOS:
 *
 *   rendimento   painel 0,250 m   certo 0,170 m   -> custo CAI  R$ 0,24
 *   costura      painel 0,30      certo 1,00      -> custo SOBE R$ 0,70
 *                                                    liquido:  +R$ 0,46
 *
 * Corrigir so o rendimento, que foi o que eu levantei e ela autorizou, deixa
 * o saquinho ainda mais BARATO do que ja esta errado - move o numero na
 * direcao contraria da verdade e ainda por cima parece conserto. Fonte do
 * valor certo: "Tabela Medidas Saquinhos" da FPV Shopee 2026, e o custo do
 * Bling ja foi acertado em 05/09 para R$ 1,55/saquinho (cetim 0,17 x 2,99 =
 * 0,51 + costura 1,00 + fitilho 0,04).
 *
 * Esta funcao so MOSTRA as duas pontas e o efeito de cada conserto isolado,
 * pra decisao ser sobre o par e nao sobre a metade que eu por acaso achei
 * primeiro.
 * ========================================================================== */
function verSaquinho() {
  const L = [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  const achar = function (aba, colChave, alvo, colValor) {
    const sh = ss.getSheetByName(aba);
    if (!sh || sh.getLastRow() < 2) return null;
    const cab = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const iC = cab.indexOf(colChave), iV = cab.indexOf(colValor);
    if (iC < 0 || iV < 0) return null;
    const dados = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
    const achados = [];
    dados.forEach(function (l, i) {
      const chave = semAcento_(String(l[iC] || ''));
      if (chave.indexOf('saquinho') >= 0) {
        achados.push({ linha: i + 2, chave: String(l[iC]), valor: Number(l[iV]) || 0 });
      }
    });
    return achados;
  };

  L.push('SAQUINHO DE CETIM - as duas pontas do custo');
  L.push('');
  L.push('RENDIMENTO (metros de tecido por peca)');
  const rend = achar(ABA_PRECIFICACAO_RENDIMENTO, 'tipoProduto', 'saquinho', 'metros');
  if (!rend || !rend.length) L.push('   nao achei linha de saquinho');
  else rend.forEach(function (r) {
    L.push('   linha ' + r.linha + ': ' + r.chave + ' = ' + r.valor.toFixed(3) + ' m'
           + (Math.abs(r.valor - 0.250) < 0.001 ? '   <- o valor antigo' : ''));
  });

  L.push('');
  L.push('COSTURA (mao de obra por peca)');
  const prod = achar(ABA_PRECIFICACAO_PRODUCAO, 'tipoPeca', 'saquinho', 'costuraValor');
  if (!prod || !prod.length) L.push('   nao achei linha de saquinho em ' + ABA_PRECIFICACAO_PRODUCAO);
  else prod.forEach(function (r) {
    L.push('   linha ' + r.linha + ': ' + r.chave + ' = R$ ' + r.valor.toFixed(2)
           + (Math.abs(r.valor - 0.30) < 0.001 ? '   <- o valor antigo' : ''));
  });

  L.push('');
  L.push('O QUE A FONTE DIZ (Tabela Medidas Saquinhos, FPV Shopee 2026, e o');
  L.push('custo do Bling acertado em 05/09):');
  L.push('   tecido .: 0,170 m  x  R$ 2,99  =  R$ 0,51');
  L.push('   costura :                         R$ 1,00');
  L.push('   fitilho :  0,5     x  R$ 0,08  =  R$ 0,04');
  L.push('   TOTAL   :                         R$ 1,55 por saquinho');
  L.push('');
  L.push('EFEITO DE CADA CONSERTO, SOZINHO:');
  L.push('   so o rendimento (0,250 -> 0,170) ...: custo CAI   R$ 0,24');
  L.push('   so a costura    (0,30  -> 1,00) ....: custo SOBE  R$ 0,70');
  L.push('   os dois juntos .....................: custo SOBE  R$ 0,46');
  L.push('');
  L.push('CORRIGIR SO O RENDIMENTO deixa o saquinho mais barato do que ja esta');
  L.push('errado - move o numero pro lado contrario da verdade, e com cara de');
  L.push('conserto. Os dois andam juntos ou nenhum anda.');
  mostrarRelatorio_('Saquinho: as duas pontas', L);
}

function conferirFormatDate() {
  const L = [];
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_FLUXO_CAIXA);
  if (!sheet || sheet.getLastRow() < 2) {
    mostrarRelatorio_('formatDate', ['Fluxo de Caixa vazio']);
    return;
  }
  const n = sheet.getLastRow() - 1;
  const datas = sheet.getRange(2, 1, n, 1).getValues();

  const p2 = function (x) { return x < 10 ? '0' + x : String(x); };
  const nativo = function (v) {
    if (v instanceof Date) return v.getFullYear() + '-' + p2(v.getMonth() + 1) + '-' + p2(v.getDate());
    return String(v || '').trim().slice(0, 10);
  };
  const servico = function (v) {
    if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM-dd');
    return String(v || '').trim().slice(0, 10);
  };

  let t = Date.now();
  const a = [];
  for (let i = 0; i < n; i++) a.push(servico(datas[i][0]));
  const msServico = Date.now() - t;

  t = Date.now();
  const b = [];
  for (let i = 0; i < n; i++) b.push(nativo(datas[i][0]));
  const msNativo = Date.now() - t;

  let dif = 0;
  const exemplos = [];
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      dif++;
      if (exemplos.length < 10) {
        exemplos.push('  linha ' + (i + 2) + ': servico=' + a[i] + '  nativo=' + b[i]);
      }
    }
  }

  L.push('Utilities.formatDate   x   getter nativo do Date');
  L.push('');
  L.push('linhas conferidas .....: ' + n);
  L.push('DIVERGENCIAS ..........: ' + dif + (dif === 0 ? '    <- pode trocar' : '    <<< NAO TROCAR'));
  L.push('');
  L.push('Utilities.formatDate ..: ' + msServico + ' ms   (' + (msServico / n).toFixed(3) + ' ms/linha)');
  L.push('getter nativo .........: ' + msNativo + ' ms   (' + (msNativo / n).toFixed(3) + ' ms/linha)');
  L.push('ganho por passada .....: ' + (msServico - msNativo) + ' ms');
  L.push('');
  L.push('A fase 1 faz DUAS passadas (data e competencia), entao o ganho no');
  L.push('login seria por volta de ' + (2 * (msServico - msNativo) / 1000).toFixed(1) + ' s.');
  if (exemplos.length) {
    L.push('');
    L.push('PRIMEIRAS DIVERGENCIAS:');
    exemplos.forEach(function (e) { L.push(e); });
    L.push('');
    L.push('Divergencia aqui significa que o fuso do script NAO vale para o');
    L.push('Date no V8. Trocar jogaria linha pro mes errado, em silencio.');
  }
  mostrarRelatorio_('formatDate: medir antes de trocar', L);
}
