/**
 * Precificacao.gs — catálogo de produtos precificados (editável de verdade,
 * substitui os espelhos IMPORTRANGE antigos). Mesma fórmula confirmada nas
 * 5 planilhas FPV reais, portada aqui pra recalcular os valores no
 * servidor (nunca confia em número de saída vindo do cliente — só nos
 * inputs, que são dados, não cálculo).
 */

function num_(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

function custoProdutoServer_(materiais, maoDeObra, outros) {
  const custoMateriaPrima = (materiais || []).reduce((soma, m) => {
    const manual = num_(m.valorManual);
    if (manual > 0) return soma + manual;
    return soma + num_(m.valorUnitario) * num_(m.qtdUtilizada);
  }, 0);
  const custoMaoDeObra = (maoDeObra || []).reduce((soma, f) => {
    const horas = num_(f.horasMes);
    if (!horas) return soma;
    const valorHora = num_(f.salarioMensal) / horas;
    return soma + valorHora * (num_(f.tempoExecucaoMinutos) / 60);
  }, 0);
  const custoOutros = (outros || []).reduce((soma, o) => soma + num_(o.valor), 0);
  return custoMateriaPrima + custoMaoDeObra + custoOutros;
}

function custoVariavelPctServer_(tarifas) {
  if (!tarifas) return 0;
  return num_(tarifas.impostosPct) + num_(tarifas.comissaoPct) + num_(tarifas.extra1Pct) + num_(tarifas.extra2Pct);
}

/** Recalcula os snapshots (lucro%, margem de contribuição%, markup) a partir dos inputs. */
function breakdownServer_(precoVenda, custoProduto, custoVariavelPct, despesasFixasPct) {
  const preco = num_(precoVenda);
  const custo = num_(custoProduto);
  const despesasFixasReais = preco * num_(despesasFixasPct);
  const custoVariavelReais = preco * num_(custoVariavelPct);
  const lucroReais = preco - custo - despesasFixasReais - custoVariavelReais;
  const margemContribReais = preco - custo - custoVariavelReais;
  return {
    lucroPct: preco ? lucroReais / preco : 0,
    markup: custo ? preco / custo : 0,
    margemContribuicaoPct: preco ? margemContribReais / preco : 0
  };
}

function getPrecificacaoCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO);
  const idx = (n) => headers.indexOf(n);
  const iId = idx('id'), iNome = idx('nome'), iCanal = idx('canal'), iAtivo = idx('ativo'),
    iSku = idx('sku'), iTipoProduto = idx('tipoProduto'), iTamanho = idx('tamanho'),
    iMateriais = idx('materiaisJson'), iMaoDeObra = idx('maoDeObraJson'), iOutros = idx('outrosJson'),
    iTarifas = idx('tarifasJson'), iDespesasFixas = idx('despesasFixasPct'), iPreco = idx('precoVenda'),
    iCustoSnap = idx('custoProdutoSnapshot'), iLucroSnap = idx('lucroPctSnapshot'),
    iMargemSnap = idx('margemContribuicaoPctSnapshot'), iMarkupSnap = idx('markupSnapshot'),
    iCriadoEm = idx('criadoEm'), iCriadoPor = idx('criadoPor'), iAtualizadoEm = idx('atualizadoEm'),
    iAtualizadoPor = idx('atualizadoPor');
  const parseJson_ = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };

  return rows
    .filter(r => r[iAtivo] === true || String(r[iAtivo]).toUpperCase() === 'TRUE')
    .map(r => ({
      id: r[iId],
      nome: r[iNome],
      canal: r[iCanal],
      sku: iSku >= 0 ? (r[iSku] || '') : '',
      tipoProduto: iTipoProduto >= 0 ? (r[iTipoProduto] || '') : '',
      tamanho: iTamanho >= 0 ? String(r[iTamanho] || '') : '',
      materiais: parseJson_(r[iMateriais], []),
      maoDeObra: parseJson_(r[iMaoDeObra], []),
      outros: parseJson_(r[iOutros], []),
      tarifas: parseJson_(r[iTarifas], {}),
      despesasFixasPct: num_(r[iDespesasFixas]),
      precoVenda: num_(r[iPreco]),
      custoProdutoSnapshot: num_(r[iCustoSnap]),
      lucroPctSnapshot: num_(r[iLucroSnap]),
      margemContribuicaoPctSnapshot: num_(r[iMargemSnap]),
      markupSnapshot: num_(r[iMarkupSnap]),
      criadoEm: r[iCriadoEm] instanceof Date ? Utilities.formatDate(r[iCriadoEm], 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : r[iCriadoEm],
      criadoPor: r[iCriadoPor],
      atualizadoEm: r[iAtualizadoEm] instanceof Date ? Utilities.formatDate(r[iAtualizadoEm], 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm') : r[iAtualizadoEm],
      atualizadoPor: r[iAtualizadoPor]
    }));
}

function getPrecificacaoConfig_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_CONFIG);
  const idx = (n) => headers.indexOf(n);
  const iCanal = idx('canal'), iImpostos = idx('impostosPct'), iComissao = idx('comissaoPct'),
    iExtra1Nome = idx('extra1Nome'), iExtra1Pct = idx('extra1Pct'), iExtra2Nome = idx('extra2Nome'),
    iExtra2Pct = idx('extra2Pct'), iTaxaFixa = idx('taxaFixaReais'),
    iDespesasFixas = idx('despesasFixasPct'), iConfirmado = idx('confirmado');

  let despesasFixasPctManual = 0;
  const canais = {};
  rows.forEach(r => {
    const canal = r[iCanal];
    if (canal === '_GLOBAL') { despesasFixasPctManual = num_(r[iDespesasFixas]); return; }
    canais[canal] = {
      impostosPct: num_(r[iImpostos]), comissaoPct: num_(r[iComissao]),
      extra1Nome: r[iExtra1Nome] || '', extra1Pct: num_(r[iExtra1Pct]),
      extra2Nome: r[iExtra2Nome] || '', extra2Pct: num_(r[iExtra2Pct]),
      // Cobrança fixa por item, em reais — a Shopee cobra R$ 4,00 por item
      // vendido além do percentual. Não é custo de produto: só existe
      // naquele canal, então mora aqui e não na ficha da peça.
      taxaFixaReais: iTaxaFixa >= 0 ? num_(r[iTaxaFixa]) : 0,
      confirmado: r[iConfirmado] === true || String(r[iConfirmado]).toUpperCase() === 'TRUE'
    };
  });
  return { despesasFixasPctPadrao: getDespesasFixasPct_(despesasFixasPctManual), canais };
}

