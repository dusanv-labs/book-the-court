# Web app image for local development and the browser tests (docker compose).
# Production is built by .github/workflows/deploy-web.yml and served by GitHub Pages.
# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w web

COPY web ./web
# Vite bakes these into the static files at build time.
ARG VITE_API_URL=http://localhost:3000/api
ARG VITE_DEMO_EMAIL=
ARG VITE_DEMO_PASSWORD=
RUN npm run build -w web

FROM nginx:1.27-alpine
COPY --from=build /app/web/dist /usr/share/nginx/html
EXPOSE 80
