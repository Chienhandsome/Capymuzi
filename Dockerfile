# syntax=docker/dockerfile:1

FROM node:22.12.0-bookworm-slim AS base

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates python3 python-is-python3 \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm_config_build_from_source=true npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM base AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/app/data/music-bot.sqlite

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /app/data && chown -R node:node /app
USER node

VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
