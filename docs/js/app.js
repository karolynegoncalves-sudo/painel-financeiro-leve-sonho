const CFG = window.PAINEL_CONFIG;

const fmtBRL = (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v, dec = 1) => (v >= 0 ? '+' : '') + (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const fmtPctSimples_ = (v, dec = 1) => (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const fmtDataBR = (d) => d.toLocaleDateString('pt-BR');
const escapeHtml_ = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthLabel = (p) => {
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [y, mo] = String(p).split('-');
  return m[parseInt(mo, 10) - 1] + '/' + y.slice(2);
};
const dayLabel = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');

const PALETTE = { entrada: '#2F6F4E', saida: '#C0392B', sage: '#557571', sageSoft: '#9DB8B5', terracotta: '#D49A89', terracottaDark: '#B97A67', peach: '#F7D1BA', brick: '#AB3B32', amber: '#B9791F', ink: '#2B2926', muted: '#C9BFB4' };

let idToken = sessionStorage.getItem('id_token') || null;
const cache = {};
let FLUXO_ROWS = null; // [{date, tipo, grupoDRE, categoria, contato, banco, valor}]
let VENDAS_ROWS = null; // [{date, canal, cliente, numero, situacao, contaReceita, total}]
let DRE_REGIME = 'caixa'; // 'caixa' (dinheiro que entrou) | 'competencia' (venda que aconteceu)

/* ---------------- Precificação: estado local ---------------- */
let precifProdutos = null;       // array de produtos vinda do backend (cache mutável local)
let precifConfig = null;         // {despesasFixasPctPadrao, canais:{...}}
let precifBusca = '';
let precifFiltroCanal = '';
let precifExpandidoId = null;    // id do produto expandido, ou '__novo__'
let precifDraftOrigem = null;    // valores iniciais pro produto sendo criado/duplicado
let precifMateriais = null;      // catálogo de tecidos/materiais (_Precificacao_Materiais)
let precifRendimento = null;     // tabela tipoProduto+tamanho -> metros (_Precificacao_Rendimento)
let precifFuncionarios = null;   // cadastro de funcionários (_Precificacao_Funcionarios)
let precifMaoDeObraPecas = null; // mão de obra por peça (_Precificacao_MaoDeObra_Pecas)
let precifCorte = null;          // corte por peça (_Precificacao_Corte)
let precifDespesasFixas = null;  // despesas fixas mensais (_Despesas_Fixas)

const CANAL_LABELS = {
  NuvemShop_Cartao: 'NuvemShop (Cartão)',
  NuvemShop_Pix: 'NuvemShop (Pix)',
  MercadoLivre: 'Mercado Livre',
  Shopee: 'Shopee',
  SHEIN: 'SHEIN',
  TikTokShop: 'TikTok Shop'
};

/* ---------------- Auth ---------------- */

function decodeJwtEmail(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.email || '';
  } catch (e) { return ''; }
}

function initGoogle() {
  if (!window.google || !CFG.GOOGLE_CLIENT_ID || CFG.GOOGLE_CLIENT_ID.indexOf('COLE_AQUI') === 0) {
    document.getElementById('loginGate').innerHTML = '<p>Configuração pendente: preencha js/config.js com GOOGLE_CLIENT_ID e APPS_SCRIPT_URL.</p>';
    return;
  }
  google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
  google.accounts.id.renderButton(document.getElementById('googleBtn'), { theme: 'outline', size: 'large' });

  if (idToken) verificarESeguir_(idToken);
}

async function handleCredentialResponse(response) {
  idToken = response.credential;
  sessionStorage.setItem('id_token', idToken);
  await verificarESeguir_(idToken);
}

async function verificarESeguir_(token) {
  const data = await apiFetch_('fluxoCaixa', token);
  if (data && data.error === 'not_authorized') {
    document.getElementById('deniedEmail').textContent = decodeJwtEmail(token);
    document.getElementById('loginDenied').style.display = 'block';
    sessionStorage.removeItem('id_token');
    idToken = null;
    return;
  }
  if (data && data.error) {
    document.getElementById('loginGate').innerHTML = '<p>Erro ao conectar com o painel: ' + data.error + '</p>';
    return;
  }
  FLUXO_ROWS = parseFluxoRows_(data);
  // Vendas e opcional: se a aba ainda nao foi sincronizada, o painel
  // continua funcionando so no regime de caixa.
  try {
    const [dv, dd] = await Promise.all([apiFetch_('vendas', token), apiFetch_('despesasFixas', token)]);
    VENDAS_ROWS = (dv && !dv.error) ? parseVendasRows_(dv) : [];
    // despesas fixas sobem no boot porque o ponto de equilibrio precisa delas
    // ja na primeira tela, nao so quando abrir Configuracoes
    if (dd && !dd.error) precifDespesasFixas = dd.despesas || [];
  } catch (e) { VENDAS_ROWS = []; }
  document.getElementById('userEmail').textContent = data.email || '';
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  setupTabs();
  safeRenderTab('hoje');
}

document.getElementById('btnSair').addEventListener('click', () => {
  sessionStorage.removeItem('id_token');
  location.reload();
});

/* ---------------- API ---------------- */

async function apiFetch_(view, token) {
  try {
    const resp = await fetch(CFG.APPS_SCRIPT_URL + '?view=' + view + '&token=' + encodeURIComponent(token));
    return await resp.json();
  } catch (e) {
    return { error: String(e) };
  }
}

/**
 * Único ponto de escrita. Manda o body como texto puro (não application/json)
 * de propósito — assim o navegador não dispara um preflight CORS, que o
 * Apps Script Web App não responde direito.
 */
async function apiPost_(action, payload) {
  try {
    const resp = await fetch(CFG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ token: idToken, action: action }, payload))
    });
    return await resp.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

function parseFluxoRows_(data) {
  const headers = (data.rows && data.rows.headers) || [];
  const rows = (data.rows && data.rows.rows) || [];
  const idx = (n) => headers.indexOf(n);
  const iData = idx('data'), iTipo = idx('tipo'), iSit = idx('situacao'), iGrupo = idx('grupoDRE'),
    iCategoria = idx('categoriaNome'), iContato = idx('contatoNome'),
    iBanco = idx('contaBancariaNome'), iValor = idx('valor');
  return rows.map(r => {
    const date = new Date(String(r[iData]).slice(0, 10) + 'T00:00:00');
    // Situacoes do Bling: 1 em aberto, 2 baixada, 3 parcial, 5 cancelada.
    // Desconhecida entra como paga, pra nao sumir lancamento sem aviso.
    const sit = String(iSit >= 0 ? r[iSit] : '2').trim();
    return {
      date,
      tipo: r[iTipo],
      situacao: sit,
      cancelada: sit === '5',
      aberta: sit === '1',
      paga: sit !== '1' && sit !== '5',
      grupoDRE: r[iGrupo] || '(sem mapear)',
      categoria: r[iCategoria] || '(sem categoria)',
      contato: r[iContato] || '',
      banco: r[iBanco] || '',
      valor: Math.abs(Number(r[iValor]) || 0)
    };
  }).filter(r => !isNaN(r.date.getTime()) && !r.cancelada);
}

/* Vendas vem como lista de objetos (nao {headers,rows} como o fluxo). */
function parseVendasRows_(data) {
  return (data.rows || []).map(r => ({
    date: new Date(String(r.data).slice(0, 10) + 'T00:00:00'),
    canal: r.canal || 'Sem canal',
    cliente: r.cliente || '',
    numero: r.numero || '',
    situacao: r.situacao || '',
    contaReceita: r.contaReceita !== false,
    total: Number(r.total) || 0
  })).filter(r => !isNaN(r.date.getTime()));
}

/* ---------------- Filtro de período ---------------- */

const FILTER = { preset: 'mes', start: null, end: null, monthStr: '' };

function startOfDay_(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay_(d) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function addDays_(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function toDateInputValue_(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

function computeRange_(preset, monthStr, customStart, customEnd) {
  const hoje = new Date();
  if (preset === 'hoje') return [startOfDay_(hoje), endOfDay_(hoje)];
  if (preset === 'ontem') { const y = addDays_(hoje, -1); return [startOfDay_(y), endOfDay_(y)]; }
  if (preset === 'semana') {
    const diaSemana = (hoje.getDay() + 6) % 7;
    return [startOfDay_(addDays_(hoje, -diaSemana)), endOfDay_(hoje)];
  }
  if (preset === 'semana_passada') {
    const diaSemana = (hoje.getDay() + 6) % 7;
    const segAtual = addDays_(hoje, -diaSemana);
    const segPassada = addDays_(segAtual, -7);
    return [startOfDay_(segPassada), endOfDay_(addDays_(segPassada, 6))];
  }
  if (preset === 'mes') {
    return [startOfDay_(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), endOfDay_(hoje)];
  }
  if (preset === 'mes_passado') {
    const ini = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 0);
    return [startOfDay_(ini), endOfDay_(fim)];
  }
  if (preset === 'mes_selecionado' && monthStr) {
    const [y, m] = monthStr.split('-').map(Number);
    return [startOfDay_(new Date(y, m - 1, 1)), endOfDay_(new Date(y, m, 0))];
  }
  if (preset === 'personalizado' && customStart && customEnd) {
    return [startOfDay_(new Date(customStart + 'T00:00:00')), endOfDay_(new Date(customEnd + 'T00:00:00'))];
  }
  // fallback: mês atual
  return [startOfDay_(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), endOfDay_(hoje)];
}

function aplicarFiltro_(preset, monthStr, customStart, customEnd) {
  const [start, end] = computeRange_(preset, monthStr, customStart, customEnd);
  FILTER.preset = preset;
  FILTER.start = start;
  FILTER.end = end;
  FILTER.monthStr = monthStr || '';
  rerenderAbaAtiva_();
}

function periodoAnterior_(start, end) {
  const durMs = end.getTime() - start.getTime();
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(prevEnd.getTime() - durMs);
  return [startOfDay_(prevStart), endOfDay_(prevEnd)];
}

const FILTER_LABELS = {
  hoje: 'Hoje', ontem: 'Ontem', semana: 'Esta semana', semana_passada: 'Semana passada',
  mes: 'Este mês', mes_passado: 'Mês passado', mes_selecionado: 'Mês selecionado', personalizado: 'Período personalizado'
};

function renderFiltroBar_() {
  const presets = ['hoje', 'ontem', 'semana', 'semana_passada', 'mes', 'mes_passado'];
  const custIni = FILTER.preset === 'personalizado' ? toDateInputValue_(FILTER.start) : '';
  const custFim = FILTER.preset === 'personalizado' ? toDateInputValue_(FILTER.end) : '';
  return `
    <div class="filterbar">
      ${presets.map(p => `<button type="button" class="fbtn ${FILTER.preset === p ? 'active' : ''}" data-preset="${p}">${FILTER_LABELS[p]}</button>`).join('')}
      <label class="flabel">Mês: <input type="month" id="filtroMes" value="${FILTER.preset === 'mes_selecionado' ? FILTER.monthStr : ''}"></label>
      <label class="flabel">De <input type="date" id="filtroDe" value="${custIni}"> até <input type="date" id="filtroAte" value="${custFim}"></label>
      <span class="filtro-resumo">${fmtDataBR(FILTER.start)} – ${fmtDataBR(FILTER.end)}</span>
    </div>
  `;
}

function ligarFiltroBar_(container) {
  container.querySelectorAll('.fbtn').forEach(btn => {
    btn.addEventListener('click', () => aplicarFiltro_(btn.dataset.preset));
  });
  const mesInput = container.querySelector('#filtroMes');
  if (mesInput) mesInput.addEventListener('change', () => { if (mesInput.value) aplicarFiltro_('mes_selecionado', mesInput.value); });
  const deInput = container.querySelector('#filtroDe');
  const ateInput = container.querySelector('#filtroAte');
  const tentarPersonalizado = () => { if (deInput.value && ateInput.value) aplicarFiltro_('personalizado', null, deInput.value, ateInput.value); };
  if (deInput) deInput.addEventListener('change', tentarPersonalizado);
  if (ateInput) ateInput.addEventListener('change', tentarPersonalizado);
}

/* ---------------- Tabs ---------------- */

function setupTabs() {
  const [start, end] = computeRange_(FILTER.preset);
  FILTER.start = start; FILTER.end = end;
  document.querySelectorAll('#tabNav button').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#tabNav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.tab;
      document.getElementById('tab-' + view).classList.add('active');
      safeRenderTab(view);
    });
  });
}

