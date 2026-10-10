# Variables: AUTH_URL, ACCESS_TOKEN, PASSWORD (la actual) y NEW_PASSWORD. Responde 204 sin cuerpo.
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$AUTH_URL/api/v1/password/change" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -d "{\"current_password\":\"$PASSWORD\",\"new_password\":\"$NEW_PASSWORD\"}"
