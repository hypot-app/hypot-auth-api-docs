import { createRemoteJWKSet, jwtVerify } from 'jose';

// jwksUrl, issuer y clientId salen de la configuración de tu servicio.
// El operador te entrega los tres al registrar tu app.
export function createAccessTokenVerifier({ jwksUrl, issuer, clientId }) {
  // URL fija de configuración. Nunca uses jku, x5u ni jwk del encabezado del token: los controla el atacante.
  const jwks = createRemoteJWKSet(new URL(jwksUrl), {
    cooldownDuration: 30_000, // espera mínima entre descargas cuando llega un kid desconocido
    cacheMaxAge: 600_000, // vuelve a descargar al menos cada 10 minutos
  });

  return async function verifyAccessToken(token) {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'], // bloquea "none" y la confusión de clave con HS256
      typ: 'at+jwt', // distingue un access token de otros JWT
      issuer, // exactamente AUTH_PUBLIC_BASE_URL, sin barra final
      audience: clientId, // TU client_id: un token de otra app es un JWT válido, pero no es para ti
      clockTolerance: 5, // segundos
      requiredClaims: ['sub', 'exp'],
    });
    return payload; // payload.sub es el id de la cuenta
  };
}

// Extrae el token de "Authorization: Bearer <token>".
export function bearerToken(authorizationHeader) {
  const match = /^Bearer (\S+)$/.exec(authorizationHeader ?? '');
  return match ? match[1] : null;
}

// Devuelve { accountId } o null. Responde 401 sin detalle: no reveles por qué falló la verificación.
export function createAuthenticator(verifyAccessToken) {
  return async function authenticate(headers) {
    const token = bearerToken(headers.authorization);
    if (!token) return null;
    try {
      const payload = await verifyAccessToken(token);
      return { accountId: payload.sub };
    } catch {
      return null;
    }
  };
}
