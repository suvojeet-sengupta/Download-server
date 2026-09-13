FROM node:22-alpine

WORKDIR /app

# Install dependencies first so this layer caches across code changes
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY server.js ./
COPY public/ ./public/

# Persistent locations. Declared as directories and created at build time so a
# fresh `docker compose up --build` works with no host-side preparation.
ENV DATA_DIR=/app/data
ENV UPLOADS_DIR=/app/uploads
RUN mkdir -p "$DATA_DIR" "$UPLOADS_DIR"

# Port default only. PASSWORD is intentionally NOT defaulted here: the server
# refuses to boot without it, which keeps a shared image from shipping a known
# credential.
ENV PORT=3009
EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --quiet --tries=1 --spider "http://127.0.0.1:${PORT}/healthz" || exit 1

CMD ["node", "server.js"]
