# syntax=docker/dockerfile:1

# Stage 1: compile the site. Node 24 matches `engines` in package.json.
# Tag and digest of node:24-bookworm-slim, resolved from Docker Hub on 2026-10-09.
FROM node:24-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20 AS build
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

# Stage 2: serve the static files with unprivileged nginx.
# Tag and digest of nginxinc/nginx-unprivileged 1.30.5-alpine3.24 (the stable line), resolved from Docker Hub on 2026-10-09.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine3.24@sha256:15c994d10d6d78658721c3bcafff14cb281fba2a4bdf9d5ba92c416a472516e3
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
