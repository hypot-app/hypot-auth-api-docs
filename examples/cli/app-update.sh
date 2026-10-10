# Las opciones --origin repetidas REEMPLAZAN la lista guardada: incluye también los orígenes que ya tenía.
docker compose run --rm api dist/cli.js app update "$CLIENT_ID" \
  --origin http://localhost:5173 \
  --origin http://localhost:4321
