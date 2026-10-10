# hypot Auth API docs

Documentación en español de la API de autenticación [hypot Auth](https://github.com/hypot-app/hypot-auth-api), hecha con [Astro Starlight](https://starlight.astro.build). Explica cómo integrar un frontend y un backend, los conceptos del servicio, su operación y una referencia generada desde `openapi.json`.

Lo importante:

- **La API es un submódulo de git** (`api/`). El sitio lee `api/openapi.json`; no hay copias. El repositorio `hypot-auth-api` es privado: para clonar el submódulo necesitas credenciales de GitHub con acceso a él.
- **La documentación está en español, pero la referencia de la API está en inglés**, porque se genera tal cual desde `openapi.json`.
- **Cada fragmento de código de las páginas es un archivo de `examples/`** que `npm test` ejecuta contra la API real (Postgres 17, la imagen de la API y Mailpit, con Testcontainers).
- **El sitio es de uso local**: sin CDN ni servicios externos. No hay despliegue en servidores; se ejecuta con Astro en tu máquina.

## Inicio rápido

Requisitos: Node 24 y, para `npm test` y para la opción con Docker, Docker con Compose.

```bash
git clone --recurse-submodules https://github.com/hypot-app/hypot-auth-api-docs.git
cd hypot-auth-api-docs
npm ci
npm run dev       # http://localhost:4321
```

Si clonaste sin `--recurse-submodules`: `git submodule update --init`.

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Servidor de desarrollo con recarga (puerto 4321) |
| `npm run build` | Compila el sitio en `dist/` y valida los enlaces internos; un enlace roto falla la compilación |
| `npm run preview` | Sirve `dist/` con Astro (tras `npm run build`); aquí sí funciona la búsqueda |
| `npm test` | Todas las pruebas. **Necesita Docker.** La primera ejecución construye la imagen de la API (varios minutos); las siguientes usan la caché |
| `npm run test:unit` | Pruebas que no usan Docker: barra lateral, ejemplos, configuración de los contenedores y compilación del sitio |
| `npm run test:snippets` | Solo los ejemplos de código contra la API real |

## Estructura

| Ruta | Contenido |
|------|-----------|
| `src/content/docs/` | Las páginas (MDX), una carpeta por sección |
| `examples/` | Los fragmentos de código que muestran las páginas (`frontend`, `backend`, `curl`, `cli`, `config`, `shell`) |
| `config/` | Barra lateral, tabla de variables de entorno |
| `src/assets/diagrams/` | Diagramas SVG estáticos |
| `api/` | Submódulo con la API (solo se lee) |
| `test/` | `unit` (sin Docker), `snippets` (ejemplos), `api` (afirmaciones de las páginas), `deploy` (la imagen y `compose.yaml`) |
| `Dockerfile`, `compose.yaml` | Ejecución local en un contenedor |

## Actualizar la API

Cuando la API publica cambios en `develop`:

```bash
git submodule update --remote api
git -C api log --oneline -5      # qué entró
npm test                         # falla si cambió algo que la documentación afirma
npm run build
git add api && git commit -m "chore: update the API submodule"
```

Las pruebas comparan las variables de entorno, sus valores por defecto, las respuestas y los códigos de error con la API real. Si fallan, corrige las páginas y los ejemplos afectados en el mismo cambio. La explicación completa está en la página «Sobre esta documentación» del sitio.

## Pruebas

`npm test` levanta contenedores con Testcontainers:

- Postgres 17, la imagen de la API construida desde `api/Dockerfile` y Mailpit, en una red privada. Nada de esto toca tu base de datos ni usa puertos fijos.
- Para leer los correos de confirmación y de restablecimiento, las pruebas usan la API HTTP de Mailpit.
- No hace falta ninguna variable de entorno ni archivo `.env`.

El corredor es el de Node (`node --test`). Se eligió sobre Vitest porque los ejemplos son JavaScript ESM sin transformación, así que no hay nada que compilar, y porque evita una dependencia más que fijar y actualizar. `--test-concurrency=1` evita arrancar varias pilas de Docker a la vez.

Lo que **no** se puede probar en Node (el comportamiento real del navegador) se explica en «Sobre esta documentación».

## Uso local

Este repositorio es solo para uso local. Hay tres formas de ejecutar el sitio; en todas necesitas el submódulo `api/` (ver «Inicio rápido»: `git clone --recurse-submodules` y credenciales de GitHub con acceso a `hypot-auth-api`).

| Forma | Comandos | Búsqueda |
|-------|----------|----------|
| Editar con recarga | `npm ci && npm run dev` → http://localhost:4321 | No: Pagefind solo existe en una compilación |
| Compilar y servir con Astro | `npm ci && npm run build && npm run preview` → http://localhost:4321 | Sí |
| Contenedor | `docker compose up -d --build` → http://localhost:4321 | Sí |

El contenedor compila el sitio y lo sirve con `astro preview` como el usuario `node` (sin privilegios). `compose.yaml` lo publica **solo en `127.0.0.1:4321`**, sin capacidades de Linux y con `no-new-privileges`. La imagen base `node:24-bookworm-slim` está fijada por etiqueta y por digest en el `Dockerfile`.

Para actualizar: `git pull`, `git submodule update --init` y `docker compose up -d --build` otra vez. Para detenerlo: `docker compose down`.

## Seguridad de las dependencias

`npm audit` reporta un aviso en `postcss-selector-parser` (dependencia de Starlight). Lo aceptamos: solo se usa durante la compilación y no forma parte del sitio publicado, que son archivos estáticos sin ese código.

## Licencia

Sin licencia pública (`UNLICENSED`).
