# run-it — Rilot chalaun de saare tareeke

Har script repo de kise vi folder ton chal sakdi hai, te har ikk `--help` samjhaundi hai.

```bash
./run-it/check.sh          # ki installed hai, te kehdi script nu ki chahida
```

| Script | Ki chalaunda hai | Kithe |
| --- | --- | --- |
| `native.sh` | Asli proxy + local backend simulators | http://127.0.0.1:8080 |
| `demo-shop.sh` | Split-screen Astro site: shop + live routing (+ panel da "Policy" tab jithe har route di policy set kar sakde ho) | http://localhost:4321 |
| `playground.sh` | Policy Playground (config/decision explorer) | http://localhost:5173 |
| `worker.sh` | Cloudflare Worker (workerd, local) | http://127.0.0.1:8787 |
| `docker.sh` | Proxy container vich | http://127.0.0.1:8080 |
| `research.sh` | Comparative experiment (research-kit) | `research-kit/get_result/` |
| `test-all.sh` | Repo de saare test suites | — |

## Sabh ton pehlan

```bash
rustup target add wasm32-unknown-unknown   # ikk vaar
./run-it/check.sh
```

Pehli vaar `native.sh` jaan `docker.sh` chalaun te release build kujh minute laenda hai (wasmtime vadda hai). Baad vich cached hunda hai.

## Kujh udaharnaan

```bash
./run-it/native.sh                    # simple config naal
./run-it/native.sh --legacy           # purani proxies config naal
./run-it/native.sh --config my.json
PORT=9090 ./run-it/native.sh

./run-it/demo-shop.sh                 # dev server
./run-it/demo-shop.sh --build         # production build + preview

./run-it/worker.sh                    # local
./run-it/worker.sh --deploy           # Cloudflare te (wrangler login + KV chahida)

./run-it/docker.sh                    # build + run
./run-it/docker.sh --no-build         # pehlan bani image naal

./run-it/research.sh --quick          # chhota smoke run
./run-it/research.sh --compose        # Rilot + simulators + Prometheus

./run-it/test-all.sh                  # sab
./run-it/test-all.sh --rust           # sirf Rust (sabh ton tez)
```

## Proxy chalde hoye eh try karo

```bash
# latency rule → sabh ton nerhe backend, carbon lookup bilkul nahin
curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/checkout/pay

# carbon rule → sabh ton saaf grid
curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/reports/monthly

# apni jagah badlo: London ton dono US backends radius ton bahar
curl -i -H 'x-user-location: 51.5,-0.13' http://127.0.0.1:8080/reports/monthly

curl http://127.0.0.1:8080/metrics
```

Response headers vich faisla dissda hai: `x-rilot-selected-zone`, `x-rilot-decision-reason`, te `x-rilot-zone-filter-reasons` (har backend kyon reject hoya).

## Dhyan rakhan wali gallan

- Har script apne shuru kite hoye processes hi band kardi hai. Je simulators pehlan hi chal rahe hon (port 5601 busy), taan script ohnan nu chhed-chhaad nahin kardi.
- Ctrl-C naal proxy/container te simulators dono band ho jande han.
- `research.sh` de results `research-kit/get_result/` vich jande han — oh har run te dubara bande han te git vich nahin jande.

Hor jaankari: [../docs/running.pa.md](../docs/running.pa.md) (poora run guide) te [../README.md](../README.md).
