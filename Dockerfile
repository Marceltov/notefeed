# Build: full deps, next build (standalone output).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Runtime: only the standalone server and its traced deps; no full node_modules.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
RUN apk add --no-cache su-exec && mkdir /data && chown node:node /data
COPY docker-entrypoint.sh /usr/local/bin/
VOLUME /data
EXPOSE 3000
# Starts as root only to switch to the owner of /data (see docker-entrypoint.sh).
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
