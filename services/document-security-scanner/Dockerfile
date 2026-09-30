# TES Document Security Scanner - Cloud Run container.
#
# Isolated from the Next.js portal: this image contains only this service's
# own Node code plus ClamAV, and is built/deployed independently.

# ---- build stage --------------------------------------------------------
FROM node:20-trixie-slim@sha256:1694ccde5ea9efb3060bb8612b1f287256061ff2a04d75dc1b71f57cb7239520 AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

# ---- production dependencies (no devDependencies in the runtime image) --
FROM node:20-trixie-slim@sha256:1694ccde5ea9efb3060bb8612b1f287256061ff2a04d75dc1b71f57cb7239520 AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---- ClamAV source - the OFFICIAL Cisco Talos Docker distribution ---------
#
# This is never used as a base image or run directly: it exists only so the
# runtime stage below can COPY specific, individually-verified binaries and
# their own shared libraries out of it. See README.md "ClamAV version" for
# why this replaced two earlier acquisition strategies.
#
# Pinned by immutable registry digest, not a floating tag: `1.4.6` on Docker
# Hub could be replaced by Cisco Talos with a different image without this
# digest ever changing. Resolved directly from the Docker Registry HTTP API
# (`clamav/clamav-debian:1.4.6`'s manifest list), and re-resolved a second
# time in a separate investigation session to confirm it had not drifted.
# This is specifically the amd64 platform manifest digest (not the multi-
# arch manifest-list digest), matching Cloud Build/Cloud Run's amd64-only
# architecture.
FROM clamav/clamav-debian@sha256:cf5ce46bfc448c98875478941850102f04acac307a8c4816a96a1ee54e502b04 AS clamav-source

# ---- runtime stage -------------------------------------------------------
FROM node:20-trixie-slim@sha256:1694ccde5ea9efb3060bb8612b1f287256061ff2a04d75dc1b71f57cb7239520 AS runtime
WORKDIR /app

# ClamAV 1.4.6 - binaries and libraries copied from the official Cisco Talos
# `clamav/clamav-debian` image above, not installed via any package manager
# or downloaded artifact. That image's own manifest declares its base as
# `debian:13-slim` ("trixie"); this runtime stage was moved from Debian 12
# ("bookworm", the prior `node:20-slim` base) to the matching official
# `node:20-trixie-slim` image specifically so both halves of this container
# share one ABI-compatible glibc/library set - copying dynamically-linked
# binaries across a Debian major-version boundary is not safe in general
# (glibc is backwards- but not forwards-compatible), so this was verified,
# not assumed: see README.md "ClamAV version" for the base-OS evidence and
# the real per-binary shared-library inspection this list is drawn from.
ARG CLAMAV_VERSION=1.4.6

