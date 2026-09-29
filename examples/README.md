# Examples

Everything here is for trying Rilot out. None of it is required to run the proxy.

| Folder | What it is | Start with |
| --- | --- | --- |
| `config/` | Ready-to-run configs | `config.json` |
| `node-apps/` | Local backend simulators (ports 5601–5605) | `./node-apps/run-local-zones.sh` |
| `demo-shop/` | Split-screen Astro site: a storefront and its live routing decisions | `npm run dev` |
| `policy-playground/` | Browser tool for exploring configs and decisions | `npm run dev` |
| `wasm-plugin/` | Example Wasm plugin for per-route overrides | `cargo build --release --target wasm32-wasip1` |
| `scripts/` | Python demo runs against the legacy config | `python3 scripts/test_policy_modes.py` |

## Configs

- **`config/config.json`** — the current, simple format: `backends`, `policy`, `radius_km`, `fallback`, `routing_rules`. Two backends pointing at the simulators on 5601/5602, and two rules (`/checkout/*` latency, `/reports/*` carbon). This is the one to copy:

  ```bash
  cp examples/config/config.json config.json
  ./examples/node-apps/run-local-zones.sh          # in another terminal
  RILOT_EXPOSE_RESEARCH_HEADERS=true cargo run --release -- config.json

  curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/checkout/pay     # → east
  curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/reports/monthly  # → west
  ```

- **`config/legacy-proxies.json`** — the older `proxies[]` format, kept so the legacy shim stays exercised (and tested). Rilot translates it into the same routing config at load time. It uses all six simulators and the Wasm plugin. See the legacy section of [docs/config-reference.md](../docs/config-reference.md).

## Quick start

`./run-it/demo-shop.sh`, `./run-it/playground.sh` and `./run-it/native.sh` start these without any manual steps — see [run-it/README.md](../run-it/README.md).

Full instructions, including Docker, the Cloudflare Worker and the test suites: [docs/running.pa.md](../docs/running.pa.md) (Punjabi, Roman script) or the root [README](../README.md).
