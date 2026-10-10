# Variables: AUTH_URL, TOKEN (el #token del correo) y NEW_PASSWORD. Responde 204 sin cuerpo.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$AUTH_URL/api/v1/password/reset" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"new_password\":\"$NEW_PASSWORD\"}"
