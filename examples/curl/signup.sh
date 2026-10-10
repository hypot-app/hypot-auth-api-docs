# Variables: AUTH_URL (por ejemplo http://localhost:3000), CLIENT_ID, EMAIL y PASSWORD
curl -sS -X POST "$AUTH_URL/api/v1/accounts/signup" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}"