function rerenderAbaAtiva_() {
  const ativa = document.querySelector('#tabNav button.active');
  if (ativa) safeRenderTab(ativa.dataset.tab);
}

async function safeRenderTab(view) {
  const el = document.getElementById('tab-' + view);
  try {
    if (view === 'precificacao') {
      if (precifProdutos === null || precifConfig === null) {
        el.innerHTML = '<div class="state-msg">Carregando...</div>';
        const [dataProdutos, dataConfig, dataMateriais, dataRendimento, dataFuncionarios, dataMaoDeObraPecas, dataCorte] = await Promise.all([
          apiFetch_('precificacao', idToken),
          apiFetch_('precificacaoConfig', idToken),
          apiFetch_('precificacaoMateriais', idToken),
          apiFetch_('precificacaoRendimento', idToken),
          apiFetch_('precificacaoFuncionarios', idToken),
          apiFetch_('precificacaoMaoDeObraPecas', idToken),
          apiFetch_('precificacaoCorte', idToken)
        ]);
        precifProdutos = (dataProdutos && dataProdutos.produtos) || [];
        precifConfig = (dataConfig && dataConfig.config) || { despesasFixasPctPadrao: 0, canais: {} };
        precifMateriais = (dataMateriais && dataMateriais.materiais) || [];
        precifRendimento = (dataRendimento && dataRendimento.rendimento) || [];
        precifFuncionarios = (dataFuncionarios && dataFuncionarios.funcionarios) || [];
        precifMaoDeObraPecas = (dataMaoDeObraPecas && dataMaoDeObraPecas.maoDeObraPecas) || [];
        precifCorte = (dataCorte && dataCorte.corte) || [];
      }
      return renderPrecificacao(el);
    }
    if (view === 'configuracoes') {
      if (precifDespesasFixas === null || precifConfig === null) {
        el.innerHTML = '<div class="state-msg">Carregando...</div>';
        const [dataDespesas, dataConfig] = await Promise.all([
          apiFetch_('despesasFixas', idToken),
          apiFetch_('precificacaoConfig', idToken)
        ]);
        precifDespesasFixas = (dataDespesas && dataDespesas.despesas) || [];
        if (precifConfig === null) precifConfig = (dataConfig && dataConfig.config) || { despesasFixasPctPadrao: 0, canais: {} };
      }
      return renderConfiguracoes(el);
    }
    if (!FLUXO_ROWS) { el.innerHTML = '<div class="state-msg">Carregando...</div>'; return; }
    if (view === 'hoje') return renderHoje(el);
    const rowsFiltradas = FLUXO_ROWS.filter(r => r.date >= FILTER.start && r.date <= FILTER.end);
    // KPIs e DRE sao regime de CAIXA: so entra o que foi efetivamente pago/recebido.
    // O Fluxo de Caixa mostra os dois, com a situacao visivel e filtravel.
    const rowsPagas = rowsFiltradas.filter(r => r.paga);
    if (view === 'kpis') return renderKpis(el, rowsPagas);
    if (view === 'fluxoCaixa') return renderFluxoCaixa(el, rowsFiltradas);
    if (view === 'dre') return renderDre(el, rowsPagas);
  } catch (e) {
    el.innerHTML = '<div class="state-msg">Erro ao desenhar esta aba (' + e.message + ').</div>';
  }
}

/* ---------------- Agregação (DRE a partir do Fluxo de Caixa) ---------------- */

function agregarPorGrupo_(rows) {
  const porGrupo = {};
  rows.forEach(r => {
    const sinal = r.tipo === 'entrada' ? 1 : -1;
    porGrupo[r.grupoDRE] = (porGrupo[r.grupoDRE] || 0) + sinal * r.valor;
  });
  return porGrupo;
}

function totais_(rows) {
  const porGrupo = agregarPorGrupo_(rows);
  const receitaBruta = porGrupo['Receita Bruta'] || 0;
  let resultadoLiquido = 0;
  Object.keys(porGrupo).forEach(g => { if (g.indexOf('ignorar') < 0) resultadoLiquido += porGrupo[g]; });
  return { porGrupo, receitaBruta, resultadoLiquido };
}

