const CFG = window.PAINEL_CONFIG;

const fmtBRL = (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v, dec = 1) => (v >= 0 ? '+' : '') + (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const monthLabel = (p) => {
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const [y, mo] = String(p).split('-');
  return m[parseInt(mo, 10) - 1] + '/' + y.slice(2);
};

const PALETTE = { wine: '#8E2A44', wineSoft: '#C97C90', gold: '#B8863E', sage: '#4B7A5B', sageSoft: '#9CC3A8', brick: '#AB3B32', amber: '#B9791F', ink: '#211B22', muted: '#B8AC9C' };

let idToken = sessionStorage.getItem('id_token') || null;
const cache = {};

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
  const data = await apiFetch_('kpis', token);
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
  cache.kpis = data;
  document.getElementById('userEmail').textContent = data.email || '';
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderTab('kpis', data);
  setupTabs();
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

/* ---------------- Tabs ---------------- */

function setupTabs() {
  document.querySelectorAll('#tabNav button').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('#tabNav button').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const view = btn.dataset.tab;
      document.getElementById('tab-' + view).classList.add('active');
      if (!cache[view]) {
        document.getElementById('tab-' + view).innerHTML = '<div class="state-msg">Carregando...</div>';
        const data = await apiFetch_(view, idToken);
        cache[view] = data;
        renderTab(view, data);
      }
    });
  });
}

function renderTab(view, data) {
  const el = document.getElementById('tab-' + view);
  if (!data || data.error) {
    el.innerHTML = '<div class="state-msg">Não foi possível carregar esses dados agora (' + ((data && data.error) || 'erro desconhecido') + ').</div>';
    return;
  }
  if (view === 'kpis') return renderKpis(el, data);
  if (view === 'fluxoCaixa') return renderFluxoCaixa(el, data);
  if (view === 'dre') return renderDre(el, data);
  if (view === 'precificacao') return renderPrecificacao(el, data);
}

/* ---------------- KPIs & Gráficos ---------------- */

