# syntax=docker/dockerfile:1

# Local use only: build the static site, then serve it with `astro preview` (Pagefind search exists only in a build).
# Tag and digest of node:24-bookworm-slim, resolved from Docker Hub on 2026-10-09. Node 24 matches `engines` in package.json.
ARG NODE_IMAGE=node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

# Stage 1: compile the site.
FROM ${NODE_IMAGE} AS build
ENV ASTRO_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY astro.config.mjs tsconfig.json ./
COPY config ./config
COPY src ./src
COPY public ./public
COPY examples ./examples
# Only the OpenAPI description of the API submodule is needed. Check out the submodule before building.
COPY api/openapi.json ./api/openapi.json
RUN npm run build

# Stage 2: serve dist/ with Astro. `astro preview` loads astro.config.mjs, so the runtime keeps the production
# dependencies (astro, starlight and its plugins) and the config files, but not the test-only devDependencies.
FROM ${NODE_IMAGE} AS runtime
ENV ASTRO_TELEMETRY_DISABLED=1 NODE_ENV=production
WORKDIR /app
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force && chown -R node:node /app
COPY --chown=node:node astro.config.mjs tsconfig.json ./
COPY --chown=node:node config ./config
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node examples ./examples
COPY --chown=node:node api/openapi.json ./api/openapi.json
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 4321
CMD ["npx", "astro", "preview", "--host", "0.0.0.0", "--port", "4321"]
