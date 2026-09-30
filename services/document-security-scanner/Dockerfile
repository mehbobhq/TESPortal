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

# ClamAV 1.4.6 - the OFFICIAL Cisco Talos pre-built Linux x86_64 package,
# NOT Debian's own clamav packages. Debian bookworm's apt repository (this
# base image's distribution) currently resolves to clamav 1.4.3+dfsg-1~deb12u2
# - an older patch release - so it cannot supply 1.4.6. This replaces the
# Debian clamav/clamav-daemon/clamdscan/clamav-freshclam packages entirely:
# exactly one scanner engine exists in this image, at exactly this pinned
# version. See README.md "ClamAV version" for the full investigation.
#
# The official package has no declared Depends/Recommends and ships no
# maintainer install scripts (confirmed by direct inspection) - unlike the
# Debian packages it replaces, nothing here auto-creates /var/lib/clamav,
# /var/log/clamav, /etc/clamav, or a system user; all of that is handled
# explicitly below, and none of it assumes a "clamav" user exists (this
# image never relied on one - see clamd.conf's own note on why `User` is
# omitted there).
#
# Verified via the official Cisco Talos GPG signature published alongside
# this exact artifact on clamav.net/downloads - the strongest verification
# mechanism actually published for this release (no separate checksum file
# is published for it). The signing key's fingerprint is asserted explicitly
# below, fetched from clamav.net's own download infrastructure, so a
# compromised mirror serving a substituted key would fail this build rather
# than silently succeed.
ARG CLAMAV_VERSION=1.4.6
ARG CLAMAV_GPG_FINGERPRINT=5BADCA2665EF59DCF8A23D8B707F0DB480836771

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
  cd /tmp; \
  curl -fsSL -o clamav.deb "https://www.clamav.net/downloads/production/clamav-${CLAMAV_VERSION}.linux.x86_64.deb"; \
  curl -fsSL -o clamav.deb.sig "https://www.clamav.net/downloads/production/clamav-${CLAMAV_VERSION}.linux.x86_64.deb.sig"; \
  curl -fsSL -o talos.gpg "https://www.clamav.net/downloads/gpg_public_key"; \
  ACTUAL_FINGERPRINT=$(gpg --show-keys --with-colons --with-fingerprint talos.gpg | awk -F: '$1=="fpr"{print $10; exit}'); \
  [ "$ACTUAL_FINGERPRINT" = "$CLAMAV_GPG_FINGERPRINT" ] || { echo "ClamAV GPG key fingerprint mismatch - refusing to install"; exit 1; }; \
  export GNUPGHOME=/tmp/gnupg; \
  mkdir -m 700 "$GNUPGHOME"; \
  gpg --batch --import talos.gpg; \
  gpg --batch --verify clamav.deb.sig clamav.deb; \
  dpkg -i clamav.deb; \
  ldconfig; \
  rm -rf /tmp/clamav.deb /tmp/clamav.deb.sig /tmp/talos.gpg "$GNUPGHOME"

# The official package's binaries land under /usr/local, not /usr - since no
# Debian clamav package is installed anymore, there is no competing binary,
# but every invocation of these binaries in entrypoint.sh and src/clamav.ts
# still uses their full absolute paths deliberately (never a bare command
# name resolved via PATH), so executable resolution never depends on PATH
# contents or ordering at all.
RUN test -x /usr/local/sbin/clamd \
  && test -x /usr/local/bin/clamdscan \
  && test -x /usr/local/bin/freshclam \
  && /usr/local/sbin/clamd --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)" \
  && /usr/local/bin/clamdscan --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)" \
  && /usr/local/bin/freshclam --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)"

# The official package ships no maintainer scripts, so - unlike the Debian
# packages it replaces - nothing creates these directories automatically.
# /etc/clamav would also be auto-created by the COPY below, but is made
# explicit here for consistency with the other two, which COPY cannot help
# with.
RUN mkdir -p /var/lib/clamav /var/log/clamav /etc/clamav

# Explicit, TES-controlled configuration, at the same /etc/clamav location
# this image has always used (not the official package's /usr/local/etc
# sample-config location, which is never referenced).
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
RUN /usr/local/bin/freshclam \
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
