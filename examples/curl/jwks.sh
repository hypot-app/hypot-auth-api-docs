# Variable: AUTH_URL. Es la URL que tu backend debe tener fija en su configuración.
curl -sS "$AUTH_URL/.well-known/jwks.json"
