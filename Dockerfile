# Pattern Projector, self-hosted build.
# BASE_PATH lets it run under a sub-path such as /pattern-projector.
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json yarn.lock .yarnrc ./
COPY .yarn ./.yarn
COPY patches ./patches
RUN yarn install --frozen-lockfile --network-timeout 600000

FROM node:20-alpine AS build
WORKDIR /app
ARG BASE_PATH=""
ENV NEXT_PUBLIC_BASE_PATH=$BASE_PATH \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn next build

FROM node:20-alpine AS run
ARG BASE_PATH=""
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
# Health check path follows the base path baked in at build time.
ENV BASE_PATH_HEALTH=$BASE_PATH
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:3000${BASE_PATH_HEALTH:-}/en" || exit 1
CMD ["node", "server.js"]
