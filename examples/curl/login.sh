# Variables: AUTH_URL, CLIENT_ID, EMAIL, PASSWORD
curl -sS -X POST "$AUTH_URL/api/v1/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
