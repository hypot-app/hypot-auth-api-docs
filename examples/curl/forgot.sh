# Variables: AUTH_URL, CLIENT_ID, EMAIL. Siempre responde 202 con el mismo texto.
curl -sS -X POST "$AUTH_URL/api/v1/password/forgot" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"email\":\"$EMAIL\"}"
