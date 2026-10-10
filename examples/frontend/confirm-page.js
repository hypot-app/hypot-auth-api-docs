// Pantalla de confirmación: https://app.example/confirm#token=...
// Lee el token del fragmento y lo borra de la URL ANTES de cargar scripts de terceros
// o de hacer cualquier llamada de red.
export function takeTokenFromUrl({ location = window.location, history = window.history } = {}) {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname + location.search);
  return token;
}

export async function confirmEmail(client, urlParts) {
  const token = takeTokenFromUrl(urlParts);
  if (!token) return { status: 'invalid_link' };

  const result = await client.confirm(token);
  if (result.ok) return { status: 'confirmed' }; // lleva al usuario a tu pantalla de login
  if (result.error === 'rate_limited') return { status: 'rate_limited', retryAfter: result.retryAfter };

  // invalid_or_expired_link y network_error se tratan igual: en el navegador, Auth solo permite leer
  // algunos fallos de confirm. Un token desconocido llega como error de red opaco.
  return { status: 'invalid_link' }; // ofrece el formulario de reenvío
}
