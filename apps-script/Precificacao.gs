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
    iExtra2Pct = idx('extra2Pct'), iDespesasFixas = idx('despesasFixasPct'), iConfirmado = idx('confirmado');

  let despesasFixasPctPadrao = 0;
  const canais = {};
  rows.forEach(r => {
    const canal = r[iCanal];
    if (canal === '_GLOBAL') { despesasFixasPctPadrao = num_(r[iDespesasFixas]); return; }
    canais[canal] = {
      impostosPct: num_(r[iImpostos]), comissaoPct: num_(r[iComissao]),
      extra1Nome: r[iExtra1Nome] || '', extra1Pct: num_(r[iExtra1Pct]),
      extra2Nome: r[iExtra2Nome] || '', extra2Pct: num_(r[iExtra2Pct]),
      confirmado: r[iConfirmado] === true || String(r[iConfirmado]).toUpperCase() === 'TRUE'
    };
  });
  return { despesasFixasPctPadrao, canais };
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

    const linha = [
      id, produto.nome, produto.canal, true,
      JSON.stringify(produto.materiais || []), JSON.stringify(produto.maoDeObra || []),
      JSON.stringify(produto.outros || []), JSON.stringify(produto.tarifas || {}),
      despesasFixasPct, num_(produto.precoVenda),
      custoProduto, snap.lucroPct, snap.margemContribuicaoPct, snap.markup,
      linhaExistente === -1 ? agora : rows[linhaExistente - 2][idx('criadoEm')],
      linhaExistente === -1 ? email : rows[linhaExistente - 2][idx('criadoPor')],
      agora, email
    ];

    if (linhaExistente === -1) {
      sheet.appendRow(linha);
    } else {
      sheet.getRange(linhaExistente, 1, 1, linha.length).setValues([linha]);
    }

    return {
      id, nome: produto.nome, canal: produto.canal,
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