# The runtime shared libraries clamd/clamdscan/freshclam actually need,
# determined by directly inspecting the real ELF binaries extracted from the
# clamav-source image above (their embedded NEEDED/version-requirement
# strings), not by copying the official image's own, broader install list
# (which also covers clamav-milter and clamdtop/clamconf - tools this image
# never runs). Package names are trixie's actual current names, confirmed
# against Debian's own trixie/amd64 package contents - notably
# `libssl3t64` and `libcurl4t64`, not the `libssl3`/`libcurl4` names the
# official image's own (Debian 12-targeted) install list uses, and which do
# not exist as package names on trixie.
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       ca-certificates \
       libbz2-1.0 \
       libcurl4t64 \
       libgcc-s1 \
       libjson-c5 \
       libpcre2-8-0 \
       libssl3t64 \
       libxml2 \
       zlib1g \
  && rm -rf /var/lib/apt/lists/*

# The three binaries this scanner actually invokes, plus the ClamAV-owned
# shared libraries they link against (libclamav, libfreshclam, and
# libclamav's own bundled libclammspack/libclamunrar) - copied individually
# rather than the whole image, so nothing unused (clamav-milter, clamdtop,
# clamconf, clamsubmit, the Rust static archive) ends up in this image.
COPY --from=clamav-source /usr/sbin/clamd /usr/sbin/clamd
COPY --from=clamav-source /usr/bin/clamdscan /usr/bin/clamdscan
COPY --from=clamav-source /usr/bin/freshclam /usr/bin/freshclam
COPY --from=clamav-source /usr/lib/libclamav.so.12 /usr/lib/libclamav.so.12.0.3 /usr/lib/
COPY --from=clamav-source /usr/lib/libclammspack.so.0 /usr/lib/libclammspack.so.0.8.0 /usr/lib/
COPY --from=clamav-source /usr/lib/libclamunrar.so.12 /usr/lib/libclamunrar.so.12.0.3 /usr/lib/
COPY --from=clamav-source /usr/lib/libclamunrar_iface.so.12 /usr/lib/libclamunrar_iface.so.12.0.3 /usr/lib/
COPY --from=clamav-source /usr/lib/libfreshclam.so.3 /usr/lib/libfreshclam.so.3.0.2 /usr/lib/
RUN ldconfig

# Nothing creates these directories automatically (no package post-install
# step runs at all in this COPY-based approach). /var/lib/clamav is not
# listed here - it is created by the database COPY below instead.
RUN mkdir -p /var/log/clamav /etc/clamav

# Explicit, TES-controlled configuration, at the same /etc/clamav location
# this image has always used.
COPY clamd.conf /etc/clamav/clamd.conf
COPY freshclam.conf /etc/clamav/freshclam.conf

# Signature database - copied directly from the pinned official ClamAV
# image's own /var/lib/clamav, not fetched over the network. Direct
# inspection of that image's layers confirmed it ships a real, non-empty
# database (main.cvd, daily.cvd, bytecode.cvd) built alongside these exact
# 1.4.6 binaries, so this build has no dependency on clamav.net or any other
# download endpoint being reachable - a real requirement after two
# independent Cloud Build failures reaching external ClamAV artifact hosts.
# This is build-time seeding only, a separate concern from runtime updating:
# entrypoint.sh's existing best-effort startup `freshclam` (bounded to 30s,
# non-fatal on failure) is unchanged and still attempts to refresh whatever
# this seeds. The copied files are owned by the source image's own `clamav`
# user (uid/gid 1000); ownership is reassigned to `tesscan` below, in the
# same step that already chowns the rest of this directory tree, so this
# copy does not depend on the source image's user model.
COPY --from=clamav-source /var/lib/clamav /var/lib/clamav

# Hard build-time gate: fail unless every copied binary/library actually
# resolves all of its shared-library dependencies under this runtime's
# actual library set - not merely present on disk. A silent ABI mismatch
# (the exact risk this Debian-13 runtime move exists to avoid) would show up
# here as an "=> not found" line from `ldd` and fail the build, rather than
# surfacing later as a container crash.
RUN set -eu; \
  for bin in \
    /usr/sbin/clamd /usr/bin/clamdscan /usr/bin/freshclam \
    /usr/lib/libclamav.so.12 /usr/lib/libfreshclam.so.3 \
    /usr/lib/libclammspack.so.0 /usr/lib/libclamunrar.so.12 \
    /usr/lib/libclamunrar_iface.so.12; \
  do \
    echo "=== ldd $bin ==="; \
    ldd "$bin"; \
    if ldd "$bin" | grep -qi "not found"; then \
      echo "FATAL: $bin has an unresolved shared library dependency under this runtime"; \
      exit 1; \
    fi; \
  done

# Build-time version assertion: fails the build outright if the copied
# binaries do not actually report 1.4.6 - together with the ldd gate above,
# this proves the binaries both identify as the pinned version and actually
# execute correctly under this runtime's shared libraries.
RUN test -x /usr/sbin/clamd \
  && test -x /usr/bin/clamdscan \
  && test -x /usr/bin/freshclam \
  && /usr/sbin/clamd --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)" \
  && /usr/bin/clamdscan --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)" \
  && /usr/bin/freshclam --version | grep -qE "ClamAV ${CLAMAV_VERSION}([^0-9]|\$)"

# Hard build-time gate on the copied database: fails the build if
# /var/lib/clamav is empty, or if it does not contain recognized ClamAV
# database material for both the main and daily signature sets (accepting
# either the compressed .cvd form or an already-unpacked .cld form, since
# either is a valid, loadable ClamAV database file).
RUN set -eu; \
  test -n "$(ls -A /var/lib/clamav)" \
    || { echo "FATAL: /var/lib/clamav is empty after copying from clamav-source"; exit 1; }; \
  { test -f /var/lib/clamav/main.cvd || test -f /var/lib/clamav/main.cld; } \
    || { echo "FATAL: no main.cvd/main.cld found in the copied signature database"; exit 1; }; \
  { test -f /var/lib/clamav/daily.cvd || test -f /var/lib/clamav/daily.cld; } \
    || { echo "FATAL: no daily.cvd/daily.cld found in the copied signature database"; exit 1; }

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