function renderKpis(el, data) {
  const kpis = data.kpis || [];
  if (!kpis.length) {
    el.innerHTML = '<div class="state-msg">Ainda sem dados suficientes — sincronize o Bling na planilha (menu Painel Financeiro > Sincronizar Bling agora).</div>';
    return;
  }
  const last = kpis[kpis.length - 1];
  const prev = kpis[kpis.length - 2];
  const momReceita = prev ? (last.receitaBruta / prev.receitaBruta - 1) : 0;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">KPIs &amp; Gráficos</h2>
      <div class="section-desc">Calculado a partir da DRE mensal (Bling: contas a pagar/receber por categoria).</div>
    </div>
    <div class="kpi-grid">
      <div class="kpi ${last.receitaBruta >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Receita bruta · ${monthLabel(last.mes)}</div>
        <div class="kpi-value">${fmtBRL(last.receitaBruta)}</div>
        <div class="kpi-foot">${prev ? fmtPct(momReceita) + ' vs. ' + monthLabel(prev.mes) : ''}</div>
      </div>
      <div class="kpi ${last.resultadoLiquido >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Resultado líquido · ${monthLabel(last.mes)}</div>
        <div class="kpi-value">${fmtBRL(last.resultadoLiquido)}</div>
        <div class="kpi-foot">${last.resultadoLiquido >= 0 ? 'Positivo no mês' : 'Negativo no mês'}</div>
      </div>
      <div class="kpi ${last.margemLiquidaPct >= 0 ? 'ok' : 'warn'}">
        <div class="kpi-label">Margem líquida · ${monthLabel(last.mes)}</div>
        <div class="kpi-value">${fmtPct(last.margemLiquidaPct)}</div>
        <div class="kpi-foot">Resultado líquido ÷ receita bruta</div>
      </div>
      <div class="kpi">
        <div class="kpi-label">Meses com dados</div>
        <div class="kpi-value">${kpis.length}</div>
        <div class="kpi-foot">${monthLabel(kpis[0].mes)} – ${monthLabel(last.mes)}</div>
      </div>
    </div>
    <div class="panel">
      <h3>Receita bruta x Resultado líquido</h3>
      <div class="sub">Por mês, em R$.</div>
      <div class="chart-box" style="height:300px;"><canvas id="chartKpis"></canvas></div>
    </div>
  `;

  new Chart(document.getElementById('chartKpis'), {
    data: {
      labels: kpis.map(k => monthLabel(k.mes)),
      datasets: [
        { type: 'bar', label: 'Receita bruta', data: kpis.map(k => k.receitaBruta), backgroundColor: PALETTE.wineSoft, borderRadius: 3 },
        { type: 'line', label: 'Resultado líquido', data: kpis.map(k => k.resultadoLiquido), borderColor: PALETTE.gold, borderWidth: 2, pointRadius: 4, tension: .2 }
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

function renderFluxoCaixa(el, data) {
  const rows = (data.rows && data.rows.rows) || [];
  const headers = (data.rows && data.rows.headers) || [];
  if (!rows.length) {
    el.innerHTML = '<div class="state-msg">Ainda sem lançamentos sincronizados. Rode a sincronização do Bling na planilha.</div>';
    return;
  }
  const idx = (nome) => headers.indexOf(nome);
  const iData = idx('data'), iTipo = idx('tipo'), iValor = idx('valor'), iCategoria = idx('categoriaNome'), iContato = idx('contatoNome'), iBanco = idx('contaBancariaNome');

  const porMes = {};
  rows.forEach(r => {
    const d = r[iData]; if (!d) return;
    const mes = String(d).slice(0, 7);
    porMes[mes] = porMes[mes] || { entradas: 0, saidas: 0 };
    const v = Math.abs(Number(r[iValor]) || 0);
    if (r[iTipo] === 'entrada') porMes[mes].entradas += v; else porMes[mes].saidas += v;
  });
  const meses = Object.keys(porMes).sort();

  const porCategoria = {};
  rows.filter(r => r[iTipo] === 'saida').forEach(r => {
    const cat = r[iCategoria] || '(sem categoria)';
    porCategoria[cat] = (porCategoria[cat] || 0) + Math.abs(Number(r[iValor]) || 0);
  });
  const topCategorias = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).slice(0, 10);

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Fluxo de Caixa</h2>
      <div class="section-desc">Contas a pagar e a receber do Bling (caixas e bancos), ${rows.length} lançamento(s) sincronizado(s).</div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h3>Entradas x Saídas por mês</h3>
        <div class="chart-box" style="height:290px;"><canvas id="chartCaixaMensal"></canvas></div>
      </div>
      <div class="panel">
        <h3>Maiores categorias de saída</h3>
        <div class="chart-box" style="height:290px;"><canvas id="chartCaixaCategorias"></canvas></div>
      </div>
    </div>
    <div class="panel">
      <h3>Últimos lançamentos</h3>
      <div style="overflow-x:auto;"><table class="simple" id="tblFluxo"></table></div>
    </div>
  `;

  new Chart(document.getElementById('chartCaixaMensal'), {
    type: 'bar',
    data: {
      labels: meses.map(monthLabel),
      datasets: [
        { label: 'Entradas', data: meses.map(m => porMes[m].entradas), backgroundColor: PALETTE.sageSoft },
        { label: 'Saídas', data: meses.map(m => porMes[m].saidas), backgroundColor: PALETTE.wineSoft }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + fmtBRL(c.raw) } } }, scales: { y: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  new Chart(document.getElementById('chartCaixaCategorias'), {
    type: 'bar',
    data: { labels: topCategorias.map(c => c[0]), datasets: [{ label: 'Total', data: topCategorias.map(c => c[1]), backgroundColor: PALETTE.wine, borderRadius: 3 }] },
    options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => fmtBRL(c.raw) } } }, scales: { x: { ticks: { callback: (v) => fmtBRL(v) } } } }
  });

  const tbl = document.getElementById('tblFluxo');
  let html = '<tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Contato</th><th>Banco</th><th>Valor</th></tr>';
  rows.slice(-30).reverse().forEach(r => {
    html += `<tr><td>${r[iData]}</td><td>${r[iTipo]}</td><td>${r[iCategoria] || ''}</td><td>${r[iContato] || ''}</td><td>${r[iBanco] || ''}</td><td>${fmtBRL(r[iValor], 2)}</td></tr>`;
  });
  tbl.innerHTML = html;
}

/* ---------------- DRE ---------------- */

function renderDre(el, data) {
  const rows = (data.rows && data.rows.rows) || [];
  if (!rows.length) {
    el.innerHTML = '<div class="state-msg">Ainda sem DRE calculada. Rode a sincronização do Bling na planilha.</div>';
    return;
  }
  const meses = [...new Set(rows.map(r => r[0]))].sort();
  const grupos = [...new Set(rows.map(r => r[1]))];
  const porGrupoMes = {};
  rows.forEach(([mes, grupo, valor]) => { porGrupoMes[grupo + '|' + mes] = Number(valor) || 0; });

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">DRE</h2>
      <div class="section-desc">Agrupado por categoria do Bling (aba _DRE_Mapa da planilha define o agrupamento — editável sem mexer em código).</div>
    </div>
    <div class="panel">
      <h3>DRE por mês</h3>
      <div style="overflow-x:auto;">
        <table class="simple" id="tblDre"></table>
      </div>
    </div>
  `;

  const tbl = document.getElementById('tblDre');
  let html = '<tr><th>Grupo</th>' + meses.map(m => `<th>${monthLabel(m)}</th>`).join('') + '</tr>';
  grupos.forEach(g => {
    html += `<tr><td>${g}</td>` + meses.map(m => `<td>${fmtBRL(porGrupoMes[g + '|' + m] || 0, 2)}</td>`).join('') + '</tr>';
  });
  tbl.innerHTML = html;
}

/* ---------------- Precificação ---------------- */

function renderPrecificacao(el, data) {
  const canais = data.canais || [];
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
