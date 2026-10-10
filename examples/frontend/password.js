import { checkPassword } from './password-rules.js';

// "Olvidé mi contraseña". La respuesta es siempre 202 con el mismo texto, exista o no la cuenta.
export async function requestPasswordReset(client, email) {
  const result = await client.forgotPassword(email);
  if (result.ok) return { status: 'check_inbox' };
  if (result.error === 'rate_limited') return { status: 'rate_limited', retryAfter: result.retryAfter };
  if (result.error === 'invalid_email') return { status: 'field_error', field: 'email' };
  return { status: 'unexpected', error: result.error };
}

// Pantalla de restablecimiento: lee el token UNA vez al cargar (con takeTokenFromUrl) y consérvalo
// en una variable hasta que el usuario envíe la nueva contraseña.
export async function resetPassword(client, { token, newPassword }) {
  const problem = checkPassword(newPassword);
  if (problem) return { status: 'field_error', field: 'new_password', reason: problem };

  const result = await client.resetPassword(token, newPassword);
  if (result.ok) return { status: 'reset' }; // 204: todas las sesiones se revocaron; envía al login
  if (result.error === 'invalid_password') return { status: 'field_error', field: 'new_password' }; // el token sigue vivo
  if (result.error === 'rate_limited') return { status: 'rate_limited', retryAfter: result.retryAfter };
  return { status: 'invalid_link' }; // invalid_or_expired_link o network_error
}

// Cambio de contraseña con la sesión iniciada.
export async function changePassword({ client, store, refresher }, { currentPassword, newPassword }) {
  const problem = checkPassword(newPassword);
  if (problem) return { status: 'field_error', field: 'new_password', reason: problem };

  let result = await client.changePassword(await refresher.getAccessToken(), currentPassword, newPassword);
  if (result.error === 'invalid_token') {
    // Token vencido: renueva UNA vez y reintenta.
    const outcome = await refresher.refresh();
    if (outcome.status === 'ok') {
      result = await client.changePassword(outcome.accessToken, currentPassword, newPassword);
    }
  }

  if (result.ok) {
    store.clear(); // 204: se revocaron TODAS las sesiones, incluida esta
    return { status: 'changed_log_in_again' };
  }
  // invalid_current_password es 400, no 401: no cierres la sesión ni intentes refrescar por este error.
  if (result.error === 'invalid_current_password') return { status: 'field_error', field: 'current_password' };
  if (result.error === 'invalid_password') return { status: 'field_error', field: 'new_password' };
  if (result.error === 'invalid_token') {
    store.clear();
    return { status: 'log_in_again' };
  }
  return { status: 'unexpected', error: result.error };
}
