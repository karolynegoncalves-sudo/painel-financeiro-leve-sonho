const CFG = window.PAINEL_CONFIG;

const fmtBRL = (v, dec = 0) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (v, dec = 1) => (v >= 0 ? '+' : '') + (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const fmtPctSimples_ = (v, dec = 1) => (Number(v || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }) + '%';
const fmtDataBR = (d) => d.toLocaleDateString('pt-BR');
/* VERSAO DESTE ARQUIVO, mostrada na DRE ao lado do carimbo do backend.
 *
 * POR QUE: o `?v=` no index.html protege o js e o css do cache, mas NAO protege
 * o proprio index.html - se ele vier do cache do navegador ou da CDN do GitHub
 * Pages, ele aponta para a versao ANTIGA do js e a correcao nova nao chega. Em
 * 14/09/2026 a Karolyne disse "nao esta clicavel" sobre a gaveta que eu acabara
 * de publicar, e eu nao tinha como saber se era bug ou cache.
 *
 * Com o numero na tela a pergunta morre: se o que ela ve e menor que o que eu
 * acabei de subir, e cache, e o conserto e recarregar - nao e codigo.
 *
 * TROCAR JUNTO com o ?v= do index.html. Sao os dois lados da mesma versao.
 */
const PAINEL_VERSAO = '20260914t';

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
/* Receita pela data do pedido e CMV por consumo, mensais, vindos das abas
   _Receita_Pedidos e _CMV_Consumo. Ficam FORA de FLUXO_ROWS de propósito: a
   aba Fluxo de Caixa é espelho do razão do Bling, e a DFC lê a mesma aba —
   injetar receita reconstruída ali faria a DFC contar a venda duas vezes,
   uma no recebimento real e outra na linha sintética. */
let DRE_FONTES = { receita: [], cmv: [] };
/* Carimbo da versao implantada do Apps Script, mostrado na DRE. Ver
   BACKEND_VERSAO_ no Code.gs para o motivo. */
let BACKEND_VERSAO = '(nao informado)';
let VENDAS_ROWS = null; // [{date, canal, cliente, numero, situacao, contaReceita, total}]
/* A DRE e SEMPRE por competencia desde 09/09/2026. Receita e CMV passaram a
   vir de fontes mensais por data do pedido (_Receita_Pedidos e _CMV_Consumo),
   entao um "modo caixa" misturaria receita pelo fato gerador com despesa pela
   data de pagamento - duas reguas na mesma tabela. Quem responde caixa e a
   DFC, logo abaixo na mesma tela, que le o dinheiro que de fato mexeu. */
let DRE_REGIME = 'competencia';

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

function decodeJwt_(token) {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  } catch (e) { return null; }
}

function decodeJwtEmail(token) {
  const p = decodeJwt_(token);
  return (p && p.email) || '';
}

/* O token do Google vale 1 hora. Passado esse tempo o servidor recusa, e
   ate aqui o painel mostrava a MESMA tela de "acesso negado" que aparece
   quando o e-mail nao tem permissao - dava a entender que a pessoa tinha
   perdido o acesso, quando so precisava entrar de novo. */