/** Agrupa linhas em intervalos (dia se período <=45 dias, senão mês), pra desenhar séries temporais. */
/* Segunda-feira da semana da data (semana comeca na segunda, como no Bling). */
function inicioSemana_(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/*
 * Quebra os lancamentos em colunas. Tres granularidades, escolhidas pelo
 * tamanho do periodo — antes so existia dia ou mes, e um mes inteiro virava
 * ~30 colunas, que nao cabem na tela.
 */
function serieTemporal_(rows, start, end) {
  const dias = Math.round((end - start) / 86400000) + 1;
  const modo = dias <= 14 ? 'dia' : (dias <= 92 ? 'semana' : 'mes');

  const chave = (d) => {
    if (modo === 'dia') return toDateInputValue_(d);
    if (modo === 'semana') return toDateInputValue_(inicioSemana_(d));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  };
  const label = (k) => {
    if (modo === 'mes') return monthLabel(k);
    const ini = new Date(k + 'T00:00:00');
    if (modo === 'dia') return dayLabel(ini);
    // semana: rotulo de intervalo, recortado no periodo filtrado
    let fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
    const iniVis = ini < start ? start : ini;
    if (fim > end) fim = end;
    return dayLabel(iniVis) + '–' + dayLabel(fim);
  };

  const buckets = {};
  rows.forEach(r => {
    const k = chave(r.date);
    buckets[k] = buckets[k] || [];
    buckets[k].push(r);
  });
  const chaves = Object.keys(buckets).sort();
  return chaves.map(k => ({ chave: k, label: label(k), rows: buckets[k] }));
}

/* ---------------- Os 5 indicadores ---------------- */
/*
 * Baseados no cardapio da apostila Acelera Time Financeiro (p.59) e nas
 * 4 perguntas da p.58: caixa esta saudavel / clientes estao pagando /
 * estamos pagando bem / a empresa esta ganhando dinheiro.
 *
 * PMP ficou de fora de proposito: a Leve Sonho compra tecido a vista e
 * paga salario em dia, entao prazo de fornecedor nao e alavanca hoje.
 */

/*
 * 1) Saldo em caixa: NAO e calculado aqui.
 *
 * Somar os lancamentos sincronizados nao devolve o saldo bancario —
 * os lancamentos avulsos do Caixas e Bancos do Bling nao aparecem na
 * API (mesmo motivo que impediu apagar os lotes antigos por script).
 * Resultado: entram quase todas as entradas e falta parte das saidas.
 * Na pratica deu R$ 446 mil contra ~R$ 1 mil de saldo real.
 *
 * Enquanto nao houver saldo informado, o painel mostra so o que ele
 * sabe de verdade: quanto entra e quanto sai, pelo vencimento das
 * contas em aberto. Melhor nao ter o numero do que ter um errado.
 */

/**
 * 2) Movimento previsto nos proximos N dias, a partir das contas EM ABERTO.
 * Confiavel: sai direto do vencimento das contas do Bling.
 * O que ja venceu e nao foi baixado entra separado como atrasado.
 */
function projecaoCaixa_(dias) {
  const hoje = startOfDay_(new Date());
  const limite = endOfDay_(addDays_(hoje, dias));
  let aReceber = 0, aPagar = 0, vencidoReceber = 0, vencidoPagar = 0;
  (FLUXO_ROWS || []).forEach(r => {
    if (!r.aberta) return;
    if (r.date < hoje) {
      if (r.tipo === 'entrada') vencidoReceber += r.valor; else vencidoPagar += r.valor;
      return;
    }
    if (r.date > limite) return;
    if (r.tipo === 'entrada') aReceber += r.valor; else aPagar += r.valor;
  });
  return { aReceber, aPagar, vencidoReceber, vencidoPagar, necessidade: aPagar - aReceber };
}

/** 3) PMR: quantos dias, em media, o dinheiro leva pra chegar depois da venda. */
function pmr_(rows) {
  const aReceber = (FLUXO_ROWS || [])
    .filter(r => r.aberta && r.tipo === 'entrada')
    .reduce((s, r) => s + r.valor, 0);
  const receita = totais_(rows).receitaBruta;
  const dias = Math.round((FILTER.end - FILTER.start) / 86400000) + 1;
  return { aReceber, receita, pmr: receita ? (aReceber / receita) * dias : 0 };
}

/**
 * 4) Margem de contribuicao por canal.
 * v1: receita do canal menos as taxas daquele canal. Ainda NAO desconta o
 * custo do produto (CMV) — isso depende do custo por SKU, que e a trilha
 * de estoque. Por isso a tela chama de "antes do CMV", pra nao dar a
 * impressao de que essa e a margem final.
 */
function margemPorCanal_(rows) {
  const vendas = (VENDAS_ROWS || []).filter(v => v.date >= FILTER.start && v.date <= FILTER.end && v.contaReceita);
  const receitaPorCanal = {};
  vendas.forEach(v => { receitaPorCanal[v.canal] = (receitaPorCanal[v.canal] || 0) + v.total; });

  const receitaTotal = Object.values(receitaPorCanal).reduce((a, b) => a + b, 0);
  const taxasTotal = rows
    .filter(r => r.tipo === 'saida' && String(r.grupoDRE).indexOf('Dedu') >= 0)
    .reduce((s, r) => s + r.valor, 0);

  // sem taxa carimbada por canal no financeiro, rateia proporcional a receita
  return Object.keys(receitaPorCanal).sort().map(canal => {
    const receita = receitaPorCanal[canal];
    const taxa = receitaTotal ? taxasTotal * (receita / receitaTotal) : 0;
    const mc = receita - taxa;
    return { canal, receita, taxa, mc, mcPct: receita ? mc / receita : 0 };
  });
}

/** 5) Ponto de equilibrio: quanto precisa faturar pra pagar o custo fixo. */
function pontoEquilibrio_(rows) {
  const fixasMes = (precifDespesasFixas || [])
    .filter(d => d.ativo !== false)
    .reduce((s, d) => s + (Number(d.valorMensal || d.valor || 0)), 0);
  const canais = margemPorCanal_(rows);
  const receita = canais.reduce((s, c) => s + c.receita, 0);
  const mc = canais.reduce((s, c) => s + c.mc, 0);
  const mcPct = receita ? mc / receita : 0;
  const faturamentoNecessario = mcPct > 0 ? fixasMes / mcPct : 0;
  return { fixasMes, receita, mcPct, faturamentoNecessario, cobertura: faturamentoNecessario ? receita / faturamentoNecessario : 0 };
}

/* ---------------- Hoje (o que olhar no dia) ---------------- */
/*
 * Tela de rotina diaria. Nao usa o filtro de periodo de proposito: a
 * pergunta aqui e sempre "e hoje?". Responde as duas primeiras perguntas
 * da apostila — caixa esta saudavel, e tem algo vencendo.
 */
function renderHoje(el) {
  const p7 = projecaoCaixa_(7);
  const p15 = projecaoCaixa_(15);
  const p30 = projecaoCaixa_(30);
  const hoje = startOfDay_(new Date());

  const vencemHoje = (FLUXO_ROWS || []).filter(r => r.aberta && startOfDay_(r.date).getTime() === hoje.getTime());
  const atrasadas = (FLUXO_ROWS || []).filter(r => r.aberta && r.date < hoje).sort((a, b) => a.date - b.date);
  const proximas = (FLUXO_ROWS || []).filter(r => r.aberta && r.date >= hoje && r.date <= addDays_(hoje, 7)).sort((a, b) => a.date - b.date);

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Hoje</h2>
      <div class="section-desc">${fmtDataBR(hoje)} — o que precisa da sua atenção agora. Esta tela ignora o filtro de período.</div>
    </div>

    <div class="kpi-grid">
      <div class="kpi ${p7.necessidade > 0 ? 'warn' : 'ok'}">
        <div class="kpi-label">Precisa nos 7 dias</div>
        <div class="kpi-value">${p7.necessidade > 0 ? fmtBRL(p7.necessidade) : fmtBRL(0)}</div>
        <div class="kpi-foot">${p7.necessidade > 0
          ? 'Sai mais do que entra na semana'
          : 'A semana se paga sozinha'}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">A pagar · 7 dias</div>
        <div class="kpi-value val-out">${fmtBRL(p7.aPagar)}</div>
        <div class="kpi-foot">30 dias: ${fmtBRL(p30.aPagar)}</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">A receber · 7 dias</div>
        <div class="kpi-value val-in">${fmtBRL(p7.aReceber)}</div>
        <div class="kpi-foot">30 dias: ${fmtBRL(p30.aReceber)}</div>
      </div>
      <div class="kpi ${atrasadas.length ? 'bad' : 'ok'}">
        <div class="kpi-label">Vencidas em aberto</div>
        <div class="kpi-value">${atrasadas.length}</div>
        <div class="kpi-foot">${atrasadas.length
          ? fmtBRL(p7.vencidoPagar) + ' a pagar · ' + fmtBRL(p7.vencidoReceber) + ' a receber'
          : 'Nada atrasado'}</div>
      </div>
    </div>

    ${p15.necessidade > 0 ? `<div class="alerta warn">Nos próximos 15 dias sai <b>${fmtBRL(p15.necessidade)}</b> a mais do que entra. Confira se o saldo em conta cobre.</div>` : ''}

    <div class="alerta info">
      <b>O saldo em conta não aparece aqui de propósito.</b> A API do Bling não expõe os lançamentos
      avulsos do Caixas e Bancos, então qualquer saldo que eu calculasse viria errado — e errado pra
      mais. Os valores acima saem do vencimento das contas, que é informação confiável.
      Pra ver saldo, use o Caixas e Bancos do Bling.
    </div>

    <div class="grid-2">
      <div class="panel">
        <h3>Vence hoje</h3>
        ${vencemHoje.length ? '<table class="simple" id="tblHoje"></table>' : '<div class="state-msg">Nada vencendo hoje.</div>'}
      </div>
      <div class="panel">
        <h3>Próximos 7 dias</h3>
        ${proximas.length ? '<div style="max-height:320px; overflow:auto;"><table class="simple" id="tblProximas"></table></div>' : '<div class="state-msg">Nada previsto pros próximos 7 dias.</div>'}
      </div>
    </div>

    ${atrasadas.length ? `<div class="panel"><h3>Atrasadas <span class="badge-bad">${atrasadas.length}</span></h3>
      <div class="sub">Contas com vencimento passado que ainda não foram baixadas no Bling. Pode ser pagamento em atraso de verdade, ou baixa esquecida.</div>
      <div style="overflow-x:auto; max-height:420px;"><table class="simple" id="tblAtrasadas"></table></div></div>` : ''}
  `;

  const linhaConta = (r) => `<tr>
      <td>${fmtDataBR(r.date)}</td>
      <td>${escapeHtml_(r.contato || '—')}</td>
      <td>${escapeHtml_(r.categoria)}</td>
      <td class="num ${r.tipo === 'entrada' ? 'val-in' : 'val-out'}">${r.tipo === 'entrada' ? '' : '\u2212'}${fmtBRL(r.valor, 2)}</td>
    </tr>`;
  const cab = '<tr><th>Venc.</th><th>Quem</th><th>Categoria</th><th>Valor</th></tr>';

  if (vencemHoje.length) document.getElementById('tblHoje').innerHTML = cab + vencemHoje.map(linhaConta).join('');
  if (atrasadas.length) document.getElementById('tblAtrasadas').innerHTML = cab + atrasadas.map(linhaConta).join('');
  if (proximas.length) document.getElementById('tblProximas').innerHTML = cab + proximas.map(linhaConta).join('');
}

/* ---------------- KPIs & Gráficos ---------------- */

function renderKpis(el, rows) {
  const { receitaBruta, resultadoLiquido } = totais_(rows);
  const margem = receitaBruta ? resultadoLiquido / receitaBruta : 0;
  const [prevStart, prevEnd] = periodoAnterior_(FILTER.start, FILTER.end);
  const rowsAnterior = FLUXO_ROWS.filter(r => r.date >= prevStart && r.date <= prevEnd);
  const anterior = totais_(rowsAnterior.filter(r => r.paga));
  const variacaoReceita = anterior.receitaBruta ? (receitaBruta / anterior.receitaBruta - 1) : null;
  const indPmr = pmr_(rows);
  const eq = pontoEquilibrio_(rows);
  const canais = margemPorCanal_(rows);

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">KPIs &amp; Gráficos</h2>
      <div class="section-desc">Calculado a partir dos lançamentos do Bling (contas a pagar/receber por categoria) no período selecionado.</div>
    </div>
    ${renderFiltroBar_()}
    <div class="kpi-grid">
      <div class="kpi ${receitaBruta >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Receita recebida</div>
        <div class="kpi-value">${fmtBRL(receitaBruta)}</div>
        <div class="kpi-foot">${variacaoReceita === null ? 'Sem período anterior comparável' : fmtPct(variacaoReceita) + ' vs. período anterior'}</div>
      </div>
      <div class="kpi ${resultadoLiquido >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Resultado líquido</div>
        <div class="kpi-value">${fmtBRL(resultadoLiquido)}</div>
        <div class="kpi-foot">${resultadoLiquido >= 0 ? 'Positivo no período' : 'Negativo no período'}</div>
      </div>
      <div class="kpi ${indPmr.pmr <= 15 ? 'ok' : 'warn'}">
        <div class="kpi-label">PMR — prazo de recebimento</div>
        <div class="kpi-value">${indPmr.pmr.toFixed(0)} dias</div>
        <div class="kpi-foot">${fmtBRL(indPmr.aReceber)} vendidos e ainda não recebidos</div>
      </div>
      <div class="kpi ${eq.cobertura >= 1 ? 'ok' : (eq.cobertura >= 0.7 ? 'warn' : 'bad')}">
        <div class="kpi-label">Ponto de equilíbrio</div>
        <div class="kpi-value">${eq.faturamentoNecessario ? fmtPctSimples_(eq.cobertura) : '—'}</div>
        <div class="kpi-foot">${eq.faturamentoNecessario
          ? (eq.cobertura >= 1 ? 'Custo fixo pago' : 'Faltam ' + fmtBRL(eq.faturamentoNecessario - eq.receita) + ' de faturamento')
          : 'Cadastre as despesas fixas em Configurações'}</div>
      </div>
    </div>

    <div class="panel">
      <h3>Margem de contribuição por canal</h3>
      <div class="sub">Receita pela data da venda, menos a taxa do canal. Duas ressalvas: a taxa é rateada proporcionalmente (o financeiro não carimba taxa por canal) e <b>ainda não desconta o custo do produto</b>. Serve pra comparar canais entre si, não como margem final.</div>
      <div style="overflow-x:auto;"><table class="simple" id="tblCanais"></table></div>
    </div>
    <div class="panel">
      <h3>Receita bruta x Resultado líquido</h3>
      <div class="sub">${FILTER.start.toDateString() === FILTER.end.toDateString() ? 'Único dia selecionado — sem série temporal.' : 'Ao longo do período selecionado, em R$.'}</div>
      <div class="chart-box" style="height:300px;"><canvas id="chartKpis"></canvas></div>
    </div>
  `;
  ligarFiltroBar_(el);

  const tblC = document.getElementById('tblCanais');
  if (canais.length) {
    let h = '<tr><th>Canal</th><th>Receita</th><th>Taxa do canal</th><th>Margem de contrib.</th><th>%</th></tr>';
    canais.sort((a, b) => b.receita - a.receita).forEach(c => {
      h += `<tr><td>${escapeHtml_(c.canal)}</td>`
        + `<td class="num val-in">${fmtBRL(c.receita, 2)}</td>`
        + `<td class="num val-out">−${fmtBRL(c.taxa, 2)}</td>`
        + `<td class="num val-in">${fmtBRL(c.mc, 2)}</td>`
        + `<td class="num">${fmtPctSimples_(c.mcPct)}</td></tr>`;
    });
    tblC.innerHTML = h;
  } else {
    tblC.outerHTML = '<div class="state-msg">Sem vendas no período (a aba Vendas alimenta esta tabela).</div>';
  }

  const serie = serieTemporal_(rows, FILTER.start, FILTER.end);
  const serieReceita = serie.map(b => totais_(b.rows).receitaBruta);
  const serieResultado = serie.map(b => totais_(b.rows).resultadoLiquido);

  new Chart(document.getElementById('chartKpis'), {
    data: {
      labels: serie.map(b => b.label),
      datasets: [
        { type: 'bar', label: 'Receita bruta', data: serieReceita, backgroundColor: PALETTE.sageSoft, borderRadius: 3 },
        { type: 'line', label: 'Resultado líquido', data: serieResultado, borderColor: PALETTE.terracottaDark, borderWidth: 2, pointRadius: 3, tension: .2 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtBRL(c.raw) } } },
      scales: { y: { ticks: { callback: (v) => fmtBRL(v) }, grid: { color: '#EFE7DB' } }, x: { grid: { display: false } } }
    }
  });
}

