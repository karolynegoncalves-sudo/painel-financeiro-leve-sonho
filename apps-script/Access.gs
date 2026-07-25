/**
 * Access.gs — confere se quem está chamando a API tem permissão, checando
 * o id_token do Google Identity Services contra a aba "_Acesso".
 *
 * Antes de usar: rode configurarClienteGoogle_() uma vez (ou defina a
 * propriedade manualmente) com o OAuth Client ID criado no Google Cloud
 * Console para este dashboard (ver SETUP.md, passo "Google Cloud").
 */

function configurarClienteGoogle(clientId) {
  PropertiesService.getScriptProperties().setProperty('GOOGLE_CLIENT_ID', clientId);
  Logger.log('GOOGLE_CLIENT_ID salvo.');
}

/**
 * Retorna o e-mail se o token for válido, do domínio certo e estiver
 * ativo na aba _Acesso. Retorna null caso contrário (nunca lança erro —
 * quem chama decide o que responder).
 */
function verificarAcesso_(idToken) {
  if (!idToken) return null;
  const clientId = PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_ID');
  try {
    const resp = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (resp.getResponseCode() !== 200) return null;
    const claims = JSON.parse(resp.getContentText());
    if (clientId && claims.aud !== clientId) return null;
    if (claims.email_verified !== 'true' && claims.email_verified !== true) return null;
    const email = String(claims.email || '').toLowerCase();
    if (!email) return null;
    if (!emailEstaAtivo_(email)) return null;
    return email;
  } catch (err) {
    logSync_('verificarAcesso_', 'erro', String(err));
    return null;
  }
}

function emailEstaAtivo_(email) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_ACESSO);
  if (!sheet) return false;
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    const linhaEmail = String(dados[i][0] || '').toLowerCase();
    const ativo = dados[i][3];
    if (linhaEmail === email) {
      return ativo === true || String(ativo).toUpperCase() === 'TRUE' || String(ativo) === '1';
    }
  }
  return false;
}

function logSync_(tipo, status, detalhes) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ABA_SYNC_LOG);
  if (!sheet) return;
  sheet.appendRow([new Date(), tipo, status, detalhes]);
}
