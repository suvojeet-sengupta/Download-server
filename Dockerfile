# ---- build stage: compile TypeScript with dev dependencies present ----
FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build


# ---- runtime stage: production dependencies and compiled output only ----
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY public/ ./public/

# Persistent locations, created at build time so a fresh `docker compose up`
# needs no host-side preparation. Both are directories: bind mounting a single
# file breaks on a new host, because Docker creates the missing mount source as
# a directory and every read then fails with EISDIR.
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/uploads
RUN mkdir -p "$DATA_DIR" "$UPLOADS_DIR"

# Port default only. PASSWORD is intentionally NOT defaulted: the server exits
# when it is missing, which stops a shared image booting with a known credential.
ENV PORT=3009
EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "dist/index.js"]