/* ---------------- Fluxo de Caixa ---------------- */

/* Estado dos filtros da tabela do Fluxo de Caixa (independente do periodo). */
const FLUXO_F = { busca: '', categoria: '', contato: '', tipo: '', situacao: '' };

function renderFluxoCaixa(el, rows) {
  const categorias = [...new Set(rows.map(r => r.categoria))].sort();
  const contatos = [...new Set(rows.map(r => r.contato).filter(Boolean))].sort();

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Fluxo de Caixa</h2>
      <div class="section-desc">Contas a pagar e a receber do Bling no período. Mostra o que já foi pago <b>e</b> o que ainda está em aberto — use o filtro Situação pra separar.</div>
    </div>
    ${renderFiltroBar_()}
    ${!rows.length ? '<div class="state-msg">Sem lançamentos nesse período.</div>' : `
    <div class="grid-2">
      <div class="panel">
        <h3>Entradas x Saídas</h3>
        <div class="chart-box" style="height:290px;"><canvas id="chartCaixaMensal"></canvas></div>
      </div>
      <div class="panel">
        <h3>Maiores categorias de saída</h3>
        <div class="chart-box" style="height:290px;"><canvas id="chartCaixaCategorias"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <h3>Lançamentos</h3>
      <div class="tbl-filtros">
        <input type="text" id="fxBusca" placeholder="Buscar por nome, categoria, conta..." value="${escapeHtml_(FLUXO_F.busca)}">
        <select id="fxCategoria"><option value="">Todas as categorias</option>
          ${categorias.map(c => `<option value="${escapeHtml_(c)}" ${FLUXO_F.categoria === c ? 'selected' : ''}>${escapeHtml_(c)}</option>`).join('')}
        </select>
        <select id="fxContato"><option value="">Todos os contatos</option>
          ${contatos.map(c => `<option value="${escapeHtml_(c)}" ${FLUXO_F.contato === c ? 'selected' : ''}>${escapeHtml_(c)}</option>`).join('')}
        </select>
        <select id="fxTipo"><option value="">Entradas e saídas</option>
          <option value="entrada" ${FLUXO_F.tipo === 'entrada' ? 'selected' : ''}>Só entradas</option>
          <option value="saida" ${FLUXO_F.tipo === 'saida' ? 'selected' : ''}>Só saídas</option>
        </select>
        <select id="fxSituacao"><option value="">Pagas e em aberto</option>
          <option value="paga" ${FLUXO_F.situacao === 'paga' ? 'selected' : ''}>Só pagas</option>
          <option value="aberta" ${FLUXO_F.situacao === 'aberta' ? 'selected' : ''}>Só em aberto</option>
        </select>
        <button type="button" id="fxLimpar" class="link-btn">Limpar</button>
      </div>
      <div id="fxResumo" class="tbl-resumo"></div>
      <div style="overflow-x:auto;"><table class="simple" id="tblFluxo"></table></div>
    </div>
    `}
  `;
  ligarFiltroBar_(el);
  if (!rows.length) return;

  const serie = serieTemporal_(rows, FILTER.start, FILTER.end);
  const entradas = serie.map(b => b.rows.filter(r => r.tipo === 'entrada').reduce((s, r) => s + r.valor, 0));
  const saidas = serie.map(b => b.rows.filter(r => r.tipo === 'saida').reduce((s, r) => s + r.valor, 0));

  const porCategoria = {};
  rows.filter(r => r.tipo === 'saida').forEach(r => { porCategoria[r.categoria] = (porCategoria[r.categoria] || 0) + r.valor; });
  const topCategorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 10);

  new Chart(document.getElementById('chartCaixaMensal'), {
    type: 'bar',
    data: { labels: serie.map(b => b.label), datasets: [
      { label: 'Entradas', data: entradas, backgroundColor: PALETTE.entrada },
      { label: 'Saídas', data: saidas, backgroundColor: PALETTE.saida }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtBRL(c.raw) } } }, scales: { y: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  new Chart(document.getElementById('chartCaixaCategorias'), {
    type: 'bar',
    data: { labels: topCategorias.map(c => c[0]), datasets: [{ label: 'Total', data: topCategorias.map(c => c[1]), backgroundColor: PALETTE.saida, borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtBRL(c.raw) } } }, scales: { x: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  const redesenhar = () => desenharTabelaFluxo_(rows);
  const liga = (id, campo) => document.getElementById(id).addEventListener('change', (e) => { FLUXO_F[campo] = e.target.value; redesenhar(); });
  liga('fxCategoria', 'categoria');
  liga('fxContato', 'contato');
  liga('fxTipo', 'tipo');
  liga('fxSituacao', 'situacao');
  document.getElementById('fxBusca').addEventListener('input', (e) => { FLUXO_F.busca = e.target.value; redesenhar(); });
  document.getElementById('fxLimpar').addEventListener('click', () => {
    FLUXO_F.busca = ''; FLUXO_F.categoria = ''; FLUXO_F.contato = ''; FLUXO_F.tipo = ''; FLUXO_F.situacao = '';
    renderFluxoCaixa(el, rows);
  });
  redesenhar();
}

const LIMITE_LINHAS_FLUXO = 300;

function desenharTabelaFluxo_(rows) {
  const busca = FLUXO_F.busca.trim().toLowerCase();
  const filtradas = rows.filter(r => {
    if (FLUXO_F.categoria && r.categoria !== FLUXO_F.categoria) return false;
    if (FLUXO_F.contato && r.contato !== FLUXO_F.contato) return false;
    if (FLUXO_F.tipo && r.tipo !== FLUXO_F.tipo) return false;
    if (FLUXO_F.situacao === 'paga' && !r.paga) return false;
    if (FLUXO_F.situacao === 'aberta' && !r.aberta) return false;
    if (busca) {
      const alvo = (r.contato + ' ' + r.categoria + ' ' + r.banco + ' ' + r.grupoDRE).toLowerCase();
      if (alvo.indexOf(busca) < 0) return false;
    }
    return true;
  });

  const totEnt = filtradas.filter(r => r.tipo === 'entrada').reduce((s, r) => s + r.valor, 0);
  const totSai = filtradas.filter(r => r.tipo === 'saida').reduce((s, r) => s + r.valor, 0);
  document.getElementById('fxResumo').innerHTML =
    '<span>' + filtradas.length + ' lançamento(s)</span>'
    + '<span class="val-in">entradas ' + fmtBRL(totEnt, 2) + '</span>'
    + '<span class="val-out">saídas ' + fmtBRL(totSai, 2) + '</span>'
    + '<span class="' + (totEnt - totSai >= 0 ? 'val-in' : 'val-out') + '">saldo ' + fmtBRL(totEnt - totSai, 2) + '</span>';

  const ordenadas = filtradas.slice().sort((a, b) => b.date - a.date);
  let html = '<tr><th>Data</th><th>Situação</th><th>Quem</th><th>Categoria</th><th>Grupo DRE</th><th>Conta</th><th>Valor</th></tr>';
  ordenadas.slice(0, LIMITE_LINHAS_FLUXO).forEach(r => {
    html += '<tr class="' + (r.aberta ? 'linha-aberta' : '') + '">'
      + '<td>' + fmtDataBR(r.date) + '</td>'
      + '<td>' + (r.aberta
          ? '<span class="pill pill-aberta">em aberto</span>'
          : '<span class="pill pill-paga">' + (r.tipo === 'entrada' ? 'recebida' : 'paga') + '</span>') + '</td>'
      + '<td>' + escapeHtml_(r.contato || '—') + '</td>'
      + '<td>' + escapeHtml_(r.categoria) + '</td>'
      + '<td>' + escapeHtml_(r.grupoDRE) + '</td>'
      + '<td>' + escapeHtml_(r.banco || '—') + '</td>'
      + '<td class="num ' + (r.tipo === 'entrada' ? 'val-in' : 'val-out') + '">'
        + (r.tipo === 'entrada' ? '' : '\u2212') + fmtBRL(r.valor, 2) + '</td>'
      + '</tr>';
  });
  if (ordenadas.length > LIMITE_LINHAS_FLUXO) {
    html += '<tr><td colspan="7" class="state-msg">Mostrando os ' + LIMITE_LINHAS_FLUXO
      + ' mais recentes de ' + ordenadas.length + '. Use os filtros pra reduzir.</td></tr>';
  }
  document.getElementById('tblFluxo').innerHTML = html;
}

/* ---------------- DRE ---------------- */

function renderDre(el, rows) {
  const temVendas = (VENDAS_ROWS || []).length > 0;
  const competencia = DRE_REGIME === 'competencia' && temVendas;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">DRE</h2>
      <div class="section-desc">${competencia
        ? 'Receita pela <b>data da venda</b> (competência) — mostra o quanto você vendeu, mesmo que o dinheiro ainda não tenha entrado.'
        : 'Receita pela <b>data do recebimento</b> (caixa) — mostra o dinheiro que efetivamente entrou. Agrupado pela aba <code>_DRE_Mapa</code>.'}</div>
    </div>
    ${renderFiltroBar_()}
    <div class="regime-switch">
      <button type="button" data-regime="caixa" class="${competencia ? '' : 'ativo'}">Caixa</button>
      <button type="button" data-regime="competencia" class="${competencia ? 'ativo' : ''}" ${temVendas ? '' : 'disabled title="Rode syncVendas() no Apps Script pra habilitar"'}>Competência</button>
    </div>
    <div id="dreCorpo"></div>
  `;
  ligarFiltroBar_(el);
  el.querySelectorAll('.regime-switch button[data-regime]').forEach(b => {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      DRE_REGIME = b.dataset.regime;
      renderDre(el, rows);
    });
  });

  const corpo = el.querySelector('#dreCorpo');
  if (competencia) renderDreCompetencia_(corpo);
  else renderDreCaixa_(corpo, rows);
}

