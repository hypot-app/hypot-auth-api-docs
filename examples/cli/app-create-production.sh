docker compose run --rm api dist/cli.js app create \
  --name "Mi aplicación" \
  --origin https://app.example.com \
  --origin https://staging.app.example.com \
  --email-confirmation-url https://app.example.com/confirm \
  --password-reset-url https://app.example.com/reset
