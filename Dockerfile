# use the official Bun image for building
FROM oven/bun:1.3.14 AS base
WORKDIR /usr/src/app

# install dependencies into a temp directory — copying every workspace's
# package.json so bun install can resolve the workspace topology
FROM base AS install
RUN mkdir -p /temp/dev/packages/mochi /temp/dev/packages/site
COPY package.json bun.lock /temp/dev/
COPY packages/mochi/package.json /temp/dev/packages/mochi/
COPY packages/site/package.json /temp/dev/packages/site/
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
COPY --from=install /temp/dev/packages/site/node_modules packages/site/node_modules
COPY --from=install /temp/dev/packages/mochi/node_modules packages/mochi/node_modules

# install ncdu for disk usage analysis
RUN apk add --no-cache ncdu

# create runtime build-cache dir under packages/site/
RUN mkdir -p packages/site/.mochi && chown -R bun:bun packages/site/.mochi

# run in development mode (enables debug bar and dev overlays)
USER bun
EXPOSE 3333/tcp
ENTRYPOINT [ "bun", "run", "dev:site" ]
