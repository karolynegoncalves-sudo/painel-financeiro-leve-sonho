/**
 * PrecificacaoSku.gs — custo por SKU calculado a partir de regras, em vez de
 * uma linha manual por produto.
 *
 * O problema que isto resolve: a aba Precificação guarda `nome` livre e não
 * gravava tipoProduto nem tamanho, então as precificações não casavam com o
 * estoque do Bling — viravam "Robe - Cetim - R$129,00" e não dava pra saber
 * a que SKU pertenciam. Aqui a conta é ao contrário:
 *
 *     custo = rendimento(modelo, tamanho) × preço do tecido
 *           + corte (por peça componente)
 *           + costura
 *           + aviamentos
 *
 * Duas coisas que o modelo antigo errava e este acerta:
 *
 * 1. TAMANHO. Um G3 gasta ~50% mais tecido que um M. O tamanho sai do NOME
 *    do produto no Bling, não da posição no código — no catálogo real a
 *    posição varia (`PMC-CUR-M-MAR` na 2ª, `PIF-CUR-PRE-06` na 3ª, e a
 *    própria RMC-CUR tem 63 SKUs de um jeito e 7 do outro), enquanto o campo
 *    `Tamanho:` está em 100% dos SKUs que têm tamanho.
 *
 * 2. CANAL. A mesma peça tem custo diferente por onde é vendida: robe de
 *    marketplace é 100% poliéster e a costura sai por R$ 5,00; robe da
 *    Nuvemshop é cetim com elastano e a costura sai por R$ 8,00. Por isso o
 *    tecido principal e a costura moram em _Precificacao_Producao (canal ×
 *    tipo de peça), e não na regra da família.
 *
 * O tecido SECUNDÁRIO é o contrário: fica na regra da família, porque é
 * característica do modelo e não do canal. É por onde entram as RENDAS —
 * tule, guipir, guipir larga e renda chantily são todas renda aplicada sobre
 * o corpo da peça, e a diferença entre elas é só o preço do metro. O robe
 * flare leva 0,60m de renda em qualquer canal; o que muda com o canal é o
 * cetim dos outros 1,23m. No catálogo de rendimento o modelo guarda `metros`
 * já descontado dos 0,60 e `metros2` = 0,60.
 */

/** Prefixo de família: os dois primeiros blocos do código (RMC-CUR-G-AZL -> RMC-CUR). */
function familiaDoSku_(sku) {
  const partes = String(sku || '').split('-');
  if (partes.length <= 2) return partes[0] || '';
  return partes[0] + '-' + partes[1];
}

/**
 * Agrupa o canal de venda no que a produção enxerga. A Nuvemshop tem duas
 * linhas de tarifa (cartão e Pix) mas uma produção só, e os marketplaces
 * todos consomem a mesma peça.
 */
function grupoDoCanal_(canal) {
  const c = String(canal || '').trim().toLowerCase();
  if (!c) return 'Marketplace';
  if (c.indexOf('nuvem') === 0 || c.indexOf('site') === 0) return 'Nuvemshop';
  return 'Marketplace';
}

/**
 * Normaliza tamanho pra casar com o catálogo de rendimento: caixa alta, sem
 * espaço, e sem zero à esquerda nos infantis — o Bling grava tanto
 * "Tamanho:6" quanto "Tamanho:08" pra mesma grade.
 */
function normTamanho_(t) {
  const s = String(t || '').trim().toUpperCase();
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s;
}

/** Lê o tamanho do nome do produto ("...Cor:Preto;Tamanho:08" -> "8"). Vazio quando a peça é tamanho único. */
function tamanhoDoProduto_(nome) {
  const m = String(nome || '').match(/Tamanho:\s*([^;]+)/i);
  return m ? normTamanho_(m[1]) : '';
}

/** Regra por família: que modelo a peça é, que tipo de peça ela conta como e o que leva de aviamento. */
function getPrecificacaoSkuRegras_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_SKU);
  const idx = (n) => headers.indexOf(n);
  const iFamilia = idx('familia'), iDescricao = idx('descricao'), iTipoProduto = idx('tipoProduto'),
    iTipoPeca = idx('tipoPeca'), iMaterial2 = idx('materialSecundario'), iAviamentos = idx('aviamentosJson'),
    iCustoManual = idx('custoManual'), iAtivo = idx('ativo');
  const parseJson_ = (v, fallback) => { try { return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } };

  return rows
    .filter(r => r[iFamilia] && (r[iAtivo] === true || String(r[iAtivo]).toUpperCase() === 'TRUE' || r[iAtivo] === ''))
    .map(r => ({
      familia: String(r[iFamilia]).trim(),
      descricao: r[iDescricao] || '',
      tipoProduto: String(r[iTipoProduto] || '').trim(),
      tipoPeca: String(r[iTipoPeca] || '').trim(),
      materialSecundario: String(r[iMaterial2] || '').trim(),
      aviamentos: parseJson_(r[iAviamentos], []),
      custoManual: num_(r[iCustoManual])
    }));
}

