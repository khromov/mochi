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
# Base image defaults to oven/bun:1.3.14-alpine (pure musl alpine, multi-arch),
# overridable via the BUN_IMAGE build arg so a single workspace can ride a
# different Bun tag without moving the others — the site is temporarily pinned
# to oven/bun:canary-alpine in .github/workflows/build.yml while demos stays on
# the stable default. Earlier revisions used frolvlad/alpine-glibc with a copied
# bun binary; that combo broke @tailwindcss/oxide's native binding on linux/arm64
# because the glibc compat shim was loaded in place of musl libc.

ARG BUN_IMAGE=oven/bun:1.3.14-alpine
FROM ${BUN_IMAGE} AS base
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
COPY --from=install /temp/dev/packages/docs/node_modules packages/docs/node_modules
COPY --from=install /temp/dev/packages/shared/node_modules packages/shared/node_modules

# ncdu for disk usage analysis. libgcc is already present in oven/bun:alpine.
RUN apk add --no-cache ncdu

# .mochi for runtime build cache; src/ must be writable too because demos'
# tailwind step writes app.generated.css into src/ at startup (no-op for site).
RUN mkdir -p packages/${WORKSPACE}/.mochi && chown -R bun:bun packages/${WORKSPACE}/.mochi packages/${WORKSPACE}/src

# Bake every generated barrel into the image. Dev mode regenerates these at
# boot (index.ts), but the deployed rootfs is read-only for the `bun` user, so
# the runtime write is a no-op that recovers onto whatever file is already
# present — the barrel MUST exist in the image or the SSR compile fails with
# "Could not resolve". Any new src/lib/*.generated.ts barrel needs a line here.
RUN bun packages/site/src/lib/generateDocsBarrel.ts
RUN bun packages/site/src/lib/generateBlogBarrel.ts

ENV WORKSPACE=${WORKSPACE}
ENV PORT=${PORT}
ENV MOCHI_LIVE_RELOAD=false
ENV MOCHI_DOCKER=true
USER bun
EXPOSE ${PORT}/tcp

# No curl/wget in the alpine base; bun is on PATH, so probe with fetch. Reads
# PORT from the env above and hits the bare /health: it is a Mochi.api() route,
# so trailingSlash:'always' never applies to it and /health/ is a hard 404.
#HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
#  CMD bun --eval "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]