/**
 * % de despesas fixas usada como padrão na calculadora: soma da aba
 * _Despesas_Fixas ÷ média da Receita Bruta dos últimos meses já
 * sincronizados na DRE. Sem despesas cadastradas, ou sem meses
 * suficientes na DRE ainda, cai no valor manual da aba
 * _Precificacao_Config (linha _GLOBAL) como reserva.
 */
/**
 * A coluna `mes` da DRE pode voltar como Date (o Sheets converte "2026-08"
 * sozinho) ou como texto. Normaliza pra "AAAA-MM" nos dois casos, senao
 * a ordenacao vira ordem alfabetica de "Wed Aug 01 2026...".
 */
function mesTexto_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'America/Sao_Paulo', 'yyyy-MM');
  return String(v || '').trim().slice(0, 7);
}

function getDespesasFixasPct_(fallbackManual) {
  const { headers, rows: despesas } = sheetData_(ABA_DESPESAS_FIXAS);
  const iValor = headers.indexOf('valorMensal');
  const totalDespesas = despesas.reduce((soma, r) => soma + num_(r[iValor]), 0);
  if (totalDespesas <= 0) return fallbackManual;

  const { rows: dreRows } = sheetData_(ABA_DRE);
  const receitaPorMes = {};
  dreRows.forEach(r => {
    const mes = mesTexto_(r[0]), grupo = r[1], valor = r[2];
    if (grupo !== 'Receita Bruta' || !mes) return;
    receitaPorMes[mes] = (receitaPorMes[mes] || 0) + num_(valor);
  });

  /* So meses FECHADOS. O mes corrente entra pela metade e derruba a media;
     e a DRE ainda tem meses FUTUROS, das contas a receber com vencimento
     la na frente (out/2026 com R$ 401,75, dez/2026 com R$ 90,79 em
     24/08/2026). Sem esse corte, "os 3 ultimos" seriam justamente esses
     trocados e o custo fixo por peca dispararia. */
  const mesAtual = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'yyyy-MM');
  const meses = Object.keys(receitaPorMes).filter(m => m < mesAtual).sort().slice(-3);
  if (!meses.length) return fallbackManual;
  const mediaReceita = meses.reduce((soma, m) => soma + receitaPorMes[m], 0) / meses.length;
  if (!mediaReceita) return fallbackManual;
  return totalDespesas / mediaReceita;
}

