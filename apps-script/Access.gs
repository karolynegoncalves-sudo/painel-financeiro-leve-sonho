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
/**
 * Valida o login e devolve o e-mail.
 *
 * Cada chamada fazia uma requisicao EXTERNA ao tokeninfo do Google. Como o
 * painel dispara varias rotas por tela, isso virava varias idas e voltas
 * so pra confirmar a mesma pessoa. O resultado passa a ficar 5 minutos em
 * cache, com a CHAVE derivada do proprio token: token diferente nao acha
 * cache, token invalido continua sendo recusado, e o token do Google dura
 * 1 hora de qualquer forma. So o e-mail e guardado, nunca o token.
 */
function verificarAcesso_(idToken) {
  if (!idToken) return null;

  const cache = CacheService.getScriptCache();
  const chave = 'auth_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const guardado = cache.get(chave);
  if (guardado) return guardado;

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
    cache.put(chave, email, 300);
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
