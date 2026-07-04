FROM oven/bun:1.3.14-alpine
WORKDIR /app

COPY package.json bun.lock* ./
COPY patches ./patches
RUN bun install --production

COPY . .
RUN bun run build

ENV PORT=3334
EXPOSE 3334
CMD ["bun", "run", "start"]
