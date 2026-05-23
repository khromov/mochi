# Dev-mode image shared by both deployed apps (site + demos). The deployed
# variant is selected by the WORKSPACE build arg:
#   docker build --build-arg WORKSPACE=site  -f Dockerfile .   # mochi
#   docker build --build-arg WORKSPACE=demos -f Dockerfile .   # mochi-demos
# Running in dev mode (`bun run dev:<workspace>` sets MODE=development) so
# the debug bar and dev overlays are visible in the deployed environment.
# MOCHI_LIVE_RELOAD=false strips the live-reload WS — the socket is flaky
# behind the deploy proxy and dropped connections trigger a page reload.
# Prebuilt production variants live at Dockerfile.production and
# packages/demos/Dockerfile.production if we ever need to flip back.
#
# Base image is oven/bun:1.3.14-alpine (pure musl alpine, multi-arch).
# Earlier revisions used frolvlad/alpine-glibc with a copied bun binary;
# that combo broke @tailwindcss/oxide's native binding on linux/arm64
# because the glibc compat shim was loaded in place of musl libc.

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /usr/src/app

# install dependencies into a temp directory. We copy the whole packages/
# tree (rather than only the workspace package.json files) so bun install
# can reconcile the lockfile topology AND resolve workspace:* bin shims
# (e.g. mochi-framework -> src/cli.js). packages/ also carries
# packages/mochi/patches/ which the root package.json's patchedDependencies
# field references. Trades a bit of layer-cache granularity for robustness.
FROM base AS install
COPY package.json bun.lock /temp/dev/
COPY packages /temp/dev/packages
RUN cd /temp/dev && bun install --frozen-lockfile

# release image — same alpine base, no glibc shim
FROM base AS release
ARG WORKSPACE=site
ARG PORT=3333

# source first (.dockerignore strips node_modules / .mochi / db at any depth)
COPY package.json tsconfig.json tsconfig.base.json ./
COPY --chown=bun:bun packages packages

# resolved node_modules trees from the install stage. Docker COPY can't take
# an ARG-suffixed src path with a different dst, so we copy both workspace
# trees and accept the few MB of unused weight in each image.
COPY --from=install /temp/dev/node_modules node_modules
COPY --from=install /temp/dev/packages/mochi/node_modules packages/mochi/node_modules
COPY --from=install /temp/dev/packages/site/node_modules packages/site/node_modules
COPY --from=install /temp/dev/packages/demos/node_modules packages/demos/node_modules

# ncdu for disk usage analysis. libgcc is already present in oven/bun:alpine.
RUN apk add --no-cache ncdu

# .mochi for runtime build cache; src/ must be writable too because demos'
# tailwind step writes app.generated.css into src/ at startup (no-op for site).
RUN mkdir -p packages/${WORKSPACE}/.mochi && chown -R bun:bun packages/${WORKSPACE}/.mochi packages/${WORKSPACE}/src

ENV WORKSPACE=${WORKSPACE}
ENV MOCHI_LIVE_RELOAD=false
USER bun
EXPOSE ${PORT}/tcp
ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]
