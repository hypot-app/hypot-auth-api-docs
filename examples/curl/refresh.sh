# Variables: AUTH_URL, CLIENT_ID y REFRESH_TOKEN. Guarda el refresh_token NUEVO: el anterior queda usado.
curl -sS -X POST "$AUTH_URL/api/v1/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"refresh_token\":\"$REFRESH_TOKEN\"}"
