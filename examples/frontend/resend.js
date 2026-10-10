// Reenvío del correo de confirmación. Ofrécelo en el login y en la pantalla de enlace vencido:
// el login nunca revela que una cuenta está sin confirmar.
export async function resendConfirmation(client, email) {
  const result = await client.resendConfirmation(email);
  if (result.ok) return { status: 'check_inbox' }; // siempre 202, exista o no la cuenta
  if (result.error === 'rate_limited') return { status: 'rate_limited', retryAfter: result.retryAfter };
  if (result.error === 'invalid_email') return { status: 'field_error', field: 'email' };
  return { status: 'unexpected', error: result.error };
}
