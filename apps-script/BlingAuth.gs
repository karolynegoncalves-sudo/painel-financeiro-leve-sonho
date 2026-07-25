/**
 * BlingAuth.gs — autorização Bling PRÓPRIA deste Apps Script.
 *
 * Importante: o refresh_token do Bling gira a cada uso. Os scripts locais
 * (.ps1 na pasta INTEGRAÇÃO BLING) já usam um token que gira sozinho — se
 * este Apps Script usasse o mesmo, os dois iriam brigar e quebrar um ao
 * outro. Por isso este script tem sua PRÓPRIA autorização (mesmo
 * client_id/secret do app Bling, mas um token independente).
 *
 * Configuração (uma vez só, ver SETUP.md):
 *  1) configurarClienteBling(clientId, clientSecret) — rodar no editor.
 *  2) iniciarAutorizacaoBling() — rodar no editor, abrir a URL que aparece
 *     no Log (Ver > Registros), logada como o usuário do Bling.
 *  3) O Bling redireciona pra este próprio Web App, que troca o código
 *     por tokens e salva em Propriedades do Script.
 */

function configurarClienteBling(clientId, clientSecret) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BLING_CLIENT_ID', clientId);
  props.setProperty('BLING_CLIENT_SECRET', clientSecret);
  Logger.log('Client ID/secret do Bling salvos nas Propriedades do Script.');
}

function iniciarAutorizacaoBling() {
  const props = PropertiesService.getScriptProperties();
  const clientId = props.getProperty('BLING_CLIENT_ID');
  if (!clientId) throw new Error('Rode configurarClienteBling(clientId, clientSecret) primeiro.');

  const redirectUri = ScriptApp.getService().getUrl();
  const state = Utilities.getUuid();
  props.setProperty('BLING_OAUTH_STATE', state);

  const url = 'https://www.bling.com.br/Api/v3/oauth/authorize'
    + '?response_type=code'
    + '&client_id=' + encodeURIComponent(clientId)
    + '&state=' + encodeURIComponent(state)
    + '&redirect_uri=' + encodeURIComponent(redirectUri);

  Logger.log('IMPORTANTE: o redirect_uri abaixo precisa estar cadastrado no app do Bling ' +
    '(developer.bling.com.br/aplicativos) ANTES de abrir a URL de autorização:');
  Logger.log('redirect_uri = %s', redirectUri);
  Logger.log('Depois de cadastrar, abra esta URL logada no Bling e autorize:');
  Logger.log(url);
}

function handleBlingOAuthCallback_(params) {
  const props = PropertiesService.getScriptProperties();
  const expectedState = props.getProperty('BLING_OAUTH_STATE');
  if (!params.state || params.state !== expectedState) {
    return htmlResponse_('Estado inválido ou expirado. Rode iniciarAutorizacaoBling() de novo e use a URL nova.');
  }
  const clientId = props.getProperty('BLING_CLIENT_ID');
  const clientSecret = props.getProperty('BLING_CLIENT_SECRET');
  const redirectUri = ScriptApp.getService().getUrl();
  const auth = Utilities.base64Encode(clientId + ':' + clientSecret);

  const resp = UrlFetchApp.fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'post',
    headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' },
    payload: { grant_type: 'authorization_code', code: params.code, redirect_uri: redirectUri },
    muteHttpExceptions: true
  });

  let data;
  try { data = JSON.parse(resp.getContentText()); } catch (e) { data = {}; }

  if (data.access_token) {
    salvarTokensBling_(data);
    logSync_('blingAuth', 'ok', 'Autorização concluída');
    return htmlResponse_('Bling conectado com sucesso! Pode fechar esta aba e voltar pro Apps Script.');
  }
  logSync_('blingAuth', 'erro', resp.getContentText());
  return htmlResponse_('Erro ao conectar com o Bling: ' + resp.getContentText());
}

function salvarTokensBling_(tokenResp) {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('BLING_ACCESS_TOKEN', tokenResp.access_token);
  props.setProperty('BLING_REFRESH_TOKEN', tokenResp.refresh_token);
  const expiraEm = Date.now() + (Number(tokenResp.expires_in || 21600) - 120) * 1000;
  props.setProperty('BLING_TOKEN_EXPIRES_AT', String(expiraEm));
}

/** Retorna um access_token válido, renovando via refresh_token se preciso. */
function getBlingAccessToken_() {
  const props = PropertiesService.getScriptProperties();
  const expiraEm = Number(props.getProperty('BLING_TOKEN_EXPIRES_AT') || 0);
  if (Date.now() < expiraEm) {
    return props.getProperty('BLING_ACCESS_TOKEN');
  }

  const clientId = props.getProperty('BLING_CLIENT_ID');
  const clientSecret = props.getProperty('BLING_CLIENT_SECRET');
  const refreshToken = props.getProperty('BLING_REFRESH_TOKEN');
  if (!refreshToken) throw new Error('Bling ainda não autorizado. Rode iniciarAutorizacaoBling() e siga as instruções no Log.');

  const auth = Utilities.base64Encode(clientId + ':' + clientSecret);
  const resp = UrlFetchApp.fetch('https://www.bling.com.br/Api/v3/oauth/token', {
    method: 'post',
    headers: { Authorization: 'Basic ' + auth, Accept: 'application/json' },
    payload: { grant_type: 'refresh_token', refresh_token: refreshToken },
    muteHttpExceptions: true
  });
  const data = JSON.parse(resp.getContentText());
  if (!data.access_token) {
    logSync_('blingRefresh', 'erro', resp.getContentText());
    throw new Error('Falha ao renovar token do Bling: ' + resp.getContentText());
  }
  salvarTokensBling_(data);
  return data.access_token;
}
