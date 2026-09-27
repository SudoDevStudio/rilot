# syntax=docker/dockerfile:1.7
#
# Native Rilot proxy. Routing decisions come from crates/rilot-core (the same
# engine the browser playground runs as WebAssembly).
#
#   docker build -t rilot .
#   docker run -p 8080:8080 -v "$PWD/my-config.json:/app/config.json:ro" rilot

ARG RUST_VERSION=1.93

FROM rust:${RUST_VERSION}-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY crates ./crates
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked -p rilot \
    && cp target/release/rilot /usr/local/bin/rilot

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin rilot
WORKDIR /app
COPY --from=builder /usr/local/bin/rilot /usr/local/bin/rilot
# Default config (simple format). Mount your own over /app/config.json.
COPY docker/config.json /app/config.json
ENV RILOT_HOST=0.0.0.0 \
    RILOT_PORT=8080 \
    RUST_LOG=info
USER rilot
EXPOSE 8080
CMD ["/usr/local/bin/rilot", "/app/config.json"]
