# Comparative Evaluation Summary

- Generated at: `2026-03-10T16:14:43Z`
- Route: `/heavy?burn_ms=40`
- Metrics route filter: `/`
- Config file: `config.live.dynamic.json`
- Compose file: `docker-compose.live.yml`
- Results dir: `result_live`
- Requests per region: `500`
- Backend services: `zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10`
- User region input mode: `header-synthetic`
- Carbon variance profile: `default`
- Carbon provider override: `electricitymap`
- Failure scenario enabled: `True`
- Baseline for savings: `baseline_no_carbon_balanced`

| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | expected cross->green % | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| carbon_first | 0.70% | 95.97 | 131.24 | +45.19 | 422 | 265 | 121 | 0.00% | 0.61 | -0.01 | 10.20 | +1.92 | 243.21 | +58.78% | +55.17% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 15, 'zone-06': 93, 'zone-09': 438, 'zone-02': 194, 'zone-08': 36, 'zone-01': 107, 'zone-05': 110}`
| balanced | 1.20% | 91.39 | 128.82 | +42.76 | 382 | 111 | 148 | 0.00% | 0.63 | +0.01 | 8.45 | +0.17 | 389.09 | +34.05% | +32.11% |
  - dominant zone: `zone-01`; zone split: `{'zone-10': 97, 'zone-06': 8, 'zone-09': 198, 'zone-05': 198, 'zone-01': 199, 'zone-02': 149, 'zone-07': 16, 'zone-08': 118, 'zone-03': 5}`
| latency_first | 1.80% | 74.38 | 86.70 | +0.65 | 0 | 0 | 0 | 0.00% | 0.62 | -0.00 | 8.09 | -0.18 | 447.25 | +24.19% | +23.81% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 266, 'zone-02': 221, 'zone-09': 363, 'zone-05': 132}`
| carbon_first_provider_timeout | 1.40% | 93.67 | 130.86 | +44.81 | 391 | 99 | 99 | 0.00% | 0.69 | +0.07 | 7.68 | -0.60 | 349.59 | +40.74% | +37.00% |
  - dominant zone: `zone-06`; zone split: `{'zone-10': 199, 'zone-07': 98, 'zone-09': 6, 'zone-08': 193, 'zone-02': 100, 'zone-06': 200, 'zone-05': 190}`
| explicit_cross_region_to_green | 1.70% | 92.72 | 129.55 | +43.49 | 358 | 208 | 100 | 0.00% | 0.63 | +0.01 | 8.41 | +0.13 | 255.69 | +56.66% | +53.67% |
  - dominant zone: `zone-09`; zone split: `{'zone-10': 32, 'zone-06': 172, 'zone-09': 269, 'zone-08': 50, 'zone-01': 55, 'zone-02': 269, 'zone-05': 136}`
| baseline_no_carbon_strict_local | 1.10% | 72.47 | 86.35 | +0.29 | 0 | 0 | 0 | 0.00% | 0.56 | -0.06 | 7.21 | -1.07 | 587.75 | +0.38% | +0.26% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 491, 'zone-05': 498}`
| baseline_no_carbon_latency_first | 2.10% | 72.65 | 86.35 | +0.30 | 0 | 0 | 0 | 0.00% | 0.60 | -0.02 | 8.02 | -0.26 | 587.64 | +0.40% | -0.02% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 484, 'zone-05': 495}`
| baseline_no_carbon_balanced | 1.70% | 72.36 | 86.05 | +0.00 | 0 | 0 | 0 | 0.00% | 0.62 | +0.00 | 8.28 | +0.00 | 589.98 | +0.00% | +0.00% |
  - dominant zone: `zone-05`; zone split: `{'zone-01': 488, 'zone-05': 495}`
