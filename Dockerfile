# Dev-mode image shared by both deployed apps (site + demos). The deployed
# variant is selected by the WORKSPACE build arg:
#   docker build --build-arg WORKSPACE=site  -f Dockerfile .   # mochi
#   docker build --build-arg WORKSPACE=demos -f Dockerfile .   # mochi-demos
# Running in dev mode (`bun run dev:<workspace>` sets MODE=development) so
# the debug bar and dev overlays are visible in the deployed environment.
# Prebuilt production variants live at Dockerfile.production and
# packages/demos/Dockerfile.production if we ever need to flip back.

FROM oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

# install dependencies into a temp directory. We copy the whole packages/
# tree (rather than only the workspace package.json files) for the same
# reason Dockerfile.production does: bun install needs to reconcile the
# lockfile topology AND resolve workspace:* bin shims (e.g. mochi-framework
# -> src/cli.js), and packages/ also carries packages/mochi/patches/ which
# the root package.json's patchedDependencies field references. Trades a
# bit of layer-cache granularity for robustness.
FROM base AS install
COPY package.json bun.lock /temp/dev/
COPY packages /temp/dev/packages
RUN cd /temp/dev && bun install --frozen-lockfile

# minimal alpine-glibc release image
FROM frolvlad/alpine-glibc:latest AS release
ARG WORKSPACE=site
ARG PORT=3333
WORKDIR /usr/src/app

# create non-root user
RUN addgroup -g 1000 bun && adduser -u 1000 -G bun -s /bin/sh -D bun

# copy bun binary
COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

# source first (.dockerignore strips node_modules / .mochi / db at any depth)
COPY package.json tsconfig.json tsconfig.base.json ./
COPY --chown=bun:bun packages packages

# resolved node_modules trees from the install stage (root + selected workspace + mochi)
COPY --from=install /temp/dev/node_modules node_modules
COPY --from=install /temp/dev/packages/mochi/node_modules packages/mochi/node_modules
# Need a static second source — Docker COPY can't take an ARG-suffixed src
# path AND a different dst, so we copy both workspace node_modules trees.
# The unused one is a few MB and harmless.
COPY --from=install /temp/dev/packages/site/node_modules packages/site/node_modules
COPY --from=install /temp/dev/packages/demos/node_modules packages/demos/node_modules

# libgcc is required by @tailwindcss/oxide's musl native binding (demos uses
# tailwind; harmless for site). ncdu for disk usage analysis.
RUN apk add --no-cache libgcc ncdu

# .mochi for runtime build cache; src/ must be writable too because demos'
# tailwind step writes app.generated.css into src/ at startup (no-op for site).
RUN mkdir -p packages/${WORKSPACE}/.mochi && chown -R bun:bun packages/${WORKSPACE}/.mochi packages/${WORKSPACE}/src

ENV WORKSPACE=${WORKSPACE}
USER bun
EXPOSE ${PORT}/tcp
ENTRYPOINT [ "sh", "-c", "exec bun run dev:${WORKSPACE}" ]
