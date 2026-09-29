# TES Document Security Scanner - Cloud Run container.
#
# Isolated from the Next.js portal: this image contains only this service's
# own Node code plus ClamAV, and is built/deployed independently.

# ---- build stage --------------------------------------------------------
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

# ---- production dependencies (no devDependencies in the runtime image) --
FROM node:20-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- runtime stage -------------------------------------------------------
FROM node:20-slim AS runtime
WORKDIR /app

# ClamAV (clamscan + freshclam + the signature-database tooling). No other
# scanning engine, no archive/executable-format tooling is installed.
RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-freshclam ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Seed an initial signature database at build time so the image is usable
# immediately, without depending on outbound network access at first
# container start. See README.md "Signature update strategy" for why this
# is a Phase 1 simplification, not a final production distribution design.
RUN freshclam || true

# Non-root runtime. ClamAV's own signature directory and /tmp (used for the
# scanner's per-invocation temp files, see src/assessment.ts) must be
# writable by this user.
RUN groupadd --system tesscan && useradd --system --gid tesscan --home /app tesscan \
  && chown -R tesscan:tesscan /var/lib/clamav /app

COPY --from=prod-deps --chown=tesscan:tesscan /app/package.json ./package.json
COPY --from=prod-deps --chown=tesscan:tesscan /app/node_modules ./node_modules
COPY --from=build --chown=tesscan:tesscan /app/dist/src ./dist/src
COPY --chown=tesscan:tesscan entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER tesscan

# Cloud Run injects PORT; the server reads it via config.ts's port().
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["./entrypoint.sh"]