/** Produção por canal: que tecido a peça leva e quanto custa a costura naquele canal. */
function getPrecificacaoProducao_() {
  const { headers, rows } = sheetData_(ABA_PRECIFICACAO_PRODUCAO);
  const idx = (n) => headers.indexOf(n);
  const iCanal = idx('canalGrupo'), iTipoPeca = idx('tipoPeca'), iMaterial = idx('material'),
    iCostura = idx('costuraValor'), iAtivo = idx('ativo');

  return rows
    .filter(r => r[iCanal] && r[iTipoPeca] && (r[iAtivo] === true || String(r[iAtivo]).toUpperCase() === 'TRUE' || r[iAtivo] === ''))
    .map(r => ({
      canalGrupo: String(r[iCanal]).trim(),
      tipoPeca: String(r[iTipoPeca]).trim(),
      material: String(r[iMaterial] || '').trim(),
      costuraValor: num_(r[iCostura])
    }));
}

/**
 * Carrega de uma vez os catálogos que o cálculo consulta, já indexados.
 * Ler as abas dentro do laço deixaria o cálculo de 400 SKUs lento o
 * bastante pra estourar o tempo do Apps Script.
 */
function carregarCatalogosCusto_() {
  const materiais = {};
  getPrecificacaoMateriaisCatalogo_().forEach(m => {
    materiais[m.material.trim().toLowerCase()] = m;
  });

  const rendimento = {};
  getPrecificacaoRendimentoCatalogo_().forEach(r => {
    rendimento[r.tipoProduto.trim().toLowerCase() + '|' + normTamanho_(r.tamanho)] = r;
  });

  // A aba de corte guarda o custo TOTAL por produto, já somando os
  // componentes: R$ 1,00 por peça, então Robe = 1,00 e Pijama = 2,00
  // (camisa + short/calça).
  const corte = {};
  getPrecificacaoCorteCatalogo_().forEach(c => {
    corte[c.tipoPeca.trim().toLowerCase()] = num_(c.valor);
  });

  // Aviamentos por tamanho: chave tipoProduto|tamanho -> lista de {aviamento, quantidade}
  const aviamentosTamanho = {};
  getPrecificacaoAviamentosTamanhoCatalogo_().forEach(a => {
    const k = a.tipoProduto.toLowerCase() + '|' + normTamanho_(a.tamanho);
    (aviamentosTamanho[k] = aviamentosTamanho[k] || []).push(a);
  });

  const producao = {};
  getPrecificacaoProducao_().forEach(p => {
    producao[p.canalGrupo.toLowerCase() + '|' + p.tipoPeca.toLowerCase()] = p;
  });

  const regras = {};
  getPrecificacaoSkuRegras_().forEach(r => { regras[r.familia.toUpperCase()] = r; });

  return { materiais, rendimento, corte, producao, regras, aviamentosTamanho };
}

/**
 * Custo de um SKU num canal. Devolve sempre o detalhamento e a lista de
 * avisos — um custo que veio incompleto (tecido sem preço, tamanho fora do
 * catálogo) precisa aparecer como incompleto, nunca como zero silencioso.
 */
