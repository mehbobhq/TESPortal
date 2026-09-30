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

# ClamAV components:
#   clamav          - clamscan (still the application's scan engine in
#                      Phase 1 - see src/clamav.ts; unchanged this phase)
#   clamav-daemon   - clamd (the persistent-daemon foundation being
#                      established in this phase; not yet wired into the
#                      application's scanFile())
#   clamdscan       - the clamdscan CLIENT used to talk to clamd (PING and,
#                      in Phase 2, real scans). REAL RUNTIME VALIDATION of an
#                      earlier build of this image proved clamd-daemon does
#                      NOT bring this in on this base image/Debian version -
#                      `clamdscan: not found` at runtime, even with clamd
#                      itself running correctly and its socket present. The
#                      most likely explanation is that clamdscan is packaged
#                      separately from clamav-daemon in this Debian release,
#                      and/or is only a Recommends (not a hard Depends) of
#                      clamav-daemon, which --no-install-recommends below
#                      would skip either way. Do not assume clamav-daemon
#                      provides this client - it is listed explicitly here so
#                      apt fails the build immediately if it is genuinely
#                      unavailable, rather than silently producing an image
#                      that starts clamd but can never prove it is ready.
#   clamav-freshclam - freshclam (signature updates)
# No other scanning engine, no archive/executable-format tooling is
# installed.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-daemon clamdscan clamav-freshclam ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Explicit, TES-controlled configuration - entirely replaces both packages'
# own template files (each ships with a packager-inserted "Example" guard
# line requiring explicit review before use; see clamd.conf/freshclam.conf's
# own header comments for the full rationale). Overwriting after install, so
# these authored files win over the packages' defaults.
COPY clamd.conf /etc/clamav/clamd.conf
COPY freshclam.conf /etc/clamav/freshclam.conf

# Seed the signature database at build time so the image is usable
# immediately, without depending on outbound network access at first
# container start (see README.md "Signature update strategy" for why a
# best-effort startup refresh is layered on top of this, not a replacement
# for it). This step is NOT allowed to fail silently: an image built without
# a real, non-empty signature database must never be produced - this RUN
# uses plain `freshclam` with no `|| true` fallback, so `freshclam`'s own
# exit code already fails the build on a genuine download failure; the
# explicit directory-emptiness check afterward is defense in depth against
# any edge case where freshclam could otherwise exit 0 without having
# actually written database files. No clamd is running yet at this point in
# the build, so freshclam.conf's NotifyClamd attempt is expected to log a
# harmless "could not connect" warning here, per ClamAV's documented
# behavior (not independently verified in this session - see
# freshclam.conf's own note).
RUN freshclam \
  && test -n "$(ls -A /var/lib/clamav)"

# Non-root runtime. ClamAV's signature directory and its log directory
# (written by the startup freshclam refresh in entrypoint.sh, which runs as
# this non-root user) must be writable by this user. clamd's own Unix socket
# directory (/tmp/tes-clamd, see clamd.conf) and the scanner's per-invocation
# scan temp files (src/assessment.ts) do NOT need a chown here: both live
# under /tmp, which is world-writable (mode 1777) by standard Debian
# convention, so tesscan can create its own entries there at container
# runtime without any pre-existing ownership grant.
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