/* Regime de caixa: o que ja existia — grupos do _DRE_Mapa sobre o fluxo. */
function renderDreCaixa_(corpo, rows) {
  if (!rows.length) { corpo.innerHTML = '<div class="state-msg">Sem lançamentos nesse período.</div>'; return; }
  corpo.innerHTML = `<div class="panel"><h3>DRE do período</h3>
    <div style="overflow-x:auto;"><table class="simple" id="tblDre"></table></div></div>`;

  const serie = serieTemporal_(rows, FILTER.start, FILTER.end);
  const grupos = [...new Set(rows.map(r => r.grupoDRE))];
  const porGrupoColuna = serie.map(b => agregarPorGrupo_(b.rows));

  let html = '<tr><th>Grupo</th>' + serie.map(b => `<th>${b.label}</th>`).join('') + '<th>Total</th></tr>';
  grupos.forEach(g => {
    const valores = porGrupoColuna.map(pg => pg[g] || 0);
    const total = valores.reduce((a, b) => a + b, 0);
    html += `<tr><td>${g}</td>` + valores.map(v => `<td>${fmtBRL(v, 2)}</td>`).join('') + `<td><b>${fmtBRL(total, 2)}</b></td></tr>`;
  });
  document.getElementById('tblDre').innerHTML = html;
}

/*
 * Regime de competência: receita bruta pela data do pedido, por canal.
 * Cancelado nao entra (contaReceita = false na aba Vendas).
 *
 * Ainda e so a linha de receita — deducoes e CMV por competencia exigem
 * a taxa e o custo por pedido, que sao o proximo passo. Por isso a tela
 * mostra so o que da pra afirmar com os dados que existem hoje.
 */
function renderDreCompetencia_(corpo) {
  const todas = (VENDAS_ROWS || []).filter(v => v.date >= FILTER.start && v.date <= FILTER.end);
  const vendas = todas.filter(v => v.contaReceita);
  if (!todas.length) { corpo.innerHTML = '<div class="state-msg">Sem vendas nesse período.</div>'; return; }

  const canceladas = todas.filter(v => !v.contaReceita);
  const totalBruto = vendas.reduce((s, v) => s + v.total, 0);
  const ticket = vendas.length ? totalBruto / vendas.length : 0;

  corpo.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi ok">
        <div class="kpi-label">Receita bruta (competência)</div>
        <div class="kpi-value">${fmtBRL(totalBruto)}</div>
        <div class="kpi-foot">${vendas.length} pedido(s) no período</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Ticket médio</div>
        <div class="kpi-value">${fmtBRL(ticket)}</div>
        <div class="kpi-foot">Por pedido faturado</div>
      </div>
      <div class="kpi ${canceladas.length ? 'bad' : ''}">
        <div class="kpi-label">Cancelados no período</div>
        <div class="kpi-value">${canceladas.length}</div>
        <div class="kpi-foot">${fmtBRL(canceladas.reduce((s, v) => s + v.total, 0))} fora da receita</div>
      </div>
    </div>
    <div class="panel"><h3>Receita por canal</h3>
      <div style="overflow-x:auto;"><table class="simple" id="tblDre"></table></div></div>
    <div class="panel"><h3>Caixa × Competência</h3>
      <div id="dreComparativo"></div></div>
  `;

  const serie = serieTemporal_(vendas, FILTER.start, FILTER.end);
  const canais = [...new Set(vendas.map(v => v.canal))].sort();
  const porCanalColuna = serie.map(b => {
    const acc = {};
    b.rows.forEach(v => { acc[v.canal] = (acc[v.canal] || 0) + v.total; });
    return acc;
  });

  let html = '<tr><th>Canal</th>' + serie.map(b => `<th>${b.label}</th>`).join('') + '<th>Total</th></tr>';
  canais.forEach(c => {
    const valores = porCanalColuna.map(pc => pc[c] || 0);
    const total = valores.reduce((a, b) => a + b, 0);
    html += `<tr><td>${c}</td>` + valores.map(v => `<td>${fmtBRL(v, 2)}</td>`).join('') + `<td><b>${fmtBRL(total, 2)}</b></td></tr>`;
  });
  const totColuna = porCanalColuna.map(pc => Object.values(pc).reduce((a, b) => a + b, 0));
  html += '<tr><td><b>Total</b></td>' + totColuna.map(v => `<td><b>${fmtBRL(v, 2)}</b></td>`).join('')
        + `<td><b>${fmtBRL(totalBruto, 2)}</b></td></tr>`;
  document.getElementById('tblDre').innerHTML = html;

  // comparativo com o regime de caixa, que e a duvida que gera essa tela
  const rowsCaixa = (FLUXO_ROWS || []).filter(r => r.date >= FILTER.start && r.date <= FILTER.end);
  const receitaCaixa = rowsCaixa
    .filter(r => r.tipo === 'entrada' && String(r.grupoDRE).indexOf('Receita Bruta') >= 0)
    .reduce((s, r) => s + r.valor, 0);
  const dif = totalBruto - receitaCaixa;
  document.getElementById('dreComparativo').innerHTML = `
    <table class="simple">
      <tr><td>Vendi no período (competência)</td><td style="text-align:right;"><b>${fmtBRL(totalBruto)}</b></td></tr>
      <tr><td>Recebi no período (caixa)</td><td style="text-align:right;"><b>${fmtBRL(receitaCaixa)}</b></td></tr>
      <tr><td>${dif >= 0 ? 'Vendido e ainda não recebido' : 'Recebido de vendas anteriores'}</td>
          <td style="text-align:right;"><b>${fmtBRL(Math.abs(dif))}</b></td></tr>
    </table>
    <p class="section-desc" style="margin-top:10px;">A diferença é normal: marketplace libera o dinheiro dias depois da venda. Ela vira problema só se crescer mês a mês sem parar.</p>
  `;
}

/* ---------------- Precificação ---------------- */

function renderPrecificacao(el) {
  const produtos = precifProdutos || [];

  const margens = produtos.map(p => p.lucroPctSnapshot || 0);
  const margemMedia = margens.length ? margens.reduce((a, b) => a + b, 0) / margens.length : 0;
  const abaixoDe20 = produtos.filter(p => (p.lucroPctSnapshot || 0) < 0.20).length;
  const markups = produtos.map(p => p.markupSnapshot).filter(m => m > 0);
  const markupMedio = markups.length ? markups.reduce((a, b) => a + b, 0) / markups.length : 0;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Precificação</h2>
      <div class="section-desc">Calculadora editável — escolha o canal, preencha os custos e veja preço, margem e lucro na hora. Fica salvo aqui, não precisa mais abrir a planilha antiga.</div>
    </div>
    <div class="precif-summary">
      <div class="tile"><div class="l">Produtos cadastrados</div><div class="v">${produtos.length}</div></div>
      <div class="tile"><div class="l">Margem média</div><div class="v">${produtos.length ? fmtPct(margemMedia) : '—'}</div></div>
      <div class="tile"><div class="l">Abaixo de 20% de margem</div><div class="v">${abaixoDe20}</div></div>
      <div class="tile"><div class="l">Markup médio</div><div class="v">${markupMedio ? markupMedio.toFixed(2) + '×' : '—'}</div></div>
    </div>
    <div class="precif-toolbar">
      <input type="text" id="precifBusca" placeholder="Buscar por nome..." value="${escapeHtml_(precifBusca)}">
      <select id="precifFiltroCanal">
        <option value="">Todos os canais</option>
        ${Object.keys(CANAL_LABELS).map(c => `<option value="${c}" ${precifFiltroCanal === c ? 'selected' : ''}>${CANAL_LABELS[c]}</option>`).join('')}
      </select>
      <button type="button" class="primario" id="precifNovo">+ Novo produto</button>
    </div>
    <div class="panel">
      <div style="overflow-x:auto;"><table class="simple" id="precifTabela"></table></div>
    </div>
  `;

  document.getElementById('precifBusca').addEventListener('input', (e) => { precifBusca = e.target.value; renderPrecificacaoTabela_(); });
  document.getElementById('precifFiltroCanal').addEventListener('change', (e) => { precifFiltroCanal = e.target.value; renderPrecificacaoTabela_(); });
  document.getElementById('precifNovo').addEventListener('click', () => abrirNovoProduto_());

  renderPrecificacaoTabela_();
}

