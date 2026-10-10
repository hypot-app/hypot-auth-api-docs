# Desde la raíz del repositorio de la API, contra una instancia dedicada o de staging.
# La instancia debe tener los límites ABUSE_LOGIN_* elevados y la cuenta debe estar confirmada.
LOAD_PASSWORD='the account password' node scripts/login-load.mjs \
  --client-id app_0123456789abcdef0123456789abcdef --email load@example.com \
  --url http://localhost:3000 --requests 200 --concurrency 4
