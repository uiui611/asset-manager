FROM oven/bun:1.4.2 AS frontend
WORKDIR /build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html tsconfig.json vite.config.ts playwright.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY tests ./tests
RUN bun run build

FROM rust:1.98.1-bookworm AS backend
WORKDIR /build
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY backend/schema.sql ./schema.sql
RUN cargo build --release --locked
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /build/target/release/asset-manager /app/asset-manager
COPY --from=frontend /build/dist /app/dist
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["/app/asset-manager"]
