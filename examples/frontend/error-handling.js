// Tabla de decisiones: qué hace la interfaz con cada error de Auth.
// `result` es lo que devuelve createAuthClient (ok, status, error, retryAfter).
export function actionFor(result) {
  switch (result.error) {
    case 'invalid_email':
    case 'invalid_password':
    case 'invalid_current_password':
      return { action: 'show_field_error', field: result.error };
    case 'invalid_credentials':
      return { action: 'show_generic_login_error' }; // "Correo o contraseña incorrectos"
    case 'invalid_or_expired_link':
    case 'network_error': // en confirm y reset, un error de red equivale a un enlace inválido
      return { action: 'show_invalid_link' };
    case 'invalid_grant':
    case 'invalid_token':
      return { action: 'log_in_again' };
    case 'rate_limited':
      // Desactiva el botón hasta que pase Retry-After. No cierres la sesión.
      return { action: 'wait', seconds: result.retryAfter ?? 60 };
    case 'temporarily_unavailable':
      return { action: 'try_later' }; // reintenta con espera creciente, nunca en bucle cerrado
    case 'invalid_request':
    case 'invalid_client':
    case 'unconfigured_client':
    case 'unsupported_media_type':
      return { action: 'integration_bug', error: result.error }; // se corrige en el código o con el operador
    default:
      return { action: 'show_generic_error' };
  }
}
