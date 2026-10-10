# Variables: AUTH_URL y TOKEN (el valor de #token del enlace del correo)
curl -sS -X POST "$AUTH_URL/api/v1/accounts/confirm" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"