function tokenExpirado_(token) {
  const p = decodeJwt_(token);
  if (!p || !p.exp) return false;
  return (p.exp * 1000) < Date.now();
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
  if (tokenExpirado_(token)) {
    sessionStorage.removeItem('id_token');
    idToken = null;
    document.getElementById('loginGate').style.display = 'block';
    const g = document.getElementById('loginGate');
    if (g && !document.getElementById('avisoExpirou')) {
      const p = document.createElement('p');
      p.id = 'avisoExpirou';
      p.textContent = 'Sua sessão expirou. Entre de novo com o Google.';
      g.insertBefore(p, g.firstChild);
    }
    return;
  }

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
  if (data && data.janelaDesde) JANELA_DESDE = data.janelaDesde;
  LINHAS_NA_ABA = (data && data.linhasNaAba) || 0;
  FLUXO_ROWS = parseFluxoRows_(data);
  /* Vendas NAO entra no login. Sao 8.824 pedidos e 7,6 segundos - o
     login inteiro esperava por eles mesmo quando a pessoa ia direto pra
     precificacao, que nem usa vendas. Quem precisa e a aba KPIs, e ela
     carrega sozinha quando for aberta (ver garantirVendas_).

     As despesas fixas vem DENTRO desta mesma resposta. Medido em
     24/08/2026: buscar as 24 linhas delas numa chamada separada custava
     2,26s - quase tudo pedagio do Web App, nao leitura. */
  precifDespesasFixas = data.despesas || [];
  DRE_FONTES = (data.dreFontes && data.dreFontes.receita)
    ? data.dreFontes : { receita: [], cmv: [] };
  /* Que versao do Apps Script respondeu. Salvar o codigo nao publica: o Web App
     serve a versao IMPLANTADA. Sem este carimbo, "nao atualizou" e uma pergunta
     sem resposta - pode ser codigo, dado ou implantacao. */
  BACKEND_VERSAO = data.backend || '(sem carimbo)';
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

/* O Apps Script devolve uma pagina HTML de erro quando passa do limite de
   execucoes concorrentes - e nao um JSON com erro. Sem tratar, o
   resp.json() estoura com "Unexpected token '<'" e a aba inteira morre por
   causa de um soluco. Aqui a resposta e lida como texto primeiro: se nao
   for JSON, tenta de novo com espera crescente. `_falhou` marca a
   diferenca entre "nao consegui falar com a planilha" e "a planilha
   respondeu e esta vazia", que sao problemas distintos. */
async function apiFetch_(view, token, tentativas) {
  const max = tentativas === undefined ? 3 : tentativas;
  let ultimoErro = '';
  for (let t = 1; t <= max; t++) {
    try {
      /* `_` quebra cache. O /exec do Apps Script redireciona para
         googleusercontent.com, e essa resposta pode ser servida do cache do
         navegador - o painel mostraria dado de antes da republicacao mesmo
         depois de recarregar. Dashboard nunca deve ler dado de cache. */
      const resp = await fetch(CFG.APPS_SCRIPT_URL + '?view=' + view
        + '&token=' + encodeURIComponent(token) + '&_=' + Date.now(),
        { cache: 'no-store' });
      const txt = await resp.text();
      try {
        return JSON.parse(txt);
      } catch (e) {
        ultimoErro = 'resposta nao e JSON (HTTP ' + resp.status + ')';
      }
    } catch (e) {
      ultimoErro = String(e);
    }
    /* ESPERA LONGA de proposito. O erro que cai aqui e quase sempre "limite de
       execucoes simultaneas" do Google, e nao um soluco de rede: alguma outra
       rota ainda esta rodando e ocupando o slot. Repetir em 700ms empilha mais
       uma chamada no mesmo limite e garante o fracasso das tres tentativas -
       foi assim que a aba Precificacao passou o dia dizendo "nao consegui falar
       com a planilha". 3s, 6s, 9s da tempo de o slot liberar. */
    if (t < max) await new Promise(r => setTimeout(r, 3000 * t));
  }
  return { error: ultimoErro, _falhou: true, _view: view };
}

/* Carrega em lotes em vez de tudo de uma vez. A aba de precificacao pedia
   12 rotas simultaneas, o que sozinho ja estourava o limite de execucoes
   concorrentes do Apps Script. */
async function carregarEmLotes_(views, token, porLote) {
  const n = porLote || 4;
  const out = [];
  for (let i = 0; i < views.length; i += n) {
    const lote = views.slice(i, i + n);
    const r = await Promise.all(lote.map(v => apiFetch_(v, token)));
    r.forEach(x => out.push(x));
  }
  return out;
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
    iBanco = idx('contaBancariaNome'), iValor = idx('valor'),
    iComp = idx('competencia'), iDesc = idx('descricao');
  return rows.map(r => {
    const date = new Date(String(r[iData]).slice(0, 10) + 'T00:00:00');
    // COMPETENCIA: quando o fato aconteceu, que nem sempre e quando o dinheiro
    // mexeu. Na Shopee a venda so e liberada dias depois, entao a mesma linha
    // alimenta as duas visoes. Conta sem competencia cai na data do caixa - e o
    // melhor palpite, e some do radar em vez de sumir da tela.
    const bruto = iComp >= 0 ? String(r[iComp] || '').slice(0, 10) : '';
    let dateComp = bruto ? new Date(bruto + 'T00:00:00') : null;
    if (!dateComp || isNaN(dateComp.getTime())) dateComp = date;
    // Situacoes do Bling: 1 em aberto, 2 baixada, 3 parcial, 5 cancelada.
    // Desconhecida entra como paga, pra nao sumir lancamento sem aviso.
    const sit = String(iSit >= 0 ? r[iSit] : '2').trim();
    return {
      date,
      dateComp,
      temComp: !!bruto,
      tipo: r[iTipo],
      situacao: sit,
      cancelada: sit === '5',
      aberta: sit === '1',
      paga: sit !== '1' && sit !== '5',
      grupoDRE: r[iGrupo] || '(sem mapear)',
      categoria: r[iCategoria] || '(sem categoria)',
      contato: r[iContato] || '',
      banco: r[iBanco] || '',
      // o texto que explica o lancamento. Vinha vazio ate 10/09/2026, quando o
      // sync passou a gravar d.historico no lugar de d.numeroDocumento.
      descricao: (iDesc >= 0 ? r[iDesc] : '') || '',
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

/*
 * CORRIDA DE RENDERIZACAO (09/09/2026).
 *
 * safeRenderTab e async: entre o `await` que busca as vendas e o desenho da
 * tela cabe um clique no filtro. Quando isso acontece, `aplicarFiltro_` troca
 * o FILTER e dispara uma renderizacao nova - mas a ANTIGA continua de onde
 * parou e desenha na mesma tela, com as linhas do periodo velho e os rotulos
 * lidos do FILTER novo.
 *
 * Foi o que produziu a coluna impossivel "07/09-31/08" na DFC: linhas de
 * setembro (periodo antigo, "Este mes") rotuladas com o fim de agosto
 * (periodo novo, "Mes passado"). A DFC mostrava setembro com titulo de agosto,
 * e nada na tela dizia isso.
 *
 * Cada chamada agora pega um numero. Depois de cada await, quem nao e a
 * renderizacao mais recente para em silencio - a nova ja esta desenhando.
 */
/* Ate onde o painel baixou lancamento, vindo do Apps Script
   (JANELA_PAINEL_MESES). Serve para AVISAR quando o filtro pede periodo mais
   antigo do que o que foi carregado: sem o aviso a tela mostraria zero, e zero
   parece numero, nao parece falta. */
let JANELA_DESDE = null;
let LINHAS_NA_ABA = 0;

let RENDER_GEN = 0;
function renderObsoleta_(gen) { return gen !== RENDER_GEN; }

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

/**
 * Aviso de periodo fora da janela baixada.
 *
 * O painel le apenas os ultimos JANELA_PAINEL_MESES meses de lancamento (ver
 * getFluxoCaixaRows_ no Code.gs). Escolher um periodo anterior a isso mostraria
 * R$ 0,00 em tudo - e zero parece resposta, nao parece ausencia. Este aviso e a
 * unica coisa que separa "nao teve movimento" de "nao foi carregado".
 */
function avisoJanela_() {
  if (!JANELA_DESDE || !FILTER.start) return '';
  const ini = ymdLocal_(FILTER.start);
  if (ini >= JANELA_DESDE) return '';
  const [y, m, d] = JANELA_DESDE.split('-');
  return '<p class="dre-nota" style="color:var(--brick);"><b>Período fora do que foi '
    + 'carregado.</b> O painel lê lançamento a partir de <b>' + d + '/' + m + '/' + y
    + '</b> para carregar rápido. O período escolhido começa antes disso, então o que '
    + 'aparece abaixo está <b>incompleto — não é zero, é dado que não foi baixado</b>. '
    + 'Para ver mais atrás, aumente <code>JANELA_PAINEL_MESES</code> no Apps Script.</p>';
}

/** Data em 'yyyy-MM-dd' no fuso local, para comparar com JANELA_DESDE. */
function ymdLocal_(dt) {
  const p = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate());
}

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

/* Carrega a aba Vendas na primeira vez que alguem abre KPIs. Sao 8.824
   pedidos, entao segurar isso ate ser necessario tira 7,6s do login. */
async function garantirVendas_(el) {
  if (VENDAS_ROWS !== null) return;
  if (el) el.innerHTML = '<div class="state-msg">Carregando vendas...</div>';
  const dv = await apiFetch_('vendas', idToken);
  VENDAS_ROWS = (dv && !dv.error) ? parseVendasRows_(dv) : [];
}

/*
 * A taxa por canal mora na aba Precificação_Config, e ate 03/09/2026 a aba
 * KPIs nunca a carregava - garantia so as vendas. Com precifConfig nulo, o
 * margemPorCanal_ nao achava chave nenhuma e TODO canal aparecia como "sem
 * taxa cadastrada", taxa R$ 0,00 e margem 100%. As taxas estavam cadastradas
 * o tempo todo (Shopee 50,78%, Mercado Livre 36,92%, SHEIN 23%, TikTok
 * 32,73%, Nuvemshop 20,74% + R$ 0,50).
 *
 * O sintoma denunciava a causa: abrir a aba Precificacao antes e voltar pra
 * KPIs fazia as taxas aparecerem, porque ai o config ja estava em memoria.
 */
async function garantirConfigCanais_(el) {
  if (precifConfig !== null) return;
  if (el) el.innerHTML = '<div class="state-msg">Carregando taxas por canal...</div>';
  const dc = await apiFetch_('precificacaoConfig', idToken);
  precifConfig = (dc && dc.config) || { despesasFixasPctPadrao: 0, canais: {} };
}

async function safeRenderTab(view) {
  const el = document.getElementById('tab-' + view);
  const gen = ++RENDER_GEN;   // ver RENDER_GEN
  try {
    if (view === 'precificacao') {
      if (precifProdutos === null || precifConfig === null) {
        el.innerHTML = '<div class="state-msg">Carregando...</div>';
        /* Uma chamada em vez de doze. Enquanto a versao implantada do
           Apps Script nao tiver a rota nova, cai no jeito antigo - assim
           o painel funciona antes e depois de republicar. */
        let d = await apiFetch_('precificacaoTudo', idToken);
        if (!d || d.error) {
          const partes = await Promise.all([
            'precificacaoConfig', 'precificacaoMateriais', 'precificacaoRendimento',
            'precificacaoMaoDeObraPecas', 'precificacaoCorte', 'precificacaoProducao',
            'precificacaoAviamentos', 'precificacaoAcabamentos', 'precificacaoModelos',
            'precificacaoFicha'
          ].map(v => apiFetch_(v, idToken)));
          if (partes.some(x => x && x._falhou)) {
            el.innerHTML = '<div class="state-msg">Não consegui falar com a planilha agora. '
              + 'Costuma ser limite temporário do Google, não erro de configuração. '
              + 'Espere um minuto e recarregue.</div>';
            return;
          }
          d = {
            config: partes[0].config, materiais: partes[1].materiais,
            rendimento: partes[2].rendimento, maoDeObraPecas: partes[3].maoDeObraPecas,
            corte: partes[4].corte, producao: partes[5].producao,
            aviamentos: partes[6].aviamentos, acabamentos: partes[7].acabamentos,
            modelos: partes[8].modelos, ficha: partes[9].ficha
          };
        }

        /* produtos e funcionarios alimentavam o editor antigo, que saiu do
           ar quando a Ficha entrou. Ficam como lista vazia so pra guarda
           de carregamento continuar funcionando. */
        precifProdutos = [];
        precifFuncionarios = [];
        precifConfig = d.config || { despesasFixasPctPadrao: 0, canais: {} };
        precifMateriais = d.materiais || [];
        precifRendimento = d.rendimento || [];
        precifMaoDeObraPecas = d.maoDeObraPecas || [];
        precifCorte = d.corte || [];
        precifProducao = d.producao || [];
        precifAviamentos = d.aviamentos || [];
        precifAcabamentos = d.acabamentos || [];
        precifModelos = d.modelos || [];
        precifFicha = d.ficha || [];
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

    /* Recorta na hora de desenhar, nunca antes do await: o FILTER pode ter
       mudado no meio. KPIs e DFC sao regime de CAIXA - so entra o que foi
       efetivamente pago/recebido. O Fluxo de Caixa mostra os dois, com a
       situacao visivel e filtravel. */
    const recortar_ = () => FLUXO_ROWS.filter(r => r.date >= FILTER.start && r.date <= FILTER.end);
    if (view === 'fluxoCaixa') return renderFluxoCaixa(el, recortar_());
    if (view === 'kpis') {
      await garantirVendas_(el); await garantirConfigCanais_(el);
      if (renderObsoleta_(gen)) return;
      return renderKpis(el, recortar_().filter(r => r.paga));
    }
    // a DRE em regime de competencia le VENDAS_ROWS; sem garantir aqui,
    // ela cairia calada pro regime de caixa na primeira abertura
    if (view === 'dre') {
      await garantirVendas_(el);
      if (renderObsoleta_(gen)) return;
      return renderDre(el, recortar_().filter(r => r.paga));
    }
    if (view === 'balanco') return renderBalanco(el);
    if (view === 'vendas') {
      await garantirVendas_(el);
      if (renderObsoleta_(gen)) return;
      return renderVendas(el, recortar_().filter(r => r.paga));
    }
  } catch (e) {
    el.innerHTML = '<div class="state-msg">Erro ao desenhar esta aba (' + e.message + ').</div>';
  }
}

/* ---------------- Agregação (DRE a partir do Fluxo de Caixa) ---------------- */

/*
 * O nome do grupo é digitado à mão no _DRE_Mapa, e acento é onde isso quebra:
 * a planilha ficou com "Despesas Variaveis de Venda" e a estrutura da DRE
 * espera "Despesas Variáveis de Venda". Sem casar, o grupo virava "extra" e
 * caía no bloco de fora do resultado — em agosto/2026 isso escondeu
 * R$ 14.676,67 de taxa de marketplace e frete, e a margem de contribuição
 * apareceu igual ao lucro bruto.
 *
 * Comparar sem acento e sem caixa resolve na leitura, sem exigir que ninguém
 * digite certo na planilha.
 */
/* Nome antigo -> nome atual. Renomear grupo e barato no codigo e caro na
   planilha, e os dois nao mudam juntos. Entrada aqui pode ser removida depois
   que manutencaoDre rodar e nenhuma linha carregar mais o nome velho - mas
   custa nada deixar, e protege planilha restaurada de backup. */
const ALIAS_GRUPO_ = {
  /* 14/09/2026: o nome antigo lia como "receita ignorada" e e o oposto - e a
     copia da venda que NAO conta, porque a que conta vem do pedido. */
  'Receita pelo pedido (ignorar na DRE)': 'Venda já contada pelo pedido (ignorar na DRE)'
};

let GRUPOS_CANONICOS = null;

function chaveGrupo_(s) {
  // ̀-ͯ e o bloco de acentos combinantes. Escrito como escape de
  // proposito: os caracteres literais nao sobrevivem a copiar e colar.
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

function canonizarGrupo_(nome) {
  /* Montado na PRIMEIRA CHAMADA, nao no topo do arquivo: DRE_ESTRUTURA e
     DRE_FORA sao declaradas mais abaixo, e ler um `const` antes da declaracao
     e ReferenceError - derrubaria o painel inteiro no carregamento. */
  if (!GRUPOS_CANONICOS) {
    GRUPOS_CANONICOS = {};
    DRE_ESTRUTURA.filter(i => i.tipo === 'grupo').map(i => i.nome)
      .concat(DRE_FORA)
      .forEach(n => { GRUPOS_CANONICOS[chaveGrupo_(n)] = n; });
    /* NOMES ANTIGOS. O painel e a planilha nao viram a mesma hora: o JS chega
       pelo GitHub Pages na hora, e as ~19 mil linhas do Fluxo de Caixa so
       recebem o nome novo quando alguem roda manutencaoDre. Sem esta tabela, a
       DRE nessa janela mostraria o grupo DUAS vezes - o nome novo zerado e o
       antigo como grupo desconhecido, em vermelho, como se fosse problema. */
    Object.keys(ALIAS_GRUPO_).forEach(function (antigo) {
      GRUPOS_CANONICOS[chaveGrupo_(antigo)] = ALIAS_GRUPO_[antigo];
    });
  }
  return GRUPOS_CANONICOS[chaveGrupo_(nome)] || nome;
}

function agregarPorGrupo_(rows) {
  const porGrupo = {};
  rows.forEach(r => {
    const sinal = r.tipo === 'entrada' ? 1 : -1;
    const g = canonizarGrupo_(r.grupoDRE);
    porGrupo[g] = (porGrupo[g] || 0) + sinal * r.valor;
  });
  return porGrupo;
}

function totais_(rows) {
  const porGrupo = agregarPorGrupo_(rows);
  const receitaBruta = porGrupo['Receita Bruta'] || 0;
  /* "(sem mapear)" nao entra no resultado, pelo mesmo motivo dos "(ignorar na
     DRE)": a tabela da DRE ja o deixa fora (DRE_FORA), e com ele aqui o KPI e
     a tabela discordavam em R$ 1.065,90 sem nada na tela explicando a
     diferenca. Ele nao desaparece - fica listado em "Fora do resultado", com o
     motivo em vermelho, porque e pendencia de classificacao e nao decisao. */
  let resultadoLiquido = 0;
  Object.keys(porGrupo).forEach(g => {
    if (g.indexOf('ignorar') >= 0 || g === '(sem mapear)') return;
    resultadoLiquido += porGrupo[g];
  });
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
/*
 * `campoData` escolhe por qual data a linha cai na coluna: 'date' (caixa,
 * quando o dinheiro mexeu) ou 'dateComp' (competência, quando o fato
 * aconteceu). Default 'date' — todo chamador antigo continua igual.
 */
function serieTemporal_(rows, start, end, campoData, forcarMes) {
  const campo = campoData || 'date';
  const dias = Math.round((end - start) / 86400000) + 1;
  /* forcarMes existe para a DRE (08/09/2026). Receita e CMV passaram a vir de
     fontes MENSAIS - receita pela data do pedido, CMV por consumo - e não há
     como recortá-las por semana sem inventar rateio. Uma DRE semanal também
     não diz nada: despesa fixa não acontece em fatias de sete dias. */
  const modo = forcarMes ? 'mes' : (dias <= 14 ? 'dia' : (dias <= 92 ? 'semana' : 'mes'));

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
    /* Semana que comeca DEPOIS do fim do periodo: nao existe recorte honesto,
       e o rotulo sairia com o inicio depois do fim ("07/09-31/08"). Isso so
       acontece com linha fora do periodo filtrado, o que e sintoma de bug -
       melhor a coluna se denunciar do que mentir uma data. */
    if (ini > end) return dayLabel(ini) + ' (fora do período)';
    let fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
    const iniVis = ini < start ? start : ini;
    if (fim > end) fim = end;
    return dayLabel(iniVis) + '–' + dayLabel(fim);
  };

  /* As colunas saem do PERIODO, nao dos dados.
     Antes so existia coluna onde havia lancamento, e por isso a DFC e a tabela
     de canais logo acima dela apareciam com numeros de colunas diferentes na
     mesma tela - dava a impressao de serem periodos diferentes, e foi parte do
     que escondeu a corrida de renderizacao de 09/09/2026. Semana sem
     movimento agora aparece como R$ 0,00, que tambem e informacao. */
  const buckets = {};
  const ordem = [];
  for (let d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
       d <= end;
       d.setDate(d.getDate() + 1)) {
    const k = chave(d);
    if (!buckets[k]) { buckets[k] = []; ordem.push(k); }
  }
  const foraDoPeriodo = [];
  rows.forEach(r => {
    const k = chave(r[campo] || r.date);
    if (!buckets[k]) { buckets[k] = []; ordem.push(k); foraDoPeriodo.push(k); }
    buckets[k].push(r);
  });
  ordem.sort();
  return ordem.map(k => ({
    chave: k, label: label(k), rows: buckets[k],
    fora: foraDoPeriodo.indexOf(k) >= 0
  }));
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
/* O nome do canal na aba Vendas (vem do Bling) nao e o mesmo da
   _Precificacao_Config (vem do FPV). Sem esta ponte, a taxa medida de
   cada canal nao encontra a receita dele. */
const CANAL_PARA_CONFIG = {
  'Shopee': ['Shopee'],
  'Mercado Livre': ['MercadoLivre'],
  'MercadoLivre': ['MercadoLivre'],
  'Site (Nuvemshop)': ['NuvemShop_Cartao', 'NuvemShop_Pix'],
  'Nuvemshop': ['NuvemShop_Cartao', 'NuvemShop_Pix'],
  'TikTok Shop': ['TikTokShop'],
  'SHEIN': ['SHEIN']
};

/**
 * Margem de contribuicao por canal, com a taxa REAL de cada um.
 *
 * Antes isto pegava o total de taxas do financeiro e rateava proporcional
 * a receita. Sendo proporcional, a razao taxa÷receita saia identica em
 * todo canal - os 85,4% que apareciam em Shopee, Mercado Livre, site,
 * TikTok e SHEIN na mesma coluna. A tabela dizia servir pra comparar
 * canais e era exatamente o que ela nao conseguia fazer.
 *
 * Agora usa as taxas medidas da _Precificacao_Config: imposto, comissao,
 * extras e a cobranca fixa por pedido (a Shopee cobra R$ 4,00 por item).
 * Canal com mais de uma forma de pagamento, como o site, entra pela media
 * das duas - o financeiro nao separa cartao de pix na venda.
 *
 * Continua sem descontar custo de produto: para isso existe o painel de
 * ponto de equilibrio logo acima.
 */
/*
 * Faturamento do período: a venda pela DATA DA VENDA, não pela data em que
 * o dinheiro entrou.
 *
 * É outra coisa do que a "Receita bruta recebida" do primeiro cartão, e as
 * duas precisam conviver: uma diz quanto a loja vendeu, a outra quanto o
 * caixa recebeu. Na Shopee a diferença é de semanas — a venda de 28/08 só
 * cai na carteira em setembro. Sem o faturamento, um mês de venda forte com
 * liberação lenta aparece como mês fraco.
 *
 * Pedido cancelado não entra (contaReceita = false na aba Vendas), mas é
 * contado à parte pra ficar visível.
 */
function faturamento_(inicio, fim) {
  const todas = (VENDAS_ROWS || []).filter(v => v.date >= inicio && v.date <= fim);
  const vendas = todas.filter(v => v.contaReceita);
  const total = vendas.reduce((s, v) => s + v.total, 0);
  const canceladas = todas.filter(v => !v.contaReceita);
  return {
    total: total,
    pedidos: vendas.length,
    ticket: vendas.length ? total / vendas.length : 0,
    canceladas: canceladas.length,
    valorCancelado: canceladas.reduce((s, v) => s + v.total, 0),
    temDados: todas.length > 0
  };
}

function margemPorCanal_(rows) {
  const vendas = (VENDAS_ROWS || []).filter(v => v.date >= FILTER.start && v.date <= FILTER.end && v.contaReceita);
  const porCanal = {};
  vendas.forEach(v => {
    if (!porCanal[v.canal]) porCanal[v.canal] = { receita: 0, pedidos: 0 };
    porCanal[v.canal].receita += v.total;
    porCanal[v.canal].pedidos++;
  });

  const cfg = (precifConfig && precifConfig.canais) || {};

  return Object.keys(porCanal).sort().map(canal => {
    const receita = porCanal[canal].receita;
    const pedidos = porCanal[canal].pedidos;

    const chaves = (CANAL_PARA_CONFIG[canal] || []).filter(k => cfg[k]);
    let taxa = 0, pct = 0, fixaUnit = 0, medido = false;

    if (chaves.length) {
      chaves.forEach(k => {
        const c = cfg[k];
        pct += (Number(c.impostosPct) || 0) + (Number(c.comissaoPct) || 0)
          + (Number(c.extra1Pct) || 0) + (Number(c.extra2Pct) || 0);
        fixaUnit += Number(c.taxaFixaReais) || 0;
      });
      pct = pct / chaves.length;
      fixaUnit = fixaUnit / chaves.length;
      taxa = receita * pct + pedidos * fixaUnit;
      medido = chaves.every(k => cfg[k].confirmado === true || String(cfg[k].confirmado).toUpperCase() === 'TRUE');
    }

    const mc = receita - taxa;
    return {
      canal, receita, pedidos, taxa, pct, fixaUnit, medido,
      semTaxa: !chaves.length,
      mc, mcPct: receita ? mc / receita : 0,
      ticket: pedidos ? receita / pedidos : 0
    };
  });
}

/**
 * 5) Ponto de equilibrio: quanto precisa faturar pra pagar o custo fixo.
 *
 * Dois consertos em 24/08/2026:
 *
 *  - a margem vinha do margemPorCanal_, que desconta so a taxa do canal e
 *    NAO o custo do produto (a propria tabela avisa isso). Com CMV de
 *    fora, a margem parecia bem maior e o ponto de equilibrio saia baixo
 *    demais - justo o numero que serve pra decidir se o mes fecha.
 *    Agora a margem sai da DRE: receita menos deducoes, CMV e despesas
 *    comerciais, que sao os tres que andam junto com a venda.
 *
 *  - o custo fixo e MENSAL e era comparado com a receita do periodo
 *    filtrado, fosse ele de uma semana ou de um trimestre. Agora e
 *    proporcional aos dias selecionados.
 */
function pontoEquilibrio_(rows) {
  /* Custo fixo VIGENTE. O filtro antigo era `d.ativo !== false`, e o campo
     `ativo` nunca existiu no cadastro - entao ele nao filtrava nada e somava
     inclusive despesa ja encerrada. Agora usa `vigente`, que o backend calcula
     com a vigencia de cada linha e o mes de hoje no fuso de Sao Paulo. */
  const fixasMes = (precifDespesasFixas || [])
    .filter(d => d.vigente !== false)
    .reduce((s, d) => s + (Number(d.valorMensal || d.valor || 0)), 0);

  const somaGrupo = (frag, tipo) => rows
    .filter(r => r.tipo === tipo && String(r.grupoDRE).indexOf(frag) >= 0)
    .reduce((s, r) => s + r.valor, 0);

  const receita = somaGrupo('Receita Bruta', 'entrada');
  const deducoes = somaGrupo('Dedu', 'saida');
  const cmv = somaGrupo('CMV', 'saida');
  const comerciais = somaGrupo('Despesas Comerciais', 'saida');
  const mc = receita - deducoes - cmv - comerciais;
  const mcPct = receita ? mc / receita : 0;

  /* Sem zerar a hora, 01/07 00:00 ate 31/07 23:59 da 30,99 dias, que
     arredonda pra 31, e o +1 leva a 32 - julho ganhava um dia de custo
     fixo que nao existe. Os dias seguem sendo calculados porque a tela
     mostra o periodo, mas nao entram mais no custo fixo (ver abaixo). */
  const dias = Math.max(1, Math.round(
    (startOfDay_(FILTER.end) - startOfDay_(FILTER.start)) / 86400000) + 1);

  /*
   * CUSTO FIXO E DO MES INTEIRO, NAO RATEADO POR DIA (mudado em 03/09/2026).
   *
   * Antes isto era fixasMes * (dias / 30,44). No dia 3 de setembro o painel
   * cobrava 3/30 do aluguel e anunciava "95,9% da meta" - uma meta de tres
   * dias. A Karolyne apontou: "da uma sensacao burra de meta atingida".
   * Ela esta certa. Aluguel, salario e contador nao chegam em parcelas
   * diarias: o mes inteiro vence de qualquer jeito, entao a meta do mes
   * nasce cheia no dia 1 e vai sendo coberta conforme a venda entra.
   *
   * Para periodo que cruza meses, conta os meses do CALENDARIO tocados
   * (jul+ago = 2), nao a fracao - dois meses custam dois alugueis.
   */
  const meses = Math.max(1,
    (FILTER.end.getFullYear() - FILTER.start.getFullYear()) * 12
    + (FILTER.end.getMonth() - FILTER.start.getMonth()) + 1);
  const fixasPeriodo = fixasMes * meses;

  const faturamentoNecessario = mcPct > 0 ? fixasPeriodo / mcPct : 0;
  return {
    fixasMes, fixasPeriodo, dias, meses, receita, deducoes, cmv, comerciais, mc, mcPct,
    faturamentoNecessario,
    cobertura: faturamentoNecessario ? receita / faturamentoNecessario : 0
  };
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

/*
 * CRUZAMENTO vendas × resultado × caixa (07/09/2026).
 *
 * As três respondem perguntas diferentes e a confusão entre elas foi o que
 * gerou "por que a DRE não bate com o relatório de vendas?":
 *   VENDI    - data da venda            (competência) "quanto saiu da loja"
 *   RECEBI   - data do dinheiro         (caixa)       "quanto entrou na conta"
 *   RESULTADO- receita menos despesa    (competência) "quanto o mês rendeu"
 *   CAIXA    - entradas menos saídas    (caixa)       "quanto o saldo andou"
 *
 * Lado a lado elas mostram o comportamento que nenhuma mostra sozinha: mês que
 * vende bem e não gera caixa (venda a prazo, liberação lenta), mês que gera
 * caixa de venda velha, mês que dá lucro e mesmo assim o saldo cai porque teve
 * retirada ou compra de máquina.
 */
function mesesDoPeriodo_(start, end) {
  const out = [];
  let d = new Date(start.getFullYear(), start.getMonth(), 1);
  while (d <= end) {
    out.push({
      chave: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
      label: monthLabel(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'))
    });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  }
  return out;
}

function renderCruzamento_(rows) {
  const meses = mesesDoPeriodo_(FILTER.start, FILTER.end);
  if (meses.length < 1) return '';
  const chaveDe = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const val = (r) => (r.tipo === 'entrada' ? 1 : -1) * r.valor;

  // competência precisa do conjunto completo: `rows` chegou filtrado por caixa
  const todasComp = (FLUXO_ROWS || []).filter(r => r.paga
    && r.dateComp >= FILTER.start && r.dateComp <= FILTER.end);

  const linha = meses.map(m => {
    const vendi = (VENDAS_ROWS || [])
      .filter(v => v.contaReceita && chaveDe(v.date) === m.chave
        && v.date >= FILTER.start && v.date <= FILTER.end)
      .reduce((s, v) => s + v.total, 0);

    const doMesCaixa = rows.filter(r => chaveDe(r.date) === m.chave);
    const recebi = doMesCaixa.filter(r => r.grupoDRE === 'Receita Bruta').reduce((s, r) => s + val(r), 0);

    // caixa: tudo menos transferência entre contas (sai de um portador, entra em outro)
    const caixa = doMesCaixa
      .filter(r => !/transfer/i.test(r.categoria || ''))
      .reduce((s, r) => s + val(r), 0);

    // resultado: competência, fora o não operacional e o que não tem grupo
    const resultado = todasComp
      .filter(r => chaveDe(r.dateComp) === m.chave)
      .filter(r => r.grupoDRE.indexOf('ignorar') < 0 && r.grupoDRE !== '(sem mapear)')
      .reduce((s, r) => s + val(r), 0);

    return { ...m, vendi, recebi, resultado, caixa };
  });

  const somaDe = (k) => linha.reduce((s, l) => s + l[k], 0);
  const tv = somaDe('vendi'), tr = somaDe('recebi'), tres = somaDe('resultado'), tc = somaDe('caixa');

  let tab = `<tr><th>Mês</th><th>Vendi <small>data da venda</small></th>
    <th>Recebi <small>data do dinheiro</small></th>
    <th>Resultado <small>competência</small></th>
    <th>Caixa <small>variação</small></th></tr>`;
  linha.forEach(l => {
    tab += `<tr><td>${l.label}</td>
      <td class="num">${fmtBRL(l.vendi, 2)}</td>
      <td class="num">${fmtBRL(l.recebi, 2)}</td>
      <td class="num ${l.resultado >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(l.resultado, 2)}</td>
      <td class="num ${l.caixa >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(l.caixa, 2)}</td></tr>`;
  });
  tab += `<tr class="dre-subtotal"><th>Total</th>
    <th class="num">${fmtBRL(tv, 2)}</th>
    <th class="num">${fmtBRL(tr, 2)}</th>
    <th class="num ${tres >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(tres, 2)}</th>
    <th class="num ${tc >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(tc, 2)}</th></tr>`;

  // leituras: só o que os números sustentam, uma frase por achado
  const notas = [];
  const dif = tr - tv;
  if (Math.abs(dif) > tv * 0.03 && tv > 0) {
    notas.push(dif > 0
      ? `Entrou <b>${fmtBRL(dif, 2)}</b> a mais do que se vendeu no período — é venda anterior sendo liberada agora.`
      : `Entrou <b>${fmtBRL(Math.abs(dif), 2)}</b> a menos do que se vendeu — esse valor ainda está para liberar.`);
  }
  const difRC = tc - tres;
  if (Math.abs(difRC) > 500) {
    notas.push(difRC > 0
      ? `O caixa cresceu <b>${fmtBRL(difRC, 2)}</b> a mais que o resultado — entrou dinheiro que não é lucro (empréstimo, venda de ativo, ou recebimento de venda antiga).`
      : `O caixa ficou <b>${fmtBRL(Math.abs(difRC), 2)}</b> abaixo do resultado — saiu dinheiro que não é despesa do mês (retirada, compra de máquina, ou pagamento de conta antiga).`);
  }
  const descolados = linha.filter(l => l.resultado > 0 && l.caixa < 0);
  if (descolados.length) {
    notas.push(`${descolados.map(l => l.label).join(', ')}: deu <b>lucro mas o caixa caiu</b> —
      o mês rendeu, mas o dinheiro saiu para outra coisa ou ainda não entrou.`);
  }
  const inverso = linha.filter(l => l.resultado < 0 && l.caixa > 0);
  if (inverso.length) {
    notas.push(`${inverso.map(l => l.label).join(', ')}: <b>caixa subiu com resultado negativo</b> —
      o saldo enganou; o mês deu prejuízo e o dinheiro veio de fora da operação.`);
  }

  return `<div class="panel">
    <h3>Vendas × Resultado × Caixa</h3>
    <div class="sub">As quatro colunas respondem perguntas diferentes, e por isso quase nunca são iguais.
    <b>Vendi</b> é o que saiu da loja; <b>Recebi</b> é o que entrou na conta; <b>Resultado</b> é o que o mês
    rendeu de fato; <b>Caixa</b> é o quanto o saldo andou.</div>
    <div style="overflow-x:auto;"><table class="simple dre">${tab}</table></div>
    ${notas.length ? '<ul class="sub" style="margin-top:.7rem;padding-left:1.1rem;">'
      + notas.map(n => `<li style="margin-bottom:.35rem;">${n}</li>`).join('') + '</ul>' : ''}
  </div>`;
}

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
  const fat = faturamento_(FILTER.start, FILTER.end);
  const fatAnterior = faturamento_(prevStart, prevEnd);
  const variacaoFat = fatAnterior.total ? (fat.total / fatAnterior.total - 1) : null;
  const totalCanais = canais.reduce((s, c) => s + c.receita, 0);

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">KPIs &amp; Gráficos</h2>
      <div class="section-desc">Faturamento e distribuição por canal saem da aba Vendas (pela data da venda). O resto vem dos lançamentos do Bling — contas a pagar/receber já baixadas, por categoria.</div>
    </div>
    ${renderFiltroBar_()}
    ${avisoJanela_()}
    <div class="kpi-grid k5">
      <div class="kpi ${fat.total > 0 ? 'ok' : ''}">
        <div class="kpi-label">Faturamento — vendas</div>
        <div class="kpi-value">${fat.temDados ? fmtBRL(fat.total) : '—'}</div>
        <div class="kpi-foot">${fat.temDados
          ? fat.pedidos + ' pedido(s) · ticket ' + fmtBRL(fat.ticket, 2)
            + (variacaoFat === null ? '' : ' · ' + fmtPct(variacaoFat) + ' vs. anterior')
            + (fat.canceladas ? ' · ' + fat.canceladas + ' cancelado(s), ' + fmtBRL(fat.valorCancelado, 2) + ' fora' : '')
          : 'A aba Vendas alimenta este número'}</div>
      </div>
      <div class="kpi ${receitaBruta >= 0 ? 'ok' : 'bad'}">
        <div class="kpi-label">Receita bruta recebida <small style="text-transform:none;letter-spacing:0;">(antes das deduções)</small></div>
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
        <div class="kpi-value">${eq.faturamentoNecessario ? fmtBRL(eq.faturamentoNecessario) : '—'}</div>
        ${eq.faturamentoNecessario ? `
        <div style="margin:.45rem 0 .3rem;height:6px;border-radius:3px;background:rgba(0,0,0,.08);overflow:hidden;">
          <div style="height:100%;width:${Math.min(100, eq.cobertura * 100).toFixed(1)}%;border-radius:3px;background:currentColor;opacity:.55;"></div>
        </div>` : ''}
        <div class="kpi-foot">${eq.faturamentoNecessario
          ? 'Meta de ' + eq.meses + ' mês(es) — custo fixo cheio. Você fez ' + fmtBRL(eq.receita)
            + ' (' + fmtPctSimples_(eq.cobertura) + ')'
            + (eq.cobertura >= 1
              ? '. Passou em ' + fmtBRL(eq.receita - eq.faturamentoNecessario) + '.'
              : '. Faltam ' + fmtBRL(eq.faturamentoNecessario - eq.receita) + '.')
          : 'Cadastre o custo fixo na aba Custo Fixo'}</div>
      </div>
    </div>

    ${renderCruzamento_(rows)}

    <div class="panel">
      <h3>Ponto de equilíbrio</h3>
      <div class="sub">Quanto precisa entrar pra pagar o custo fixo. A margem aqui já desconta o custo do produto, diferente da tabela por canal abaixo. <b>Só entra conta já baixada</b>, agrupada pelo mês do vencimento — conta em aberto fica de fora, e por isso o total daqui é menor que o das vendas na tabela abaixo, que conta tudo pela data da venda.</div>
      <div style="overflow-x:auto;"><table class="simple">
        <tr><td>Receita bruta recebida <small>contas baixadas, pelo mês do vencimento</small></td><td class="num val-in">${fmtBRL(eq.receita, 2)}</td></tr>
        <tr><td>Deduções (impostos, taxas de canal)</td><td class="num val-out">−${fmtBRL(eq.deducoes, 2)}</td></tr>
        <tr><td>CMV (tecido, aviamento, facção)</td><td class="num val-out">−${fmtBRL(eq.cmv, 2)}</td></tr>
        <tr><td>Despesas comerciais (frete, marketing)</td><td class="num val-out">−${fmtBRL(eq.comerciais, 2)}</td></tr>
        <tr><th>Margem de contribuição <small>é isto que sobra pra pagar o custo fixo</small></th><th class="num val-in">${fmtBRL(eq.mc, 2)} · ${fmtPctSimples_(eq.mcPct)}</th></tr>
        <tr><td>Custo fixo no período <small>${fmtBRL(eq.fixasMes, 2)}/mês × ${eq.meses} mês(es) — cheio, não rateado por dia</small></td><td class="num val-out">−${fmtBRL(eq.fixasPeriodo, 2)}</td></tr>
        <tr><th>Resultado</th><th class="num ${eq.mc - eq.fixasPeriodo >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(eq.mc - eq.fixasPeriodo, 2)}</th></tr>
        <tr><th>Faturamento necessário <small>o ponto de equilíbrio</small></th><th class="num">${eq.faturamentoNecessario ? fmtBRL(eq.faturamentoNecessario, 2) : '—'}</th></tr>
      </table></div>
      <div class="sub" style="margin-top:.6rem;">${eq.faturamentoNecessario
        ? (eq.cobertura >= 1
          ? `Com ${fmtPctSimples_(eq.mcPct)} de margem, cada R$ 100 vendidos deixam ${fmtBRL(eq.mcPct * 100, 2)} para pagar o custo fixo. Eram necessários <b>${fmtBRL(eq.faturamentoNecessario, 2)}</b> e entraram ${fmtBRL(eq.receita, 2)} — <b>${fmtPctSimples_(eq.cobertura)}</b> do necessário, com ${fmtBRL(eq.receita - eq.faturamentoNecessario, 2)} acima da conta.`
          : `Com ${fmtPctSimples_(eq.mcPct)} de margem, cada R$ 100 vendidos deixam ${fmtBRL(eq.mcPct * 100, 2)} para pagar o custo fixo. Eram necessários <b>${fmtBRL(eq.faturamentoNecessario, 2)}</b> e entraram ${fmtBRL(eq.receita, 2)} — faltaram <b>${fmtBRL(eq.faturamentoNecessario - eq.receita, 2)}</b>.`)
        : ''}</div>
    </div>

    <div class="panel">
      <h3>Vendas e margem por canal</h3>
      <div class="sub">Receita pela data da venda, menos a taxa real de cada canal — imposto, comissão, antecipação e a cobrança fixa por pedido. <b>Ainda não desconta o custo do produto</b>: para o número final, veja o ponto de equilíbrio acima. Canal marcado com <span class="pill md">estimado</span> tem taxa não medida ainda.</div>
      <div style="overflow-x:auto;"><table class="simple" id="tblCanais"></table></div>
      <div class="chart-box" style="height:260px; margin-top:16px;"><canvas id="chartCanais"></canvas></div>
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
    // "Part." e a fatia do faturamento que cada canal representa. E o numero
    // que responde "de onde vem meu dinheiro" — sem ele a tabela so mostra
    // valores absolutos e a concentracao num canal so passa despercebida.
    let h = '<tr><th>Canal</th><th class="num">Pedidos</th><th class="num">Ticket</th>'
      + '<th class="num">Receita</th><th class="num">Part.</th><th class="num">Taxa do canal</th>'
      + '<th class="num">Margem de contrib.</th><th class="num">%</th></tr>';
    const ordenados = canais.slice().sort((a, b) => b.receita - a.receita);
    ordenados.forEach(c => {
      const selo = c.semTaxa
        ? ' <span class="pill md">sem taxa cadastrada</span>'
        : (c.medido ? '' : ' <span class="pill md">estimado</span>');
      const detTaxa = c.semTaxa ? '—'
        : fmtPctSimples_(c.pct) + (c.fixaUnit ? ' + ' + fmtBRL(c.fixaUnit, 2) + '/pedido' : '');
      h += `<tr><td>${escapeHtml_(c.canal)}${selo}</td>`
        + `<td class="num">${c.pedidos}</td>`
        + `<td class="num">${fmtBRL(c.ticket, 2)}</td>`
        + `<td class="num val-in">${fmtBRL(c.receita, 2)}</td>`
        + `<td class="num">${totalCanais ? fmtPctSimples_(c.receita / totalCanais) : '—'}</td>`
        + `<td class="num val-out">−${fmtBRL(c.taxa, 2)}<small>${detTaxa}</small></td>`
        + `<td class="num val-in">${fmtBRL(c.mc, 2)}</td>`
        + `<td class="num">${fmtPctSimples_(c.mcPct)}</td></tr>`;
    });
    const totPedidos = ordenados.reduce((s, c) => s + c.pedidos, 0);
    const totTaxa = ordenados.reduce((s, c) => s + c.taxa, 0);
    const totMc = ordenados.reduce((s, c) => s + c.mc, 0);
    h += `<tr><th>Total</th>`
      + `<th class="num">${totPedidos}</th>`
      + `<th class="num">${totPedidos ? fmtBRL(totalCanais / totPedidos, 2) : '—'}</th>`
      + `<th class="num val-in">${fmtBRL(totalCanais, 2)}</th>`
      + `<th class="num">100%</th>`
      + `<th class="num val-out">−${fmtBRL(totTaxa, 2)}</th>`
      + `<th class="num val-in">${fmtBRL(totMc, 2)}</th>`
      + `<th class="num">${totalCanais ? fmtPctSimples_(totMc / totalCanais) : '—'}</th></tr>`;
    tblC.innerHTML = h;

    // Cor fixa por canal, na cor da marca de cada um: a mesma fatia tem a
    // mesma cor todo mes, mesmo quando a ordem muda. Canal fora da lista cai
    // na paleta rotativa.
    const CORES_CANAL = {
      'shopee': '#D9342B',           // vermelho
      'mercado livre': '#E8B500',    // amarelo
      'tiktok': '#141414',           // preto
      'nuvemshop': '#2B50D8',        // azul royal
      'site': '#2B50D8'
    };
    const coresFallback = [PALETTE.sage, PALETTE.terracotta, PALETTE.sageSoft, PALETTE.amber, PALETTE.peach, PALETTE.terracottaDark, PALETTE.brick];
    function corDoCanal_(nome, i) {
      const n = String(nome || '').toLowerCase();
      const chave = Object.keys(CORES_CANAL).find(k => n.indexOf(k) >= 0);
      return chave ? CORES_CANAL[chave] : coresFallback[i % coresFallback.length];
    }
    new Chart(document.getElementById('chartCanais'), {
      type: 'doughnut',
      data: {
        labels: ordenados.map(c => c.canal),
        datasets: [{ data: ordenados.map(c => c.receita), backgroundColor: ordenados.map((c, i) => corDoCanal_(c.canal, i)), borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => c.label + ': ' + fmtBRL(c.raw, 2)
            + (totalCanais ? ' (' + fmtPctSimples_(c.raw / totalCanais) + ')' : '') } }
        }
      }
    });
  } else {
    tblC.outerHTML = '<div class="state-msg">Sem vendas no período (a aba Vendas alimenta esta tabela).</div>';
    const cv = document.getElementById('chartCanais');
    if (cv && cv.parentElement) cv.parentElement.style.display = 'none';
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
    ${avisoJanela_()}
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

/*
 * FATURA DE CARTAO AINDA NAO RATEADA.
 *
 * A fatura de cartao entra no Bling como UM lancamento generico ("Cartao de
 * Credito") no vencimento, e o rateio por categoria e feito a mao depois - por
 * volta do dia 18, porque a fatura fechada e o extrato so existem depois do
 * vencimento. Nao e erro: e o calendario.
 *
 * O efeito na DRE e que, entre o vencimento e o rateio, o valor inteiro fica
 * numa categoria so (hoje "Compra de insumos e materia prima", que o mapa manda
 * para Estoque). Nesse intervalo a DRE do mes corrente mostra administrativo,
 * comercial e taxas MENORES do que sao, e o estoque maior. Em setembro/2026 sao
 * R$ 10.216,10 nessa situacao.
 *
 * O painel nao tem como ratear sozinho - so quem viu a fatura sabe o que e o
 * que. Mas pode dizer que esta assim, em vez de mostrar um numero calado.
 */
const RE_FATURA_CRUA = /cart[ãa]o de cr[ée]dito/i;

function faturaNaoRateada_(rows) {
  const linhas = (rows || []).filter(function (r) {
    // duas formas de reconhecer: o grupo proprio (jeito certo, desde 10/09/2026)
    // ou o texto do lancamento (jeito antigo, para o que ja esta gravado)
    return chaveGrupo_(r.grupoDRE) === chaveGrupo_('Cartão a ratear (ignorar na DRE)')
        || RE_FATURA_CRUA.test(String(r.descricao || ''));
  });
  if (!linhas.length) return null;
  const total = linhas.reduce(function (s, r) {
    return s + (r.tipo === 'entrada' ? r.valor : -r.valor);
  }, 0);
  const datas = linhas.map(function (r) { return r.date; }).sort(function (a, b) { return a - b; });
  return { n: linhas.length, total: total,
           de: datas[0], ate: datas[datas.length - 1] };
}


/* =========================== BALANCO PATRIMONIAL ===========================
 *
 * A DRE diz se o mes deu lucro. A DFC diz para onde o dinheiro foi. O balanco
 * diz o que a empresa E - e era o unico dos tres que nao existia aqui.
 *
 * POR QUE OS NUMEROS SAO DIGITADOS E NAO CALCULADOS: balanco e FOTOGRAFIA de
 * uma data, e as posicoes nao estao no Fluxo de Caixa. Saldo de conta vem do
 * extrato do banco (o Bling nao tem saldo, tem lancamento); saldo devedor de
 * emprestimo vem da ficha do Sicoob; imobilizado vem de nota de compra. Somar
 * lancamento nao produz saldo - foi exatamente por tentar isso que a carteira
 * Shopee aparecia com R$ 27.878 no Bling quando o extrato dizia R$ 977,01.
 *
 * PARA ATUALIZAR: troque os numeros de BALANCO_ e a data em BALANCO_.data.
 * Cada linha tem a fonte escrita ao lado de proposito: numero de balanco sem
 * fonte nao se confere depois.
 */
const BALANCO_ = {
  data: '31/08/2026',
  ativo: {
    'Caixa e equivalentes': [
      ['Sicoob conta corrente', 4748.28, 'extrato — sem os 2.000 de cheque especial, que é limite e não ativo'],
      ['Nubank',                1846.15, 'OFX, saldo datado (LEDGERBAL)'],
      ['Carteira Shopee',        977.01, 'extrato da Shopee, coluna saldo_depois — no Bling aparece 27.878, errado'],
      ['Mercado Pago',             0.00, 'extrato, 373 movimentos reconstruídos — no Bling aparece +21 mil, errado'],
      ['Pagar.me',                 0.00, 'a Pagar.me esvazia a conta a cada repasse, não acumula']
    ],
    'Estoque': [
      ['Peça acabada',         13851.97, '839 peças pela ficha técnica'],
      ['Em produção',           7130.43, '1.358 peças, tecido e corte já gastos'],
      ['Tecido em rolo',        5032.80, '720 m de cetim'],
      ['Linhas e aviamentos',   2864.55, '333 unidades contadas em 12/09'],
      ['Fechos Carmóvel',        645.86, '80 unidades da NF 3986']
    ],
    'Imobilizado': [
      ['Máquinas e equipamentos', 6113.09, 'costura, corte, prensas — custo 17.950, já depreciado. NÃO inclui a bordadeira Brother, a reta Singer, a overlock, a Cameo 1 nem o filtro: foram ganhadas, custo zero'],
      ['Informática',             4004.00, 'notebooks e impressoras — custo 10.400, já depreciado'],
      ['(depreciação acumulada)',     0.0, 'custo total 28.350, sendo 18.233 já depreciados — os valores acima já são líquidos']
    ],
    /* PISO, nao saldo exato - e a diferenca importa. O Bling guarda a situacao
       de HOJE: conta que estava aberta em 31/08 e foi recebida em setembro
       aparece baixada agora e NAO entra aqui. O exato exigiria a data de cada
       baixa, que mora no bordero. Entao isto e "venceu ate 31/08 e continua em
       aberto", que e um minimo. */
    'Contas a receber': [
      ['Vencido e não recebido', 1296.28, '2 contas em aberto com vencimento até 31/08 — PISO: o que foi recebido em setembro não aparece mais como aberto'],
      ['(ficha da CLA)', 0.00, 'FALTA — a última ficha do private label ainda não foi cobrada']
    ]
  },
  passivo: {
    'Empréstimos bancários': [
      ['Sicoob 4376284', 67701.11, 'SAC, 1,75% a.m., até 07/2030 — saldo da ficha em 08/09'],
      ['Sicoob 3397194',  5111.79, 'Price, 2,10% a.m., até 12/2027 — saldo da ficha em 08/09']
    ],
    'Dívida tributária': [
      ['Parcelamento do Simples', 27076.56, '56 de 60 parcelas de R$ 483,51 — adesão 04/05/2026'],
      ['Parcelamento do ICMS',      521.27, 'última das 6 parcelas, vence 30/09'],
      ['DAS de julho em aberto',   4580.21, 'guia 07.20.26239.9819789-5, venceu 31/08']
    ],
    'Contas a pagar e cartões': [
      /* As 3 faturas de setembro. Vencem em setembro, mas a COMPRA e de agosto:
         obrigacao existente em 31/08. Estao em "Cartao a ratear", nao entram em
         nenhuma outra linha deste balanco - sem risco de dobra. */
      ['Faturas de cartão (compra de agosto)', 10216.10, 'Nubank 1.409,25 + 4.953,38 + Sicoob 3.853,47 — vencem em setembro, compra de agosto'],
      /* CONFERIDO em 14/09/2026, e a conferencia cortou o numero pela metade.
         A medicao bruta deu R$ 34.782,74 em 47 contas vencidas e abertas. Pedi
         a quebra por categoria antes de usar, e duas coisas sairam:

           -17.707,59  21 contas em "Transferencias": saque Shopee -> Nubank,
                       o par EM ABERTO que o script antigo (SAQPAG-) deixou
                       enquanto o espelho v2 ja lancou e baixou o saque de
                       verdade. Transferencia entre contas proprias nao e
                       passivo em nenhuma hipotese, e estas nem existem.
            -4.580,21  DAS de julho, que ja esta em Divida tributaria acima.
           =12.494,94  passivo real

         Conferido tambem o que eu temia e nao aconteceu: NENHUMA parcela do
         Sicoob esta entre as 47, entao nao ha dobra com os R$ 72.812,90 lidos
         da ficha grafica; e os dois parcelamentos tributarios ficaram fora,
         porque vencem depois de 31/08.

         A licao: passivo medido por "conta em aberto" carrega lixo de
         integracao. Sem a quebra por categoria eu teria posto R$ 17,7 mil de
         transferencia fantasma no balanco - e escrito na tela que a empresa
         devia isso. */
      ['Vencido e não pago', 12494.94, '47 contas vencidas e abertas (34.782,74) menos 17.707,59 de saque Shopee→Nubank em aberto (transferência, não dívida) e menos o DAS de julho já contado acima']
    ]
  }
};

/*
 * O RAZONETE DO BALANCO: ativo de um lado, passivo e patrimonio do outro.
 *
 * POR QUE desenhar isso alem da tabela de contas: a tabela responde "quanto
 * tem de cada coisa" e esconde a identidade que da nome ao demonstrativo -
 * ATIVO = PASSIVO + PATRIMONIO LIQUIDO. No formato de T a identidade fica
 * visivel, e com ela o fato desconfortavel: os dois lados so fecham porque o
 * patrimonio liquido e NEGATIVO. Quem le a tabela ve um numero ruim; quem le o
 * T entende que o numero ruim e o que sustenta a conta.
 *
 * E o formato em que contador brasileiro le balanco, entao serve tambem para
 * mostrar a terceiro sem traducao.
 */
function razonete_(ativoGrupos, passivoGrupos, ativo, passivo, pl) {
  const F = (v) => fmtBRL(v, 2);
  const soma = (g) => g.reduce((s, x) => s + x[1], 0);
  const lado = (grupos) => Object.keys(grupos)
    .map((g) => ({ nome: g, valor: soma(grupos[g]) }))
    .filter((x) => x.valor !== 0);

  const esq = lado(ativoGrupos);
  const dir = lado(passivoGrupos);
  /* O patrimonio liquido e uma linha do lado DIREITO, nao um resultado no pe da
     pagina. E ai que ele pertence: capital proprio financia ativo do mesmo jeito
     que divida financia. Negativo, ele aparece subtraindo - que e exatamente o
     que significa. */
  dir.push({ nome: 'Patrimônio líquido', valor: pl, pl: true });

  const linhas = Math.max(esq.length, dir.length);
  let corpo = '';
  for (let i = 0; i < linhas; i++) {
    const e = esq[i], d = dir[i];
    corpo += '<tr>'
      + '<td>' + (e ? escapeHtml_(e.nome) : '') + '</td>'
      + '<td class="num">' + (e ? F(e.valor) : '') + '</td>'
      + '<td class="rz-meio">' + (d ? escapeHtml_(d.nome) : '') + '</td>'
      + '<td class="num' + (d && d.pl ? (d.valor < 0 ? ' val-out' : ' val-in') : '') + '">'
      + (d ? F(d.valor) : '') + '</td></tr>';
  }

  return `<div class="panel">
    <h3>O balanço em razonete</h3>
    <div class="sub">O mesmo balanço no formato de T, que é como contador lê. Serve
      para uma coisa que a tabela acima não mostra: <b>os dois lados fecham no mesmo
      número</b>. E só fecham porque o patrimônio líquido é negativo — ou seja, a
      dívida financia não só o ativo, mas também o prejuízo acumulado.</div>
    <div style="overflow-x:auto;"><table class="simple razonete">
      <thead><tr>
        <th colspan="2">ATIVO <small>o que a empresa tem</small></th>
        <th colspan="2" class="rz-meio">PASSIVO + PATRIMÔNIO <small>de quem é</small></th>
      </tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr>
        <th>TOTAL</th><th class="num">${F(ativo)}</th>
        <th class="rz-meio">TOTAL</th><th class="num">${F(passivo + pl)}</th>
      </tr></tfoot>
    </table></div>
    <div class="sub" style="margin-top:.7rem;">Leitura em uma linha: de cada
      <b>R$ 1,00</b> de ativo, <b>${F(passivo / ativo)}</b> é
      de terceiros. O que passa de R$ 1,00 é o que a empresa deve além de tudo o que
      possui.</div>
  </div>`;
}

function renderBalanco(el) {
  const F = (v) => fmtBRL(v, 2);
  let ativo = 0, passivo = 0;
  const bloco_ = (titulo, grupos, acumula) => {
    let h = '<tr class="dre-secao"><th colspan="3">' + titulo + '</th></tr>';
    Object.keys(grupos).forEach((g) => {
      let sub = 0;
      let linhas = '';
      grupos[g].forEach(([rot, v, fonte]) => {
        sub += v;
        const falta = /^\(/.test(rot);
        linhas += '<tr><th>&nbsp;&nbsp;' + escapeHtml_(rot) + '</th>'
          + '<td class="num">' + (falta && !v ? '&mdash;' : F(v)) + '</td>'
          + '<td class="bal-fonte' + (falta ? ' bal-falta' : '') + '">'
          + escapeHtml_(fonte) + '</td></tr>';
      });
      acumula(sub);
      h += '<tr class="dre-subtotal"><th>' + escapeHtml_(g) + '</th>'
        + '<td class="num">' + F(sub) + '</td><td></td></tr>' + linhas;
    });
    return h;
  };
  const corpoAtivo = bloco_('ATIVO', BALANCO_.ativo, (v) => { ativo += v; });
  const corpoPassivo = bloco_('PASSIVO', BALANCO_.passivo, (v) => { passivo += v; });
  const pl = ativo - passivo;
  const razao = passivo / ativo;
  const trib = 27076.56 + 521.27 + 4580.21;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Balanço Patrimonial</h2>
      <div class="section-desc">O que a empresa <b>é</b> em <b>${BALANCO_.data}</b> — de um lado o que ela tem, do outro o que ela deve. A DRE diz se o mês rendeu; a DFC, para onde o dinheiro foi; este diz se sobra patrimônio.</div>
    </div>
    <p class="dre-nota">Posições de <b>${BALANCO_.data}</b>, lidas de extrato, ficha de
      empréstimo e nota de compra — não somadas de lançamento. O Bling não guarda
      saldo, guarda movimento: as carteiras da Shopee e do Mercado Pago aparecem
      lá com <b>R$ 27,9 mil e R$ 21 mil acima do real</b>, e aqui está o extrato.
      Para atualizar, troque <code>BALANCO_</code> no app.js.</p>
    <p class="dre-nota" style="color:var(--brick);"><b>Contas a pagar e a receber são
      PISO, não saldo exato.</b> O Bling guarda a situação de hoje: conta que estava
      aberta em 31/08 e foi quitada em setembro já aparece baixada e não entra na soma.
      O saldo exato da data exige a data de cada baixa, que fica no borderô. Os dois
      lados estão subestimados, e o de pagar mais que o de receber.</p>

    <div class="kpi-grid" style="margin-bottom:18px;">
      <div class="kpi"><div class="kpi-label">Ativo</div>
        <div class="kpi-value">${F(ativo)}</div>
        <div class="kpi-foot">caixa, estoque e imobilizado</div></div>
      <div class="kpi"><div class="kpi-label">Passivo</div>
        <div class="kpi-value val-out">${F(passivo)}</div>
        <div class="kpi-foot">${Math.round(100 * trib / passivo)}% é dívida tributária</div></div>
      <div class="kpi"><div class="kpi-label">Patrimônio líquido</div>
        <div class="kpi-value ${pl < 0 ? 'val-out' : 'val-in'}">${F(pl)}</div>
        <div class="kpi-foot">dívida ÷ ativo = ${razao.toFixed(1)}x</div></div>
    </div>

    <table class="dre simple">
      <thead><tr><th>conta</th><th class="num">valor</th><th>de onde vem</th></tr></thead>
      <tbody>
        ${corpoAtivo}
        <tr class="dre-subtotal"><th>TOTAL DO ATIVO</th><td class="num">${F(ativo)}</td><td></td></tr>
        ${corpoPassivo}
        <tr class="dre-subtotal"><th>TOTAL DO PASSIVO</th><td class="num">${F(passivo)}</td><td></td></tr>
        <tr class="dre-resultado"><th>PATRIMÔNIO LÍQUIDO</th>
          <td class="num ${pl < 0 ? 'val-out' : 'val-in'}">${F(pl)}</td>
          <td class="bal-fonte">${pl < 0 ? 'a empresa deve mais do que tem' : 'sobra patrimônio'}</td></tr>
      </tbody>
    </table>

    ${razonete_(BALANCO_.ativo, BALANCO_.passivo, ativo, passivo, pl)}

    <div class="bal-leitura">
      <h3>A conta que junta os três demonstrativos</h3>
      <p>O EBITDA de jan a ago é <b>+R$ 12.482</b>, ou <b>R$ 1.560 por mês</b> — a
        operação se paga. O serviço da dívida é <b>R$ 4.677 por mês</b>: três vezes
        isso. A dívida de ${F(passivo)} levaria <b>${Math.round(passivo / 1560)} meses
        de EBITDA</b> para ser quitada, e isso supondo que o resultado financeiro não
        existisse — que é justamente o problema.</p>
      <p>Por isso a estratégia começa aqui e não na DRE: <b>prazo e taxa da dívida</b>,
        e decidir o que fazer com os ${F(BALANCO_.ativo['Estoque'].reduce((s, x) => s + x[1], 0))}
        de estoque, que é o maior ativo da empresa e não paga parcela.</p>
      <p><b>E não conte com o maquinário.</b> São
        ${F(BALANCO_.ativo['Imobilizado'].reduce((s, x) => s + x[1], 0))} de valor
        contábil, e a empresa produz com <b>sete equipamentos que valem zero aqui</b>
        porque foram ganhados — a bordadeira Brother inclusive. O parque de máquinas
        é maior do que esta linha, mas o que se poderia vender é menor do que a
        operação sugere.</p>
      <p class="bal-falta"><b>As duas linhas que faltavam não se cancelaram.</b> Eu
        esperava que contas a receber e contas a pagar tivessem tamanho parecido e o
        patrimônio líquido ficasse onde estava. Medido em 14/09/2026: a receber
        <b>R$ 1.296</b>, a pagar <b>R$ 22.711</b> — 17 para 1. O patrimônio líquido
        saiu de <b>−R$ 56.558</b> para <b>−R$ 79.192</b>.</p>
      <p class="bal-falta">E o formato dessa dívida é diferente do resto: dos
        R$ 22.711, <b>R$ 12.495 são conta que já venceu e não foi paga</b> e
        R$ 10.216 são fatura de cartão de compra de agosto. Não é financiamento com
        prazo e taxa, como o Sicoob; é fornecedor esperando. Não se renegocia em
        planilha, se renegocia por telefone, e vence antes de qualquer plano.</p>
      <p class="bal-falta">A primeira medição desse passivo deu <b>R$ 34.782,74</b>, e
        conferir a composição cortou <b>R$ 17.707,59</b>: eram 21 saques
        Shopee→Nubank em aberto, transferência entre contas próprias que a
        integração antiga deixou pendurada. Passivo medido por "conta em aberto"
        carrega lixo de integração — sem a quebra por categoria, este balanço estaria
        afirmando uma dívida que não existe.</p>
    </div>
  `;
}

function renderDre(el, rows) {
  const temVendas = (VENDAS_ROWS || []).length > 0;
  const competencia = true;   // ver o comentario em DRE_REGIME

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">DRE</h2>
      <div class="section-desc">Tudo pela <b>data do fato</b> — receita e despesa entram no mês em que aconteceram, mesmo que o dinheiro tenha andado em outro. É o regime que responde <b>quanto o mês rendeu</b>.</div>
    </div>
    ${renderFiltroBar_()}
    ${avisoJanela_()}
    <p class="dre-nota">Sempre por <b>competência</b>: cada valor entra no mês em
      que o fato aconteceu, não no mês em que o dinheiro andou. Quanto o caixa
      mexeu está na <b>DFC</b>, logo abaixo.</p>
    <div id="avisoFatura"></div>
    <div id="dreCorpo"></div>
  `;
  ligarFiltroBar_(el);

  /* ver faturaNaoRateada_: entre o vencimento e o rateio manual (~dia 18) a
     fatura inteira fica numa categoria so, e a DRE do mes corrente subestima
     administrativo, comercial e taxas. */
  const fatura = faturaNaoRateada_(rows);
  if (fatura) {
    el.querySelector('#avisoFatura').innerHTML =
      '<div class="alerta warn"><b>Fatura de cartão ainda não rateada.</b> '
      + fatura.n + ' lançamento(s) de <b>' + fmtBRL(Math.abs(fatura.total), 2)
      + '</b> entraram como "Cartão de Crédito" em uma única categoria, vencendo entre '
      + fmtDataBR(fatura.de) + ' e ' + fmtDataBR(fatura.ate) + '. '
      + 'O rateio por categoria é feito à mão depois do vencimento, quando a fatura fecha. '
      + 'Até lá, este valor está todo em compra de insumos: as linhas de '
      + 'administrativo, comercial e taxas deste período estão menores do que serão, '
      + 'e o estoque maior.</div>';
  }

  const corpo = el.querySelector('#dreCorpo');

  /*
   * COMPETÊNCIA vs CAIXA (07/09/2026).
   *
   * Até aqui o botão "Competência" trocava só a RECEITA (pela data do pedido)
   * e deixava despesa e CMV pelo caixa - meio termo que confunde mais do que
   * ajuda: o mês mostrava a venda de julho contra a despesa paga em julho,
   * que é de junho.
   *
   * Agora o regime vale para a DRE inteira, usando a coluna `competencia` que
   * o sync já gravava e o painel ignorava. Refiltra do conjunto completo
   * (FLUXO_ROWS), porque `rows` chegou aqui filtrado pela data de CAIXA - usar
   * ele deixaria de fora justamente a conta cuja competência é deste mês mas
   * o pagamento é de outro.
   *
   * A DFC continua sempre por caixa: ela existe para dizer quanto dinheiro
   * entrou e saiu, e isso não tem versão por competência.
   */
  if (competencia) {
    /* Competência inclui o que AINDA NÃO FOI PAGO — é o ponto inteiro do
       regime. Exigir `r.paga` aqui deixava de fora, em agosto/2026, os
       R$ 4.580,21 de imposto sobre vendas que estavam em aberto: a linha de
       deduções aparecia como R$ 2.937 quando o fato gerador do mês era
       R$ 7.518. Cancelada continua fora, essa não aconteceu mesmo. */
    const rowsComp = (FLUXO_ROWS || [])
      .filter(r => !r.cancelada && r.dateComp >= FILTER.start && r.dateComp <= FILTER.end);
    renderDreCaixa_(corpo, rowsComp, true);
    renderDreCompetenciaVendas_(corpo);
  } else {
    renderDreCaixa_(corpo, rows, false);
  }

  const caixa = document.createElement('div');
  corpo.appendChild(caixa);
  renderDfc_(caixa, rows);
}

/*
 * DFC - para onde o dinheiro foi (07/09/2026).
 *
 * A DRE responde "o negócio deu lucro?". A DFC responde "por que o saldo
 * mexeu isso?" - e as duas quase nunca dão o mesmo número, porque o caixa
 * carrega coisas que a DRE ignora de propósito: retirada de sócio,
 * empréstimo, compra de máquina, transferência entre contas.
 *
 * A separação dentro do "Não Operacional" é feita pela CATEGORIA, porque o
 * grupo joga tudo num balde só. Transferência entre contas próprias fica
 * numa linha à parte e NÃO entra na variação: o dinheiro sai de um portador
 * e entra em outro, o caixa total não muda. Se ela aparecer com valor
 * diferente de zero, é sinal de que só uma perna da transferência está
 * lançada - vale investigar, e por isso a linha aparece mesmo zerada.
 */
/*
 * De que linha da DFC cada grupo da DRE faz parte.
 *
 * "(ignorar na DRE)" e instrucao para a DRE, NAO para a DFC. A DRE ignora
 * essas linhas por bons motivos - a receita passou a vir de _Receita_Pedidos,
 * pela data do pedido, e contar tambem o lancamento do Bling duplicaria a
 * venda. Mas o dinheiro entrou no banco de verdade, e a DFC existe justamente
 * para dizer o que mexeu no caixa.
 *
 * Sem este mapa, tres coisas grandes caiam caladas em "Outros" ou sumiam:
 *   - a receita recebida (o grupo virou "Venda ja contada pelo pedido
 *     (ignorar na DRE)"), que fez "Recebi no periodo (caixa)" mostrar R$ 0 num mes com
 *     R$ 56.860 de venda, e deixou a DFC sem linha de recebimento;
 *   - "Despesas Variaveis de Venda", que nem estava previsto aqui - R$ 14.676
 *     de taxa de marketplace e frete em agosto/2026;
 *   - a compra de tecido e aviamento ("Estoque"), R$ 16.815 no mesmo mes.
 *
 * Compra de estoque fica em OPERACIONAL, nao em investimento: materia prima
 * nao e imobilizado, o dinheiro dela e giro.
 */
const DFC_POR_GRUPO = {
  'Receita Bruta':                          'receb',
  'Venda já contada pelo pedido (ignorar na DRE)':   'receb',
  'Deduções da Receita':                    'deducoes',
  'Desconto de vitrine (ignorar na DRE)':   'desconto',
  'CMV':                                    'fornec',
  'Estoque (ignorar na DRE)':               'estoque',
  'Despesas Variáveis de Venda':            'variaveis',
  'Despesas com Pessoal':                   'pessoal',
  'Despesas Administrativas':               'admin',
  'Despesas Comerciais':                    'comercial',
  'Impostos sobre o Lucro':                 'impostos',
  'Resultado Financeiro':                   'financeiro',
  // divisao de lucro com o dono da marca dos fechos. No CAIXA e saida
  // operacional como qualquer outra - o tratamento especial dela e so na DRE,
  // onde fica abaixo do EBITDA.
  'Participação de Parceiros':              'admin',
  // amortização é saída de financiamento: paga dívida, não custeia a operação
  'Amortização de Dívida (ignorar na DRE)': 'financeiro',
  // imposto pago é saída operacional no caixa, mesmo estando fora da DRE
  'Imposto pago (ignorar na DRE)':          'impostos'
};

/* Grupos que sao dinheiro de VENDA entrando no caixa. Usado tambem pelo
   comparativo Caixa x Competencia, que sem isso responde sempre R$ 0. */
const GRUPOS_RECEBIMENTO_ = ['Receita Bruta', 'Venda já contada pelo pedido (ignorar na DRE)'];

let DFC_POR_GRUPO_CANON = null;   // lazy: comparacao sem acento e sem caixa
function dfcChaveDoGrupo_(g) {
  if (!DFC_POR_GRUPO_CANON) {
    DFC_POR_GRUPO_CANON = {};
    Object.keys(DFC_POR_GRUPO).forEach(k => { DFC_POR_GRUPO_CANON[chaveGrupo_(k)] = DFC_POR_GRUPO[k]; });
  }
  return DFC_POR_GRUPO_CANON[chaveGrupo_(g)] || null;
}

const DFC_REGRAS = [
  { chave: 'transf',      teste: /transfer/i },
  { chave: 'emprestimo',  teste: /empr[ée]stimo|financiamento/i },
  { chave: 'retirada',    teste: /retirada|pr[óo]-?labore|s[óo]cio|compra pessoal/i },
  { chave: 'investimento',teste: /m[áa]quina|equipamento|imobilizado|m[óo]vel/i }
];

function renderDfc_(el, rows) {
  if (!rows.length) { el.innerHTML = ''; return; }

  const serie = serieTemporal_(rows, FILTER.start, FILTER.end);
  const val = (r) => (r.tipo === 'entrada' ? 1 : -1) * r.valor;

  // classifica cada lançamento numa atividade da DFC
  const classificar = (r) => {
    const porGrupo = dfcChaveDoGrupo_(r.grupoDRE);
    if (porGrupo) return porGrupo;
    // sem grupo conhecido, decide pela categoria (transferencia, socio, etc.)
    const cat = r.categoria || '';
    for (const regra of DFC_REGRAS) if (regra.teste.test(cat)) return regra.chave;
    return 'outros';
  };

  const somaPorColuna = (chave) => serie.map(b =>
    b.rows.reduce((s, r) => s + (classificar(r) === chave ? val(r) : 0), 0));
  const tot = (v) => v.reduce((a, b) => a + b, 0);

  const LINHAS = [
    { s: 'ATIVIDADES OPERACIONAIS' },
    { k: 'receb',     n: 'Recebimento de vendas' },
    { k: 'deducoes',  n: 'Impostos sobre vendas, devoluções e descontos' },
    { k: 'desconto',  n: 'Descontos de vitrine' },
    { k: 'variaveis', n: 'Taxas de marketplace e frete' },
    { k: 'fornec',    n: 'Fornecedores, tecido e facção' },
    { k: 'estoque',   n: 'Compra de estoque (tecido e aviamento)' },
    { k: 'pessoal',   n: 'Pessoal' },
    { k: 'admin',     n: 'Administrativas' },
    { k: 'comercial', n: 'Comerciais' },
    { k: 'impostos',  n: 'Impostos' },
    { k: 'outros',    n: 'Outros' },
    { sub: 'Caixa gerado pela operação',
      soma: ['receb','deducoes','desconto','variaveis','fornec','estoque','pessoal','admin','comercial','impostos','outros'] },

    { s: 'INVESTIMENTO' },
    { k: 'investimento', n: 'Máquinas e equipamentos' },

    { s: 'FINANCIAMENTO' },
    { k: 'financeiro',  n: 'Juros, tarifas e antecipação' },
    { k: 'emprestimo',  n: 'Empréstimos' },
    { k: 'retirada',    n: 'Retiradas dos sócios' },
    { sub: 'Caixa de investimento e financiamento',
      soma: ['investimento','financeiro','emprestimo','retirada'] },

    { res: 'VARIAÇÃO DE CAIXA NO PERÍODO',
      soma: ['receb','deducoes','desconto','variaveis','fornec','estoque','pessoal','admin','comercial','impostos','outros',
             'investimento','financeiro','emprestimo','retirada'] }
  ];

  let html = '<tr><th>Movimento</th>' + serie.map(b => `<th>${b.label}</th>`).join('') + '<th>Total</th></tr>';
  LINHAS.forEach(l => {
    if (l.s) { html += `<tr class="dre-secao"><th colspan="${serie.length + 2}">${l.s}</th></tr>`; return; }
    const vals = l.k ? somaPorColuna(l.k)
                     : serie.map((_, i) => l.soma.reduce((s, k) => s + somaPorColuna(k)[i], 0));
    const total = tot(vals);
    if (l.k && total === 0 && !vals.some(v => v !== 0)) return;
    const cls = l.res ? 'dre-resultado' : l.sub ? 'dre-subtotal' : '';
    const nome = l.k ? `<td>${l.n}</td>` : `<th>${l.sub || l.res}</th>`;
    const cel = l.k ? `<td class="num"><b>${fmtBRL(total, 2)}</b></td>`
                    : `<th class="num ${total < 0 ? 'val-out' : 'val-in'}">${fmtBRL(total, 2)}</th>`;
    html += `<tr class="${cls}">${nome}` + vals.map(v => `<td class="num">${fmtBRL(v, 2)}</td>`).join('') + cel + '</tr>';
  });

  const transf = somaPorColuna('transf');
  const totTransf = tot(transf);
  const variacao = tot(serie.map((_, i) =>
    ['receb','deducoes','desconto','variaveis','fornec','estoque','pessoal','admin','comercial','impostos','outros',
     'investimento','financeiro','emprestimo','retirada'].reduce((s, k) => s + somaPorColuna(k)[i], 0)));

  const nota = Math.abs(totTransf) < 0.01
    ? 'Transferências entre contas somam zero no período, como esperado — cada saída teve sua entrada.'
    : `<b>Atenção:</b> transferências entre contas somam ${fmtBRL(totTransf, 2)} em vez de zero.
       Isso significa que alguma transferência está com só uma perna lançada.`;

  /* "Outros" e o balde de quem nao casou com nenhum grupo nem com nenhuma
     regra de categoria. Balde grande nao e categoria residual, e classificacao
     faltando - foi assim que a receita recebida ficou escondida ali por dois
     dias sem ninguem ver. Acima de 10% do movimento, a tela avisa. */
  const movimento = tot(somaPorColuna('receb').map(Math.abs))
    + ['deducoes','desconto','variaveis','fornec','estoque','pessoal','admin','comercial',
       'impostos','outros','investimento','financeiro','emprestimo','retirada']
      .reduce((soma, k) => soma + tot(somaPorColuna(k).map(Math.abs)), 0);
  const emOutros = Math.abs(tot(somaPorColuna('outros')));
  const notaOutros = (movimento > 0 && emOutros / movimento > 0.10)
    ? `<br><b>Olho aqui:</b> ${fmtBRL(emOutros, 2)} caíram em "Outros"
       (${fmtPctSimples_(emOutros / movimento)} do movimento do período). Isso é grupo
       ou categoria faltando no <code>_DRE_Mapa</code>, não uma sobra natural — enquanto
       estiver ali, o dinheiro aparece no total mas não se explica.`
    : '';

  el.innerHTML = `<div class="panel"><h3>DFC — para onde o dinheiro foi</h3>
    <div class="sub">A DRE diz se o negócio deu lucro. A DFC diz por que o saldo mexeu:
    ela inclui o que a DRE ignora de propósito (retirada, empréstimo, compra de máquina).</div>
    <div style="overflow-x:auto;"><table class="simple dre" id="tblDfc"></table></div>
    <div class="sub" style="margin-top:.6rem;">
      No período o caixa ${variacao >= 0 ? 'cresceu' : 'encolheu'}
      <b>${fmtBRL(Math.abs(variacao), 2)}</b>. ${nota}${notaOutros}</div></div>`;
  document.getElementById('tblDfc').innerHTML = html;
}

/*
 * ESTRUTURA DA DRE (reescrita em 07/09/2026).
 *
 * Antes isto era `[...new Set(rows.map(r => r.grupoDRE))]`: a tela listava os
 * grupos na ordem em que apareciam nos dados e parava aí. Sem subtotal, sem
 * resultado, e com "Não Operacional (ignorar na DRE)" somado no meio como se
 * fosse despesa - o próprio nome mandava ignorar. Para saber se o mês deu
 * lucro, era preciso somar de cabeça.
 *
 * Agora a ordem é contábil e fixa, com os subtotais que fazem a DRE ser
 * legível: Receita Líquida, Lucro Bruto, Resultado Operacional e o Resultado
 * Líquido no fim.
 *
 * SINAL: no fluxo, entrada é positiva e saída é negativa, então cada subtotal
 * é uma SOMA simples dos grupos que o compõem - não subtrair de novo, senão o
 * sinal inverte.
 */
/*
 * Estrutura revisada em 08/09/2026. Duas mudanças, as duas para o mesmo fim:
 * fazer a MARGEM DE CONTRIBUIÇÃO existir.
 *
 * 1. "Despesas Variáveis de Venda" é grupo novo. Taxa de marketplace e frete
 *    saíram das deduções da receita, onde não são dedução nenhuma: taxa de
 *    canal é custo de vender, some abaixo do lucro bruto. Em agosto/2026 a
 *    linha de deduções chegava a 64% da receita por causa disso somado ao
 *    desconto de vitrine — número que não existe em varejo nenhum.
 *
 * 2. "Resultado Operacional" virou EBITDA, que é o nome do que ele calcula.
 *
 * A margem de contribuição é o número que decide preço, desconto e mix de
 * canal; sem ela a DRE respondia "deu lucro?" e nunca "quanto sobra de cada
 * venda para pagar a estrutura?".
 */
const CUSTO_FIXO_GRUPOS = ['Despesas Comerciais', 'Despesas Administrativas', 'Despesas com Pessoal'];
/* A provisão de imposto sobre venda sem nota entra em LINHA PRÓPRIA, logo
   abaixo das Deduções, e não somada dentro delas: ela é estimativa, e
   estimativa misturada com número de guia deixa de ser auditável. Em linha
   separada dá para ver as duas e discordar de uma. A medição do gap entre a
   receita do painel e a declarada está em GRUPO_PROVISAO_IMPOSTO_, no
   BlingSync.gs. */
const GRUPO_PROVISAO = 'Provisão de Imposto (venda sem nota)';
/* O imposto do Simples vem da GUIA, por competência, e não das contas pagas —
   ver DAS_POR_COMPETENCIA_ em BlingSync.gs. Fica em linha própria, separado das
   Deduções (que são devolução e desconto) e da provisão do site (que é
   estimativa sobre venda sem nota). Três naturezas, três linhas. */
const GRUPO_IMPOSTO = 'Imposto do Simples (competência)';
const DEDUZ = ['Deduções da Receita', GRUPO_IMPOSTO, GRUPO_PROVISAO];
const ATE_MC = ['Receita Bruta'].concat(DEDUZ, ['CMV', 'Despesas Variáveis de Venda']);
/*
 * DEPRECIACAO DO IMOBILIZADO: R$ 393,75/mes.
 *
 * POR QUE A LINHA EXISTE: a DRE ia do EBITDA direto para o Resultado
 * Financeiro, e a ultima linha se chamava "Resultado Liquido" sem ser - ela
 * pulava o desgaste de R$ 36.850 de maquina e computador. EBITDA exclui
 * depreciacao por definicao e esta certo; o RESULTADO nao pode.
 *
 *     maquinas e equipamentos   R$ 17.950 x 10% a.a. / 12  =  R$ 149,58
 *     informatica               R$ 10.400 x 20% a.a. / 12  =  R$ 173,33
 *                                                             ----------
 *                                                             R$ 322,92
 *
 * Taxas da Receita: maquinas e moveis 10 anos, informatica e veiculos 5 anos.
 *
 * NAO E UM TETO - e o valor exato, e isso foi CONFERIDO item por item em
 * 14/09/2026. A duvida era se algum bem ja tinha completado a vida util (bem
 * quitado nao deprecia mais), e a resposta e que nenhum completou:
 *
 *   maquinas, 10 anos: as mais velhas sao de 2020 (Janome, Cameo 4 e as duas
 *     prensas) e terminam em 2030.
 *   informatica, 5 anos: Lenovo IdeaPad 2022 (termina 2027), Epson L805 2023,
 *     Elgin L42Pro 2024, Acer Aspire 5 2025. A mais velha ainda tem prazo.
 *
 * VALIDACAO: reconstruindo item por item, a depreciacao acumulada fechou com a
 * do balanco por 0,4% de diferenca (R$ 25.625 contra R$ 25.514,58), explicada
 * por eu ter assumido janeiro nos itens em que so se sabe o ano. Duas fontes
 * independentes chegando no mesmo lugar e o que autorizou tirar a ressalva de
 * "estimativa". Os dois numeros mudaram depois que a bordadeira saiu (abaixo),
 * mas a conferencia foi feita antes e vale para o metodo.
 *
 * NAO ENTRAM, e os motivos sao diferentes:
 *   GANHADA - custo zero, nao ha o que depreciar: bordadeira Brother BP2150L,
 *     reta industrial Singer, overlock, Cameo 1, impressora Brother, notebook
 *     LG, filtro Electrolux. A bordadeira saiu em 14/09/2026, quando a Karolyne
 *     esclareceu que foi ganhada USADA - os R$ 8.500 que ela havia citado eram
 *     quanto a maquina VALE, nao quanto custou. Bem doado nao gera despesa
 *     porque nao houve desembolso: o que se desgasta ali nunca foi dinheiro da
 *     empresa. Era o maior item do imobilizado, 32% do custo das maquinas.
 *   BEM DE SOCIO, nao da PJ: o Lenovo mais antigo e da casa da Karolyne.
 *
 * Consumivel tambem nao entra: da impressora Brother a empresa so compra toner,
 * que e despesa do mes e nao imobilizado.
 *
 * CUIDADO AO LER ESTA LINHA EM DECISAO: a empresa OPERA com mais maquina do que
 * tem no balanco - sete equipamentos produzem e valem zero aqui. Esta certo em
 * contabilidade e e armadilha em conversa de divida: nao da para contar com
 * "vender o imobilizado" olhando este numero.
 *
 * QUANDO REVISAR: 2027, quando o Lenovo IdeaPad termina - e a cada compra de
 * maquina ou computador.
 *
 * Nao vem do Fluxo de Caixa porque nao E lancamento: depreciacao nao move
 * dinheiro. Por isso tambem nao aparece na DFC.
 */
const DEPRECIACAO_MENSAL_ = 149.58 + 173.33;
const GRUPO_DEPRECIACAO = 'Depreciação';

const DRE_ESTRUTURA = [
  { tipo: 'grupo',    nome: 'Receita Bruta' },
  { tipo: 'grupo',    nome: 'Deduções da Receita' },
  { tipo: 'grupo',    nome: GRUPO_IMPOSTO },
  { tipo: 'grupo',    nome: GRUPO_PROVISAO },
  { tipo: 'subtotal', nome: 'Receita Líquida',
    soma: ['Receita Bruta'].concat(DEDUZ) },
  { tipo: 'grupo',    nome: 'CMV' },
  { tipo: 'subtotal', nome: 'Lucro Bruto',
    soma: ['Receita Bruta'].concat(DEDUZ, ['CMV']) },
  { tipo: 'grupo',    nome: 'Despesas Variáveis de Venda' },
  { tipo: 'subtotal', nome: 'Margem de Contribuição', soma: ATE_MC },
  { tipo: 'grupo',    nome: 'Despesas Comerciais' },
  { tipo: 'grupo',    nome: 'Despesas Administrativas' },
  { tipo: 'grupo',    nome: 'Despesas com Pessoal' },
  { tipo: 'subtotal', nome: 'EBITDA', soma: ATE_MC.concat(CUSTO_FIXO_GRUPOS) },
  // ABAIXO do EBITDA porque o "DA" do EBITDA e exatamente isto. Acima dele a
  // sigla deixaria de significar o que significa.
  { tipo: 'grupo',    nome: GRUPO_DEPRECIACAO },
  { tipo: 'grupo',    nome: 'Resultado Financeiro' },
  { tipo: 'grupo',    nome: 'Impostos sobre o Lucro' },
  // Abaixo do EBITDA de proposito: so existe porque houve lucro. Se subisse
  // para o custo fixo, o ponto de equilibrio exigiria volume para cobrir uma
  // conta que so nasce depois de o volume existir.
  { tipo: 'grupo',    nome: 'Participação de Parceiros' },
  { tipo: 'resultado', nome: 'Resultado Líquido',
    soma: ATE_MC.concat(CUSTO_FIXO_GRUPOS,
      [GRUPO_DEPRECIACAO, 'Resultado Financeiro', 'Impostos sobre o Lucro',
       'Participação de Parceiros']) }
];

/* Ficam FORA do resultado, mostrados à parte para não sumirem calados. */
/*
 * Ficam FORA do resultado, mas aparecem numa tabela à parte — nunca somem
 * calados. Os três grupos novos (08/09/2026) saíram da DRE por motivos
 * diferentes, e cada um vale ser visto:
 *   Estoque              compra de tecido e facção. Não é custo do mês; é ativo
 *                        até a peça sair. O custo entra pelo CMV por consumo.
 *   Venda ja contada     a conta a receber deixou de ser fonte de receita; a
 *   pelo pedido          receita vem da aba _Receita_Pedidos, pelo pedido.
 *   Desconto de vitrine  o preço de lista da Shopee é inflado para a plataforma
 *                        exibir o "de/por" (37,3% contra 0,1% no ML). Como a
 *                        receita já entra a preço praticado, o desconto não é
 *                        dedução de nada.
 */
/* Grupos que NAO entram no lucro. "Cartao a ratear" e o mais novo, e existe por
   um motivo de processo: a fatura de cartao entra no Bling como um lancamento
   generico no vencimento, e o rateio por categoria e feito a mao por volta do
   dia 18, quando a fatura fecha e o extrato existe. Antes disso o valor caia em
   "Compra de insumos e materia prima" - a maior categoria do cartao, 71% do
   gasto anual - e a DRE do mes corrente ficava ERRADA em silencio. Numa
   categoria propria, fora do resultado, ela fica INCOMPLETA e visivel: o valor
   aparece aqui cobrando o rateio. */
const DRE_FORA = ['Não Operacional (ignorar na DRE)', 'Estoque (ignorar na DRE)',
                  'Venda já contada pelo pedido (ignorar na DRE)',
                  'Desconto de vitrine (ignorar na DRE)',
                  'Cartão a ratear (ignorar na DRE)',
                  /* A parte da parcela do Sicoob que abate a dívida. Sai do
                     resultado porque não é despesa (é troca de patrimônio),
                     mas aparece aqui porque É saída de caixa: em agosto/2026
                     foram R$ 1.734,24, mais da metade da parcela. Quem olha só
                     a DRE não vê esse dinheiro sair. Ver Emprestimos.gs. */
                  'Amortização de Dívida (ignorar na DRE)',
                  /* O DAS e as parcelas de parcelamento efetivamente PAGOS. Saem
                     do resultado porque o imposto do mês já entra pela guia, na
                     competência — contar os dois seria contar duas vezes. Mas
                     aparecem aqui porque É saída de caixa. */
                  'Imposto pago (ignorar na DRE)',
                  '(sem mapear)'];

/*
 * POR QUE CADA GRUPO FICA FORA DO RESULTADO.
 *
 * A tela mostrava "Fora do resultado" com oito linhas e uma explicacao unica no
 * topo. Quem olha nao tem como saber por que a VENDA aparece fora do resultado,
 * e se isso e ou nao receita escondida. Cada linha passa a carregar o proprio
 * motivo, escrito para quem nao montou a planilha.
 *
 * A chave e o nome do grupo sem acento e em minuscula (chaveGrupo_), porque o
 * nome e digitado a mao na aba _DRE_Mapa e ja apareceu escrito das duas formas.
 * Grupo que chegar aqui sem motivo aparece em vermelho na tela: e pendencia de
 * mapeamento, nao decisao contabil, e tem de incomodar.
 */
const MOTIVO_FORA = {};
[
  ['Venda já contada pelo pedido (ignorar na DRE)',
   'A receita da DRE vem da aba <code>_Receita_Pedidos</code>, pela data do pedido e pelo preço '
   + 'praticado. A conta a receber que a integração cria para a MESMA venda fica aqui para a '
   + 'venda não ser contada duas vezes.'],
  ['Desconto de vitrine (ignorar na DRE)',
   'A receita já entra líquida de desconto. Deduzir o desconto outra vez seria contar o mesmo '
   + 'abatimento duas vezes.'],
  ['Estoque (ignorar na DRE)',
   'Compra de tecido e de aviamento é ESTOQUE: vira ativo e só se torna custo quando a peça é '
   + 'vendida — aí entra como CMV, pela ficha técnica. Enquanto isto ficava no resultado, julho '
   + 'fechou com R$ 186 de CMV e agosto com R$ 16.815, sem nada mudar no negócio.'],
  ['Imposto pago (ignorar na DRE)',
   'O DAS e as parcelas do parcelamento efetivamente PAGOS. O imposto do resultado vem da GUIA, '
   + 'na competência da apuração — contar os dois seria contar duas vezes. Fica listado aqui '
   + 'porque É saída de caixa.'],
  ['Amortização de Dívida (ignorar na DRE)',
   'A parte da parcela do Sicoob que abate a dívida. Não é despesa, é troca de patrimônio: sai '
   + 'dinheiro e cai o passivo — só o juro é despesa. Em agosto/2026 foram R$ 1.734,24 de '
   + 'amortização. Fica listado aqui porque É saída de caixa.'],
  ['Cartão a ratear (ignorar na DRE)',
   'Fatura de cartão que entrou no Bling como um lançamento só e ainda não foi rateada por '
   + 'categoria. Antes desta categoria ela caía inteira em insumos e a DRE do mês ficava errada '
   + 'calada. O valor aqui está COBRANDO o rateio — feito o rateio, sai desta linha.'],
  ['Não Operacional (ignorar na DRE)',
   'Transferência entre contas próprias, aporte e retirada de sócio, empréstimo e compra de '
   + 'máquina. Mexe no caixa e no balanço, não no resultado da operação. Se as transferências '
   + 'não somarem perto de zero, alguma está lançada com uma perna só.'],
  ['(sem mapear)',
   'Categoria sem grupo na aba <code>_DRE_Mapa</code> — a que aponta para cá é '
   + '"A Classificar (revisar)". NÃO é decisão, é PENDÊNCIA: rode <code>listarSemMapear</code> '
   + 'no Apps Script para ver quais lançamentos são e classifique-os no Bling. Enquanto '
   + 'estiverem aqui, esse dinheiro não aparece em nenhuma linha da DRE.']
].forEach(function (par) { MOTIVO_FORA[chaveGrupo_(par[0])] = par[1]; });

/*
 * A tabela da DRE. `porCompetencia` só muda a data usada para distribuir nas
 * colunas — a estrutura contábil é a mesma nos dois regimes.
 */
function renderDreCaixa_(corpo, rows, porCompetencia) {
  if (!rows.length) { corpo.innerHTML = '<div class="state-msg">Sem lançamentos nesse período.</div>'; return; }

  /* Receita e CMV vêm das abas _Receita_Pedidos e _CMV_Consumo quando elas
     existem, e não mais das contas a receber/pagar. Motivo medido em
     agosto/2026: a conta a receber só nasce quando o marketplace LIBERA o
     dinheiro, e cada espelho grava numa base diferente (Shopee a preço de
     lista, ML a preço praticado), com a integração do Bling lançando por cima
     — as contas somavam R$ 64.929 para uma venda real de R$ 56.860. E compra
     de tecido é ESTOQUE, não custo do que foi vendido: enquanto ela fazia o
     CMV, julho fechou com R$ 186 e agosto com R$ 16.815, uma oscilação de
     R$ 57 mil de resultado sem nada ter mudado no negócio.
     As categorias correspondentes viraram "(ignorar na DRE)" no _DRE_Mapa,
     então não há risco de contar duas vezes. */
  /* As DUAS fontes precisam ter dado. Exigir só a receita deixa um buraco
     real: se _Receita_Pedidos estiver preenchida e _CMV_Consumo vazia, a
     receita vem da fonte nova e o CMV é sobrescrito por ZERO — lucro bruto
     inflado, pior do que a versão antiga. Aconteceu em 09/09/2026, quando o
     script de carga falhou no meio e escreveu só a primeira aba. */
  /* Receita e CMV continuam sendo os dois obrigatórios: sem eles a fonte
     externa não vale. Imposto e provisão podem vir vazios sem invalidar nada -
     um mês sem guia lançada simplesmente não tem imposto ainda. */
  const fontes = (DRE_FONTES && (DRE_FONTES.receita || []).length
                              && (DRE_FONTES.cmv || []).length) ? DRE_FONTES : null;
  const serie = serieTemporal_(rows, FILTER.start, FILTER.end,
                               porCompetencia ? 'dateComp' : 'date', !!fontes);
  const porColuna = serie.map(b => agregarPorGrupo_(b.rows));
  if (fontes) {
    const soma = (lista, mes) => (lista || [])
      .filter(r => r.mes === mes)
      .reduce((s, r) => s + Math.abs(Number(r.valor) || 0), 0);
    serie.forEach((b, i) => {
      porColuna[i]['Receita Bruta'] = soma(fontes.receita, b.chave);
      porColuna[i]['CMV'] = -soma(fontes.cmv, b.chave);
      /* Imposto e provisão também vêm de fora, pelo mesmo motivo da receita:
         a categoria "Impostos sobre vendas" saiu da DRE (ver GRUPO_CANONICO_)
         porque misturava DAS de outro mês, parcela de parcelamento e uma
         provisão sem guia. O imposto certo vem da GUIA, por competência.
         Sem estas duas linhas a tela mostra Deduções só com devolução e
         esquece o imposto inteiro. */
      porColuna[i][GRUPO_IMPOSTO] = -soma(fontes.imposto, b.chave);
      porColuna[i][GRUPO_PROVISAO] = -soma(fontes.provisao, b.chave);
    });
  }
  /* DEPRECIACAO fora do `if (fontes)`: ela nao depende de aba nem do Web App,
     e por isso NAO desaparece quando a implantacao esta velha. Foi de proposito
     - a linha que dependia do backend e a que sumiu calada hoje.
     So entra em coluna MENSAL: numa coluna de um dia, um mes de depreciacao
     daria um resultado diario absurdo. */
  if (serie.length && /^\d{4}-\d{2}$/.test(String(serie[0].chave))) {
    serie.forEach((b, i) => { porColuna[i][GRUPO_DEPRECIACAO] = -DEPRECIACAO_MENSAL_; });
  }
  const nCols = serie.length;

  const valoresDe = (nome) => porColuna.map(pg => pg[nome] || 0);
  const somaDe = (nomes) => porColuna.map(pg => nomes.reduce((s, n) => s + (pg[n] || 0), 0));
  const totalDe = (vals) => vals.reduce((a, b) => a + b, 0);

  // receita bruta por coluna: base do percentual de análise vertical
  const receita = valoresDe('Receita Bruta');
  const receitaTotal = totalDe(receita);
  const pct = (v) => receitaTotal ? (v / receitaTotal) : 0;

  let html = '<tr><th>Grupo</th>' + serie.map(b => `<th>${b.label}</th>`).join('')
           + '<th>Total</th><th>% receita</th></tr>';

  DRE_ESTRUTURA.forEach((item, i) => {
    const vals = item.tipo === 'grupo' ? valoresDe(item.nome) : somaDe(item.soma);
    const total = totalDe(vals);
    // grupo que não existe no período não polui a tela; subtotal sempre aparece
    if (item.tipo === 'grupo' && total === 0 && !vals.some(v => v !== 0)) return;

    const cls = item.tipo === 'resultado' ? 'dre-resultado'
              : item.tipo === 'subtotal' ? 'dre-subtotal' : '';
    const sinal = total < 0 ? 'val-out' : 'val-in';
    const celTotal = item.tipo === 'grupo'
      ? `<td class="num"><b>${fmtBRL(total, 2)}</b></td>`
      : `<th class="num ${sinal}">${fmtBRL(total, 2)}</th>`;
    const nome = item.tipo === 'grupo' ? `<td>${item.nome}</td>` : `<th>${item.nome}</th>`;

    /* Na linha do RESULTADO cada mês ganha cor própria: prejuízo em vermelho,
       lucro em verde. Antes só a célula do total era colorida, e a pergunta "que
       mês deu prejuízo?" obrigava a ler oito números procurando o sinal de menos.
       Só na linha do resultado: colorir subtotal e grupo também tiraria o
       significado da cor. O CSS já existe (table.dre tr.dre-resultado .val-out,
       em style.css) - o que faltava era a classe chegar na célula do mês. */
    const corMes = (v) => item.tipo === 'resultado'
      ? (v < 0 ? ' val-out' : v > 0 ? ' val-in' : '')
      : '';
    html += `<tr class="${cls} dre-abre" data-item="${i}" title="Clique para ver o que tem dentro">${nome}`
          + vals.map(v => `<td class="num${corMes(v)}">${fmtBRL(v, 2)}</td>`).join('')
          + celTotal
          + `<td class="num">${fmtPctSimples_(pct(total))}</td></tr>`;
  });

  // grupos que existem nos dados mas não estão na estrutura: mostrar, nunca sumir
  const conhecidos = new Set(DRE_ESTRUTURA.filter(i => i.tipo === 'grupo').map(i => i.nome));
  const extras = [...new Set(rows.map(r => r.grupoDRE))]
    .filter(g => !conhecidos.has(g) && !DRE_FORA.includes(g));

  const fora = DRE_FORA.concat(extras).filter(g => {
    const v = valoresDe(g);
    return v.some(x => x !== 0);
  });

  let htmlFora = '';
  if (fora.length) {
    htmlFora = '<tr><th>Fora do resultado</th>' + serie.map(b => `<th>${b.label}</th>`).join('')
             + '<th>Total</th><th>por que não entra</th></tr>';
    fora.forEach(g => {
      const vals = valoresDe(g);
      const motivo = MOTIVO_FORA[chaveGrupo_(g)];
      htmlFora += `<tr><td>${g}</td>`
               + vals.map(v => `<td class="num">${fmtBRL(v, 2)}</td>`).join('')
               + `<td class="num"><b>${fmtBRL(totalDe(vals), 2)}</b></td>`
               + `<td class="fora-motivo${motivo ? '' : ' fora-semmotivo'}">`
               + (motivo || 'Grupo novo, sem motivo cadastrado — decida se entra na DRE_ESTRUTURA '
                          + 'ou cadastre o motivo em MOTIVO_FORA.')
               + '</td></tr>';
    });
  }

  const resultado = totalDe(somaDe(DRE_ESTRUTURA[DRE_ESTRUTURA.length - 1].soma));
  const veredito = resultado >= 0
    ? `Sobrou <b>${fmtBRL(resultado, 2)}</b> no período — ${fmtPctSimples_(pct(resultado))} do faturamento.`
    : `Faltou <b>${fmtBRL(Math.abs(resultado), 2)}</b> no período — as saídas passaram as entradas.`;

  /* AVISO DE IMPLANTACAO VELHA. O imposto da DRE nao e lancamento: vem do
     getDreFontes_, pelo Web App. Se a implantacao for anterior a 14/09/2026 o
     campo chega vazio, a linha soma zero e a DRE ESCONDE o grupo - foi assim
     que o ano apareceu com -R$ 104,82 de imposto em vez de -R$ 24.933.
     Zero escondido parece tela certa; este aviso torna o defeito visivel. */
  /* O aviso NAO chuta mais a causa. A primeira versao dizia "republique" e
     estava errada: o carimbo chegou certo na tela, provando que a implantacao
     estava boa. Acusar a causa errada custa mais tempo que nao acusar nenhuma -
     a pessoa vai republicar de novo e voltar ao mesmo lugar. Agora o aviso diz
     o FATO (o imposto nao chegou), mostra a medicao do backend e deixa a
     interpretacao para quem sabe ler `das=` e `imp=`. */
  const semImposto = !(fontes && (fontes.imposto || []).length);
  const avisoBackend = semImposto
    ? `<p class="dre-nota" style="color:var(--brick);"><b>O imposto não está
       chegando nesta tela</b> — o resultado abaixo está <b>melhor que o real</b>
       em cerca de R$ 4,4 mil por mês. Medição do backend:
       <code>${escapeHtml_(BACKEND_VERSAO)}</code>. Leia assim:
       <code>das=UNDEF</code> a tabela de guias não existe no projeto implantado;
       <code>das=13 imp=0</code> ela existe e o valor não sai do
       <code>getDreFontes_</code>; <code>imp=13</code> o problema está nesta
       tela, não no backend. Tela <code>${PAINEL_VERSAO}</code>.</p>`
    : `<p class="dre-nota" style="font-size:11px;">backend
       <code>${escapeHtml_(BACKEND_VERSAO)}</code> · tela
       <code>${PAINEL_VERSAO}</code></p>`;

  corpo.innerHTML = `<div class="panel"><h3>DRE do período</h3>
    ${avisoBackend}
    <div style="overflow-x:auto;"><table class="simple dre" id="tblDre"></table></div>
    <div class="sub" style="margin-top:.6rem;">${veredito}</div></div>`
    + (htmlFora ? `<div class="panel"><h3>Fora do resultado</h3>
    <div class="sub">Mexem no caixa mas não no resultado, e cada linha diz por quê.
    Quase todas estão fora <b>de propósito</b> — evitam contar a mesma coisa duas vezes
    ou separam caixa de resultado. A exceção é <b>(sem mapear)</b>, que é pendência e
    não decisão: o que estiver ali não aparece em nenhuma linha da DRE.</div>
    <div style="overflow-x:auto;"><table class="simple" id="tblDreFora"></table></div></div>` : '');

  document.getElementById('tblDre').innerHTML = html;
  if (htmlFora) document.getElementById('tblDreFora').innerHTML = htmlFora;

  /* CONTEXTO DA GAVETA. Guardado num objeto de modulo e nao passado por
     parametro porque o clique acontece depois do render, quando `rows`,
     `serie` e `fontes` ja sairam de escopo. Redesenhar a DRE troca o contexto
     inteiro, entao a gaveta nunca mostra numero de um periodo com rotulo de
     outro - foi esse o acidente de 09/09/2026 com a corrida de renderizacao. */
  /* Fecha antes de trocar o contexto: gaveta aberta de um render anterior
     mostraria numero de um periodo com rotulo de outro. */
  fecharGaveta_();
  DRILL = { rows: rows, fontes: fontes, porCompetencia: !!porCompetencia,
            porColuna: porColuna, serie: serie };
  const tbl = document.getElementById('tblDre');
  tbl.querySelectorAll('tr.dre-abre').forEach(function (tr) {
    tr.addEventListener('click', function () {
      abrirGaveta_(DRE_ESTRUTURA[Number(tr.dataset.item)]);
    });
  });
}

let DRILL = null;

/*
 * A GAVETA: clicar numa linha da DRE mostra o que tem dentro dela.
 *
 * POR QUE: a DRE responde "quanto" e nunca "o que". A Karolyne perguntou o que
 * era o Resultado Financeiro de -R$ 6.256,15, e a unica resposta possivel era
 * eu abrir a planilha e contar. Numero que nao se abre obriga a confiar, e
 * confiar e o que este painel passou o dia perdendo o direito de pedir.
 *
 * TRES TIPOS DE LINHA, tres respostas diferentes:
 *   grupo alimentado por LANCAMENTO -> as categorias dentro dele, e os maiores
 *     lancamentos com data, quem e descricao.
 *   grupo alimentado por FONTE EXTERNA (receita, CMV, imposto, provisao) ->
 *     quebra por canal ou por competencia, porque nao existe lancamento.
 *   subtotal e resultado -> a COMPOSICAO: quais linhas entram e com quanto.
 *     Sem isso "EBITDA" e uma palavra; com isso e uma conta.
 */
function abrirGaveta_(item) {
  if (!DRILL || !item) return;
  const F = (v) => fmtBRL(v, 2);
  const abs = (v) => fmtBRL(Math.abs(v), 2);
  const soma = (lista) => (lista || []).reduce((s, r) => s + Math.abs(Number(r.valor) || 0), 0);

  let corpo = '';
  let total = 0;

  if (item.tipo === 'grupo') {
    total = DRILL.porColuna.reduce((s, pg) => s + (pg[item.nome] || 0), 0);

    if (item.nome === GRUPO_DEPRECIACAO) {
      corpo = `<p class="gv-nota">Não é lançamento: é cálculo. Nenhum dinheiro sai
        do caixa por esta linha — a máquina foi paga quando foi comprada, e aqui
        ela perde valor com o uso.</p>
        <table class="simple gv-tab">
          <tr><td>Máquinas e equipamentos<small>R$ 17.950 × 10% a.a.</small></td>
              <td class="num">${F(-149.58 * DRILL.serie.length)}</td></tr>
          <tr><td>Informática<small>R$ 10.400 × 20% a.a.</small></td>
              <td class="num">${F(-173.33 * DRILL.serie.length)}</td></tr>
        </table>
        <p class="gv-nota">${DRILL.serie.length} mês(es) no período.</p>`;

    } else if (DRILL.fontes && (item.nome === 'Receita Bruta' || item.nome === 'CMV'
               || item.nome === GRUPO_IMPOSTO || item.nome === GRUPO_PROVISAO)) {
      /* Fonte externa: nao ha lancamento para listar. A quebra util e por CANAL
         na receita e no CMV, e por COMPETENCIA no imposto - que e o que a guia
         tem. */
      const lista = item.nome === 'Receita Bruta' ? DRILL.fontes.receita
        : item.nome === 'CMV' ? DRILL.fontes.cmv
          : item.nome === GRUPO_IMPOSTO ? DRILL.fontes.imposto : DRILL.fontes.provisao;
      const meses = DRILL.serie.map(b => b.chave);
      const dentro = (lista || []).filter(r => meses.indexOf(r.mes) >= 0);
      const porChave = {};
      dentro.forEach(function (r) {
        const k = (item.nome === GRUPO_IMPOSTO) ? r.mes : (r.canal || '—');
        porChave[k] = (porChave[k] || 0) + Math.abs(Number(r.valor) || 0);
      });
      const chaves = Object.keys(porChave).sort((x, y) => porChave[y] - porChave[x]);
      corpo = `<p class="gv-nota">Vem da aba
        <code>${item.nome === 'CMV' ? '_CMV_Consumo' : item.nome === 'Receita Bruta' ? '_Receita_Pedidos' : 'das guias do Simples'}</code>,
        não de lançamento do caixa — por isso a quebra é
        ${item.nome === GRUPO_IMPOSTO ? 'por competência' : 'por canal'} e não por conta.</p>
        <table class="simple gv-tab">`
        + chaves.map(k => `<tr><td>${escapeHtml_(k)}</td><td class="num">${abs(porChave[k])}</td>
            <td class="num gv-pct">${fmtPctSimples_(porChave[k] / (soma(dentro) || 1))}</td></tr>`).join('')
        + '</table>';

    } else {
      /* Grupo de lancamento: categorias primeiro (e ali que se decide), depois
         as maiores linhas (e ali que se confere). */
      const chave = chaveGrupo_(item.nome);
      const linhas = DRILL.rows.filter(r => chaveGrupo_(canonizarGrupo_(r.grupoDRE)) === chave);
      const porCat = {};
      linhas.forEach(function (r) {
        const v = (r.tipo === 'entrada' ? 1 : -1) * r.valor;
        porCat[r.categoria] = (porCat[r.categoria] || 0) + v;
      });
      const cats = Object.keys(porCat).sort((x, y) => Math.abs(porCat[y]) - Math.abs(porCat[x]));
      const maiores = linhas.slice().sort((x, y) => y.valor - x.valor).slice(0, 15);

      corpo = `<h4>Por categoria <small>${cats.length} categoria(s)</small></h4>
        <table class="simple gv-tab">`
        + cats.map(c => `<tr><td>${escapeHtml_(c)}</td><td class="num">${F(porCat[c])}</td>
            <td class="num gv-pct">${fmtPctSimples_(Math.abs(porCat[c]) / (Math.abs(total) || 1))}</td></tr>`).join('')
        + `</table>
        <h4>Os maiores lançamentos <small>${linhas.length} no período</small></h4>
        <table class="simple gv-tab gv-lanc">`
        + maiores.map(r => `<tr>
            <td>${fmtDataBR(DRILL.porCompetencia ? r.dateComp : r.date)}</td>
            <td>${escapeHtml_(r.contato || r.categoria)}
              ${r.descricao ? '<small>' + escapeHtml_(String(r.descricao).slice(0, 70)) + '</small>' : ''}</td>
            <td class="num">${F((r.tipo === 'entrada' ? 1 : -1) * r.valor)}</td></tr>`).join('')
        + '</table>'
        + (linhas.length > 15 ? `<p class="gv-nota">Mostrando os 15 maiores de
            ${linhas.length}. A aba <b>Fluxo de Caixa</b> tem todos, com busca.</p>` : '')
        + (!linhas.length ? '<p class="gv-nota">Nenhum lançamento neste grupo no período.</p>' : '');
    }

  } else {
    /* Subtotal ou resultado: a conta que o forma. */
    total = (item.soma || []).reduce((s, n) =>
      s + DRILL.porColuna.reduce((t, pg) => t + (pg[n] || 0), 0), 0);
    corpo = `<p class="gv-nota">Não é uma conta, é uma <b>soma</b>. Estas são as linhas
      que entram nela — clique em qualquer uma delas na tabela para abrir por dentro.</p>
      <table class="simple gv-tab">`
      + (item.soma || []).map(function (n) {
        const v = DRILL.porColuna.reduce((t, pg) => t + (pg[n] || 0), 0);
        return `<tr><td>${escapeHtml_(n)}</td><td class="num">${F(v)}</td></tr>`;
      }).join('')
      + `</table><table class="simple gv-tab"><tr class="gv-total">
        <td><b>${escapeHtml_(item.nome)}</b></td><td class="num"><b>${F(total)}</b></td></tr></table>`;
  }

  const receita = DRILL.porColuna.reduce((s, pg) => s + (pg['Receita Bruta'] || 0), 0);
  const gv = document.getElementById('gaveta');
  gv.innerHTML = `<div class="gv-head">
      <div><div class="gv-tit">${escapeHtml_(item.nome)}</div>
        <div class="gv-sub">${fmtDataBR(FILTER.start)} a ${fmtDataBR(FILTER.end)} ·
          ${DRILL.porCompetencia ? 'competência' : 'caixa'}</div></div>
      <button type="button" class="gv-x" id="gvFechar" aria-label="Fechar">✕</button>
    </div>
    <div class="gv-valor ${total < 0 ? 'val-out' : 'val-in'}">${F(total)}
      <small>${receita ? fmtPctSimples_(Math.abs(total) / Math.abs(receita)) + ' da receita' : ''}</small></div>
    <div class="gv-corpo">${corpo}</div>`;
  gv.hidden = false;
  document.getElementById('gvFundo').hidden = false;
  document.getElementById('gvFechar').addEventListener('click', fecharGaveta_);
}

function fecharGaveta_() {
  const gv = document.getElementById('gaveta');
  if (gv) gv.hidden = true;
  const f = document.getElementById('gvFundo');
  if (f) f.hidden = true;
}

/*
 * ABA VENDAS — o relatório de vendas do Bling, dentro do painel.
 *
 * Pedida em 07/09/2026 depois de a DRE do Bling (R$ 107.094,63 em julho) não
 * bater com o relatório de vendas dele (R$ 88.641,55). Não havia erro: um conta
 * pela data do RECEBIMENTO e o outro pela data da VENDA. Ter as duas coisas na
 * mesma ferramenta é o que evita a dúvida voltar todo mês.
 *
 * Serve também de conferência: "vendi no período" aqui deve bater com a
 * Receita Bruta da DRE por competência. Divergência = venda sem conta lançada,
 * ou conta de receita sem venda correspondente.
 */
function renderVendas(el, rowsPagas) {
  const todas = (VENDAS_ROWS || []).filter(v => v.date >= FILTER.start && v.date <= FILTER.end);
  const vendas = todas.filter(v => v.contaReceita);
  const canceladas = todas.filter(v => !v.contaReceita);

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Vendas</h2>
      <div class="section-desc">Pedidos pela <b>data da venda</b>, como no relatório de vendas do Bling.
      Diferente da DRE em caixa, que conta pela data em que o dinheiro entrou.</div>
    </div>
    ${renderFiltroBar_()}
    <div id="vendasCorpo"></div>`;
  ligarFiltroBar_(el);
  const corpo = el.querySelector('#vendasCorpo');

  if (!todas.length) {
    corpo.innerHTML = '<div class="state-msg">Sem vendas nesse período.</div>';
    return;
  }

  const bruto = vendas.reduce((s, v) => s + v.total, 0);
  const ticket = vendas.length ? bruto / vendas.length : 0;
  const perdido = canceladas.reduce((s, v) => s + v.total, 0);

  // recebido no período, pela DRE em caixa — a outra ponta da ponte.
  // Mesmo motivo do comparativo da DRE: comparar com 'Receita Bruta' cru parou
  // de casar quando a receita do Fluxo de Caixa virou "Venda ja contada pelo
  // pedido (ignorar na DRE)", e esta ponta da ponte passou a responder zero.
  const recebido = rowsPagas
    .filter(r => GRUPOS_RECEBIMENTO_.some(g => chaveGrupo_(g) === chaveGrupo_(r.grupoDRE)))
    .reduce((s, r) => s + (r.tipo === 'entrada' ? r.valor : -r.valor), 0);

  const serie = serieTemporal_(vendas, FILTER.start, FILTER.end);
  const canais = [...new Set(vendas.map(v => v.canal))].sort();
  const porCanalColuna = serie.map(b => {
    const m = {};
    b.rows.forEach(v => { m[v.canal] = (m[v.canal] || 0) + v.total; });
    return m;
  });

  let tab = '<tr><th>Canal</th>' + serie.map(b => `<th>${b.label}</th>`).join('')
          + '<th>Total</th><th>% do mix</th></tr>';
  canais.forEach(c => {
    const vals = porCanalColuna.map(m => m[c] || 0);
    const tot = vals.reduce((a, b) => a + b, 0);
    tab += `<tr><td>${c}</td>` + vals.map(v => `<td class="num">${fmtBRL(v, 2)}</td>`).join('')
         + `<td class="num"><b>${fmtBRL(tot, 2)}</b></td>`
         + `<td class="num">${fmtPctSimples_(bruto ? tot / bruto : 0)}</td></tr>`;
  });
  const totCol = serie.map((_, i) => canais.reduce((s, c) => s + (porCanalColuna[i][c] || 0), 0));
  tab += `<tr class="dre-subtotal"><th>Total</th>`
       + totCol.map(v => `<td class="num">${fmtBRL(v, 2)}</td>`).join('')
       + `<th class="num val-in">${fmtBRL(bruto, 2)}</th><th></th></tr>`;

  const dif = recebido - bruto;
  corpo.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi ok"><div class="kpi-label">Vendido no período</div>
        <div class="kpi-value">${fmtBRL(bruto, 0)}</div>
        <div class="kpi-foot">${vendas.length} pedido(s) faturado(s)</div></div>
      <div class="kpi"><div class="kpi-label">Ticket médio</div>
        <div class="kpi-value">${fmtBRL(ticket, 0)}</div>
        <div class="kpi-foot">por pedido</div></div>
      <div class="kpi ${canceladas.length ? 'alerta' : ''}"><div class="kpi-label">Cancelados</div>
        <div class="kpi-value">${canceladas.length}</div>
        <div class="kpi-foot">${fmtBRL(perdido, 0)} fora da receita</div></div>
    </div>
    <div class="panel"><h3>Receita por canal</h3>
      <div style="overflow-x:auto;"><table class="simple dre" id="tblVendasCanal"></table></div></div>
    <div class="panel"><h3>Vendi × Recebi</h3>
      <div class="sub">A diferença não é erro: é o descasamento entre vender e receber.
      A Shopee libera dias depois, então parte do que entrou neste mês é venda do mês passado.</div>
      <table class="simple">
        <tr><td>Vendi no período <small>(data da venda)</small></td>
            <td class="num"><b>${fmtBRL(bruto, 2)}</b></td></tr>
        <tr><td>Recebi no período <small>(data do dinheiro)</small></td>
            <td class="num"><b>${fmtBRL(recebido, 2)}</b></td></tr>
        <tr class="dre-subtotal"><th>Diferença</th>
            <th class="num ${dif >= 0 ? 'val-in' : 'val-out'}">${fmtBRL(dif, 2)}</th></tr>
      </table>
      <div class="sub" style="margin-top:.6rem;">${dif >= 0
        ? `Entrou <b>${fmtBRL(dif, 2)}</b> a mais do que se vendeu — sobra de vendas anteriores caindo agora.`
        : `Entrou <b>${fmtBRL(Math.abs(dif), 2)}</b> a menos do que se vendeu — esse valor ainda está para liberar.`}</div>
    </div>`;
  document.getElementById('tblVendasCanal').innerHTML = tab;
}

/*
 * Painel de VENDAS por competência: receita bruta pela data do pedido, por
 * canal, e a ponte caixa × competência. Vem ABAIXO da DRE por competência,
 * como conferência: o "vendi no período" daqui deve bater com a Receita Bruta
 * da tabela de cima. Se não bater, há venda sem conta lançada (ou o contrário).
 *
 * Cancelado nao entra (contaReceita = false na aba Vendas).
 */
function renderDreCompetenciaVendas_(corpoPai) {
  const corpo = document.createElement('div');
  corpoPai.appendChild(corpo);
  const todas = (VENDAS_ROWS || []).filter(v => v.date >= FILTER.start && v.date <= FILTER.end);
  const vendas = todas.filter(v => v.contaReceita);
  if (!todas.length) { corpo.innerHTML = ''; return; }

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
      <div style="overflow-x:auto;"><table class="simple" id="tblCanal"></table></div></div>
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
  /* ERA id="tblDre" AQUI, e era o mesmo id da tabela da DRE.
     getElementById devolve o PRIMEIRO elemento do documento com aquele id,
     que e a tabela da DRE - entao a tabela de canais era escrita EM CIMA da
     DRE, e o painel "Receita por canal" ficava vazio. A aba DRE mostrava
     receita por canal no lugar de Receita, Deducoes, CMV, Lucro Bruto, Margem
     de Contribuicao, EBITDA e Resultado.
     Id duplicado nao da erro nenhum: o navegador escolhe um e segue. */
  document.getElementById('tblCanal').innerHTML = html;

  // comparativo com o regime de caixa, que e a duvida que gera essa tela
  const rowsCaixa = (FLUXO_ROWS || []).filter(r => r.date >= FILTER.start && r.date <= FILTER.end);
  /* Antes era indexOf('Receita Bruta'), que parou de casar quando a receita do
     Fluxo de Caixa foi remapeada para "Venda já contada pelo pedido (ignorar na DRE)" -
     e a linha passou a responder R$ 0 em todo mes, dizendo que nada tinha sido
     recebido. Ver GRUPOS_RECEBIMENTO_. */
  const receitaCaixa = rowsCaixa
    .filter(r => r.tipo === 'entrada' && GRUPOS_RECEBIMENTO_.some(g => chaveGrupo_(g) === chaveGrupo_(r.grupoDRE)))
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

/**
 * Taxa do canal PARA UM PREÇO. A Shopee cobra por faixa do preço do item
 * (20%+R$4 até R$ 79,99; 14%+R$16/20/26 acima), então a taxa só existe
 * depois que o preço é conhecido. Canal sem faixas devolve o de sempre.
 */
function taxaNoPreco_(canalObj, preco) {
  const f = canalObj.faixas;
  if (!f || f.length <= 1) {
    return {
      imp: canalObj.imp, com: canalObj.com, ex: canalObj.ex,
      fixa: canalObj.fixa, faixa: null
    };
  }
  const p = Number(preco) || 0;
  let alvo = f[0];
  for (let i = 0; i < f.length; i++) {
    const min = Number(f[i].precoMin) || 0;
    const max = Number(f[i].precoMax) || 0;   // 0 = sem teto
    if (p >= min && (max === 0 || p <= max)) { alvo = f[i]; break; }
    if (p >= min) alvo = f[i];
  }
  const ex = [];
  if (alvo.extra1Nome && alvo.extra1Pct) ex.push([alvo.extra1Nome, Number(alvo.extra1Pct) || 0]);
  if (alvo.extra2Nome && alvo.extra2Pct) ex.push([alvo.extra2Nome, Number(alvo.extra2Pct) || 0]);
  const max = Number(alvo.precoMax) || 0;
  return {
    imp: Number(alvo.impostosPct) || 0,
    com: Number(alvo.comissaoPct) || 0,
    ex: ex,
    fixa: Number(alvo.taxaFixaReais) || 0,
    faixa: (max ? 'R$ ' + fmtNum_(alvo.precoMin) + ' a ' + fmtNum_(max)
                : 'acima de R$ ' + fmtNum_(alvo.precoMin))
  };
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
      faixas: c.faixas || null,
      ok: c.confirmado === true || String(c.confirmado).toUpperCase() === 'TRUE'
    };
  });
}

function calcularFicha_(modelo, tamanho, tecido, escolhidos, canalObj, preco) {
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
  /* A taxa depende do preço quando o canal cobra por faixa (Shopee).
     Sem preço informado, cai na primeira faixa — que é o que a pessoa vê
     antes de digitar qualquer coisa. */
  const t = taxaNoPreco_(canalObj, preco);
  const taxaPct = t.imp + t.com + t.ex.reduce((s, e) => s + e[1], 0);

  return {
    canal: canalObj, tipoPeca, totalMetros, metrosPrinc, metrosSubstituidos, detAcab, custoAcab,
    mat, nomeTecido, padraoDoCanal, custoTecido, custoCorte, custoCostura,
    itensFicha, custoAviamento, custoMaoObraExtra, custoEmbalagem,
    detTam, custoTam, custoFabricacao, custo, taxaPct, avisos,
    taxa: t, faixa: t.faixa, fixa: t.fixa
  };
}

/**
 * Piso de queima. Com taxa por faixa o problema é circular: a taxa
 * depende do preço e o preço é justamente o que se procura. Resolve
 * testando cada faixa e ficando com a que fecha dentro de si mesma —
 * se a conta da faixa "até R$ 79,99" der R$ 92, essa faixa não vale e
 * a resposta está na de cima.
 */
function pisoQueima_(custo, taxaPct, taxaFixa, canalObj) {
  const resolve = (pct, fixa) => {
    const den = 1 - pct - MARGEM_QUEIMA;
    return den > 0 ? (custo + fixa) / den : null;
  };

  const f = canalObj && canalObj.faixas;
  if (!f || f.length <= 1) return resolve(taxaPct, taxaFixa);

  let ultimo = null;
  for (let i = 0; i < f.length; i++) {
    const t = taxaNoPreco_(canalObj, (Number(f[i].precoMin) || 0) + 0.01);
    const pct = t.imp + t.com + t.ex.reduce((s, e) => s + e[1], 0);
    const p = resolve(pct, t.fixa);
    if (p === null) continue;
    ultimo = p;
    const min = Number(f[i].precoMin) || 0;
    const max = Number(f[i].precoMax) || 0;
    if (p >= min && (max === 0 || p <= max)) return p;   // fecha dentro da faixa
  }
  /* Nenhuma faixa fechou em si mesma: o piso caiu numa zona morta, onde
     o degrau da taxa engole o aumento de preço. A resposta correta é o
     primeiro preço da faixa seguinte que dê margem. */
  return ultimo;
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

/**
 * Refaz SO os blocos que dependem do preço e dos acabamentos, sem tocar no
 * formulário. É o que permite digitar um preço inteiro sem o campo ser
 * destruído e recriado a cada tecla.
 */
function atualizarSaida_(el) {
  const canais = canaisDaConfig_();
  const canalObj = canais.find(c => c.canal === FICHA.canal) || canais[0];
  if (!canalObj) return;
  const r = calcularFicha_(FICHA.modelo, FICHA.tamanho, FICHA.tecido, FICHA.acabamentos, canalObj, Number(FICHA.preco) || 0);
  const preco = Number(FICHA.preco) || 0;
  const taxaRs = preco * r.taxaPct;
  const sobra = preco - taxaRs - r.fixa - r.custo;
  const mcPct = preco ? sobra / preco : 0;
  const p15 = pisoQueima_(r.custo, r.taxaPct, r.fixa, canalObj);
  const dfx = (precifConfig && precifConfig.despesasFixasPctPadrao) || 0;
  const fixasRs = preco * dfx;
  const lucro = sobra - fixasRs;

  const põe = (id, html) => { const e = document.getElementById(id); if (e) e.innerHTML = html; };
  põe('fpCusto', linhasCusto_(r));
  põe('fpVenda', linhasVenda_(r, preco, taxaRs, sobra, p15, dfx, fixasRs, lucro));
  põe('fpAvisos', avisosFicha_(r, preco, p15));
  põe('fpCanais', linhasCanais_(canais, preco));

  const hero = document.getElementById('fpHero');
  if (hero) {
    hero.className = 'fp-hero ' + (!preco ? '' : mcPct >= 0.30 ? 'ok' : mcPct >= MARGEM_QUEIMA ? 'warn' : 'crit');
    hero.innerHTML = '<span class="k">Margem de contribuição</span>'
      + '<span class="v">' + (preco ? fmtPctPlano_(mcPct) : '—') + '</span>'
      + '<span class="n">' + (preco
        ? 'R$ ' + fmtNum_(sobra) + ' por peça vendida a R$ ' + fmtNum_(preco)
        : 'Informe um preço de venda para ver.') + '</span>';
  }
}

function renderPrecificacao(el) {
  const rend = rendimentoMapa_();
  const modelos = Object.keys(rend).sort();
  const canais = canaisDaConfig_();
  const mats = nomesDeMaterial_()
    .filter(n => ['Vivo', 'Elástico', 'Botão'].indexOf(n) < 0);

  if (!modelos.length || !canais.length) {
    /* Aqui a planilha RESPONDEU e veio vazia de verdade - falha de
       comunicacao ja foi barrada antes de chegar neste ponto. */
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
  const r = calcularFicha_(FICHA.modelo, FICHA.tamanho, FICHA.tecido, FICHA.acabamentos, canalObj, Number(FICHA.preco) || 0);
  const preco = Number(FICHA.preco) || 0;

  const taxaRs = preco * r.taxaPct;
  const sobra = preco - taxaRs - r.fixa - r.custo;
  const mcPct = preco ? sobra / preco : 0;
  const p15 = pisoQueima_(r.custo, r.taxaPct, r.fixa, canalObj);
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
        <div class="fp-linhas" id="fpCusto">${linhasCusto_(r)}</div>
      </div>
      <div class="fp-card">
        <h3>O que sobra nesse canal</h3>
        <div class="fp-hero ${heroCls}" id="fpHero">
          <span class="k">Margem de contribuição</span>
          <span class="v">${preco ? fmtPctPlano_(mcPct) : '—'}</span>
          <span class="n">${preco ? 'R$ ' + fmtNum_(sobra) + ' por peça vendida a R$ ' + fmtNum_(preco) : 'Informe um preço de venda para ver.'}</span>
        </div>
        <div class="fp-linhas" id="fpVenda">${linhasVenda_(r, preco, taxaRs, sobra, p15, dfx, fixasRs, lucro)}</div>
        <div id="fpAvisos">${avisosFicha_(r, preco, p15)}</div>
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
        <tbody id="fpCanais">${linhasCanais_(canais, preco)}</tbody>
      </table></div>
    </div>

    ${tabelaPisos_(modelos, canais, dfx)}

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
        /* Redesenhar tudo a cada tecla destruia o proprio campo em que a
           pessoa digita: o cursor voltava pro inicio e "129" virava "921".
           Numero so mexe na saida, entao atualiza so ela e o input fica
           intacto - nem foco nem cursor se perdem. */
        atualizarSaida_(el);
        return;
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
      atualizarSaida_(el);   // mesmo motivo do preço: nao recriar o campo
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

  /* SEM PRECO, as linhas de taxa mostram travessao e nao "- R$ 0,00".
     Em 14/09/2026 a Karolyne perguntou "nao entendi essas taxas 0.00": a ficha
     estava com preco vazio, e todas as taxas sao percentual SOBRE o preco, logo
     zero. Mas "- R$ 0,00" nao le como "ainda nao calculado" - le como "este
     canal nao cobra nada", que e o oposto do que a ficha existe para dizer. E o
     Lucro aparecia em VERMELHO com o custo inteiro, como se a peca desse
     prejuizo, quando era so custo sem receita do outro lado.

     Mesma regra do hero, que ja fazia certo ("Informe um preco de venda para
     ver"): numero que depende do preco so aparece quando existe preco. */
  const q = (v) => preco ? '− R$ ' + fmtNum_(v) : '—';

  vi('Preço de venda', preco ? '' : 'digite acima para calcular as taxas',
    preco ? 'R$ ' + fmtNum_(preco) : '—');
  vi('Custo até a porta', 'fabricação + embalagem', '− R$ ' + fmtNum_(r.custo));

  vi('Imposto (' + fmtPctPlano_(r.taxa.imp) + ')', '', q(preco * r.taxa.imp), 'sub');
  vi('Comissão (' + fmtPctPlano_(r.taxa.com) + ')',
    escapeHtml_(r.canal.canal) + (r.faixa ? ' · faixa ' + escapeHtml_(r.faixa) : ''),
    q(preco * r.taxa.com), 'sub');
  r.taxa.ex.forEach(e => vi(escapeHtml_(e[0]) + ' (' + fmtPctPlano_(e[1]) + ')', '',
    q(preco * e[1]), 'sub'));
  if (r.fixa) vi('Taxa fixa por item', escapeHtml_(r.canal.canal)
    + (r.faixa ? ' cobra nesta faixa' : ' cobra por item vendido'),
    '− R$ ' + fmtNum_(r.fixa), 'sub');

  vi('Margem de contribuição', 'antes das despesas fixas',
    preco ? 'R$ ' + fmtNum_(sobra) : '—',
    'tot' + (preco && sobra < 0 ? ' neg' : ''));

  /* Rateio das despesas fixas: aluguel, salarios, energia. Vem da aba
     _Despesas_Fixas dividida pela receita media dos ultimos meses da DRE,
     entao acompanha o faturamento sozinho. Sem ele a ficha parava na
     margem de contribuicao e nao dava pra saber se a peca da lucro. */
  vi('Despesas fixas (' + fmtPctPlano_(dfx) + ')', 'rateio sobre o faturamento',
    q(fixasRs), 'sub');
  vi('Lucro',
    preco ? fmtPctPlano_(lucro / preco) + ' do preço'
          : 'sem preço não há lucro a calcular — o piso abaixo é a resposta útil',
    preco ? 'R$ ' + fmtNum_(lucro) : '—',
    'tot destaque' + (preco && lucro < 0 ? ' neg' : ''));

  vi('Piso para 15% de margem', 'só para queima — ignora as despesas fixas de propósito',
    p15 ? 'R$ ' + fmtNum_(p15) : '—');
  return V.join('');
}

function avisosFicha_(r, preco, p15) {
  const a = r.avisos.slice();
  if (preco && p15 && preco < p15) a.push('A R$ ' + fmtNum_(preco) + ' este produto está abaixo do piso de queima (R$ ' + fmtNum_(p15) + ').');
  return a.length ? '<div class="fp-aviso">' + a.map(escapeHtml_).join(' ') + '</div>' : '';
}

/*
 * QUANTO CADA PECA PRECISA CUSTAR PARA PAGAR O CUSTO FIXO.
 *
 * DE ONDE VEIO: em 14/09/2026 o custo fixo por peca estava sendo aplicado pela
 * METADE (19,4% em vez de ~38,8%, por receita dobrada na conta - ver
 * getDreRows_). Corrigido, a Karolyne perguntou quais fichas "mudam de lado".
 *
 * A regra e exata: muda de lado a ficha cuja MARGEM DE CONTRIBUICAO esta entre
 * a % antiga e a nova. Acima da nova ja dava lucro e continua; abaixo da antiga
 * ja dava prejuizo e continua. Quem vira e quem esta na faixa do meio.
 *
 * Mas nao existe LISTA de fichas para varrer - a rota `precificacao` devolveu
 * 0 itens no testarRotas de hoje, porque a Ficha de Preco e calculadora, uma
 * peca por vez, e nao cadastro de precos. Entao a pergunta certa nao e "qual
 * muda", e "quanto cada peca precisa custar para se pagar". Esta tabela.
 *
 * A CONTA, e ela e brutal quando escrita:
 *
 *     preco x (1 - carga do canal - custo fixo %) = custo + taxa fixa
 *
 * Na Shopee a carga e ~50,8% e o custo fixo ~38,8%: sobram 10,4% do preco para
 * pagar a peca. Logo o piso e cerca de DEZ VEZES o custo de fabricacao. Nao e
 * exagero de calculo, e o que 89,6% de carga faz com qualquer numero.
 *
 * Quando o denominador fica <= 0, nao existe preco que feche - e a tabela diz
 * isso com palavra, nao com um numero gigante que pareceria meta de preco.
 *
 * O tamanho usado e o M quando o modelo tem, senao o do meio da grade: e a
 * peca representativa. Tamanho maior gasta mais tecido e piora; menor melhora.
 */
function tabelaPisos_(modelos, canais, dfx) {
  const rend = rendimentoMapa_();
  const tamDe = (m) => {
    const t = Object.keys(rend[m] || {}).sort((x, y) => ORDEM_TAM.indexOf(x) - ORDEM_TAM.indexOf(y));
    if (!t.length) return '';
    return t.indexOf('M') >= 0 ? 'M' : t[Math.floor(t.length / 2)];
  };

  /* Preco que zera o LUCRO (ja com o rateio do custo fixo), nao a margem de
     contribuicao. E a resposta para "vale ser feito?", diferente do piso de
     queima, que responde "vale liquidar?". */
  const pisoLucroZero = (custo, taxaPct, fixa) => {
    const den = 1 - taxaPct - dfx;
    return den > 0 ? (custo + fixa) / den : null;
  };

  let linhas = '';
  let impossiveis = 0, total = 0;
  modelos.forEach((m) => {
    const tam = tamDe(m);
    if (!tam) return;
    let celulas = '';
    canais.forEach((c) => {
      const r = calcularFicha_(m, tam, '', [], c, 0);
      const pz = pisoLucroZero(r.custo, r.taxaPct, r.fixa);
      const pq = pisoQueima_(r.custo, r.taxaPct, r.fixa, c);
      total++;
      if (pz === null) impossiveis++;
      celulas += '<td class="num' + (pz === null ? ' val-out' : '') + '">'
        + (pz === null ? 'não fecha' : 'R$ ' + fmtNum_(pz))
        + '<small>custo ' + fmtNum_(r.custo) + ' · carga ' + fmtPctPlano_(r.taxaPct)
        + (pq ? ' · queima ' + fmtNum_(pq) : '') + '</small></td>';
    });
    linhas += '<tr><td>' + escapeHtml_(m) + '<small>' + escapeHtml_(tam) + '</small></td>'
      + celulas + '</tr>';
  });

  return `<div class="panel">
    <h3>Quanto cada peça precisa custar para pagar o custo fixo</h3>
    <div class="sub">Preço que <b>zera o lucro</b> — já com o rateio de
      <b>${fmtPctPlano_(dfx)}</b> de custo fixo. Abaixo dele a peça vende e a empresa
      perde. É diferente do <b>piso de queima</b> (embaixo, em cinza), que ignora o
      custo fixo de propósito e serve só para liquidar estoque.
      O tamanho de cada linha é o representativo do modelo (M quando existe); tamanho
      maior gasta mais tecido e piora o piso.</div>
    <div style="overflow-x:auto;"><table class="simple pisos">
      <thead><tr><th>Modelo</th>${canais.map(c => '<th class="num">' + escapeHtml_(c.canal) + '</th>').join('')}</tr></thead>
      <tbody>${linhas}</tbody>
    </table></div>
    ${impossiveis ? `<div class="alerta warn"><b>${impossiveis} de ${total} combinações
      não fecham a nenhum preço.</b> Quando a carga do canal somada ao custo fixo passa
      de 100% do preço, não existe preço que pague a peça — aumentar o preço aumenta a
      comissão na mesma proporção. Nesses casos a decisão não é de preço: é sair do
      canal, cortar custo fixo, ou tratar aquele produto como isca e ganhar em
      outro.</div>` : ''}
    <div class="alerta info"><b>Por que os números são tão altos.</b> A conta é
      <code>preço × (1 − carga do canal − custo fixo %) = custo da peça</code>. Na
      Shopee a carga é ~50,8% e o custo fixo ${fmtPctPlano_(dfx)}: sobram cerca de
      10% do preço para pagar a peça, então o piso fica perto de <b>dez vezes</b> o
      custo de fabricação. Não é exagero de cálculo — é o que uma carga de ~90% faz
      com qualquer número. Os dois caminhos que mudam isso são <b>canal</b> (o site
      cobra 9,8% contra 29,5% da Shopee) e <b>custo fixo</b>, que hoje é
      R$ 21.116,59 por mês.</div>
  </div>`;
}

function linhasCanais_(canais, preco) {
  return canais.map(c => {
    const rc = calcularFicha_(FICHA.modelo, FICHA.tamanho, FICHA.tecido, FICHA.acabamentos, c, preco);
    const t = preco * rc.taxaPct;
    const s = preco - t - rc.fixa - rc.custo;
    const mp = preco ? s / preco : 0;
    const pc = pisoQueima_(rc.custo, rc.taxaPct, rc.fixa, c);
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
      + '<td class="num">' + (rc.fixa ? 'R$ ' + fmtNum_(rc.fixa) : '—') + '</td>'
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
  /* VIGENTE e o numero que importa, nao o total do cadastro. Despesa encerrada
     continua na lista de proposito - e historico, e a % de meses passados
     depende dela - mas somar tudo dava R$ 21.116,59 num mes em que o custo real
     era R$ 18.282, e essa diferenca ia inteira para o preco de cada peca. */
  const vigentes = despesas.filter(d => d.vigente !== false);
  const total = vigentes.reduce((s, d) => s + d.valorMensal, 0);
  const totalCadastro = despesas.reduce((s, d) => s + d.valorMensal, 0);
  const encerradas = despesas.length - vigentes.length;
  const pctAtual = (precifConfig && precifConfig.despesasFixasPctPadrao) || 0;

  el.innerHTML = `
    <div class="section-head">
      <h2 class="section-title">Custo Fixo</h2>
      <div class="section-desc">O que sai todo mês independente de vender: aluguel, salários fixos, pró-labore, energia, softwares. A % aplicada em cada peça na Ficha de Preço sai daqui ÷ a receita dos últimos meses fechados — ela se ajusta sozinha conforme o faturamento.</div>
    </div>
    <div class="precif-summary">
      <div class="tile"><div class="l">Custo fixo vigente</div><div class="v">${fmtBRL(total, 2)}</div></div>
      <div class="tile"><div class="l">% aplicada em cada peça</div><div class="v">${fmtPctSimples_(pctAtual)}</div></div>
      <div class="tile"><div class="l">Itens vigentes</div><div class="v">${vigentes.length}${encerradas ? ' <small style="font-size:13px;color:var(--muted);">+' + encerradas + ' encerrada(s)</small>' : ''}</div></div>
    </div>
    ${encerradas ? `<p class="dre-nota">O cadastro soma <b>${fmtBRL(totalCadastro, 2)}</b> no
      total, mas ${encerradas} despesa(s) já foi(ram) encerrada(s) — o vigente é
      <b>${fmtBRL(total, 2)}</b>. As encerradas ficam na lista de propósito: a % de um
      mês passado tem de ser calculada com o custo que existia naquele mês.</p>` : ''}
    <div class="panel">
      <h3>Custo fixo mensal <small class="sub">Uma linha por item. Salário e pró-labore entram aqui — mas só de quem você paga todo mês. Quem é pago por peça (costureira, caseado) já está na ficha da peça; repetir aqui conta duas vezes.</small></h3>
      <div style="overflow-x:auto;"><table class="simple" id="despesasTabela"></table></div>
    </div>
  `;
  renderDespesasTabela_();
}

function renderDespesasTabela_() {
  const tbl = document.getElementById('despesasTabela');
  if (!tbl) return;
  const despesas = precifDespesasFixas || [];
  /* VIGENCIA: de quando ate quando a despesa vale. Vazio significa aberto - sem
     inicio vale desde sempre, sem fim ainda esta valendo. Despesa que nao mudou
     fica com os dois vazios e se comporta como antes.
     `type="month"` de proposito: ele entrega exatamente 'yyyy-MM', que e o que o
     backend valida. Campo de texto livre aqui deixaria a pessoa escrever
     "junho" e a vigencia sumiria calada. */
  let html = '<tr><th>Descrição</th><th>Valor mensal (R$)</th>'
           + '<th>Vale a partir de</th><th>Até</th><th></th></tr>';
  despesas.forEach(d => {
    const fim = d.fim || '';
    const encerrada = d.vigente === false;
    html += `<tr data-id="${d.id}" class="${encerrada ? 'desp-encerrada' : ''}">
      <td><input type="text" class="d-descricao" value="${escapeHtml_(d.descricao)}">
        ${encerrada ? '<span class="pill md">encerrada</span>' : ''}</td>
      <td><input type="number" step="0.01" class="d-valor" value="${d.valorMensal}"></td>
      <td><input type="month" class="d-inicio" value="${escapeHtml_(d.inicio || '')}"></td>
      <td><input type="month" class="d-fim" value="${escapeHtml_(fim)}"></td>
      <td><div class="precif-row-acoes">
        <button type="button" class="salvar-despesa">Salvar</button>
        <button type="button" class="excluir excluir-despesa">Excluir</button>
      </div></td>
    </tr>`;
  });
  html += `<tr data-id="">
    <td><input type="text" class="d-descricao" placeholder="ex: Aluguel, Salário Margarida..."></td>
    <td><input type="number" step="0.01" class="d-valor" placeholder="0,00"></td>
    <td><input type="month" class="d-inicio"></td>
    <td><input type="month" class="d-fim"></td>
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
  const inicio = (tr.querySelector('.d-inicio') || {}).value || '';
  const fim = (tr.querySelector('.d-fim') || {}).value || '';
  if (!descricao) { alert('Preenche a descrição antes de salvar.'); return; }
  if (inicio && fim && fim < inicio) { alert('O mês final é antes do inicial.'); return; }
  btn.disabled = true;
  const resp = await apiPost_('salvarDespesaFixa', { despesa: {
    id: id, descricao: descricao, valorMensal: valorMensal, inicio: inicio, fim: fim } });
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
