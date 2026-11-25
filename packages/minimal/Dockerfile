FROM oven/bun:1.4.4-alpine
WORKDIR /app
RUN chown bun:bun /app
USER bun

COPY --chown=bun:bun package.json bun.lock* ./
COPY --chown=bun:bun patches ./patches
RUN bun install --production

COPY --chown=bun:bun . .
RUN bun run build

ENV PORT=3333
EXPOSE 3333
CMD ["bun", "run", "start"]
