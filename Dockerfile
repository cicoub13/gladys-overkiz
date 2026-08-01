# -----------------------------------------------------------------------------
# Integration image.
#
# Gladys sandbox constraints ("the sandbox is the defense"):
#   - rootfs mounted READ-ONLY -> never write outside /data
#   - a single writable volume: /data
#   - runs as a non-root user
#   - multi-arch image (linux/amd64 + linux/arm64), see the CI workflow
# -----------------------------------------------------------------------------

FROM node:24-alpine

# dumb-init: handles signals (SIGTERM) correctly for a graceful shutdown.
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install the PROD dependencies first (better build cache).
# `npm ci` only, with no `npm install` fallback: a lockfile that no longer
# matches package.json must fail the build, not silently resolve to something
# else. `--ignore-scripts` closes an install-time supply-chain hole (no
# dependency here needs a build step).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# Then the integration code.
COPY index.js ./
COPY src ./src
COPY gladys-assistant-integration.json ./

# The only writable location allowed at runtime.
ENV NODE_ENV=production
# Gladys caps the container at 256 MB; without this Node sizes its heap from the
# HOST memory and gets OOM-killed before it ever bothers to collect garbage.
ENV NODE_OPTIONS=--max-old-space-size=192
VOLUME ["/data"]

# Run as an unprivileged user (already present in the node image).
USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
