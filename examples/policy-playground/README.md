# Policy Playground

This example app is an educational and exploratory companion for the Rilot repository.

It is intentionally different from the formal benchmark and comparative-evaluation workflow in `research-kit/`:

- it is frontend-only
- it uses a simplified, explainable decision model
- it recomputes immediately on every input change
- it is meant to help researchers and reviewers inspect why a region was selected or rejected

It is **not** the benchmark suite and should not be used as a substitute for the formal results pipeline.

## What it demonstrates

- local baseline identification
- candidate filtering and guardrails
- weighted scoring over carbon, latency, reliability, and cost
- hysteresis preventing a switch when improvement is too small
- local fail-safe fallback when every candidate is rejected
- exact rejection reasons per candidate

## Presets

1. Local pinned interactive
2. Balanced routing
3. Carbon-first background
4. Cleaner but rejected
5. Hysteresis prevents flapping

## Run locally

```bash
cd examples/policy-playground
npm install
npm run dev
```

## Test

```bash
npm run test
```

## Build

```bash
npm run build
```

## Deploy to GitHub Pages

This app is prepared for static deployment on GitHub Pages.

What is already wired:

- Vite reads `VITE_BASE_PATH` so the app can build correctly under a repository subpath
- `.github/workflows/policy-playground-pages.yml` installs dependencies, runs tests, builds the app, and deploys `dist/` to Pages

Recommended repository setup:

1. Push this repo to GitHub.
2. In repository settings, enable **Pages** with **GitHub Actions** as the source.
3. Keep the app in `examples/policy-playground/`; the workflow will build and deploy from there.

The published URL will usually look like:

```text
https://<github-user>.github.io/<repository-name>/
```

Manual local check with a Pages-style base path:

```bash
cd examples/policy-playground
VITE_BASE_PATH=/rilot/ npm run build
```

