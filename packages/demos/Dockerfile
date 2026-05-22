# Dev-mode image for the standalone demos site.
# Modeled on the root Dockerfile but scoped to packages/demos. Runs in
# development mode so the debug bar and dev overlays are visible in the
# deployed environment.

FROM oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

# install dependencies into a temp directory — copying every workspace's
# package.json so bun install can resolve the workspace topology
FROM base AS install
RUN mkdir -p /temp/dev/packages/mochi /temp/dev/packages/demos
COPY package.json bun.lock /temp/dev/
COPY packages/mochi/package.json /temp/dev/packages/mochi/
COPY packages/demos/package.json /temp/dev/packages/demos/
RUN cd /temp/dev && bun install --frozen-lockfile

# minimal alpine-glibc release image
FROM frolvlad/alpine-glibc:latest AS release
WORKDIR /usr/src/app

# create non-root user
RUN addgroup -g 1000 bun && adduser -u 1000 -G bun -s /bin/sh -D bun

# copy bun binary
COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

# source first (.dockerignore strips node_modules / .mochi / db at any depth)
COPY package.json tsconfig.json tsconfig.base.json ./
COPY --chown=bun:bun packages packages

# resolved node_modules trees from the install stage (root + each workspace)
COPY --from=install /temp/dev/node_modules node_modules
COPY --from=install /temp/dev/packages/demos/node_modules packages/demos/node_modules
COPY --from=install /temp/dev/packages/mochi/node_modules packages/mochi/node_modules

# libgcc is required by @tailwindcss/oxide's musl native binding (libgcc_s.so.1)
RUN apk add --no-cache libgcc ncdu

# create runtime build-cache dir under packages/demos/ and ensure src/ is
# writable — tailwind.ts writes app.generated.css into src/ at startup
RUN mkdir -p packages/demos/.mochi && chown -R bun:bun packages/demos/.mochi packages/demos/src

# run in development mode (enables debug bar and dev overlays)
USER bun
EXPOSE 3334/tcp
ENTRYPOINT [ "bun", "run", "dev:demos" ]
