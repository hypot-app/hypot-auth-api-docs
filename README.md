# hypot Auth API docs

Documentación en español de la API de autenticación [hypot Auth](https://github.com/hypot-app/hypot-auth-api), hecha con [Astro Starlight](https://starlight.astro.build). Explica cómo integrar un frontend y un backend, los conceptos del servicio, su operación y una referencia generada desde `openapi.json`.

Lo importante:

- **La API es un submódulo de git** (`api/`). El sitio lee `api/openapi.json`; no hay copias.
- **Cada fragmento de código de las páginas es un archivo de `examples/`** que `npm test` ejecuta contra la API real (Postgres 17, la imagen de la API y Mailpit, con Testcontainers).
- **El sitio es autoalojado**: sin CDN ni servicios externos. Se despliega como una imagen de nginx sin privilegios detrás del nginx del servidor.

## Inicio rápido

Requisitos: Node 24 y, para `npm test`, Docker.

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
| `npm run preview` | Sirve `dist/` localmente |
| `npm test` | Todas las pruebas. **Necesita Docker.** La primera ejecución construye la imagen de la API (varios minutos); las siguientes usan la caché |
| `npm run test:unit` | Pruebas que no usan Docker: barra lateral, ejemplos, configuración de despliegue y compilación del sitio |
| `npm run test:snippets` | Solo los ejemplos de código contra la API real |
| `npm run csp:update` | Recalcula los hashes de la política CSP (ver más abajo) tras `npm run build` |

## Estructura

| Ruta | Contenido |
|------|-----------|
| `src/content/docs/` | Las páginas (MDX), una carpeta por sección |
| `examples/` | Los fragmentos de código que muestran las páginas (`frontend`, `backend`, `curl`, `cli`, `config`, `shell`) |
| `config/` | Barra lateral, tabla de variables de entorno y construcción de la política CSP |
| `src/assets/diagrams/` | Diagramas SVG estáticos |
| `api/` | Submódulo con la API (solo se lee) |
| `test/` | `unit` (sin Docker), `snippets` (ejemplos), `api` (afirmaciones de las páginas), `deploy` (la imagen) |
| `Dockerfile`, `compose.yaml`, `docker/` | Despliegue |
| `deploy/` | Ejemplos de configuración del nginx del servidor |

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

## Despliegue con Docker Compose detrás de nginx

`compose.yaml` ejecuta el sitio en un contenedor de nginx sin privilegios. Escucha **solo en `127.0.0.1:8081`**, así que la única entrada es el nginx del servidor. Corre con el sistema de archivos de solo lectura, sin capacidades de Linux, con `no-new-privileges`, con un `healthcheck` y con límites de memoria (128 MB) y de procesos (64).

La imagen se construye en dos etapas: una etapa con Node 24 compila el sitio y una etapa con `nginxinc/nginx-unprivileged:1.30.5-alpine3.24` lo sirve. Ambas imágenes base están fijadas por etiqueta y por digest en el `Dockerfile`.

1. **En el servidor**, clona el repositorio con sus submódulos y levanta el contenedor:

   ```bash
   git clone --recurse-submodules https://github.com/hypot-app/hypot-auth-api-docs.git
   cd hypot-auth-api-docs
   docker compose up -d --build
   curl -I http://127.0.0.1:8081/
   ```

   Para actualizar: `git pull`, `git submodule update --init` y `docker compose up -d --build` otra vez.

2. **DNS:** crea un registro `A` `docs.<tu-dominio>` que apunte a la IP del servidor.

3. **nginx del servidor:** crea `/etc/nginx/sites-available/docs.example.com` con el contenido de [`deploy/host-nginx.conf`](deploy/host-nginx.conf) y enlázalo en `sites-enabled`:

   ```nginx
   # /etc/nginx/sites-available/docs.example.com (enlázalo en sites-enabled)
   server {
       listen 80;
       server_name docs.example.com;

       location / {
           proxy_pass http://127.0.0.1:8081;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```

   Aplica el cambio y activa HTTPS con certbot:

   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d docs.example.com
   ```

   Certbot agrega la redirección a HTTPS y los certificados. Si quieres HSTS, agrega `add_header Strict-Transport-Security "max-age=31536000" always;` en el bloque `server` que escucha en el puerto 443.

4. **Opcional: restringir el acceso.** La documentación describe toda la API, así que conviene considerarlo. Dentro del bloque `location /` del nginx del servidor usa una lista de IP permitidas ([`deploy/host-nginx-allowlist.conf`](deploy/host-nginx-allowlist.conf)):

   ```nginx
   allow 203.0.113.10;
   deny all;
   ```

   o autenticación básica ([`deploy/host-nginx-basic-auth.conf`](deploy/host-nginx-basic-auth.conf); instala `apache2-utils` y ejecuta `sudo htpasswd -c /etc/nginx/.htpasswd docs-user`):

   ```nginx
   auth_basic "hypot docs";
   auth_basic_user_file /etc/nginx/.htpasswd;
   ```

### Política de seguridad del contenedor

El contenedor envía una política CSP estricta (`docker/security-headers.conf`) y las cabeceras `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy` y `Cross-Origin-Resource-Policy`. Como el sitio es autoalojado, no se permite ningún origen externo.

| Directiva | Valor | Por qué |
|-----------|-------|---------|
| `default-src` | `'none'` | Se niega todo lo que no se permite explícitamente |
| `script-src` | `'self'` y los hashes `sha256-...` de los scripts en línea | Los scripts son archivos del propio sitio. Los hashes cubren los únicos scripts en línea que Starlight y el complemento OpenAPI escriben en el HTML (tema, atajo de búsqueda, estado del menú lateral, pestañas y fragmentos de código de la referencia) |
| `script-src` | `'wasm-unsafe-eval'` | La búsqueda (Pagefind) instancia WebAssembly en la página y en su worker. Es la concesión mínima para eso: **no** permite `eval()` ni `new Function()`, y una prueba comprueba que ningún script compilado los usa |
| `style-src` | `'self'` | Todo el CSS son archivos (`build.inlineStylesheets: 'never'`); no hay elementos `<style>` |
| `style-src-attr` | `'unsafe-inline'` | Starlight y Expressive Code escriben atributos `style="--sl-icon-size: 1em"` y variables de color por cada token del código. Los valores dependen del contenido, así que no se pueden listar como hashes. Solo afecta a atributos |
| `img-src` | `'self' data:` | Los iconos son SVG `data:` dentro del CSS |
| `font-src`, `connect-src`, `worker-src` | `'self'` | Pagefind descarga su índice del mismo origen y ejecuta la búsqueda en un worker del mismo origen |
| `base-uri`, `form-action`, `object-src`, `frame-ancestors` | `'none'` | El sitio no usa base, formularios ni plugins, y no se puede enmarcar |

**Los hashes se verifican en cada prueba.** `npm test` compila el sitio y compara los scripts en línea del resultado con los hashes de `docker/security-headers.conf`. Si una actualización de Starlight cambia un script en línea, la prueba falla en lugar de dejar la búsqueda o el tema rotos en producción. Entonces ejecuta `npm run build && npm run csp:update`, revisa qué script cambió y confirma el archivo.

## Licencia

Sin licencia pública (`UNLICENSED`).