function renderPrecificacaoTabela_() {
  const tbl = document.getElementById('precifTabela');
  if (!tbl) return;
  const produtos = precifProdutos || [];
  const filtrados = produtos.filter(p => {
    if (precifFiltroCanal && p.canal !== precifFiltroCanal) return false;
    if (precifBusca && p.nome.toLowerCase().indexOf(precifBusca.toLowerCase()) < 0) return false;
    return true;
  });

  let html = '<tr><th>Nome</th><th>Canal</th><th>Preço</th><th>Custo</th><th>Margem</th><th>Markup</th><th></th></tr>';

  if (precifExpandidoId === '__novo__') {
    html += linhaEditavelHtml_(precifDraftOrigem, '__novo__');
  }
  if (!filtrados.length && precifExpandidoId !== '__novo__') {
    html += '<tr><td colspan="7" style="padding:24px; text-align:center; color:var(--muted);">Nenhum produto ainda. Clique em "+ Novo produto" pra começar.</td></tr>';
  }
  filtrados.forEach(p => {
    html += precifExpandidoId === p.id ? linhaEditavelHtml_(p, p.id) : linhaResumoHtml_(p);
  });

  tbl.innerHTML = html;
  ligarEventosPrecifTabela_(tbl);
}

function linhaResumoHtml_(p) {
  const canalCfg = (precifConfig.canais || {})[p.canal];
  const tagCls = 'precif-canal-tag' + (canalCfg && !canalCfg.confirmado ? ' nao-confirmado' : '');
  return `<tr>
    <td>${escapeHtml_(p.nome)}</td>
    <td><span class="${tagCls}">${CANAL_LABELS[p.canal] || p.canal}</span></td>
    <td>${fmtBRL(p.precoVenda, 2)}</td>
    <td>${fmtBRL(p.custoProdutoSnapshot, 2)}</td>
    <td>${fmtPct(p.lucroPctSnapshot)}</td>
    <td>${p.markupSnapshot ? p.markupSnapshot.toFixed(2) + '×' : '—'}</td>
    <td><div class="precif-row-acoes">
      <button type="button" class="editar" data-id="${p.id}">Editar</button>
      <button type="button" class="duplicar" data-id="${p.id}">Duplicar</button>
      <button type="button" class="excluir" data-id="${p.id}">Excluir</button>
    </div></td>
  </tr>`;
}

function materialCatalogoOptions_() {
  return (precifMateriais || []).map((m, i) =>
    `<option value="${i}">${escapeHtml_((m.fornecedor ? m.fornecedor + ' - ' : '') + m.material)} (R$${m.valor.toFixed(2)}/m)</option>`
  ).join('');
}
function funcionarioCatalogoOptions_() {
  return (precifFuncionarios || []).map((f, i) =>
    `<option value="${i}">${escapeHtml_(f.nome)}</option>`
  ).join('');
}

function materialLinhaTds_(m) {
  return `<td><select class="m-catalogo"><option value="">— catálogo —</option>${materialCatalogoOptions_()}</select></td>
    <td><input type="text" class="m-descricao" placeholder="ex: Cetim" value="${escapeHtml_(m.descricao || '')}"></td>
    <td><input type="number" step="0.01" class="m-valorUnitario" value="${m.valorUnitario || ''}"></td>
    <td><input type="number" step="0.01" class="m-qtdUtilizada" value="${m.qtdUtilizada || ''}"></td>
    <td><input type="number" step="0.01" class="m-valorManual" value="${m.valorManual || ''}"></td>
    <td><button type="button" class="del-linha">✕</button></td>`;
}
function maoDeObraLinhaTds_(f) {
  return `<td><select class="f-catalogo"><option value="">— catálogo —</option>${funcionarioCatalogoOptions_()}</select></td>
    <td><input type="text" class="f-descricao" placeholder="ex: Costureira" value="${escapeHtml_(f.descricao || '')}"></td>
    <td><input type="number" step="0.01" class="f-salarioMensal" value="${f.salarioMensal || ''}"></td>
    <td><input type="number" step="0.01" class="f-horasMes" value="${f.horasMes || ''}"></td>
    <td><input type="number" step="0.01" class="f-tempoExecucaoMinutos" value="${f.tempoExecucaoMinutos || ''}"></td>
    <td><button type="button" class="del-linha">✕</button></td>`;
}
function outrosCatalogoOptions_() {
  const mdo = (precifMaoDeObraPecas || []).map((m, i) =>
    `<option value="mdo:${i}">${escapeHtml_(m.funcionario + ' - ' + m.tipoPeca)} (R$${m.valor.toFixed(2)}${m.unidade ? ' ' + escapeHtml_(m.unidade) : ''})</option>`
  ).join('');
  const corte = (precifCorte || []).map((c, i) =>
    `<option value="corte:${i}">${escapeHtml_('Corte - ' + c.tipoPeca)} (R$${c.valor.toFixed(2)})</option>`
  ).join('');
  return mdo + corte;
}

function outrosLinhaTds_(o) {
  return `<td><select class="o-catalogo"><option value="">— catálogo —</option>${outrosCatalogoOptions_()}</select></td>
    <td><input type="text" class="o-descricao" placeholder="ex: Embalagem" value="${escapeHtml_(o.descricao || '')}"></td>
    <td><input type="number" step="0.01" class="o-valor" value="${o.valor || ''}"></td>
    <td><button type="button" class="del-linha">✕</button></td>`;
}

function linhaEditavelHtml_(produto, chave) {
  produto = produto || { nome: '', canal: '', materiais: [], maoDeObra: [], outros: [], tarifas: {}, despesasFixasPct: 0, precoVenda: 0 };
  const canais = Object.keys(CANAL_LABELS);
  const materiaisRows = (produto.materiais && produto.materiais.length ? produto.materiais : [{}]).map(m => '<tr>' + materialLinhaTds_(m) + '</tr>').join('');
  const maoDeObraRows = (produto.maoDeObra && produto.maoDeObra.length ? produto.maoDeObra : [{}]).map(f => '<tr>' + maoDeObraLinhaTds_(f) + '</tr>').join('');
  const outrosRows = (produto.outros && produto.outros.length ? produto.outros : [{}]).map(o => '<tr>' + outrosLinhaTds_(o) + '</tr>').join('');
  const tarifas = produto.tarifas || {};

  return `<tr><td colspan="7">
    <div class="precif-subrow" data-id="${produto.id || ''}">
      <div class="precif-field-row">
        <label>Nome<input type="text" class="nome" value="${escapeHtml_(produto.nome || '')}"></label>
        <label>Canal<select class="canal">
          ${canais.map(c => {
            const cfg = canaisConfigOuVazio_()[c];
            const aviso = cfg && !cfg.confirmado ? ' ⚠ não confirmado' : '';
            return `<option value="${c}" ${produto.canal === c ? 'selected' : ''}>${CANAL_LABELS[c]}${aviso}</option>`;
          }).join('')}
        </select></label>
        <label>Preço de venda (R$)<input type="number" step="0.01" class="precoVenda" value="${produto.precoVenda || ''}"></label>
        <label>Despesas fixas %<input type="number" step="0.01" class="despesasFixasPct" value="${((produto.despesasFixasPct || 0) * 100).toFixed(2)}"></label>
      </div>

      <div class="precif-field-row">
        <label>Tipo de produto (opcional)<input type="text" class="tipoProduto" list="precifTiposList" placeholder="ex: Robe manga curta"></label>
        <label>Tamanho<input type="text" class="tamanho" list="precifTamanhosList" placeholder="ex: M"></label>
        <span class="out-sugestaoRendimento"></span>
      </div>

      <div class="precif-linegroup" data-grupo="materiais">
        <h4>Matéria-prima</h4>
        <table><thead><tr><th>Material do catálogo</th><th>Descrição</th><th>Valor unitário</th><th>Qtd utilizada</th><th>ou valor manual</th><th></th></tr></thead>
        <tbody>${materiaisRows}</tbody></table>
        <button type="button" class="add-linha" data-grupo="materiais">+ material</button>
      </div>

      <div class="precif-linegroup" data-grupo="maoDeObra">
        <h4>Mão de obra</h4>
        <table><thead><tr><th>Funcionário</th><th>Descrição</th><th>Salário mensal</th><th>Horas/mês</th><th>Tempo execução (min)</th><th></th></tr></thead>
        <tbody>${maoDeObraRows}</tbody></table>
        <button type="button" class="add-linha" data-grupo="maoDeObra">+ funcionário</button>
      </div>

      <div class="precif-linegroup" data-grupo="outros">
        <h4>Outros materiais/serviços</h4>
        <table><thead><tr><th>Catálogo (mão de obra/corte)</th><th>Descrição</th><th>Valor</th><th></th></tr></thead>
        <tbody>${outrosRows}</tbody></table>
        <button type="button" class="add-linha" data-grupo="outros">+ item</button>
      </div>

      <div class="precif-linegroup" data-grupo="tarifas">
        <h4>Tarifas do canal</h4>
        <div class="precif-field-row">
          <label>Impostos %<input type="number" step="0.01" class="tarifa-impostosPct" value="${((tarifas.impostosPct || 0) * 100).toFixed(2)}"></label>
          <label>Comissão %<input type="number" step="0.01" class="tarifa-comissaoPct" value="${((tarifas.comissaoPct || 0) * 100).toFixed(2)}"></label>
          <label><span class="extra1-label">${escapeHtml_(tarifas.extra1Nome || 'Taxa extra 1')} %</span><input type="number" step="0.01" class="tarifa-extra1Pct" value="${((tarifas.extra1Pct || 0) * 100).toFixed(2)}"></label>
          <label><span class="extra2-label">${escapeHtml_(tarifas.extra2Nome || 'Taxa extra 2')} %</span><input type="number" step="0.01" class="tarifa-extra2Pct" value="${((tarifas.extra2Pct || 0) * 100).toFixed(2)}"></label>
        </div>
      </div>

      <div class="precif-breakdown">
        <div class="tile"><div class="l">Custo do produto</div><div class="v out-custo">—</div></div>
        <div class="tile"><div class="l">Despesas fixas</div><div class="v out-despesasFixas">—</div></div>
        <div class="tile"><div class="l">Custo variável</div><div class="v out-custoVariavel">—</div></div>
        <div class="tile out-lucro-tile"><div class="l">Lucro</div><div class="v out-lucro">—</div></div>
        <div class="tile"><div class="l">Markup</div><div class="v out-markup">—</div></div>
        <div class="tile"><div class="l">Margem de contribuição</div><div class="v out-margemContrib">—</div></div>
      </div>

      <div class="precif-ladder out-ladder"></div>

      <div class="precif-save-bar">
        <button type="button" class="cancelar">Cancelar</button>
        <button type="button" class="salvar">Salvar</button>
      </div>

      <datalist id="precifTiposList">
        ${[...new Set((precifRendimento || []).map(r => r.tipoProduto))].map(t => `<option value="${escapeHtml_(t)}">`).join('')}
      </datalist>
      <datalist id="precifTamanhosList">
        ${[...new Set((precifRendimento || []).map(r => r.tamanho))].map(t => `<option value="${escapeHtml_(t)}">`).join('')}
      </datalist>
    </div>
  </td></tr>`;
}

