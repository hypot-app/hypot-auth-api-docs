# Dentro de la imagen de la API, con DATABASE_URL en el entorno. Es lo que ejecuta el servicio `migrate` del compose de la API.
# Aplica las migraciones pendientes y termina. El servicio nunca migra al arrancar.
node node_modules/typeorm/cli.js migration:run -d dist/platform/persistence/data-source.js
