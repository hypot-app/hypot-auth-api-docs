// Renovación de tokens: como máximo UN refresh en vuelo por usuario, entre todas las pestañas.
// Un refresh token ya usado se trata como robado y revoca la sesión completa.
export function createRefresher({
  client,
  store,
  clientId,
  locks = globalThis.navigator?.locks, // Web Locks: un candado compartido entre pestañas
  retryDelayMs = 1000,
}) {
  let inFlight = null; // una sola promesa compartida por página

  async function rotate() {
    // Relee el token DESPUÉS de obtener el candado: otra pestaña pudo rotarlo mientras esperabas.
    const refreshToken = store.getRefreshToken();
    if (!refreshToken) return { status: 'logged_out' };

    let result = await client.refresh(refreshToken);
    if (result.error === 'network_error') {
      // Respuesta perdida: reintenta UNA vez con el mismo token. Auth lo perdona si llega dentro
      // de la ventana de gracia (unos 10 s) y desde la misma red.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      result = await client.refresh(refreshToken);
    }

    if (result.ok) {
      store.save(result.data); // reemplaza el refresh token antes que cualquier otra cosa
      return { status: 'ok', accessToken: result.data.access_token };
    }
    if (result.error === 'rate_limited') {
      // 429 no es una sesión muerta: conserva los tokens y reintenta tras Retry-After.
      return { status: 'rate_limited', retryAfter: result.retryAfter };
    }
    if (result.status === 401 && result.error === 'invalid_grant') {
      store.clear(); // la sesión ya no existe: vuelve a iniciar sesión
      return { status: 'logged_out', reason: 'invalid_grant' };
    }
    // 503, 5xx, red caída tras el reintento o un error desconocido: es una caída, no una sesión muerta.
    // Conserva los tokens y deja que quien llama reintente más tarde.
    return { status: 'unavailable' };
  }

  function refresh() {
    inFlight ??= locks.request(`hypot-refresh:${clientId}`, rotate).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  // Úsalo antes de cada llamada a tu backend: renueva solo cuando el access token está por vencer.
  async function getAccessToken() {
    const current = store.getAccessToken();
    if (current) return current;
    const outcome = await refresh();
    return outcome.status === 'ok' ? outcome.accessToken : null;
  }

  return { refresh, getAccessToken };
}
