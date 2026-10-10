# Variables: AUTH_URL, CLIENT_ID y REFRESH_TOKEN. Muestra el estado y la cabecera Retry-After de una respuesta 429.
curl -sS -D - -o /dev/null -X POST "$AUTH_URL/api/v1/auth/refresh" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"refresh_token\":\"$REFRESH_TOKEN\"}" | grep -i -E '^(HTTP|retry-after)'
