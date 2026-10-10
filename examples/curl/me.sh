# Variables: AUTH_URL y ACCESS_TOKEN
curl -sS "$AUTH_URL/api/v1/me" -H "Authorization: Bearer $ACCESS_TOKEN"
