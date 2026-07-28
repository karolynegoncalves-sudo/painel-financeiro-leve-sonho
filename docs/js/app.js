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

const PALETTE = { sage: '#557571', sageSoft: '#9DB8B5', terracotta: '#D49A89', terracottaDark: '#B97A67', peach: '#F7D1BA', brick: '#AB3B32', amber: '#B9791F', ink: '#2B2926', muted: '#C9BFB4' };

let idToken = sessionStorage.getItem('id_token') || null;
const cache = {};
let FLUXO_ROWS = null; // [{date, tipo, grupoDRE, categoria, contato, banco, valor}]

/* ---------------- Precificação: estado local ---------------- */
let precifProdutos = null;       // array de produtos vinda do backend (cache mutável local)
let precifConfig = null;         // {despesasFixasPctPadrao, canais:{...}}
let precifBusca = '';
let precifFiltroCanal = '';
let precifExpandidoId = null;    // id do produto expandido, ou '__novo__'
let precifDraftOrigem = null;    // valores iniciais pro produto sendo criado/duplicado

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
  document.getElementById('userEmail').textContent = data.email || '';
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  setupTabs();
  safeRenderTab('kpis');
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
  const iData = idx('data'), iTipo = idx('tipo'), iGrupo = idx('grupoDRE'), iCategoria = idx('categoriaNome'),
    iContato = idx('contatoNome'), iBanco = idx('contaBancariaNome'), iValor = idx('valor');
  return rows.map(r => {
    const date = new Date(String(r[iData]).slice(0, 10) + 'T00:00:00');
    return {
      date,
      tipo: r[iTipo],
      grupoDRE: r[iGrupo] || '(sem mapear)',
      categoria: r[iCategoria] || '(sem categoria)',
      contato: r[iContato] || '',
      banco: r[iBanco] || '',
      valor: Math.abs(Number(r[iValor]) || 0)
    };
  }).filter(r => !isNaN(r.date.getTime()));
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
        const [dataProdutos, dataConfig] = await Promise.all([
          apiFetch_('precificacao', idToken),
          apiFetch_('precificacaoConfig', idToken)
        ]);
        precifProdutos = (dataProdutos && dataProdutos.produtos) || [];
        precifConfig = (dataConfig && dataConfig.config) || { despesasFixasPctPadrao: 0, canais: {} };
      }
      return renderPrecificacao(el);
    }
    if (!FLUXO_ROWS) { el.innerHTML = '<div class="state-msg">Carregando...</div>'; return; }
    const rowsFiltradas = FLUXO_ROWS.filter(r => r.date >= FILTER.start && r.date <= FILTER.end);
    if (view === 'kpis') return renderKpis(el, rowsFiltradas);
    if (view === 'fluxoCaixa') return renderFluxoCaixa(el, rowsFiltradas);
    if (view === 'dre') return renderDre(el, rowsFiltradas);
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
function serieTemporal_(rows, start, end) {
  const dias = Math.round((end - start) / 86400000) + 1;
  const porDia = dias <= 45;
  const buckets = {};
  const chave = (d) => porDia ? toDateInputValue_(d) : (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  const label = (k) => porDia ? dayLabel(new Date(k + 'T00:00:00')) : monthLabel(k);
  rows.forEach(r => {
    const k = chave(r.date);
    buckets[k] = buckets[k] || [];
    buckets[k].push(r);
  });
  const chaves = Object.keys(buckets).sort();
  return chaves.map(k => ({ chave: k, label: label(k), rows: buckets[k] }));
}

/* ---------------- KPIs & Gráficos ---------------- */

function renderKpis(el, rows) {
  const { receitaBruta, resultadoLiquido } = totais_(rows);
  const margem = receitaBruta ? resultadoLiquido / receitaBruta : 0;
  const [prevStart, prevEnd] = periodoAnterior_(FILTER.start, FILTER.end);
  const rowsAnterior = FLUXO_ROWS.filter(r => r.date >= prevStart && r.date <= prevEnd);
  const anterior = totais_(rowsAnterior);
  const variacaoReceita = anterior.receitaBruta ? (receitaBruta / anterior.receitaBruta - 1) : null;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">KPIs &amp; Gráficos</h2>
      <div class="section-desc">Calculado a partir dos lançamentos do Bling (contas a pagar/receber por categoria) no período selecionado.</div>
    </div>
    ${renderFiltroBar_()}
    <div class="kpi-grid">
      <div class="kpi ${receitaBruta >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Receita bruta</div>
        <div class="kpi-value">${fmtBRL(receitaBruta)}</div>
        <div class="kpi-foot">${variacaoReceita === null ? 'Sem período anterior comparável' : fmtPct(variacaoReceita) + ' vs. período anterior'}</div>
      </div>
      <div class="kpi ${resultadoLiquido >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Resultado líquido</div>
        <div class="kpi-value">${fmtBRL(resultadoLiquido)}</div>
        <div class="kpi-foot">${resultadoLiquido >= 0 ? 'Positivo no período' : 'Negativo no período'}</div>
      </div>
      <div class="kpi ${margem >= 0 ? 'ok' : 'warn'}">
        <div class="kpi-label">Margem líquida</div>
        <div class="kpi-value">${fmtPct(margem)}</div>
        <div class="kpi-foot">Resultado líquido ÷ receita bruta</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Lançamentos no período</div>
        <div class="kpi-value">${rows.length}</div>
        <div class="kpi-foot">${fmtDataBR(FILTER.start)} – ${fmtDataBR(FILTER.end)}</div>
      </div>
    </div>
    <div class="panel">
      <h3>Receita bruta x Resultado líquido</h3>
      <div class="sub">${FILTER.start.toDateString() === FILTER.end.toDateString() ? 'Único dia selecionado — sem série temporal.' : 'Ao longo do período selecionado, em R$.'}</div>
      <div class="chart-box" style="height:300px;"><canvas id="chartKpis"></canvas></div>
    </div>
  `;
  ligarFiltroBar_(el);

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

function renderFluxoCaixa(el, rows) {
  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Fluxo de Caixa</h2>
      <div class="section-desc">Contas a pagar e a receber do Bling (caixas e bancos) no período selecionado.</div>
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
      <h3>Lançamentos do período (${rows.length})</h3>
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
      { label: 'Entradas', data: entradas, backgroundColor: PALETTE.sageSoft },
      { label: 'Saídas', data: saidas, backgroundColor: PALETTE.terracotta }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtBRL(c.raw) } } }, scales: { y: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  new Chart(document.getElementById('chartCaixaCategorias'), {
    type: 'bar',
    data: { labels: topCategorias.map(c => c[0]), datasets: [{ label: 'Total', data: topCategorias.map(c => c[1]), backgroundColor: PALETTE.terracottaDark, borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtBRL(c.raw) } } }, scales: { x: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  const tbl = document.getElementById('tblFluxo');
  let html = '<tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Contato</th><th>Banco</th><th>Valor</th></tr>';
  rows.slice().sort((a, b) => b.date - a.date).slice(0, 100).forEach(r => {
    html += `<tr><td>${fmtDataBR(r.date)}</td><td>${r.tipo}</td><td>${r.categoria}</td><td>${r.contato}</td><td>${r.banco}</td><td>${fmtBRL(r.valor, 2)}</td></tr>`;
  });
  tbl.innerHTML = html;
}

/* ---------------- DRE ---------------- */

function renderDre(el, rows) {
  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">DRE</h2>
      <div class="section-desc">Agrupado por categoria do Bling (aba _DRE_Mapa da planilha define o agrupamento — editável sem mexer em código) no período selecionado.</div>
    </div>
    ${renderFiltroBar_()}
    ${!rows.length ? '<div class="state-msg">Sem lançamentos nesse período.</div>' : `
    <div class="panel">
      <h3>DRE do período</h3>
      <div style="overflow-x:auto;"><table class="simple" id="tblDre"></table></div>
    </div>
    `}
  `;
  ligarFiltroBar_(el);
  if (!rows.length) return;

  const serie = serieTemporal_(rows, FILTER.start, FILTER.end);
  const grupos = [...new Set(rows.map(r => r.grupoDRE))];
  const porGrupoColuna = serie.map(b => agregarPorGrupo_(b.rows));

  const tbl = document.getElementById('tblDre');
  let html = '<tr><th>Grupo</th>' + serie.map(b => `<th>${b.label}</th>`).join('') + '<th>Total</th></tr>';
  grupos.forEach(g => {
    const valores = porGrupoColuna.map(pg => pg[g] || 0);
    const total = valores.reduce((a, b) => a + b, 0);
    html += `<tr><td>${g}</td>` + valores.map(v => `<td>${fmtBRL(v, 2)}</td>`).join('') + `<td><b>${fmtBRL(total, 2)}</b></td></tr>`;
  });
  tbl.innerHTML = html;
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

function materialLinhaTds_(m) {
  return `<td><input type="text" class="m-descricao" placeholder="ex: Cetim" value="${escapeHtml_(m.descricao || '')}"></td>
    <td><input type="number" step="0.01" class="m-valorUnitario" value="${m.valorUnitario || ''}"></td>
    <td><input type="number" step="0.01" class="m-qtdUtilizada" value="${m.qtdUtilizada || ''}"></td>
    <td><input type="number" step="0.01" class="m-valorManual" value="${m.valorManual || ''}"></td>
    <td><button type="button" class="del-linha">✕</button></td>`;
}
function maoDeObraLinhaTds_(f) {
  return `<td><input type="text" class="f-descricao" placeholder="ex: Costureira" value="${escapeHtml_(f.descricao || '')}"></td>
    <td><input type="number" step="0.01" class="f-salarioMensal" value="${f.salarioMensal || ''}"></td>
    <td><input type="number" step="0.01" class="f-horasMes" value="${f.horasMes || ''}"></td>
    <td><input type="number" step="0.01" class="f-tempoExecucaoMinutos" value="${f.tempoExecucaoMinutos || ''}"></td>
    <td><button type="button" class="del-linha">✕</button></td>`;
}
function outrosLinhaTds_(o) {
  return `<td><input type="text" class="o-descricao" placeholder="ex: Embalagem" value="${escapeHtml_(o.descricao || '')}"></td>
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

      <div class="precif-linegroup" data-grupo="materiais">
        <h4>Matéria-prima</h4>
        <table><thead><tr><th>Descrição</th><th>Valor unitário</th><th>Qtd utilizada</th><th>ou valor manual</th><th></th></tr></thead>
        <tbody>${materiaisRows}</tbody></table>
        <button type="button" class="add-linha" data-grupo="materiais">+ material</button>
      </div>

      <div class="precif-linegroup" data-grupo="maoDeObra">
        <h4>Mão de obra</h4>
        <table><thead><tr><th>Descrição</th><th>Salário mensal</th><th>Horas/mês</th><th>Tempo execução (min)</th><th></th></tr></thead>
        <tbody>${maoDeObraRows}</tbody></table>
        <button type="button" class="add-linha" data-grupo="maoDeObra">+ funcionário</button>
      </div>

      <div class="precif-linegroup" data-grupo="outros">
        <h4>Outros materiais/serviços</h4>
        <table><thead><tr><th>Descrição</th><th>Valor</th><th></th></tr></thead>
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
    </div>
  </td></tr>`;
}

function canaisConfigOuVazio_() { return (precifConfig && precifConfig.canais) || {}; }

function ligarEventosPrecifTabela_(tbl) {
  tbl.querySelectorAll('.editar').forEach(btn => btn.addEventListener('click', () => abrirEdicaoProduto_(btn.dataset.id)));
  tbl.querySelectorAll('.duplicar').forEach(btn => btn.addEventListener('click', () => duplicarProduto_(btn.dataset.id)));
  tbl.querySelectorAll('.excluir').forEach(btn => btn.addEventListener('click', () => excluirProdutoUi_(btn.dataset.id)));

  const subrow = tbl.querySelector('.precif-subrow');
  if (!subrow) return;

  subrow.addEventListener('input', (e) => {
    if (e.target.matches('input')) recalcularSubrow_(subrow);
  });

  subrow.addEventListener('change', (e) => {
    if (e.target.classList.contains('canal')) aplicarPresetCanal_(subrow, e.target.value);
  });

  subrow.addEventListener('click', (e) => {
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

/* ---------------- Boot ---------------- */
window.addEventListener('load', () => {
  const check = setInterval(() => {
    if (window.google && google.accounts) { clearInterval(check); initGoogle(); }
  }, 100);
});
