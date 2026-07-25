const CFG = window.PAINEL_CONFIG;

const fmtBRL = (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v, dec = 1) => (v >= 0 ? '+' : '') + (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const fmtDataBR = (d) => d.toLocaleDateString('pt-BR');
const monthLabel = (p) => {
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [y, mo] = String(p).split('-');
  return m[parseInt(mo, 10) - 1] + '/' + y.slice(2);
};
const dayLabel = (d) => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');

const PALETTE = { wine: '#8E2A44', wineSoft: '#C97C90', gold: '#B8863E', sage: '#4B7A5B', sageSoft: '#9CC3A8', brick: '#AB3B32', amber: '#B9791F', ink: '#211B22', muted: '#B8AC9C' };

let idToken = sessionStorage.getItem('id_token') || null;
const cache = {}; // só para 'precificacao' (não depende de filtro de data)
let FLUXO_ROWS = null; // [{date, tipo, grupoDRE, categoria, contato, banco, valor}]

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
  const custIni = FILTER.preset === 'personalizado' ? FILTER.start.toISOString().slice(0, 10) : '';
  const custFim = FILTER.preset === 'personalizado' ? FILTER.end.toISOString().slice(0, 10) : '';
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
      if (!cache.precificacao) {
        el.innerHTML = '<div class="state-msg">Carregando...</div>';
        cache.precificacao = await apiFetch_('precificacao', idToken);
      }
      return renderPrecificacao(el, cache.precificacao);
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
  const chave = (d) => porDia ? d.toISOString().slice(0, 10) : (d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
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
        { type: 'bar', label: 'Receita bruta', data: serieReceita, backgroundColor: PALETTE.wineSoft, borderRadius: 3 },
        { type: 'line', label: 'Resultado líquido', data: serieResultado, borderColor: PALETTE.gold, borderWidth: 2, pointRadius: 3, tension: .2 }
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
      { label: 'Saídas', data: saidas, backgroundColor: PALETTE.wineSoft }
    ] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtBRL(c.raw) } } }, scales: { y: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  new Chart(document.getElementById('chartCaixaCategorias'), {
    type: 'bar',
    data: { labels: topCategorias.map(c => c[0]), datasets: [{ label: 'Total', data: topCategorias.map(c => c[1]), backgroundColor: PALETTE.wine, borderRadius: 3 }] },
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

function renderPrecificacao(el, data) {
  const canais = (data && data.canais) || [];
  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Precificação</h2>
      <div class="section-desc">Espelho ao vivo (IMPORTRANGE) das planilhas FPV 2026 reais de cada canal — as mesmas fórmulas que a Karolyne já usa, sem recriação.</div>
    </div>
    <div class="grid-3" id="precifCards"></div>
    <div class="panel">
      <p class="sub">Para ver o detalhe completo de cada calculadora (matéria-prima, mão de obra, margens), abra a planilha "Leve Sonho — Painel Financeiro" diretamente — a aba <code>Precificação_&lt;Canal&gt;</code> espelha o FPV real daquele canal.</p>
    </div>
  `;
  const grid = document.getElementById('precifCards');
  canais.forEach(c => {
    const div = document.createElement('div');
    div.className = 'panel';
    div.innerHTML = `
      <h3>${c.canal}</h3>
      <div class="sub">${c.ok ? c.linhas + ' linhas × ' + c.colunas + ' colunas espelhadas' : (c.motivo || 'aba não encontrada')}</div>
      <span class="badge ${c.ok ? 'ok' : 'bad'}">${c.ok ? 'Sincronizado' : 'Verificar'}</span>
    `;
    grid.appendChild(div);
  });
}

/* ---------------- Boot ---------------- */
window.addEventListener('load', () => {
  const check = setInterval(() => {
    if (window.google && google.accounts) { clearInterval(check); initGoogle(); }
  }, 100);
});
