# API image for local development and the browser tests (docker compose).
# Production runs on Render with render.yaml; this image is not used there.
# Build context is the repository root (npm workspaces share one lockfile).
FROM node:24-bookworm-slim

# Prisma's migration engine needs OpenSSL.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY api/package.json api/
COPY web/package.json web/
COPY e2e/package.json e2e/
RUN npm ci -w api

COPY api ./api
RUN npm run build -w api

EXPOSE 3000
# Apply migrations, add demo data (skipped when it already exists), then start.
CMD ["sh", "-c", "npm run db:migrate -w api && npm run db:seed -w api -- --demo && npm run start:prod -w api"]
