// Cliente mínimo de hypot Auth para el navegador.
// Todas las llamadas envían JSON. Auth no usa cookies: no uses credentials: 'include'.
export function createAuthClient({ authUrl, clientId, fetch: fetchFn = globalThis.fetch }) {
  async function request(method, path, { body, accessToken } = {}) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    let response;
    try {
      response = await fetchFn(`${authUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Sin respuesta legible: red caída, tiempo agotado o bloqueo de CORS.
      return { ok: false, status: 0, error: 'network_error', data: null, retryAfter: null };
    }

    const data = await response.json().catch(() => null); // 204: sin cuerpo
    const retryAfter = Number.parseInt(response.headers.get('Retry-After') ?? '', 10);
    return {
      ok: response.ok,
      status: response.status,
      data,
      // Ramifica siempre por `error`, nunca por `message`.
      error: response.ok ? null : (data?.error ?? 'unknown_error'),
      retryAfter: Number.isNaN(retryAfter) ? null : retryAfter,
    };
  }

  const post = (path, body, accessToken) => request('POST', `/api/v1${path}`, { body, accessToken });

  return {
    signup: (email, password) => post('/accounts/signup', { client_id: clientId, email, password }),
    resendConfirmation: (email) => post('/accounts/resend-confirmation', { client_id: clientId, email }),
    confirm: (token) => post('/accounts/confirm', { token }),
    login: (email, password) => post('/auth/login', { client_id: clientId, email, password }),
    refresh: (refreshToken) => post('/auth/refresh', { client_id: clientId, refresh_token: refreshToken }),
    logout: (refreshToken) => post('/auth/logout', { client_id: clientId, refresh_token: refreshToken }),
    forgotPassword: (email) => post('/password/forgot', { client_id: clientId, email }),
    resetPassword: (token, newPassword) => post('/password/reset', { token, new_password: newPassword }),
    changePassword: (accessToken, currentPassword, newPassword) =>
      post('/password/change', { current_password: currentPassword, new_password: newPassword }, accessToken),
    me: (accessToken) => request('GET', '/api/v1/me', { accessToken }),
  };
}