function custoDoSku_(sku, nomeProduto, canal, cat) {
  const familia = familiaDoSku_(sku).toUpperCase();
  const regra = cat.regras[familia];
  const canalGrupo = grupoDoCanal_(canal);
  const avisos = [];

  if (!regra) {
    return { sku: sku, familia: familia, canalGrupo: canalGrupo, custo: null, completo: false,
      avisos: ['Família sem regra cadastrada em ' + ABA_PRECIFICACAO_SKU] };
  }
  if (regra.custoManual > 0) {
    return {
      sku: sku, familia: familia, canalGrupo: canalGrupo, tipoProduto: regra.tipoProduto,
      tamanho: tamanhoDoProduto_(nomeProduto), custo: regra.custoManual, completo: true,
      origem: 'manual', detalhe: { manual: regra.custoManual }, avisos: []
    };
  }

  const prod = cat.producao[canalGrupo.toLowerCase() + '|' + regra.tipoPeca.toLowerCase()];
  if (!prod) avisos.push('Sem produção cadastrada para "' + regra.tipoPeca + '" em ' + canalGrupo);

  const tamanho = tamanhoDoProduto_(nomeProduto);
  const rend = cat.rendimento[regra.tipoProduto.toLowerCase() + '|' + tamanho];
  if (!rend) avisos.push('Sem rendimento para "' + regra.tipoProduto + '" tamanho "' + (tamanho || '(único)') + '"');

  const nomeMat = prod ? prod.material : '';
  const mat = nomeMat ? cat.materiais[nomeMat.toLowerCase()] : null;
  if (nomeMat && !mat) avisos.push('Tecido "' + nomeMat + '" não está no catálogo de materiais');
  const nomeMat2 = regra.materialSecundario;
  const mat2 = nomeMat2 ? cat.materiais[nomeMat2.toLowerCase()] : null;
  if (nomeMat2 && !mat2) avisos.push('Tecido secundário "' + nomeMat2 + '" não está no catálogo');

  const metros = rend ? num_(rend.metros) : 0;
  const metros2 = rend ? num_(rend.metros2) : 0;
  const custoTecido = metros * (mat ? num_(mat.valorPorMetro) : 0);
  const custoTecido2 = metros2 * (mat2 ? num_(mat2.valorPorMetro) : 0);

  // A aba de corte já guarda o custo total do produto: R$ 1,00 por peça
  // componente, então Robe vale 1,00 e Pijama 2,00 (camisa + short/calça).
  // Não multiplicar de novo aqui — era dupla contagem no pijama.
  const custoCorte = num_(cat.corte[regra.tipoPeca.toLowerCase()]);
  if (regra.tipoPeca && !(regra.tipoPeca.toLowerCase() in cat.corte)) {
    avisos.push('Sem valor de corte para "' + regra.tipoPeca + '"');
  }

  const custoCostura = prod ? num_(prod.costuraValor) : 0;
  if (prod && !custoCostura) avisos.push('Costura zerada para "' + regra.tipoPeca + '" em ' + canalGrupo);

  const custoAviamentos = (regra.aviamentos || []).reduce((s, a) => s + num_(a.valor), 0);

  // Vivo e elástico: consumo por tamanho × preço por metro do material.
  const porTamanho = cat.aviamentosTamanho[regra.tipoProduto.toLowerCase() + '|' + tamanho] || [];
  const detalheAviamentosTamanho = [];
  let custoAviamentosTamanho = 0;
  porTamanho.forEach(a => {
    const m = cat.materiais[a.aviamento.toLowerCase()];
    if (!m) { avisos.push('Aviamento "' + a.aviamento + '" não está no catálogo de materiais'); return; }
    const v = a.quantidade * num_(m.valorPorMetro);
    custoAviamentosTamanho += v;
    detalheAviamentosTamanho.push({ aviamento: a.aviamento, quantidade: a.quantidade, valor: v });
  });

  const custo = custoTecido + custoTecido2 + custoCorte + custoCostura
    + custoAviamentos + custoAviamentosTamanho;
  return {
    sku: sku, familia: familia, canalGrupo: canalGrupo, tipoProduto: regra.tipoProduto, tamanho: tamanho,
    custo: custo, completo: avisos.length === 0, origem: 'calculado',
    detalhe: {
      material: nomeMat, metros: metros, valorMetro: mat ? num_(mat.valorPorMetro) : 0, custoTecido: custoTecido,
      materialSecundario: nomeMat2, metros2: metros2, valorMetro2: mat2 ? num_(mat2.valorPorMetro) : 0, custoTecido2: custoTecido2,
      custoCorte: custoCorte,
      custoCostura: custoCostura, custoAviamentos: custoAviamentos,
      custoAviamentosTamanho: custoAviamentosTamanho, aviamentosTamanho: detalheAviamentosTamanho
    },
    avisos: avisos
  };
}

/**
 * Simulação livre pra calculadora: escolhe modelo, tamanho, tecido e canal na
 * mão, sem depender de SKU nenhum. É o caminho pra precificar uma peça nova
 * (guipir, tule) antes dela existir no Bling.
 */
