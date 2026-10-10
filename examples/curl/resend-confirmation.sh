# Variables: AUTH_URL, CLIENT_ID, EMAIL
curl -sS -X POST "$AUTH_URL/api/v1/accounts/resend-confirmation" \
  -H 'Content-Type: application/json' \
  -d "{\"client_id\":\"$CLIENT_ID\",\"email\":\"$EMAIL\"}"
