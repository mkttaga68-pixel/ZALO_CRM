# ── Stage 1: Build frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
ARG VITE_AI_QC_ENABLED=false
RUN VITE_AI_QC_ENABLED=${VITE_AI_QC_ENABLED} npm run build

# ── Stage 2: Build backend ───────────────────────────────────────────────────
FROM node:22-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci
COPY backend/ ./
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npx prisma generate
RUN npm run build

# ── Stage 3: Production image ────────────────────────────────────────────────
FROM node:22-alpine
RUN apk add --no-cache tini ffmpeg
WORKDIR /app

# Copy built artefacts
COPY --from=backend-builder /app/backend/dist       /app/dist
COPY --from=backend-builder /app/backend/node_modules /app/node_modules
COPY --from=backend-builder /app/backend/prisma     /app/prisma
COPY --from=backend-builder /app/backend/prisma.config.ts /app/prisma.config.ts
COPY --from=backend-builder /app/backend/package.json /app/package.json
COPY --from=backend-builder /app/backend/fixtures/ai-quality-control/vault /app/fixtures/ai-quality-control/vault
COPY --from=frontend-builder /app/frontend/dist     /app/static

RUN mkdir -p /var/lib/zalo-crm/files
COPY scripts/readiness-probe.cjs /app/scripts/readiness-probe.cjs
COPY scripts/bot-auto-backfill.cjs /app/scripts/bot-auto-backfill.cjs
COPY scripts/manual-posting-migrate.cjs /app/scripts/manual-posting-migrate.cjs
COPY scripts/native-ai-qc-migrate.cjs /app/scripts/native-ai-qc-migrate.cjs
COPY scripts/aiqc-customer-archive-migrate.cjs /app/scripts/aiqc-customer-archive-migrate.cjs

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
# Schema/data migration is an explicit release operation, never a restart side effect.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 CMD ["node", "scripts/readiness-probe.cjs"]
CMD ["sh", "-c", "node scripts/bot-auto-backfill.cjs --check && exec node dist/app.js"]
