docker compose run --rm api dist/cli.js app create \
  --name "Mi aplicación" \
  --origin http://localhost:5173 \
  --email-confirmation-url http://localhost:5173/confirm \
  --password-reset-url http://localhost:5173/reset
