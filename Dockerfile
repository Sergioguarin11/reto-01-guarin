FROM oven/bun:1.3-slim
LABEL org.opencontainers.image.source=https://github.com/Sergioguarin11/reto-01-guarin
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production
COPY . .
RUN mkdir -p out && chown -R bun:bun /app/out
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
USER bun
CMD ["bun", "src/server.ts"]
