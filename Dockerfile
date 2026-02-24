FROM rust:1.86 AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY crates ./crates
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/rilot /usr/local/bin/rilot
COPY config.json /app/config.json
EXPOSE 8080
CMD ["/usr/local/bin/rilot", "/app/config.json"]