function canaisConfigOuVazio_() { return (precifConfig && precifConfig.canais) || {}; }

function buscarRendimento_(tipoProduto, tamanho) {
  return (precifRendimento || []).find(r =>
    r.tipoProduto.toLowerCase() === String(tipoProduto || '').trim().toLowerCase() &&
    r.tamanho.toLowerCase() === String(tamanho || '').trim().toLowerCase()
  ) || null;
}

function atualizarSugestaoRendimento_(subrow) {
  const tipoProduto = subrow.querySelector('.tipoProduto').value;
  const tamanho = subrow.querySelector('.tamanho').value;
  const el = subrow.querySelector('.out-sugestaoRendimento');
  const r = buscarRendimento_(tipoProduto, tamanho);
  if (!r) { el.innerHTML = ''; return; }
  const texto = r.metros2
    ? `Rendimento: ${r.metros} m (+ ${r.metros2} m acabamento)`
    : `Rendimento: ${r.metros} m`;
  el.innerHTML = `<span class="precif-canal-tag">${texto}</span> <button type="button" class="usar-rendimento" data-metros="${r.metros}" data-metros2="${r.metros2 || ''}">aplicar na 1ª matéria-prima</button>`;
}

function aplicarMaterialCatalogo_(select) {
  const idx = parseInt(select.value, 10);
  const m = isNaN(idx) ? null : (precifMateriais || [])[idx];
  if (!m) return;
  const tr = select.closest('tr');
  tr.querySelector('.m-descricao').value = (m.fornecedor ? m.fornecedor + ' - ' : '') + m.material;
  tr.querySelector('.m-valorUnitario').value = m.valor;
}

function aplicarFuncionarioCatalogo_(select) {
  const idx = parseInt(select.value, 10);
  const f = isNaN(idx) ? null : (precifFuncionarios || [])[idx];
  if (!f) return;
  const tr = select.closest('tr');
  tr.querySelector('.f-descricao').value = f.nome;
  tr.querySelector('.f-salarioMensal').value = f.salarioMensal;
  tr.querySelector('.f-horasMes').value = f.horasMes;
}

function aplicarOutrosCatalogo_(select) {
  const [tipo, idxStr] = String(select.value || '').split(':');
  const idx = parseInt(idxStr, 10);
  if (isNaN(idx)) return;
  const tr = select.closest('tr');
  if (tipo === 'mdo') {
    const m = (precifMaoDeObraPecas || [])[idx];
    if (!m) return;
    tr.querySelector('.o-descricao').value = m.funcionario + ' - ' + m.tipoPeca;
    tr.querySelector('.o-valor').value = m.valor;
  } else if (tipo === 'corte') {
    const c = (precifCorte || [])[idx];
    if (!c) return;
    tr.querySelector('.o-descricao').value = 'Corte - ' + c.tipoPeca;
    tr.querySelector('.o-valor').value = c.valor;
  }
}

