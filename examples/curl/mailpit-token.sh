# Solo desarrollo. Variables: MAILPIT_URL (por ejemplo http://localhost:8025) y EMAIL.
# Lee el correo más reciente enviado a EMAIL y extrae el token del fragmento (#token=...) del enlace.
# Auth envía el correo en segundo plano (cada 2 s), por eso reintenta hasta 10 veces.
TOKEN=""
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  ID=$(curl -s -G "$MAILPIT_URL/api/v1/search" --data-urlencode "query=to:$EMAIL" | jq -r '.messages[0].ID // empty')
  if [ -n "$ID" ]; then
    TOKEN=$(curl -s "$MAILPIT_URL/api/v1/message/$ID" | jq -r '.Text' | sed -n 's/.*#token=\([^[:space:]]*\).*/\1/p' | head -n 1)
  fi
  [ -n "$TOKEN" ] && break
  sleep 1
done
echo "$TOKEN"
