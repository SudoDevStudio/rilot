# Rilot kiven chalauna hai (Punjabi guide)

Eh guide sirf **chalaun** baare hai: native proxy, Docker, browser playground, Cloudflare Worker, te tests.

Rilot kamm kiven karda hai — oh [how-it-works.pa.md](how-it-works.pa.md) vich hai.

Saare commands repo de root (`rilot/`) ton chalde han, jithe vakhra na dasseya hove.

---

## 0. Ki chahida

| Cheez | Kis layi | Check |
| --- | --- | --- |
| Rust (stable) | native proxy, saare tests | `cargo --version` |
| `wasm32-unknown-unknown` target | playground te Worker (rilot-core nu Wasm vich banaun layi) | `rustup target list --installed` |
| Node.js 20+ | playground, Worker, carbon layer tests | `node -v` |
| Docker (optional) | container vich chalaun layi | `docker --version` |

Wasm target ikk vaar add kar lao:

```bash
rustup target add wasm32-unknown-unknown
```

---

## 1. Sab ton saukha tareeka: `run-it/` scripts

Har cheez layi ikk script hai, te har ikk apne processes aap band kardi hai:

```bash
./run-it/check.sh        # ki installed hai
./run-it/native.sh       # proxy + simulators
./run-it/demo-shop.sh    # split-screen demo
./run-it/playground.sh   # policy playground
./run-it/worker.sh       # Cloudflare Worker (local)
./run-it/docker.sh       # container vich
./run-it/research.sh     # comparative experiment
./run-it/test-all.sh     # saare tests
```

Vaid: [../run-it/README.md](../run-it/README.md). Hethaan har cheez hath naal chalaun da tareeka vi dassya hai.

---

## 2. Sab ton chhoti shuruaat (30 second)

Kujh vi chalaun ton pehlan, engine sahi hai ja nahin:

```bash
cargo test --workspace
```

Sab pass hon taan routing engine, carbon policy te native adapter theek han.

---

## 3. Native Rilot proxy chalauna

### 3a. Nakli backends (simulators) chalao

Vakhri terminal window vich:

```bash
./examples/node-apps/run-local-zones.sh
```

Eh ports te chhe apps chalaunda hai:

| App | Port |
| --- | --- |
| us-east | 5601 |
| us-west | 5602 |
| checkout-local | 5603 |
| background-east | 5604 |
| background-west | 5605 |
| plugin-oracle | 3012 |

Sirf do chahide hon taan:

```bash
node examples/node-apps/us-east-app.js &   # 5601
node examples/node-apps/us-west-app.js &   # 5602
```

### 3b. Config banao

Repo vich `config.json` nahin hundi (gitignored hai). Sabh ton saukha tareeka — taiyar example copy kar lo:

```bash
cp examples/config/config.json config.json
```

Eh config upar wale do simulators (5601 te 5602) naal chaldi hai, te do routing rules dikhaundi hai: `/checkout/*` layi latency policy (800 km radius) te `/reports/*` layi carbon policy.

Purani (legacy) `proxies` wali config vi chaldi hai — oh vekhni hove taan `examples/config/legacy-proxies.json` varto (ohnu saare chhe simulators chahide han).

### 3c. Proxy chalao

```bash
RILOT_EXPOSE_RESEARCH_HEADERS=true cargo run --release -- config.json
```

`http://127.0.0.1:8080` te chalega. Startup log vich dissega ki kehdi config te kehda carbon provider chuneya gaya.

### 3d. Test karo

```bash
# latency rule → east (sabh ton nerhe)
curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/checkout/pay

# carbon rule → west (sabh ton saaf bijli)
curl -i -H 'x-user-region: us-east-1' http://127.0.0.1:8080/reports/monthly

# metrics
curl http://127.0.0.1:8080/metrics
```

Radius test karan da sabh ton saukha tareeka — apni jagah header naal badlo:

```bash
# Montreal ton: dono backends radius de andar
curl -i -H 'x-user-location: 45.5,-73.6' http://127.0.0.1:8080/reports/monthly

# London ton: dono US backends radius ton bahar → fallback
curl -i -H 'x-user-location: 51.5,-0.13' http://127.0.0.1:8080/reports/monthly
```

Response headers vich eh vekho:

| Header | Matlab |
| --- | --- |
| `x-rilot-selected-zone` | kehda backend chuneya |
| `x-rilot-decision-reason` | kyon chuneya (`lowest-latency`, `score-win`, `fallback-nearest`, …) |
| `x-rilot-zone-filter-reasons` | har backend eligible si ja kyon reject hoya |
| `x-rilot-carbon-saved-vs-worst` | sabh ton gande eligible backend de mukable kinni CO2 bachi |

### 3e. Kamm de environment variables

| Variable | Kamm |
| --- | --- |
| `RILOT_HOST`, `RILOT_PORT` | kithe sunna hai (default `127.0.0.1:8080`) |
| `RILOT_EXPOSE_RESEARCH_HEADERS=true` | upar wale `x-rilot-*` headers on karda hai |
| `RILOT_ELECTRICITYMAP_API_KEY` | asli Electricity Maps data layi |
| `RUST_LOG=debug` | vadh logs |

Asli carbon data chahida hove taan config vich `"provider": "electricitymap"` karo te key env vich deo:

```bash
export RILOT_ELECTRICITYMAP_API_KEY=...
```

---

## 4. Docker naal

