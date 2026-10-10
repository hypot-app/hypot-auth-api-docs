// Dónde vive cada token:
// - access token: SOLO en memoria (una variable del módulo), nunca en localStorage;
// - refresh token: en memoria por defecto, o en el `storage` que elijas conscientemente
//   (sessionStorage: por pestaña; localStorage: todas las pestañas, mejor UX, más exposición ante XSS).
export function createTokenStore({ clientId, storage = null }) {
  const key = `hypot:refresh:${clientId}`;
  let accessToken = null;
  let accessExpiresAt = 0;
  let memoryRefreshToken = null;

  return {
    save(pair) {
      accessToken = pair.access_token;
      accessExpiresAt = Date.now() + pair.expires_in * 1000;
      if (storage) storage.setItem(key, pair.refresh_token);
      else memoryRefreshToken = pair.refresh_token;
    },
    // Devuelve null si falta o está por vencer (60 s de margen): es la señal para renovar.
    getAccessToken() {
      return accessToken && Date.now() < accessExpiresAt - 60_000 ? accessToken : null;
    },
    getRefreshToken() {
      return storage ? storage.getItem(key) : memoryRefreshToken;
    },
    clear() {
      accessToken = null;
      accessExpiresAt = 0;
      memoryRefreshToken = null;
      storage?.removeItem(key);
    },
  };
}