function simularCusto_(entrada) {
  entrada = entrada || {};
  const cat = carregarCatalogosCusto_();
  const canalGrupo = grupoDoCanal_(entrada.canal);
  const tipoPeca = String(entrada.tipoPeca || '').trim();
  const tamanho = normTamanho_(entrada.tamanho);
  const avisos = [];

  const rend = cat.rendimento[String(entrada.tipoProduto || '').toLowerCase() + '|' + tamanho];
  if (!rend) avisos.push('Sem rendimento para "' + entrada.tipoProduto + '" tamanho "' + (tamanho || '(único)') + '"');

  const mat = cat.materiais[String(entrada.material || '').toLowerCase()];
  if (entrada.material && !mat) avisos.push('Tecido "' + entrada.material + '" não está no catálogo');
  const mat2 = entrada.materialSecundario ? cat.materiais[String(entrada.materialSecundario).toLowerCase()] : null;

  const prod = cat.producao[canalGrupo.toLowerCase() + '|' + tipoPeca.toLowerCase()];
  // O tecido escolhido na simulação manda; a costura vem da produção do canal
  // a menos que quem simula passe um valor próprio.
  const custoCostura = entrada.costuraValor !== undefined && entrada.costuraValor !== ''
    ? num_(entrada.costuraValor)
    : (prod ? num_(prod.costuraValor) : 0);
  if (!custoCostura) avisos.push('Sem valor de costura para "' + tipoPeca + '" em ' + canalGrupo);

  const metros = rend ? num_(rend.metros) : 0;
  const metros2 = rend ? num_(rend.metros2) : 0;
  const custoTecido = metros * (mat ? num_(mat.valorPorMetro) : 0);
  const custoTecido2 = metros2 * (mat2 ? num_(mat2.valorPorMetro) : 0);
  const custoCorte = num_(cat.corte[tipoPeca.toLowerCase()]);
  const custoAviamentos = (entrada.aviamentos || []).reduce((s, a) => s + num_(a.valor), 0);

  return {
    canalGrupo: canalGrupo, tipoProduto: entrada.tipoProduto, tamanho: tamanho,
    custo: custoTecido + custoTecido2 + custoCorte + custoCostura + custoAviamentos,
    completo: avisos.length === 0,
    detalhe: {
      metros: metros, valorMetro: mat ? num_(mat.valorPorMetro) : 0, custoTecido: custoTecido,
      metros2: metros2, valorMetro2: mat2 ? num_(mat2.valorPorMetro) : 0, custoTecido2: custoTecido2,
      custoCorte: custoCorte,
      custoCostura: custoCostura, custoAviamentos: custoAviamentos
    },
    avisos: avisos
  };
}

/**
 * Custo de um lote de SKUs. Recebe [{sku, nome, canal}] — a lista vem de quem
 * já tem o catálogo do Bling em mãos (o script de estoque), pra não duplicar
 * aqui um sync de produtos que o painel não precisa manter.
 */
function custosPorSku_(produtos, canalPadrao) {
  if (!Array.isArray(produtos)) throw new Error('produtos deve ser uma lista de {sku, nome, canal}.');
  const cat = carregarCatalogosCusto_();
  return produtos
    .filter(p => p && p.sku)
    .map(p => custoDoSku_(String(p.sku).trim(), p.nome || '', p.canal || canalPadrao, cat));
}

/**
 * Arquiva as precificações antigas que não têm SKU — as linhas "Robe - Cetim
 * - R$129,00" que sobraram do cadastro manual. Soft delete (ativo=FALSE),
 * igual ao excluirPrecificacaoProduto_: somem da calculadora mas o histórico
 * fica na planilha.
 */
function arquivarPrecificacoesSemSku_(email) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_PRECIFICACAO);
    const { headers, rows } = sheetData_(ABA_PRECIFICACAO);
    const idx = (n) => headers.indexOf(n);
    const iAtivo = idx('ativo'), iSku = idx('sku'), iAtualizadoEm = idx('atualizadoEm'), iAtualizadoPor = idx('atualizadoPor');
    if (iSku < 0) throw new Error('A aba ' + ABA_PRECIFICACAO + ' ainda não tem a coluna "sku". Rode o setup antes.');
    const agora = new Date();
    let arquivadas = 0;

    for (let i = 0; i < rows.length; i++) {
      const ativo = rows[i][iAtivo] === true || String(rows[i][iAtivo]).toUpperCase() === 'TRUE';
      const temSku = String(rows[i][iSku] || '').trim() !== '';
      if (!ativo || temSku) continue;
      const linha = i + 2;
      sheet.getRange(linha, iAtivo + 1).setValue(false);
      if (iAtualizadoEm >= 0) sheet.getRange(linha, iAtualizadoEm + 1).setValue(agora);
      if (iAtualizadoPor >= 0) sheet.getRange(linha, iAtualizadoPor + 1).setValue(email || 'arquivamento automático');
      arquivadas++;
    }
    return { arquivadas: arquivadas };
  } finally {
    lock.releaseLock();
  }
}

/** Wrapper pra rodar pelo menu do editor (funções com _ no fim não aparecem lá). */
function _rodarArquivarPrecificacoesSemSku() {
  const r = arquivarPrecificacoesSemSku_(Session.getActiveUser().getEmail());
  Logger.log('Precificações arquivadas: ' + r.arquivadas);
}

/** Diagnóstico: quantos SKUs de uma lista fecham custo completo e o que está faltando. */
function diagnosticoCustoSku_(produtos, canalPadrao) {
  const res = custosPorSku_(produtos, canalPadrao);
  const porAviso = {};
  res.forEach(r => r.avisos.forEach(a => { porAviso[a] = (porAviso[a] || 0) + 1; }));
  return {
    total: res.length,
    completos: res.filter(r => r.completo).length,
    semRegra: res.filter(r => r.custo === null).length,
    avisos: porAviso
  };
}