```bash
docker build -t rilot .

# default config (docker/config.json) naal
docker run -p 8080:8080 rilot

# apni config naal
docker run -p 8080:8080 \
  -v "$PWD/config.json:/app/config.json:ro" \
  -e RILOT_EXPOSE_RESEARCH_HEADERS=true \
  rilot
```

Default config tuhadi machine de simulators (5601/5602) nu `host.docker.internal` rahin call kardi hai. **Linux** te eh vadho:

```bash
--add-host=host.docker.internal:host-gateway
```

Pura research setup (Rilot + simulators + Prometheus):

```bash
cd research-kit
docker compose up --build
# Rilot: http://localhost:8080   Prometheus: http://localhost:9090
```

Hor config chahidi hove taan: `CONFIG_FILE_NAME=config.live.json docker compose up --build`.

---

## 5. Policy Playground (browser vich)

```bash
cd examples/policy-playground
npm install
npm run dev
```

`http://localhost:5173` khollo. (Pehli vaar `rilot-core` Wasm vich compile hunda hai, is layi thodi der lagdi hai.)

- Upar **Normal / Research** toggle hai.
- "Examples" vich Checkout / Recommendations / Reports presets han.
- "Edit the full config as JSON" vich apni poori Rilot config paste kar ke path test kar sakde ho.

Production build (jiven GitHub Pages te jaanda hai):

```bash
npm run build
VITE_BASE_PATH=/rilot/ npm run build   # repo subpath naal
npm run preview
```

---

## 6. Cloudflare Worker

```bash
cd adapters/cloudflare
npm install          # npm 10.9.x te error aave taan: npm install --legacy-peer-deps
npm run dev          # http://127.0.0.1:8787
```

Test karo:

```bash
curl http://127.0.0.1:8787/__rilot/health

# faisla vekho, bina asli backend de
curl "http://127.0.0.1:8787/__rilot/decision?path=/checkout/pay"
curl "http://127.0.0.1:8787/__rilot/decision?path=/reports/monthly"

# asli traffic (backend nu forward hunda hai)
curl -i http://127.0.0.1:8787/anything
```

> Bina Electricity Maps key de saare backends `carbon-unavailable` honge te `fallback-nearest` chalega — eh sahi behaviour hai, galti nahin.

### Deploy

```bash
npx wrangler login

# KV namespace (last-known-good carbon signals)
npx wrangler kv namespace create CARBON
npx wrangler kv namespace create CARBON --preview
# donon ids wrangler.toml de [[kv_namespaces]] vich paste karo

# API key (vars vich kade na paao)
npx wrangler secret put ELECTRICITYMAP_API_KEY

# apne backends layi wrangler.toml vich RILOT_CONFIG badlo
npm run deploy
```

Deploy ton baad:

```bash
curl https://rilot-edge.<tuhada-subdomain>.workers.dev/__rilot/health
curl "https://rilot-edge.<tuhada-subdomain>.workers.dev/__rilot/decision?path=/reports/monthly"
npx wrangler tail          # live logs
```

---

## 7. Saare tests

```bash
# Rust: routing engine, carbon policy, native adapter
cargo test --workspace

# ohi routing fixtures, compile kiti hoyi Wasm vich
node scripts/check-wasm-fixtures.mjs

# carbon layer (TypeScript service + Rust policy)
cd packages/rilot-carbon && npm install && npm test && cd ../..

# Cloudflare Worker (asli workerd vich)
cd adapters/cloudflare && npm test && cd ../..

# Playground
cd examples/policy-playground && npm test && cd ../..
```

Ikko var sab chalaun layi:

```bash
cargo test --workspace \
  && node scripts/check-wasm-fixtures.mjs \
  && (cd packages/rilot-carbon && npm test) \
  && (cd adapters/cloudflare && npm test) \
  && (cd examples/policy-playground && npm test)
```

---

## 8. Aam masle te hal

| Masla | Hal |
| --- | --- |
| `error: target 'wasm32-unknown-unknown' not found` | `rustup target add wasm32-unknown-unknown` |
| `npm error Cannot read properties of null (reading 'edgesOut')` | npm da bug hai: `npm install --legacy-peer-deps` |
| Worker test: *"newest date supported by this server binary is …"* | `wrangler.toml` vich `compatibility_date` ghatt karo, jaan `npm i -D wrangler@latest` |
| `502 Bad Gateway` | simulators nahin chal rahe — `./examples/node-apps/run-local-zones.sh` chalao |
| `503 No eligible backend` | koi backend eligible nahin. Response vich `reason` te har candidate da kaaran dissega (radius, carbon, latency…) |
| Har backend `carbon-unavailable` | carbon provider data nahin de reha (key nahin, jaan signal 300s ton purana). `"provider": "static"` naal test karo |
| `Address already in use` | `RILOT_PORT=8081` varto |
| Playground khaali page | `npm run dev` de logs vekho; Wasm build fail hoyi hovegi (Rust target check karo) |

---

## 9. Quick reference

| Kamm | Command |
| --- | --- |
| Simulators | `./examples/node-apps/run-local-zones.sh` |
| Native proxy | `cargo run --release -- config.json` |
| Docker | `docker build -t rilot . && docker run -p 8080:8080 rilot` |
| Playground | `cd examples/policy-playground && npm run dev` |
| Worker (local) | `cd adapters/cloudflare && npm run dev` |
| Worker (deploy) | `cd adapters/cloudflare && npm run deploy` |
| Saare Rust tests | `cargo test --workspace` |
| Research experiment | `cd research-kit && docker compose up --build` |
