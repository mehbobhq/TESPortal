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
#
# Debian's clamav-freshclam package ships /etc/clamav/freshclam.conf with a
# packager-inserted "Example" guard line that makes freshclam refuse to run
# at all until it is removed - this is a known, universal Debian/Ubuntu
# ClamAV packaging behavior, not something specific to this image. Without
# removing it, freshclam fails immediately (before any network activity),
# both here at build time and in entrypoint.sh at container startup, and no
# signature database is ever written.
RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-freshclam ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/^Example/d' /etc/clamav/freshclam.conf

# Seed the signature database at build time so the image is usable
# immediately, without depending on outbound network access at first
# container start (see README.md "Signature update strategy" for why a
# best-effort startup refresh is layered on top of this, not a replacement
# for it). This step is NOT allowed to fail silently: an image built without
# a real, non-empty signature database must never be produced. `freshclam`'s
# own exit code already fails this RUN on a genuine download failure; the
# explicit directory-emptiness check afterward is defense in depth against
# any edge case where freshclam could otherwise exit 0 without having
# actually written database files.
RUN freshclam \
  && test -n "$(ls -A /var/lib/clamav)"

# Non-root runtime. ClamAV's signature directory, its log directory (written
# by the startup freshclam refresh in entrypoint.sh, which runs as this
# non-root user), and /tmp (used for the scanner's per-invocation temp
# files, see src/assessment.ts) must be writable by this user.
RUN groupadd --system tesscan && useradd --system --gid tesscan --home /app tesscan \
  && chown -R tesscan:tesscan /var/lib/clamav /var/log/clamav /app

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
