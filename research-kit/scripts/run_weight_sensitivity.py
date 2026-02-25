#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KIT_DIR = ROOT / "research-kit"
CONFIG_PATH = KIT_DIR / "config.docker.json"
RESULTS_BASE = KIT_DIR / "results"
RILOT_HOST_PORT = os.environ.get("RILOT_HOST_PORT", "18080")
RILOT_URL = os.environ.get("RILOT_URL", f"http://127.0.0.1:{RILOT_HOST_PORT}")
REQUESTS = int(os.environ.get("SENSITIVITY_REQUESTS", "200"))
ROUTE = os.environ.get("ROUTE", "/")
COMPOSE = ["docker", "compose", "-f", str(KIT_DIR / "docker-compose.yml")]
COMPOSE_ENV = os.environ.copy()
COMPOSE_ENV["RILOT_HOST_PORT"] = RILOT_HOST_PORT

WEIGHT_SETS = [
    ("carbon_70", {"w_carbon": 0.70, "w_latency": 0.20, "w_errors": 0.10, "w_cost": 0.0}),
    ("balanced_50", {"w_carbon": 0.50, "w_latency": 0.35, "w_errors": 0.15, "w_cost": 0.0}),
    ("latency_70", {"w_carbon": 0.20, "w_latency": 0.70, "w_errors": 0.10, "w_cost": 0.0}),
]


def run(cmd):
    subprocess.run(cmd, cwd=str(ROOT), check=True, env=COMPOSE_ENV)


def wait_http_ok(url: str, attempts: int = 60, sleep_s: float = 0.5) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if 200 <= resp.status < 500:
                    return True
        except Exception:
            time.sleep(sleep_s)
    return False


def parse_prom_sum(text: str, metric_name: str, route_filter: str):
    total = 0.0
    prefix = f"{metric_name}{{"
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith(prefix):
            continue
        if f'route="{route_filter}"' not in line:
            continue
        try:
            total += float(line.rsplit(" ", 1)[1])
        except Exception:
            continue
    return total


def send_requests():
    for idx in range(REQUESTS):
        region = "us-east" if idx % 2 == 0 else "us-west"
        req = urllib.request.Request(f"{RILOT_URL}{ROUTE}", headers={"x-user-region": region})
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
        except Exception:
            pass


def collect_metrics():
    with urllib.request.urlopen(f"{RILOT_URL}/metrics", timeout=5) as resp:
        text = resp.read().decode("utf-8")
    req_total = parse_prom_sum(text, "requests_total", ROUTE)
    exposure_total = parse_prom_sum(text, "carbon_intensity_exposure_total", ROUTE)
    co2e_total = parse_prom_sum(text, "co2e_estimated_total", ROUTE)
    mean_exposure = (exposure_total / req_total) if req_total > 0 else 0.0
    return req_total, mean_exposure, co2e_total


def main():
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = RESULTS_BASE / f"sensitivity-{timestamp}"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    original_config = CONFIG_PATH.read_text(encoding="utf-8")
    base_cfg = json.loads(original_config)
    rows = []
    try:
        run(COMPOSE + ["up", "-d", "us-east", "us-west"])
        for label, weights in WEIGHT_SETS:
            cfg = json.loads(json.dumps(base_cfg))
            for proxy in cfg.get("proxies", []):
                policy = proxy.get("policy", {})
                policy["carbon_cursor_enabled"] = True
                policy["priority_mode"] = "balanced"
                policy["weights"] = weights
                policy["plugin_enabled"] = False
                proxy["policy"] = policy
            CONFIG_PATH.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
            run(COMPOSE + ["up", "-d", "--build", "rilot"])
            if not wait_http_ok(f"{RILOT_URL}/metrics"):
                raise RuntimeError(f"Rilot not ready for {label}")
            send_requests()
            req_total, mean_exposure, co2e_total = collect_metrics()
            rows.append(
                {
                    "weight_profile": label,
                    "requests": int(req_total),
                    "w_carbon": weights["w_carbon"],
                    "w_latency": weights["w_latency"],
                    "w_errors": weights["w_errors"],
                    "w_cost": weights["w_cost"],
                    "carbon_exposure_mean_g_per_kwh": mean_exposure,
                    "co2e_estimated_total_g": co2e_total,
                }
            )
    finally:
        CONFIG_PATH.write_text(original_config, encoding="utf-8")

    (out_dir / "weights-summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    lines = [
        "# Weight Sensitivity Summary",
        "",
        "| profile | requests | w_carbon | w_latency | w_errors | mean exposure g/kWh | co2e total g |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for row in rows:
        lines.append(
            f"| {row['weight_profile']} | {row['requests']} | {row['w_carbon']:.2f} | {row['w_latency']:.2f} | "
            f"{row['w_errors']:.2f} | {row['carbon_exposure_mean_g_per_kwh']:.2f} | {row['co2e_estimated_total_g']:.6f} |"
        )
    (out_dir / "weights-summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Weight sensitivity results saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
