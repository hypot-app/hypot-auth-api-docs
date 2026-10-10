// Datos de la cuenta desde tu backend. Para autenticar NO lo necesitas: verifica el JWT localmente
// y usa `sub` como id de la cuenta. Llama a /me solo cuando necesites el correo, el indicador
// email_verified o confirmar en este instante que la cuenta sigue existiendo.
export async function fetchAccount({ authUrl, accessToken, fetch: fetchFn = globalThis.fetch }) {
  const response = await fetchFn(`${authUrl}/api/v1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 401) return null; // token ausente, vencido o inválido: un único error genérico
  if (!response.ok) throw new Error(`auth_me_failed_${response.status}`);
  return response.json(); // exactamente { id, email, email_verified, created_at }; id es igual a sub
}
