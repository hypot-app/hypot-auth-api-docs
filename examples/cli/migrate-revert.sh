# Deshace UNA migración por ejecución, con su método down(). Repite el comando para deshacer más.
node node_modules/typeorm/cli.js migration:revert -d dist/platform/persistence/data-source.js
