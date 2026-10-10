# Variables: AUTH_URL, CLIENT_ID y REFRESH_TOKEN. Responde 204 sin cuerpo.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$AUTH_URL/api/v1/auth/logout" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"refresh_token\":\"$REFRESH_TOKEN\"}"
