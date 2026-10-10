import { checkPassword } from './password-rules.js';

// Registro. La respuesta es idéntica para un correo nuevo y para uno ya registrado:
// muestra siempre la misma pantalla neutral ("Revisa tu bandeja de entrada").
export async function signUp(client, { email, password }) {
  const problem = checkPassword(password);
  if (problem) return { status: 'field_error', field: 'password', reason: problem };

  const result = await client.signup(email, password);
  if (result.ok) return { status: 'check_inbox' };

  switch (result.error) {
    case 'invalid_email':
      return { status: 'field_error', field: 'email', reason: result.error };
    case 'invalid_password':
      return { status: 'field_error', field: 'password', reason: result.error };
    case 'rate_limited':
      return { status: 'rate_limited', retryAfter: result.retryAfter };
    default:
      // invalid_client, unconfigured_client, invalid_request, 415, 503...:
      // son errores de integración o de disponibilidad, no del usuario.
      return { status: 'unexpected', error: result.error };
  }
}