function getDespesasFixasList_() {
  const { headers, rows } = sheetData_(ABA_DESPESAS_FIXAS);
  const idx = (n) => headers.indexOf(n);
  const iId = idx('id'), iDescricao = idx('descricao'), iValor = idx('valorMensal');
  return rows.filter(r => r[iDescricao]).map(r => ({ id: r[iId], descricao: r[iDescricao], valorMensal: num_(r[iValor]) }));
}

/** Grava (cria ou atualiza) uma despesa fixa. */
function salvarDespesaFixa_(despesa, email) {
  if (!despesa || !despesa.descricao || !(Number(despesa.valorMensal) >= 0)) {
    throw new Error('Despesa inválida: descrição e valor mensal são obrigatórios.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DESPESAS_FIXAS);
    const { headers, rows } = sheetData_(ABA_DESPESAS_FIXAS);
    const idx = (n) => headers.indexOf(n);
    const iId = idx('id');

    let id = despesa.id;
    let linhaExistente = -1;
    if (id) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][iId] === id) { linhaExistente = i + 2; break; }
      }
    }
    if (!id || linhaExistente === -1) { id = Utilities.getUuid(); linhaExistente = -1; }

    const linha = [id, despesa.descricao, num_(despesa.valorMensal)];
    if (linhaExistente === -1) sheet.appendRow(linha);
    else sheet.getRange(linhaExistente, 1, 1, linha.length).setValues([linha]);

    return { id: id, descricao: despesa.descricao, valorMensal: num_(despesa.valorMensal) };
  } finally {
    lock.releaseLock();
  }
}

/** Exclui uma despesa fixa de verdade (é só uma linha de configuração, não histórico financeiro). */
function excluirDespesaFixa_(id, email) {
  if (!id) throw new Error('id é obrigatório.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_DESPESAS_FIXAS);
    const { headers, rows } = sheetData_(ABA_DESPESAS_FIXAS);
    const idx = (n) => headers.indexOf(n);
    const iId = idx('id');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][iId] === id) {
        sheet.deleteRow(i + 2);
        return id;
      }
    }
    throw new Error('Despesa não encontrada.');
  } finally {
    lock.releaseLock();
  }
}

/**
 * Catálogo de tecidos e aviamentos. `valor` é o preço na unidade de COMPRA,
 * que não é a mesma para todo mundo: cetim vem por metro, malha por quilo,
 * vivo e elástico em rolo, botão em cartela. `unidade` diz qual é, e
 * `rendimento` diz quanto aquela unidade rende — 2,25 m no quilo de malha,
 * 50 m no rolo de vivo, 50 unidades na cartela de botão.
 *
 * Quem calcula custo deve usar SEMPRE `valorPorMetro`, nunca `valor`: ler o
 * valor cru tratava os R$ 46,50 do quilo de malha como se fossem R$ 46,50 do
 * metro, mais que dobrando o custo da peça.
 */
function getPrecificacaoMateriaisCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_MATERIAIS);
  const idx = (n) => headers.indexOf(n);
  const iFornecedor = idx('fornecedor'), iMaterial = idx('material'), iLargura = idx('largura'),
    iRendimento = idx('rendimento'), iValor = idx('valor'), iUnidade = idx('unidade');
  return rows.filter(r => r[iMaterial]).map(r => {
    const valor = num_(r[iValor]);
    const rendimento = num_(r[iRendimento]);
    const unidade = String((iUnidade >= 0 ? r[iUnidade] : '') || 'm').trim().toLowerCase();
    // 'm' já é o preço por metro; qualquer outra unidade de compra (kg, rolo,
    // peça, cartela) divide pelo que ela rende.
    const porMetro = (unidade !== 'm' && rendimento > 0) ? valor / rendimento : valor;
    return {
      fornecedor: r[iFornecedor] || '', material: r[iMaterial],
      largura: num_(r[iLargura]), rendimento: rendimento,
      unidade: unidade, valor: valor, valorPorMetro: porMetro
    };
  });
}

function getPrecificacaoRendimentoCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_RENDIMENTO);
  const idx = (n) => headers.indexOf(n);
  const iTipo = idx('tipoProduto'), iTamanho = idx('tamanho'), iMetros = idx('metros'), iMetros2 = idx('metros2');
  return rows.filter(r => r[iTipo]).map(r => ({
    tipoProduto: r[iTipo], tamanho: String(r[iTamanho]), metros: num_(r[iMetros]), metros2: num_(r[iMetros2])
  }));
}

function getPrecificacaoFuncionariosCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_FUNCIONARIOS);
  const idx = (n) => headers.indexOf(n);
  const iNome = idx('nome'), iSalario = idx('salarioMensal'), iHoras = idx('horasMes'), iAtivo = idx('ativo');
  return rows
    .filter(r => r[iNome] && (r[iAtivo] === true || String(r[iAtivo]).toUpperCase() === 'TRUE' || r[iAtivo] === ''))
    .map(r => ({ nome: r[iNome], salarioMensal: num_(r[iSalario]), horasMes: num_(r[iHoras]) }));
}

function getPrecificacaoMaoDeObraPecasCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_MAODEOBRA_PECAS);
  const idx = (n) => headers.indexOf(n);
  const iFuncionario = idx('funcionario'), iTipoPeca = idx('tipoPeca'), iValor = idx('valor'), iUnidade = idx('unidade');
  return rows.filter(r => r[iFuncionario] && r[iTipoPeca]).map(r => ({
    funcionario: r[iFuncionario], tipoPeca: r[iTipoPeca], valor: num_(r[iValor]), unidade: r[iUnidade] || ''
  }));
}

/**
 * Aviamentos cujo consumo muda com o tamanho (vivo e elástico do pijama).
 * A quantidade multiplica o `valorPorMetro` do material de mesmo nome no
 * catálogo de tecidos.
 */
function getPrecificacaoAviamentosTamanhoCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_AVIAMENTOS_TAMANHO);
  const idx = (n) => headers.indexOf(n);
  const iTipo = idx('tipoProduto'), iTamanho = idx('tamanho'),
    iAviamento = idx('aviamento'), iQtd = idx('quantidade');
  return rows.filter(r => r[iTipo] && r[iAviamento]).map(r => ({
    tipoProduto: String(r[iTipo]).trim(), tamanho: String(r[iTamanho]).trim(),
    aviamento: String(r[iAviamento]).trim(), quantidade: num_(r[iQtd])
  }));
}

/**
 * Acabamentos opcionais e combináveis (renda, guipir, vivo). A quantidade é
 * por aplicação — a mesma guipir aparece três vezes porque o que muda é onde
 * ela vai. `substituiTecido` marca quem desconta metros do tecido principal
 * em vez de somar; hoje só o tule.
 */
function getPrecificacaoAcabamentosCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_ACABAMENTOS);
  const idx = (n) => headers.indexOf(n);
  const iNome = idx('acabamento'), iMaterial = idx('material'), iMetros = idx('metros'),
    iSubstitui = idx('substituiTecido'), iAtivo = idx('ativo');
  return rows
    .filter(r => r[iNome] && (r[iAtivo] === true || String(r[iAtivo]).toUpperCase() === 'TRUE' || r[iAtivo] === ''))
    .map(r => ({
      acabamento: String(r[iNome]).trim(), material: String(r[iMaterial] || '').trim(),
      metros: num_(r[iMetros]),
      substituiTecido: r[iSubstitui] === true || String(r[iSubstitui]).toUpperCase() === 'TRUE'
    }));
}

function getPrecificacaoCorteCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_CORTE);
  const idx = (n) => headers.indexOf(n);
  const iTipoPeca = idx('tipoPeca'), iValor = idx('valor');
  return rows.filter(r => r[iTipoPeca]).map(r => ({ tipoPeca: r[iTipoPeca], valor: num_(r[iValor]) }));
}

/**
 * modelo -> tipoPeca. Substitui o chute por nome que existia no front.
 * Modelo sem linha aqui, ou com tipo "(confirmar)", nao e precificado:
 * a ficha mostra o aviso em vez de um numero errado.
 */
function getPrecificacaoModelosCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_MODELOS);
  const idx = (n) => headers.indexOf(n);
  const iModelo = idx('modelo'), iTipo = idx('tipoPeca'), iAtivo = idx('ativo');
  return rows
    .filter(r => r[iModelo] && String(r[iAtivo]).toLowerCase() !== 'false')
    .map(r => ({ modelo: String(r[iModelo]).trim(), tipoPeca: String(r[iTipo] || '').trim() }));
}

/**
 * Ficha tecnica (aviamento, embalagem, mao de obra extra) por tipo de
 * peca, com excecao por modelo. Devolve cru; quem resolve a heranca e
 * calcula o valor unitario e o front, que ja tem os catalogos de
 * materiais e de mao de obra carregados.
 */
function getPrecificacaoFichaCatalogo_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_FICHA);
  const idx = (n) => headers.indexOf(n);
  const iAplica = idx('aplicaA'), iGrupo = idx('grupo'), iItem = idx('item'),
        iFonte = idx('fonte'), iRef = idx('refNome'), iQtd = idx('quantidade'),
        iVal = idx('valorUnit'), iAtivo = idx('ativo');
  return rows
    .filter(r => r[iAplica] && r[iItem] && String(r[iAtivo]).toLowerCase() !== 'false')
    .map(r => ({
      aplicaA: String(r[iAplica]).trim(),
      grupo: String(r[iGrupo] || 'Aviamento').trim(),
      item: String(r[iItem]).trim(),
      fonte: String(r[iFonte] || 'fixo').trim().toLowerCase(),
      refNome: String(r[iRef] || '').trim(),
      quantidade: num_(r[iQtd]),
      valorUnit: num_(r[iVal])
    }));
}

