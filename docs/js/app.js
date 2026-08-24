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
let precifProducao = null;       // tecido e costura por grupo de canal (_Precificacao_Producao)
let precifAviamentos = null;     // vivo/elástico por tamanho (_Precificacao_Aviamentos_Tamanho)
let precifAcabamentos = null;    // renda, guipir e vivo opcionais (_Precificacao_Acabamentos)
let precifModelos = null;        // modelo -> tipo de peca (_Precificacao_Modelos)
let precifFicha = null;          // aviamento/embalagem/mao de obra por peca (_Precificacao_Ficha)
/* Estado da Ficha de Preço. Fica fora da função pra sobreviver ao
   redesenho a cada tecla. */
/* `acabamentos` é um mapa nome -> metros dos que estão marcados. Ausente
   significa não marcado — por isso mapa e não lista de booleanos. */
const FICHA = { modelo: '', tamanho: '', tecido: '', acabamentos: {}, canal: '', preco: '' };
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
        const [dataProdutos, dataConfig, dataMateriais, dataRendimento, dataFuncionarios, dataMaoDeObraPecas, dataCorte, dataProducao, dataAviamentos, dataAcabamentos, dataModelos, dataFicha] = await Promise.all([
          apiFetch_('precificacao', idToken),
          apiFetch_('precificacaoConfig', idToken),
          apiFetch_('precificacaoMateriais', idToken),
          apiFetch_('precificacaoRendimento', idToken),
          apiFetch_('precificacaoFuncionarios', idToken),
          apiFetch_('precificacaoMaoDeObraPecas', idToken),
          apiFetch_('precificacaoCorte', idToken),
          apiFetch_('precificacaoProducao', idToken),
          apiFetch_('precificacaoAviamentos', idToken),
          apiFetch_('precificacaoAcabamentos', idToken),
          apiFetch_('precificacaoModelos', idToken),
          apiFetch_('precificacaoFicha', idToken)
        ]);
        precifProdutos = (dataProdutos && dataProdutos.produtos) || [];
        precifConfig = (dataConfig && dataConfig.config) || { despesasFixasPctPadrao: 0, canais: {} };
        precifMateriais = (dataMateriais && dataMateriais.materiais) || [];
        precifRendimento = (dataRendimento && dataRendimento.rendimento) || [];
        precifFuncionarios = (dataFuncionarios && dataFuncionarios.funcionarios) || [];
        precifMaoDeObraPecas = (dataMaoDeObraPecas && dataMaoDeObraPecas.maoDeObraPecas) || [];
        precifCorte = (dataCorte && dataCorte.corte) || [];
        precifProducao = (dataProducao && dataProducao.producao) || [];
        precifAviamentos = (dataAviamentos && dataAviamentos.aviamentos) || [];
        precifAcabamentos = (dataAcabamentos && dataAcabamentos.acabamentos) || [];
        precifModelos = (dataModelos && dataModelos.modelos) || [];
        precifFicha = (dataFicha && dataFicha.ficha) || [];
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
/* Filtro de entrada/saida da aba Hoje. Fica fora da funcao pra
   sobreviver ao redesenho quando a pessoa troca a opcao. */
const HOJE_F = { tipo: '' };

