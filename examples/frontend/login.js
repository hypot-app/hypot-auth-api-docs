// Login. Auth responde con UN solo error (401 invalid_credentials) para cuenta inexistente,
// contraseña incorrecta, cuenta sin confirmar, bloqueo y límite de IP. No intentes distinguirlos.
export async function logIn({ client, store }, { email, password }) {
  const result = await client.login(email, password);
  if (result.ok) {
    store.save(result.data); // access en memoria, refresh donde elijas
    return { status: 'ok' };
  }
  if (result.error === 'invalid_credentials') return { status: 'invalid_credentials' };
  return { status: 'unexpected', error: result.error }; // 400 invalid_request, 503, red...
}