/** Grava (cria ou atualiza) um produto. Retorna o produto salvo, já com id/snapshots/timestamps. */
function salvarPrecificacaoProduto_(produto, email) {
  if (!produto || !produto.nome || !produto.canal || !(Number(produto.precoVenda) > 0)) {
    throw new Error('Produto inválido: nome, canal e preço de venda são obrigatórios.');
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(ABA_PRECIFICACAO);
    const { headers, rows } = sheetData_(ABA_PRECIFICACAO);
    const idx = (n) => headers.indexOf(n);
    const iId = idx('id');

    const custoProduto = custoProdutoServer_(produto.materiais, produto.maoDeObra, produto.outros);
    const custoVariavelPct = custoVariavelPctServer_(produto.tarifas);
    const despesasFixasPct = num_(produto.despesasFixasPct);
    const snap = breakdownServer_(produto.precoVenda, custoProduto, custoVariavelPct, despesasFixasPct);
    const agora = new Date();

    let id = produto.id;
    let linhaExistente = -1;
    if (id) {
      for (let i = 0; i < rows.length; i++) {
        if (rows[i][iId] === id) { linhaExistente = i + 2; break; } // +2: header + 1-index
      }
    }
    if (!id || linhaExistente === -1) {
      id = Utilities.getUuid();
      linhaExistente = -1;
    }

    /* Monta a linha POR NOME de coluna, não por posição. Colunas novas
       entram no fim do cabeçalho (ver ensureHeader_), então a ordem física
       varia de planilha pra planilha — gravar posicionalmente escreveria o
       sku em cima do materiaisJson em quem já tinha a aba antiga. */
    const valores = {
      id: id,
      nome: produto.nome,
      canal: produto.canal,
      ativo: true,
      sku: produto.sku || '',
      tipoProduto: produto.tipoProduto || '',
      tamanho: produto.tamanho || '',
      materiaisJson: JSON.stringify(produto.materiais || []),
      maoDeObraJson: JSON.stringify(produto.maoDeObra || []),
      outrosJson: JSON.stringify(produto.outros || []),
      tarifasJson: JSON.stringify(produto.tarifas || {}),
      despesasFixasPct: despesasFixasPct,
      precoVenda: num_(produto.precoVenda),
      custoProdutoSnapshot: custoProduto,
      lucroPctSnapshot: snap.lucroPct,
      margemContribuicaoPctSnapshot: snap.margemContribuicaoPct,
      markupSnapshot: snap.markup,
      criadoEm: linhaExistente === -1 ? agora : rows[linhaExistente - 2][idx('criadoEm')],
      criadoPor: linhaExistente === -1 ? email : rows[linhaExistente - 2][idx('criadoPor')],
      atualizadoEm: agora,
      atualizadoPor: email
    };
    const linha = headers.map(function (h) {
      const nome = String(h).trim();
      return Object.prototype.hasOwnProperty.call(valores, nome) ? valores[nome] : '';
    });

    const alvo = linhaExistente === -1 ? sheet.getLastRow() + 1 : linhaExistente;
    sheet.getRange(alvo, 1, 1, linha.length).setValues([linha]);

    return {
      id, nome: produto.nome, canal: produto.canal,
      sku: produto.sku || '', tipoProduto: produto.tipoProduto || '', tamanho: produto.tamanho || '',
      materiais: produto.materiais || [], maoDeObra: produto.maoDeObra || [], outros: produto.outros || [],
      tarifas: produto.tarifas || {}, despesasFixasPct, precoVenda: num_(produto.precoVenda),
      custoProdutoSnapshot: custoProduto, lucroPctSnapshot: snap.lucroPct,
      margemContribuicaoPctSnapshot: snap.margemContribuicaoPct, markupSnapshot: snap.markup,
      atualizadoEm: Utilities.formatDate(agora, 'America/Sao_Paulo', 'yyyy-MM-dd HH:mm'), atualizadoPor: email
    };
  } finally {
    lock.releaseLock();
  }
}

/** Soft delete — nunca apaga a linha, só marca ativo=false. */
function excluirPrecificacaoProduto_(id, email) {
  if (!id) throw new Error('id é obrigatório.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRECIFICACAO);
    const { headers, rows } = sheetData_(ABA_PRECIFICACAO);
    const idx = (n) => headers.indexOf(n);
    const iId = idx('id');
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][iId] === id) {
        const linha = i + 2;
        sheet.getRange(linha, idx('ativo') + 1).setValue(false);
        sheet.getRange(linha, idx('atualizadoEm') + 1).setValue(new Date());
        sheet.getRange(linha, idx('atualizadoPor') + 1).setValue(email);
        return id;
      }
    }
    throw new Error('Produto não encontrado.');
  } finally {
    lock.releaseLock();
  }
}
