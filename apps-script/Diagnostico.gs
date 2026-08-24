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
    var teste = UrlFetchApp.fetch('https://www.bling.com.br/Api/v3/contas/pagar?pagina=1&limite=1',
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
      const url = 'https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + id;
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
    const r = fetchBlingStatus_('https://www.bling.com.br/Api/v3/contas/' + tipo + '/' + id, token);
    let nome = '';
    const d = r.json && r.json.data;
    if (d && d.contato) {
      nome = d.contato.nome || '';
      if (!nome && d.contato.id) {
        const c = fetchBling_('https://www.bling.com.br/Api/v3/contatos/' + d.contato.id, token);
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
  dre.forEach(function (r) {
    if (r[1] !== 'Receita Bruta') return;
    porMes[r[0]] = (porMes[r[0]] || 0) + (Number(r[2]) || 0);
  });
  const todos = Object.keys(porMes).sort();
  const usados = todos.slice(-3);
  const mesAtual = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');

  diz('');
  diz('Receita Bruta por mes (os 8 ultimos; * = usado na media):');
  todos.slice(-8).forEach(function (m) {
    diz('   ' + (usados.indexOf(m) >= 0 ? '*' : ' ') + ' ' + m + '  R$ ' + porMes[m].toFixed(2)
      + (m === mesAtual ? '   <<< MES CORRENTE, ainda incompleto' : ''));
  });

  const media = usados.reduce(function (s, m) { return s + porMes[m]; }, 0) / (usados.length || 1);
  diz('');
  diz('media dos 3 usados: R$ ' + media.toFixed(2));
  diz('  -> custo fixo = ' + (media ? (total / media * 100).toFixed(2) : '0') + '%');

  // a mesma conta ignorando o mes corrente
  const fechados = todos.filter(function (m) { return m !== mesAtual; }).slice(-3);
  if (fechados.length) {
    const mediaF = fechados.reduce(function (s, m) { return s + porMes[m]; }, 0) / fechados.length;
    diz('');
    diz('so com meses FECHADOS (' + fechados.join(', ') + '):');
    diz('   media R$ ' + mediaF.toFixed(2) + '  ->  custo fixo = '
      + (mediaF ? (total / mediaF * 100).toFixed(2) : '0') + '%');
    const dif = (mediaF ? total / mediaF : 0) - (media ? total / media : 0);
    diz('   diferenca: ' + (dif * 100).toFixed(2) + ' ponto(s) percentual(is)');
  }

  Logger.log(L.join('\n'));
}