function renderHoje(el) {
  const p7 = projecaoCaixa_(7);
  const p15 = projecaoCaixa_(15);
  const p30 = projecaoCaixa_(30);
  const hoje = startOfDay_(new Date());

  // o filtro vale so pras tres listas; os KPIs de cima continuam
  // mostrando o quadro completo, senao "precisa nos 7 dias" mentiria
  const doTipo = (r) => !HOJE_F.tipo || r.tipo === HOJE_F.tipo;
  const vencemHoje = (FLUXO_ROWS || []).filter(r => r.aberta && startOfDay_(r.date).getTime() === hoje.getTime()).filter(doTipo);
  const atrasadas = (FLUXO_ROWS || []).filter(r => r.aberta && r.date < hoje).filter(doTipo).sort((a, b) => a.date - b.date);
  const proximas = (FLUXO_ROWS || []).filter(r => r.aberta && r.date >= hoje && r.date <= addDays_(hoje, 7)).filter(doTipo).sort((a, b) => a.date - b.date);

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

    <div class="tbl-filtros" style="margin-bottom:12px;">
      <select id="hjTipo">
        <option value="">Entradas e saídas</option>
        <option value="entrada" ${HOJE_F.tipo === 'entrada' ? 'selected' : ''}>Só o que entra</option>
        <option value="saida" ${HOJE_F.tipo === 'saida' ? 'selected' : ''}>Só o que sai</option>
      </select>
      ${HOJE_F.tipo ? '<button type="button" id="hjLimpar" class="link-btn">Limpar</button>' : ''}
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

  const selTipo = document.getElementById('hjTipo');
  if (selTipo) selTipo.addEventListener('change', (e) => { HOJE_F.tipo = e.target.value; renderHoje(el); });
  const btnLimpar = document.getElementById('hjLimpar');
  if (btnLimpar) btnLimpar.addEventListener('click', () => { HOJE_F.tipo = ''; renderHoje(el); });
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

/* ============================================================
   FICHA DE PREÇO

   Substitui o catálogo de produtos salvos. A pergunta que ela
   responde é "quanto custa fazer ESTA peça e o que sobra em cada
   canal", que é a decisão real — o catálogo respondia "quais
   produtos eu já cadastrei", que ninguém precisava.

   Tudo vem das abas da planilha, nada é fixo aqui:
     _Precificacao_Rendimento          metros por modelo+tamanho
     _Precificacao_Materiais           preço por metro
     _Precificacao_Producao            tecido e costura por canal
     _Precificacao_Aviamentos_Tamanho  vivo/elástico por tamanho
     _Precificacao_Corte               corte por tipo de peça
     _Precificacao_Config              taxas de cada canal
   ============================================================ */

const ORDEM_TAM = ['PP', 'P', 'M', 'G', 'GG', 'G1', 'G2', 'G3', '2', '4', '6', '8', '10', '12', '14', '-'];
const PADRAO_CANAL = 'padrão do canal';
const MARGEM_QUEIMA = 0.15;

/* Acabamentos são opcionais e COMBINÁVEIS — cada um marcado soma seu
   custo. A quantidade é por aplicação, não por material: a mesma guipir
   tem três linhas no catálogo porque o que muda é onde ela vai (manga e
   barra 5m, com revel 9m, larga 3m). Tratar "guipir" como uma quantidade
   só erraria o custo em qualquer um dos três casos.

   `substituiTecido` marca quem sai do tecido principal em vez de somar.
   Só o tule: a manga é de tule e não se corta manga de cetim. */

/* Aviamentos que toda peça leva, independente de tamanho. */
/* Antes daqui saia uma constante AVIAMENTOS_FIXOS e um tipoPecaDe_ que
   adivinhava o tipo pelo NOME do modelo, com "Robe" de padrao. Pantufa de
   Cetim e Moletom caiam em robe calados, e a lista de aviamentos vivia no
   codigo, fora do alcance da planilha. Agora as duas coisas vem de
   _Precificacao_Modelos e _Precificacao_Ficha. */

function tipoPecaDe_(modelo) {
  const reg = (precifModelos || []).find(m => m.modelo === modelo);
  if (!reg) return '';
  const t = String(reg.tipoPeca || '').trim();
  return (!t || t === '(confirmar)') ? '' : t;
}

/* Preco unitario de uma linha da ficha. `material` puxa do catalogo de
   tecidos e `maodeobra` da tabela das costureiras, entao renegociar preco
   com fornecedor ou costureira reflete em toda peca que usa aquele item,
   sem reeditar ficha nenhuma. */
function unitDaFicha_(linha, mats, avisos) {
  if (linha.fonte === 'material') {
    const m = mats[linha.refNome];
    if (!m) {
      avisos.push('"' + linha.item + '" usa o material "' + linha.refNome + '", que não está no catálogo.');
      return { unit: 0, nota: linha.refNome };
    }
    return { unit: m.valorPorMetro, nota: linha.refNome };
  }
  if (linha.fonte === 'maodeobra') {
    const cands = (precifMaoDeObraPecas || []).filter(x => x.tipoPeca === linha.refNome);
    if (!cands.length) {
      avisos.push('"' + linha.item + '" busca "' + linha.refNome + '" na tabela de mão de obra, que não tem essa linha.');
      return { unit: 0, nota: linha.refNome };
    }
    const menor = cands.reduce((a, b) => (b.valor < a.valor ? b : a));
    return { unit: menor.valor, nota: menor.funcionario };
  }
  return { unit: linha.valorUnit, nota: '' };
}

/* Resolve a heranca: o modelo comeca com a ficha do TIPO dele e as linhas
   com o nome do modelo substituem as de mesmo `item`. Quantidade 0 tira o
   item — e como voce diz "este modelo nao leva isso". */
function fichaDoModelo_(modelo, tipoPeca, mats, avisos) {
  const porItem = {};
  (precifFicha || []).forEach(l => { if (l.aplicaA === tipoPeca) porItem[l.item] = l; });
  (precifFicha || []).forEach(l => { if (l.aplicaA === modelo) porItem[l.item] = l; });

  return Object.keys(porItem).map(k => porItem[k])
    .filter(l => l.quantidade > 0)
    .map(l => {
      const u = unitDaFicha_(l, mats, avisos);
      return {
        grupo: l.grupo || 'Aviamento',
        item: l.item,
        qtd: l.quantidade,
        unit: u.unit,
        nota: u.nota,
        valor: l.quantidade * u.unit,
        doModelo: l.aplicaA === modelo
      };
    });
}

function grupoDoCanal_(canal) {
  return String(canal || '').indexOf('NuvemShop') === 0 ? 'Nuvemshop' : 'Marketplace';
}

function rendimentoMapa_() {
  const mapa = {};
  (precifRendimento || []).forEach(r => {
    if (!mapa[r.tipoProduto]) mapa[r.tipoProduto] = {};
    mapa[r.tipoProduto][r.tamanho] = r.metros;
  });
  return mapa;
}

/* O catalogo tem material repetido de fornecedor diferente: "Moletom 3
   cabos" e Copat R$ 49,90 E Metatex R$ 48,39; "Moletom 2 cabos" e Metatex
   R$ 48,39 E All Free R$ 35,00. Indexar so pelo nome fazia o ultimo
   sobrescrever o primeiro sem aviso - passou despercebido enquanto
   moletom nao era precificado. Agora o mapa guarda as duas chaves, "nome"
   e "Fornecedor · nome", e marca o nome cru como ambiguo pra ficha poder
   avisar em vez de escolher por voce. */
function materialPorNome_() {
  const m = {};
  const vistos = {};
  (precifMateriais || []).forEach(x => {
    const qualificado = x.fornecedor ? (x.fornecedor + ' · ' + x.material) : x.material;
    m[qualificado] = x;
    if (vistos[x.material]) {
      m[x.material] = Object.assign({}, m[x.material], { ambiguo: true });
    } else {
      m[x.material] = x;
      vistos[x.material] = true;
    }
  });
  return m;
}

/* Nomes pro seletor de tecido: qualifica com o fornecedor so quando o
   nome se repete, pra lista nao ficar poluida a toa. */
function nomesDeMaterial_() {
  const conta = {};
  (precifMateriais || []).forEach(x => { conta[x.material] = (conta[x.material] || 0) + 1; });
  return (precifMateriais || []).map(x =>
    (conta[x.material] > 1 && x.fornecedor) ? (x.fornecedor + ' · ' + x.material) : x.material);
}

function canaisDaConfig_() {
  const cfg = (precifConfig && precifConfig.canais) || {};
  return Object.keys(cfg).filter(k => k !== '_GLOBAL').map(k => {
    const c = cfg[k] || {};
    const extras = [];
    if (c.extra1Nome && c.extra1Pct) extras.push([c.extra1Nome, Number(c.extra1Pct) || 0]);
    if (c.extra2Nome && c.extra2Pct) extras.push([c.extra2Nome, Number(c.extra2Pct) || 0]);
    return {
      canal: k,
      grupo: grupoDoCanal_(k),
      imp: Number(c.impostosPct) || 0,
      com: Number(c.comissaoPct) || 0,
      ex: extras,
      fixa: Number(c.taxaFixaReais) || 0,
      ok: c.confirmado === true || String(c.confirmado).toUpperCase() === 'TRUE'
    };
  });
}

function calcularFicha_(modelo, tamanho, tecido, escolhidos, canalObj) {
  const rend = rendimentoMapa_();
  const mats = materialPorNome_();
  const avisos = [];
  const tipoPeca = tipoPecaDe_(modelo);
  if (!tipoPeca) {
    avisos.push('O modelo "' + modelo + '" ainda não tem tipo de peça definido na aba _Precificacao_Modelos. '
      + 'Sem isso não dá pra saber o corte, a costura nem os aviamentos dele.');
  }
  const prod = (precifProducao || []).find(x => x.canalGrupo === canalObj.grupo && x.tipoPeca === tipoPeca);

  const totalMetros = (rend[modelo] || {})[tamanho] || 0;
  if (!totalMetros) avisos.push('Não há rendimento cadastrado para ' + modelo + ' no tamanho ' + tamanho + '.');

  /* tecido vazio = "padrão do canal": marketplace e Nuvemshop não usam o
     mesmo tecido na mesma peça. Sem isso, trocar de canal mudava a costura
     mas mantinha o tecido, e a comparação entre canais saía errada. */
  const nomeTecido = tecido || (prod ? prod.material : '');
  const padraoDoCanal = !tecido;
  const mat = mats[nomeTecido];
  if (!nomeTecido) {
    avisos.push('Não há tecido padrão cadastrado para ' + (tipoPeca || 'esta peça') + ' em '
      + canalObj.grupo + '. Escolha o tecido no campo acima, ou defina o padrão na aba _Precificacao_Producao — '
      + 'sem isso o tecido entra como R$ 0,00.');
  } else if (!mat) {
    avisos.push('Tecido "' + nomeTecido + '" não está no catálogo de materiais.');
  } else if (mat.ambiguo) {
    avisos.push('Existe mais de um "' + nomeTecido + '" no catálogo, de fornecedores diferentes. '
      + 'Estou usando R$ ' + fmtNum_(mat.valorPorMetro) + '/m. Escolha pelo nome com fornecedor para não ficar no acaso.');
  }

  const detAcab = [];
  let custoAcab = 0, metrosSubstituidos = 0;
  (precifAcabamentos || []).forEach(a => {
    const metros = escolhidos[a.acabamento];
    if (metros === undefined) return;
    const m = mats[a.material];
    if (!m) {
      avisos.push('Acabamento "' + a.acabamento + '" usa "' + a.material + '", que não está no catálogo.');
      return;
    }
    const q = Math.max(0, Number(metros) || 0);
    const valor = q * m.valorPorMetro;
    custoAcab += valor;
    if (a.substituiTecido) metrosSubstituidos += q;
    detAcab.push({ nome: a.acabamento, metros: q, unit: m.valorPorMetro, valor, substitui: a.substituiTecido });
  });
  if (metrosSubstituidos > totalMetros) {
    avisos.push('Os acabamentos que substituem tecido (' + fmtNum_(metrosSubstituidos)
      + ' m) não cabem no total do modelo (' + fmtNum_(totalMetros) + ' m).');
  }
  const metrosPrinc = Math.max(0, Math.round((totalMetros - metrosSubstituidos) * 100) / 100);

  const custoTecido = metrosPrinc * (mat ? mat.valorPorMetro : 0);

  const corteReg = (precifCorte || []).find(x => x.tipoPeca === tipoPeca);
  const custoCorte = corteReg ? corteReg.valor : 0;
  const custoCostura = prod ? prod.costuraValor : 0;
  if (!prod) avisos.push('Não há produção cadastrada para ' + tipoPeca + ' em ' + canalObj.grupo + '.');

  const itensFicha = tipoPeca ? fichaDoModelo_(modelo, tipoPeca, mats, avisos) : [];
  const somaGrupo = (g) => itensFicha.filter(x => x.grupo === g).reduce((s, x) => s + x.valor, 0);
  const custoAviamento = somaGrupo('Aviamento');
  const custoMaoObraExtra = somaGrupo('Mão de obra');
  const custoEmbalagem = somaGrupo('Embalagem');

  const porTam = (precifAviamentos || []).filter(a => a.tipoProduto === modelo && a.tamanho === tamanho);
  const detTam = porTam.map(a => {
    const m = mats[a.aviamento];
    const unit = m ? m.valorPorMetro : 0;
    return { nome: a.aviamento, qtd: a.quantidade, unit: unit, valor: a.quantidade * unit };
  });
  const custoTam = detTam.reduce((s, a) => s + a.valor, 0);

  /* Fabricacao e o que sai da sua costura: tecido, aviamento, corte,
     costura. Embalagem entra depois - nao e custo de fabricar, mas tem
     que estar no preco. Separar os dois deixa ver o custo real da peca
     sem o frete de correio embutido. */
  const custoFabricacao = custoTecido + custoAcab + custoCorte + custoCostura
    + custoAviamento + custoMaoObraExtra + custoTam;
  const custo = custoFabricacao + custoEmbalagem;
  const taxaPct = canalObj.imp + canalObj.com + canalObj.ex.reduce((s, e) => s + e[1], 0);

  return {
    canal: canalObj, tipoPeca, totalMetros, metrosPrinc, metrosSubstituidos, detAcab, custoAcab,
    mat, nomeTecido, padraoDoCanal, custoTecido, custoCorte, custoCostura,
    itensFicha, custoAviamento, custoMaoObraExtra, custoEmbalagem,
    detTam, custoTam, custoFabricacao, custo, taxaPct, avisos
  };
}

function pisoQueima_(custo, taxaPct, taxaFixa) {
  const den = 1 - taxaPct - MARGEM_QUEIMA;
  return den > 0 ? (custo + taxaFixa) / den : null;
}

function fmtNum_(v) {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* O fmtPct global poe "+" em valor positivo, porque foi feito pra
   variacao ("+12,3% vs mes anterior"). Taxa e margem nao levam sinal:
   "imposto +7,4%" nao faz sentido. Este aqui e o plano. */
function fmtPctPlano_(v, dec) {
  const d = dec === undefined ? 2 : dec;
  return (Number(v || 0) * 100).toLocaleString('pt-BR',
    { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
}

function renderPrecificacao(el) {
  const rend = rendimentoMapa_();
  const modelos = Object.keys(rend).sort();
  const canais = canaisDaConfig_();
  const mats = nomesDeMaterial_()
    .filter(n => ['Vivo', 'Elástico', 'Botão'].indexOf(n) < 0);

  if (!modelos.length || !canais.length) {
    el.innerHTML = '<div class="section-head"><h2 class="section-title">Ficha de Preço</h2></div>'
      + '<div class="state-msg">Faltam dados nas abas de precificação da planilha '
      + '(rendimento por tamanho e taxas por canal). Rode <code>setupWorkbook</code> no Apps Script.</div>';
    return;
  }

  if (!FICHA.modelo || modelos.indexOf(FICHA.modelo) < 0) FICHA.modelo = modelos[0];
  const tamanhos = Object.keys(rend[FICHA.modelo] || {}).sort((a, b) => ORDEM_TAM.indexOf(a) - ORDEM_TAM.indexOf(b));
  if (!FICHA.tamanho || tamanhos.indexOf(FICHA.tamanho) < 0) FICHA.tamanho = tamanhos.indexOf('M') > -1 ? 'M' : (tamanhos[0] || '');
  if (!FICHA.canal || !canais.find(c => c.canal === FICHA.canal)) FICHA.canal = canais[0].canal;

  const canalObj = canais.find(c => c.canal === FICHA.canal);
  const r = calcularFicha_(FICHA.modelo, FICHA.tamanho, FICHA.tecido, FICHA.acabamentos, canalObj);
  const preco = Number(FICHA.preco) || 0;

  const taxaRs = preco * r.taxaPct;
  const sobra = preco - taxaRs - canalObj.fixa - r.custo;
  const mcPct = preco ? sobra / preco : 0;
  const p15 = pisoQueima_(r.custo, r.taxaPct, canalObj.fixa);
  const dfx = (precifConfig && precifConfig.despesasFixasPctPadrao) || 0;
  const fixasRs = preco * dfx;
  const lucro = sobra - fixasRs;

  const opt = (lista, sel) => lista.map((v, i) =>
    '<option value="' + i + '"' + (v === sel ? ' selected' : '') + '>' + escapeHtml_(v) + '</option>').join('');

  const heroCls = !preco ? '' : mcPct >= 0.30 ? 'ok' : mcPct >= MARGEM_QUEIMA ? 'warn' : 'crit';

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Ficha de Preço</h2>
      <div class="section-desc">Escolha o modelo, o tamanho e o tecido, e veja o custo real de produzir — e quanto sobra depois que cada canal cobra a parte dele.</div>
    </div>

    <div class="fp-controles">
      <div class="fp-campo"><label for="fpModelo">Modelo</label><select id="fpModelo">${opt(modelos, FICHA.modelo)}</select></div>
      <div class="fp-campo"><label for="fpTamanho">Tamanho</label><select id="fpTamanho">${opt(tamanhos, FICHA.tamanho)}</select></div>
      <div class="fp-campo"><label for="fpTecido">Tecido principal</label><select id="fpTecido">${opt([PADRAO_CANAL].concat(mats), FICHA.tecido || PADRAO_CANAL)}</select></div>
      <div class="fp-campo"><label for="fpCanal">Canal</label><select id="fpCanal">${opt(canais.map(c => c.canal), FICHA.canal)}</select></div>
      <div class="fp-campo"><label for="fpPreco">Preço de venda</label><input type="number" id="fpPreco" step="0.10" min="0" value="${FICHA.preco}"></div>
    </div>

    <div class="fp-card fp-acabamentos">
      <h3>Acabamentos — marque os que a peça leva</h3>
      <div class="fp-acab-lista">${listaAcabamentos_()}</div>
    </div>

    <div class="fp-painel">
      <div class="fp-card">
        <h3>Custo da peça</h3>
        <div class="fp-linhas">${linhasCusto_(r)}</div>
      </div>
      <div class="fp-card">
        <h3>O que sobra nesse canal</h3>
        <div class="fp-hero ${heroCls}">
          <span class="k">Margem de contribuição</span>
          <span class="v">${preco ? fmtPctPlano_(mcPct) : '—'}</span>
          <span class="n">${preco ? 'R$ ' + fmtNum_(sobra) + ' por peça vendida a R$ ' + fmtNum_(preco) : 'Informe um preço de venda para ver.'}</span>
        </div>
        <div class="fp-linhas">${linhasVenda_(r, preco, taxaRs, sobra, p15, dfx, fixasRs, lucro)}</div>
        ${avisosFicha_(r, preco, p15)}
      </div>
    </div>

    <div class="panel">
      <h3>O mesmo produto em cada canal</h3>
      <div class="sub">Mesmo preço de venda, taxas diferentes — e o custo também muda, porque marketplace e Nuvemshop não usam o mesmo tecido nem a mesma costureira. <b>Piso</b> é o menor preço que ainda deixa 15% de margem de contribuição.</div>
      <div style="overflow-x:auto;"><table class="simple fp-tabela">
        <thead><tr>
          <th>Canal</th><th class="num">Custo</th><th class="num">Taxa %</th><th class="num">Taxa R$</th>
          <th class="num">Fixa</th><th class="num">Sobra</th><th class="num">MC</th><th class="num">Piso 15%</th><th>Situação</th>
        </tr></thead>
        <tbody>${linhasCanais_(canais, preco)}</tbody>
      </table></div>
    </div>

    <div class="alerta info">
      <b>Margem de contribuição</b> é o que sobra depois do custo de produzir e das taxas do canal — antes das despesas fixas da empresa (hoje ${fmtPctPlano_(dfx)} do faturamento). É a régua certa para decidir preço e promoção, porque o custo fixo já está pago de qualquer jeito.
      O <b>piso de 15%</b> é a margem mínima para queima de estoque.
      <b>Acabamentos</b> podem ser combinados — cada um marcado soma seu custo, e a quantidade vem preenchida com o padrão da peça. Só o <b>tule</b> desconta metros do tecido principal, porque a manga é de tule e não se corta manga de cetim; guipir, chantily e vivo são aplicados por cima e só somam.
      A <b>taxa fixa</b> da Shopee entra como taxa de canal, não como custo da peça — nas fichas antigas ela estava somada ao custo, o que fazia a peça parecer cara também na Nuvemshop, onde essa cobrança não existe.
    </div>
  `;

  const liga = (id, campo) => {
    const e = document.getElementById(id);
    if (!e) return;
    const ev = e.tagName === 'SELECT' ? 'change' : 'input';
    e.addEventListener(ev, (evt) => {
      if (e.tagName === 'SELECT') {
        const lista = id === 'fpModelo' ? modelos
          : id === 'fpTamanho' ? tamanhos
            : id === 'fpTecido' ? [PADRAO_CANAL].concat(mats)
              : canais.map(c => c.canal);
        let v = lista[Number(evt.target.value)] || lista[0];
        if (v === PADRAO_CANAL) v = '';
        FICHA[campo] = v;
        if (id === 'fpModelo') FICHA.tamanho = '';
      } else {
        FICHA[campo] = evt.target.value;
      }
      renderPrecificacao(el);
    });
  };
  liga('fpModelo', 'modelo'); liga('fpTamanho', 'tamanho'); liga('fpTecido', 'tecido');
  liga('fpCanal', 'canal'); liga('fpPreco', 'preco');

  (precifAcabamentos || []).forEach((a, i) => {
    const cb = document.getElementById('fpAc' + i);
    const qt = document.getElementById('fpAcM' + i);
    if (!cb || !qt) return;
    cb.addEventListener('change', () => {
      if (cb.checked) FICHA.acabamentos[a.acabamento] = Number(qt.value) || a.metros;
      else delete FICHA.acabamentos[a.acabamento];
      renderPrecificacao(el);
    });
    qt.addEventListener('input', () => {
      if (!cb.checked) return;
      FICHA.acabamentos[a.acabamento] = Number(qt.value) || 0;
      renderPrecificacao(el);
    });
  });
}

/* Lista de acabamentos com checkbox e quantidade editável. A quantidade
   nasce com o padrão do catálogo e só fica ativa quando marcado. */
function listaAcabamentos_() {
  const acabs = precifAcabamentos || [];
  if (!acabs.length) return '<div class="state-msg">Nenhum acabamento cadastrado em _Precificacao_Acabamentos.</div>';
  const mats = materialPorNome_();
  return acabs.map((a, i) => {
    const marcado = FICHA.acabamentos[a.acabamento] !== undefined;
    const metros = marcado ? FICHA.acabamentos[a.acabamento] : a.metros;
    const m = mats[a.material];
    return '<div class="fp-acab' + (marcado ? '' : ' off') + '">'
      + '<input type="checkbox" id="fpAc' + i + '"' + (marcado ? ' checked' : '') + '>'
      + '<label for="fpAc' + i + '">' + escapeHtml_(a.acabamento)
      + (a.substituiTecido ? ' <span class="pill md">substitui tecido</span>' : '')
      + '<small>' + escapeHtml_(a.material) + ' · R$ ' + fmtNum_(m ? m.valorPorMetro : 0) + '/m</small></label>'
      + '<input type="number" id="fpAcM' + i + '" step="0.05" min="0" value="' + metros + '"'
      + (marcado ? '' : ' disabled') + '>'
      + '<span class="un">m</span></div>';
  }).join('');
}

function linhasCusto_(r) {
  const L = [];
  const li = (rot, sub, val, cls) =>
    L.push('<div class="fp-l ' + (cls || '') + '"><span class="rot">' + rot
      + (sub ? '<small>' + escapeHtml_(sub) + '</small>' : '')
      + '</span><span class="val">R$ ' + fmtNum_(val) + '</span></div>');

  li(escapeHtml_(r.nomeTecido || 'Tecido') + (r.padraoDoCanal ? ' <span class="pill md">padrão ' + escapeHtml_(r.canal.grupo) + '</span>' : ''),
    fmtNum_(r.metrosPrinc) + ' m × R$ ' + fmtNum_(r.mat ? r.mat.valorPorMetro : 0) + '/m', r.custoTecido);
  r.detAcab.forEach(a => {
    li(escapeHtml_(a.nome) + (a.substitui ? ' <span class="pill md">no lugar do tecido</span>' : ''),
      fmtNum_(a.metros) + ' m × R$ ' + fmtNum_(a.unit) + '/m', a.valor);
  });
  r.detTam.forEach(a => li(escapeHtml_(a.nome), fmtNum_(a.qtd) + ' m × R$ ' + fmtNum_(a.unit) + '/m', a.valor, 'sub'));

  /* Cada item da ficha aparece com a conta na frente. Item que veio de
     excecao do modelo ganha selo, pra voce enxergar de relance o que
     aquele modelo tem de diferente do tipo dele. */
  const doGrupo = (g) => r.itensFicha.filter(x => x.grupo === g);
  const linhaItem = (a) => li(
    escapeHtml_(a.item) + (a.doModelo ? ' <span class="pill md">só neste modelo</span>' : ''),
    fmtNum_(a.qtd) + ' × R$ ' + fmtNum_(a.unit) + (a.nota ? ' · ' + escapeHtml_(a.nota) : ''),
    a.valor, 'sub');

  doGrupo('Aviamento').forEach(linhaItem);
  li('Corte', escapeHtml_(r.tipoPeca || '—') + ' · por peça', r.custoCorte);
  li('Costura', escapeHtml_(r.tipoPeca || '—') + ' em ' + escapeHtml_(r.canal.grupo), r.custoCostura);
  doGrupo('Mão de obra').forEach(linhaItem);
  li('Custo de fabricação', 'tecido, aviamento, corte e costura', r.custoFabricacao, 'tot');

  const emb = doGrupo('Embalagem');
  if (emb.length) {
    emb.forEach(linhaItem);
    li('Custo até a porta', 'com embalagem e envio', r.custo, 'tot destaque');
  } else {
    li('Custo até a porta', '', r.custo, 'tot destaque');
  }
  return L.join('');
}

/* Imposto, comissao e cada extra saem em linha propria. Antes vinham
   somados num "Taxas do canal (28,62%)" com o detalhe em letra miuda, e a
   pergunta "onde esta o imposto?" e a prova de que nao dava pra achar. */
function linhasVenda_(r, preco, taxaRs, sobra, p15, dfx, fixasRs, lucro) {
  const V = [];
  const vi = (rot, sub, val, cls) =>
    V.push('<div class="fp-l ' + (cls || '') + '"><span class="rot">' + rot
      + (sub ? '<small>' + escapeHtml_(sub) + '</small>' : '')
      + '</span><span class="val">' + val + '</span></div>');

  vi('Preço de venda', '', 'R$ ' + fmtNum_(preco));
  vi('Custo até a porta', 'fabricação + embalagem', '− R$ ' + fmtNum_(r.custo));

  vi('Imposto (' + fmtPctPlano_(r.canal.imp) + ')', '', '− R$ ' + fmtNum_(preco * r.canal.imp), 'sub');
  vi('Comissão (' + fmtPctPlano_(r.canal.com) + ')', escapeHtml_(r.canal.canal),
    '− R$ ' + fmtNum_(preco * r.canal.com), 'sub');
  r.canal.ex.forEach(e => vi(escapeHtml_(e[0]) + ' (' + fmtPctPlano_(e[1]) + ')', '',
    '− R$ ' + fmtNum_(preco * e[1]), 'sub'));
  if (r.canal.fixa) vi('Taxa fixa por venda', escapeHtml_(r.canal.canal) + ' cobra por item vendido',
    '− R$ ' + fmtNum_(r.canal.fixa), 'sub');

  vi('Margem de contribuição', 'antes das despesas fixas', 'R$ ' + fmtNum_(sobra),
    'tot' + (sobra < 0 ? ' neg' : ''));

  /* Rateio das despesas fixas: aluguel, salarios, energia. Vem da aba
     _Despesas_Fixas dividida pela receita media dos ultimos meses da DRE,
     entao acompanha o faturamento sozinho. Sem ele a ficha parava na
     margem de contribuicao e nao dava pra saber se a peca da lucro. */
  vi('Despesas fixas (' + fmtPctPlano_(dfx) + ')', 'rateio sobre o faturamento',
    '− R$ ' + fmtNum_(fixasRs), 'sub');
  vi('Lucro', preco ? fmtPctPlano_(lucro / preco) + ' do preço' : '',
    'R$ ' + fmtNum_(lucro), 'tot destaque' + (lucro < 0 ? ' neg' : ''));

  vi('Piso para 15% de margem', 'só para queima — ignora as despesas fixas de propósito',
    p15 ? 'R$ ' + fmtNum_(p15) : '—');
  return V.join('');
}

function avisosFicha_(r, preco, p15) {
  const a = r.avisos.slice();
  if (preco && p15 && preco < p15) a.push('A R$ ' + fmtNum_(preco) + ' este produto está abaixo do piso de queima (R$ ' + fmtNum_(p15) + ').');
  return a.length ? '<div class="fp-aviso">' + a.map(escapeHtml_).join(' ') + '</div>' : '';
}

function linhasCanais_(canais, preco) {
  return canais.map(c => {
    const rc = calcularFicha_(FICHA.modelo, FICHA.tamanho, FICHA.tecido, FICHA.acabamentos, c);
    const t = preco * rc.taxaPct;
    const s = preco - t - c.fixa - rc.custo;
    const mp = preco ? s / preco : 0;
    const pc = pisoQueima_(rc.custo, rc.taxaPct, c.fixa);
    /* Quatro faixas, não três: margem positiva mas abaixo do piso não é
       prejuízo — é venda que não paga a parte dela do custo fixo. */
    const sit = !preco ? '<span class="pill md">sem preço</span>'
      : mp >= 0.30 ? '<span class="pill ok">saudável</span>'
        : mp >= MARGEM_QUEIMA ? '<span class="pill md">só para queima</span>'
          : mp > 0 ? '<span class="pill no">abaixo do piso</span>'
            : '<span class="pill no">no prejuízo</span>';
    return '<tr class="' + (c.canal === FICHA.canal ? 'fp-atual' : '') + '">'
      + '<td>' + escapeHtml_(c.canal) + (c.ok ? '' : ' <span class="pill md">a confirmar</span>') + '</td>'
      + '<td class="num">R$ ' + fmtNum_(rc.custo) + '</td>'
      + '<td class="num">' + fmtPctPlano_(rc.taxaPct) + '</td>'
      + '<td class="num">R$ ' + fmtNum_(t) + '</td>'
      + '<td class="num">' + (c.fixa ? 'R$ ' + fmtNum_(c.fixa) : '—') + '</td>'
      + '<td class="num">R$ ' + fmtNum_(s) + '</td>'
      + '<td class="num">' + (preco ? fmtPctPlano_(mp) : '—') + '</td>'
      + '<td class="num fp-piso">' + (pc ? 'R$ ' + fmtNum_(pc) : '—') + '</td>'
      + '<td>' + sit + '</td></tr>';
  }).join('');
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
