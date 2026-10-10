// Logout. Limpia SIEMPRE los tokens locales, aunque la llamada falle.
// El access token ya emitido sigue siendo válido hasta su `exp` (máximo 1 hora): Auth no tiene lista de revocados.
export async function logOut({ client, store }) {
  const refreshToken = store.getRefreshToken();
  store.clear();
  if (!refreshToken) return { status: 'logged_out' };
  const result = await client.logout(refreshToken); // 204 siempre, también con un token desconocido
  return { status: 'logged_out', serverRevoked: result.ok };
}