function ligarEventosPrecifTabela_(tbl) {
  tbl.querySelectorAll('.editar').forEach(btn => btn.addEventListener('click', () => abrirEdicaoProduto_(btn.dataset.id)));
  tbl.querySelectorAll('.duplicar').forEach(btn => btn.addEventListener('click', () => duplicarProduto_(btn.dataset.id)));
  tbl.querySelectorAll('.excluir').forEach(btn => btn.addEventListener('click', () => excluirProdutoUi_(btn.dataset.id)));

  const subrow = tbl.querySelector('.precif-subrow');
  if (!subrow) return;

  subrow.addEventListener('input', (e) => {
    if (e.target.classList.contains('tipoProduto') || e.target.classList.contains('tamanho')) atualizarSugestaoRendimento_(subrow);
    if (e.target.matches('input')) recalcularSubrow_(subrow);
  });

  subrow.addEventListener('change', (e) => {
    if (e.target.classList.contains('canal')) { aplicarPresetCanal_(subrow, e.target.value); return; }
    if (e.target.classList.contains('m-catalogo')) { aplicarMaterialCatalogo_(e.target); recalcularSubrow_(subrow); return; }
    if (e.target.classList.contains('f-catalogo')) { aplicarFuncionarioCatalogo_(e.target); recalcularSubrow_(subrow); return; }
    if (e.target.classList.contains('o-catalogo')) { aplicarOutrosCatalogo_(e.target); recalcularSubrow_(subrow); return; }
  });

  subrow.addEventListener('click', (e) => {
    const usarRendBtn = e.target.closest('.usar-rendimento');
    if (usarRendBtn) {
      const materiaisBody = subrow.querySelector('[data-grupo="materiais"] tbody');
      const linhas = materiaisBody.querySelectorAll('tr');
      if (linhas[0]) linhas[0].querySelector('.m-qtdUtilizada').value = usarRendBtn.dataset.metros;
      if (usarRendBtn.dataset.metros2) {
        let segunda = linhas[1];
        if (!segunda) {
          segunda = document.createElement('tr');
          segunda.innerHTML = materialLinhaTds_({});
          materiaisBody.appendChild(segunda);
        }
        segunda.querySelector('.m-qtdUtilizada').value = usarRendBtn.dataset.metros2;
      }
      recalcularSubrow_(subrow);
      return;
    }
    const addBtn = e.target.closest('.add-linha');
    if (addBtn) {
      const grupo = addBtn.dataset.grupo;
      const tbody = addBtn.closest('.precif-linegroup').querySelector('tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = grupo === 'materiais' ? materialLinhaTds_({}) : grupo === 'maoDeObra' ? maoDeObraLinhaTds_({}) : outrosLinhaTds_({});
      tbody.appendChild(tr);
      return;
    }
    const delBtn = e.target.closest('.del-linha');
    if (delBtn) { delBtn.closest('tr').remove(); recalcularSubrow_(subrow); return; }
    const usarBtn = e.target.closest('.usar-preco');
    if (usarBtn) { subrow.querySelector('.precoVenda').value = usarBtn.dataset.preco; recalcularSubrow_(subrow); return; }
    if (e.target.classList.contains('cancelar')) { precifExpandidoId = null; precifDraftOrigem = null; renderPrecificacaoTabela_(); return; }
    if (e.target.classList.contains('salvar')) { salvarProdutoUi_(subrow); return; }
  });

  recalcularSubrow_(subrow);
}

function aplicarPresetCanal_(subrow, canal) {
  const preset = canaisConfigOuVazio_()[canal];
  if (!preset) return;
  subrow.querySelector('.tarifa-impostosPct').value = (preset.impostosPct * 100).toFixed(2);
  subrow.querySelector('.tarifa-comissaoPct').value = (preset.comissaoPct * 100).toFixed(2);
  subrow.querySelector('.tarifa-extra1Pct').value = (preset.extra1Pct * 100).toFixed(2);
  subrow.querySelector('.tarifa-extra2Pct').value = (preset.extra2Pct * 100).toFixed(2);
  subrow.querySelector('.extra1-label').textContent = (preset.extra1Nome || 'Taxa extra 1') + ' %';
  subrow.querySelector('.extra2-label').textContent = (preset.extra2Nome || 'Taxa extra 2') + ' %';
  recalcularSubrow_(subrow);
}

function lerProdutoDoSubrow_(subrow) {
  const materiais = Array.from(subrow.querySelectorAll('[data-grupo="materiais"] tbody tr')).map(tr => ({
    descricao: tr.querySelector('.m-descricao').value,
    valorUnitario: parseFloat(tr.querySelector('.m-valorUnitario').value) || 0,
    qtdUtilizada: parseFloat(tr.querySelector('.m-qtdUtilizada').value) || 0,
    valorManual: parseFloat(tr.querySelector('.m-valorManual').value) || 0
  })).filter(m => m.descricao || m.valorUnitario || m.valorManual);

  const maoDeObra = Array.from(subrow.querySelectorAll('[data-grupo="maoDeObra"] tbody tr')).map(tr => ({
    descricao: tr.querySelector('.f-descricao').value,
    salarioMensal: parseFloat(tr.querySelector('.f-salarioMensal').value) || 0,
    horasMes: parseFloat(tr.querySelector('.f-horasMes').value) || 0,
    tempoExecucaoMinutos: parseFloat(tr.querySelector('.f-tempoExecucaoMinutos').value) || 0
  })).filter(f => f.descricao || f.salarioMensal);

  const outros = Array.from(subrow.querySelectorAll('[data-grupo="outros"] tbody tr')).map(tr => ({
    descricao: tr.querySelector('.o-descricao').value,
    valor: parseFloat(tr.querySelector('.o-valor').value) || 0
  })).filter(o => o.descricao || o.valor);

  const tarifas = {
    impostosPct: (parseFloat(subrow.querySelector('.tarifa-impostosPct').value) || 0) / 100,
    comissaoPct: (parseFloat(subrow.querySelector('.tarifa-comissaoPct').value) || 0) / 100,
    extra1Nome: subrow.querySelector('.extra1-label').textContent.replace(/\s*%$/, ''),
    extra1Pct: (parseFloat(subrow.querySelector('.tarifa-extra1Pct').value) || 0) / 100,
    extra2Nome: subrow.querySelector('.extra2-label').textContent.replace(/\s*%$/, ''),
    extra2Pct: (parseFloat(subrow.querySelector('.tarifa-extra2Pct').value) || 0) / 100
  };

  return {
    id: subrow.dataset.id || '',
    nome: subrow.querySelector('.nome').value.trim(),
    canal: subrow.querySelector('.canal').value,
    materiais, maoDeObra, outros, tarifas,
    despesasFixasPct: (parseFloat(subrow.querySelector('.despesasFixasPct').value) || 0) / 100,
    precoVenda: parseFloat(subrow.querySelector('.precoVenda').value) || 0
  };
}

function recalcularSubrow_(subrow) {
  const p = lerProdutoDoSubrow_(subrow);
  const custo = PrecifCalc.custoProduto_(p.materiais, p.maoDeObra, p.outros);
  const custoVariavelPct = PrecifCalc.custoVariavelPct_(p.tarifas);
  const bd = PrecifCalc.breakdown_(p.precoVenda, custo, custoVariavelPct, p.despesasFixasPct);

  subrow.querySelector('.out-custo').textContent = fmtBRL(bd.custoProduto, 2);
  subrow.querySelector('.out-despesasFixas').textContent = fmtBRL(bd.despesasFixasReais, 2);
  subrow.querySelector('.out-custoVariavel').textContent = fmtBRL(bd.custoVariavelReais, 2) + ' (' + fmtPctSimples_(bd.custoVariavelPct) + ')';
  subrow.querySelector('.out-lucro').textContent = fmtBRL(bd.lucroReais, 2) + ' (' + fmtPct(bd.lucroPct) + ')';
  const tileLucro = subrow.querySelector('.out-lucro-tile');
  tileLucro.classList.toggle('lucro-pos', bd.lucroReais >= 0);
  tileLucro.classList.toggle('lucro-neg', bd.lucroReais < 0);
  subrow.querySelector('.out-markup').textContent = bd.markup ? bd.markup.toFixed(2) + '×' : '—';
  subrow.querySelector('.out-margemContrib').textContent = fmtBRL(bd.margemContribReais, 2) + ' (' + fmtPct(bd.margemContribPct) + ')';

  const ladder = PrecifCalc.ladderSugerido_(custo, p.despesasFixasPct, custoVariavelPct);
  subrow.querySelector('.out-ladder').innerHTML = ladder.map(l => l.precoSugerido == null ? '' : `
    <button type="button" class="usar-preco" data-preco="${l.precoSugerido.toFixed(2)}">
      <span class="l">Lucro ${Math.round(l.margemAlvoPct * 100)}%</span>
      <span class="v">${fmtBRL(l.precoSugerido, 2)}</span>
    </button>`).join('');
}

function abrirNovoProduto_() {
  const canais = Object.keys(canaisConfigOuVazio_());
  const primeiroCanal = canais[0] || '';
  const preset = canaisConfigOuVazio_()[primeiroCanal] || {};
  precifDraftOrigem = {
    id: '', nome: '', canal: primeiroCanal,
    materiais: [], maoDeObra: [], outros: [],
    tarifas: {
      impostosPct: preset.impostosPct || 0, comissaoPct: preset.comissaoPct || 0,
      extra1Nome: preset.extra1Nome || '', extra1Pct: preset.extra1Pct || 0,
      extra2Nome: preset.extra2Nome || '', extra2Pct: preset.extra2Pct || 0
    },
    despesasFixasPct: (precifConfig && precifConfig.despesasFixasPctPadrao) || 0,
    precoVenda: 0
  };
  precifExpandidoId = '__novo__';
  renderPrecificacaoTabela_();
}

function abrirEdicaoProduto_(id) {
  const p = (precifProdutos || []).find(x => x.id === id);
  if (!p) return;
  precifDraftOrigem = JSON.parse(JSON.stringify(p));
  precifExpandidoId = id;
  renderPrecificacaoTabela_();
}

function duplicarProduto_(id) {
  const p = (precifProdutos || []).find(x => x.id === id);
  if (!p) return;
  precifDraftOrigem = Object.assign(JSON.parse(JSON.stringify(p)), { id: '', nome: p.nome + ' (cópia)' });
  precifExpandidoId = '__novo__';
  renderPrecificacaoTabela_();
}

async function excluirProdutoUi_(id) {
  const p = (precifProdutos || []).find(x => x.id === id);
  if (!p) return;
  if (!confirm('Excluir "' + p.nome + '"? Ele some da lista, mas fica marcado como inativo na planilha (não é apagado de verdade).')) return;
  const resp = await apiPost_('excluirProduto', { id: id });
  if (!resp || !resp.ok) { alert('Não deu pra excluir: ' + ((resp && resp.error) || 'erro desconhecido')); return; }
  precifProdutos = precifProdutos.filter(x => x.id !== id);
  if (precifExpandidoId === id) precifExpandidoId = null;
  renderPrecificacaoTabela_();
}

async function salvarProdutoUi_(subrow) {
  const p = lerProdutoDoSubrow_(subrow);
  if (!p.nome) { alert('Dá um nome pro produto antes de salvar.'); return; }
  if (!(p.precoVenda > 0)) { alert('Preenche o preço de venda antes de salvar.'); return; }
  const btn = subrow.querySelector('.salvar');
  btn.disabled = true; btn.textContent = 'Salvando...';
  const resp = await apiPost_('salvarProduto', { produto: p });
  if (!resp || !resp.ok) {
    btn.disabled = false; btn.textContent = 'Salvar';
    alert('Não deu pra salvar: ' + ((resp && resp.error) || 'erro desconhecido'));
    return;
  }
  const dataProdutos = await apiFetch_('precificacao', idToken);
  precifProdutos = (dataProdutos && dataProdutos.produtos) || [];
  precifExpandidoId = null;
  precifDraftOrigem = null;
  renderPrecificacaoTabela_();
}

/* ---------------- Configurações (despesas fixas / salários) ---------------- */

function renderConfiguracoes(el) {
  const despesas = precifDespesasFixas || [];
  const total = despesas.reduce((s, d) => s + d.valorMensal, 0);
  const pctAtual = (precifConfig && precifConfig.despesasFixasPctPadrao) || 0;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Configurações</h2>
      <div class="section-desc">Despesas fixas mensais (aluguel, salários, energia, softwares...). A % de despesas fixas usada na calculadora de Precificação é calculada sozinha a partir daqui ÷ a receita média dos últimos meses.</div>
    </div>
    <div class="precif-summary">
      <div class="tile"><div class="l">Total despesas fixas/mês</div><div class="v">${fmtBRL(total, 2)}</div></div>
      <div class="tile"><div class="l">% usada na calculadora</div><div class="v">${fmtPctSimples_(pctAtual)}</div></div>
      <div class="tile"><div class="l">Itens cadastrados</div><div class="v">${despesas.length}</div></div>
    </div>
    <div class="panel">
      <h3>Despesas fixas (inclua salários/pró-labore aqui também, uma linha por pessoa)</h3>
      <div style="overflow-x:auto;"><table class="simple" id="despesasTabela"></table></div>
    </div>
  `;
  renderDespesasTabela_();
}

function renderDespesasTabela_() {
  const tbl = document.getElementById('despesasTabela');
  if (!tbl) return;
  const despesas = precifDespesasFixas || [];
  let html = '<tr><th>Descrição</th><th>Valor mensal (R$)</th><th></th></tr>';
  despesas.forEach(d => {
    html += `<tr data-id="${d.id}">
      <td><input type="text" class="d-descricao" value="${escapeHtml_(d.descricao)}"></td>
      <td><input type="number" step="0.01" class="d-valor" value="${d.valorMensal}"></td>
      <td><div class="precif-row-acoes">
        <button type="button" class="salvar-despesa">Salvar</button>
        <button type="button" class="excluir excluir-despesa">Excluir</button>
      </div></td>
    </tr>`;
  });
  html += `<tr data-id="">
    <td><input type="text" class="d-descricao" placeholder="ex: Aluguel, Salário Margarida..."></td>
    <td><input type="number" step="0.01" class="d-valor" placeholder="0,00"></td>
    <td><div class="precif-row-acoes"><button type="button" class="salvar-despesa">+ adicionar</button></div></td>
  </tr>`;
  tbl.innerHTML = html;

  tbl.querySelectorAll('.salvar-despesa').forEach(btn => btn.addEventListener('click', () => salvarDespesaUi_(btn)));
  tbl.querySelectorAll('.excluir-despesa').forEach(btn => btn.addEventListener('click', () => excluirDespesaUi_(btn)));
}

async function salvarDespesaUi_(btn) {
  const tr = btn.closest('tr');
  const id = tr.dataset.id || '';
  const descricao = tr.querySelector('.d-descricao').value.trim();
  const valorMensal = parseFloat(tr.querySelector('.d-valor').value) || 0;
  if (!descricao) { alert('Preenche a descrição antes de salvar.'); return; }
  btn.disabled = true;
  const resp = await apiPost_('salvarDespesaFixa', { despesa: { id: id, descricao: descricao, valorMensal: valorMensal } });
  btn.disabled = false;
  if (!resp || !resp.ok) { alert('Não deu pra salvar: ' + ((resp && resp.error) || 'erro desconhecido')); return; }
  await recarregarConfiguracoes_();
  renderConfiguracoes(document.getElementById('tab-configuracoes'));
}

async function excluirDespesaUi_(btn) {
  const tr = btn.closest('tr');
  const id = tr.dataset.id;
  if (!id) return;
  if (!confirm('Excluir essa despesa fixa?')) return;
  const resp = await apiPost_('excluirDespesaFixa', { id: id });
  if (!resp || !resp.ok) { alert('Não deu pra excluir: ' + ((resp && resp.error) || 'erro desconhecido')); return; }
  await recarregarConfiguracoes_();
  renderConfiguracoes(document.getElementById('tab-configuracoes'));
}

async function recarregarConfiguracoes_() {
  const [dataDespesas, dataConfig] = await Promise.all([
    apiFetch_('despesasFixas', idToken),
    apiFetch_('precificacaoConfig', idToken)
  ]);
  precifDespesasFixas = (dataDespesas && dataDespesas.despesas) || [];
  precifConfig = (dataConfig && dataConfig.config) || precifConfig;
}

/* ---------------- Boot ---------------- */
window.addEventListener('load', () => {
  const check = setInterval(() => {
    if (window.google && google.accounts) { clearInterval(check); initGoogle(); }
  }, 100);
});
