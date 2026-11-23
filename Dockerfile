# Carnet - two stages: build the web app with Node, run it with plain Python (no Node at runtime).
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM python:3.12-alpine
LABEL org.opencontainers.image.title="Carnet" \
      org.opencontainers.image.description="Self-hosted Notion alternative" \
      org.opencontainers.image.source="https://github.com/mathyouadr/carnet" \
      org.opencontainers.image.licenses="AGPL-3.0-or-later"
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CARNET_HOST=0.0.0.0 \
    CARNET_PORT=8044 \
    CARNET_DATA_DIR=/data
RUN apk add --no-cache tzdata \
 && adduser -D -H -u 1000 carnet \
 && mkdir -p /data \
 && chown carnet:carnet /data
WORKDIR /app
COPY carnet ./carnet
COPY --from=web /src/carnet/static ./carnet/static
USER carnet
VOLUME ["/data"]
EXPOSE 8044
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${CARNET_PORT}${CARNET_BASE_PATH}/healthz" >/dev/null || exit 1
ENTRYPOINT ["python", "-m", "carnet"]
CMD ["serve"]
