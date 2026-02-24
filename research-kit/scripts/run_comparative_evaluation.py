#!/usr/bin/env python3
import csv
import json
import math
import os
import random
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
ROUTE = os.environ.get("ROUTE", "/")
REQUESTS_PER_REGION = int(os.environ.get("REQUESTS_PER_REGION", "150"))
RILOT_HOST_PORT = os.environ.get("RILOT_HOST_PORT", "18080")
RILOT_URL = os.environ.get("RILOT_URL", f"http://127.0.0.1:{RILOT_HOST_PORT}")
USER_REGION_INPUT_MODE = os.environ.get("USER_REGION_INPUT_MODE", "header-synthetic")
COMPOSE = ["docker", "compose", "-f", str(KIT_DIR / "docker-compose.yml")]
COMPOSE_ENV = os.environ.copy()
COMPOSE_ENV["RILOT_HOST_PORT"] = RILOT_HOST_PORT

MODES = [
    ("baseline_no_carbon_balanced", {"enabled": False, "priority_mode": "balanced", "route_class": "flexible"}),
    ("baseline_no_carbon_latency_first", {"enabled": False, "priority_mode": "latency-first", "route_class": "flexible"}),
    ("baseline_no_carbon_strict_local", {"enabled": False, "priority_mode": "latency-first", "route_class": "strict-local"}),
    ("latency_first", {"enabled": True, "priority_mode": "latency-first"}),
    ("carbon_first", {"enabled": True, "priority_mode": "carbon-first"}),
    ("balanced", {"enabled": True, "priority_mode": "balanced"}),
]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def wait_http_ok(url: str, attempts: int = 90, sleep_s: float = 0.5) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if 200 <= resp.status < 500:
                    return True
        except Exception:
            time.sleep(sleep_s)
    return False


def run(cmd, cwd=ROOT):
    subprocess.run(cmd, cwd=str(cwd), check=True, env=COMPOSE_ENV)


def parse_prom_sum(text: str, metric_name: str, route_filter: str):
    total = 0.0
    by_zone = {}
    prefix = f"{metric_name}{{"
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith(prefix):
            continue
        if f'route="{route_filter}"' not in line:
            continue
        try:
            val = float(line.rsplit(" ", 1)[1])
        except Exception:
            continue
        labels = line.split("{", 1)[1].split("}", 1)[0]
        zone = ""
        for pair in labels.split(","):
            if pair.startswith('zone="'):
                zone = pair.split("=", 1)[1].strip('"')
                break
        by_zone[zone] = by_zone.get(zone, 0.0) + val
        total += val
    return total, by_zone


def percentile(values, p):
    if not values:
        return 0.0
    seq = sorted(values)
    idx = max(0, min(len(seq) - 1, math.ceil((p / 100.0) * len(seq)) - 1))
    return float(seq[idx])


def send_requests(base_url: str, scenario: str, out_csv: Path):
    latencies = []
    zone_counts = {}
    ok_count = 0
    err_count = 0
    with out_csv.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        req_counter = 0
        for region in ("us-east", "us-west"):
            for _ in range(1, REQUESTS_PER_REGION + 1):
                req_counter += 1
                req_id = f"req-{req_counter:06d}"
                header_region = region
                if USER_REGION_INPUT_MODE == "mock-fixed-east":
                    header_region = "us-east"
                elif USER_REGION_INPUT_MODE == "mock-fixed-west":
                    header_region = "us-west"
                elif USER_REGION_INPUT_MODE == "mock-random":
                    header_region = random.choice(["us-east", "us-west"])
                headers = {"x-user-region": header_region}
                req = urllib.request.Request(f"{base_url}{ROUTE}", headers=headers)
                start = time.perf_counter()
                code = 0
                zone = ""
                selected_carbon = ""
                decision_reason = ""
                carbon_saved_vs_worst = ""
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        code = resp.status
                        selected_carbon = resp.headers.get("x-rilot-selected-carbon-intensity", "")
                        decision_reason = resp.headers.get("x-rilot-decision-reason", "")
                        carbon_saved_vs_worst = resp.headers.get("x-rilot-carbon-saved-vs-worst", "")
                        body = resp.read().decode("utf-8", errors="replace")
                        try:
                            data = json.loads(body)
                            zone = data.get("zone", "")
                        except Exception:
                            zone = ""
                except Exception:
                    code = 599
                latency_ms = (time.perf_counter() - start) * 1000.0
                latencies.append(latency_ms)
                if 200 <= code < 500:
                    ok_count += 1
                else:
                    err_count += 1
                if zone:
                    zone_counts[zone] = zone_counts.get(zone, 0) + 1
                w.writerow([
                    now_iso(),
                    scenario,
                    req_id,
                    region,
                    header_region,
                    f"{latency_ms:.3f}",
                    code,
                    zone,
                    selected_carbon,
                    carbon_saved_vs_worst,
                    decision_reason,
                ])
    return {
        "latencies": latencies,
        "ok_count": ok_count,
        "error_count": err_count,
        "zone_counts": zone_counts,
    }


def apply_mode(cfg: dict, mode_name: str, mode_cfg: dict) -> dict:
    out = json.loads(json.dumps(cfg))
    for proxy in out.get("proxies", []):
        policy = proxy.get("policy", {})
        policy["plugin_enabled"] = False
        policy["hysteresis_delta"] = 0.0
        policy["min_switch_interval_secs"] = 0
        policy["carbon_cursor_enabled"] = bool(mode_cfg["enabled"])
        policy["priority_mode"] = mode_cfg["priority_mode"]
        if mode_cfg.get("route_class"):
            policy["route_class"] = mode_cfg["route_class"]
        proxy["policy"] = policy
    return out


def collect_rilot_metrics(route: str):
    with urllib.request.urlopen(f"{RILOT_URL}/metrics", timeout=5) as resp:
        metrics_text = resp.read().decode("utf-8")
    req_total, req_by_zone = parse_prom_sum(metrics_text, "requests_total", route)
    co2e_total, _ = parse_prom_sum(metrics_text, "co2e_estimated_total", route)
    exposure_total, _ = parse_prom_sum(metrics_text, "carbon_intensity_exposure_total", route)
    mean_exposure = (exposure_total / req_total) if req_total > 0 else 0.0
    return metrics_text, req_total, req_by_zone, co2e_total, mean_exposure


def main():
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = RESULTS_BASE / f"comparative-{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)
    per_req_csv = out_dir / "requests.csv"
    with per_req_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "timestamp_utc",
            "scenario",
            "request",
            "requested_region",
            "header_region",
            "latency_ms",
            "http_code",
            "selected_zone",
            "selected_carbon_intensity_g_per_kwh",
            "carbon_saved_vs_worst_g_per_kwh",
            "decision_reason",
        ])

    original_config = CONFIG_PATH.read_text(encoding="utf-8")
    base_cfg = json.loads(original_config)
    summaries = []
    try:
        run(COMPOSE + ["up", "-d", "us-east", "us-west"])

        for mode_name, mode_cfg in MODES:
            mode_out = apply_mode(base_cfg, mode_name, mode_cfg)
            CONFIG_PATH.write_text(json.dumps(mode_out, indent=2) + "\n", encoding="utf-8")
            run(COMPOSE + ["up", "-d", "--build", "rilot"])
            if not wait_http_ok(f"{RILOT_URL}/metrics"):
                raise RuntimeError(f"rilot metrics not ready for mode={mode_name}")

            req_stats = send_requests(RILOT_URL, mode_name, per_req_csv)
            metrics_text, req_total, req_by_zone, co2e_total, mean_exposure = collect_rilot_metrics(ROUTE)
            (out_dir / f"metrics-{mode_name}.prom").write_text(metrics_text, encoding="utf-8")

            lats = req_stats["latencies"]
            summaries.append({
                "scenario": mode_name,
                "kind": "rilot_mode",
                "requests": int(req_total),
                "ok_count": req_stats["ok_count"],
                "error_count": req_stats["error_count"],
                "latency_avg_ms": (sum(lats) / len(lats)) if lats else 0.0,
                "latency_p95_ms": percentile(lats, 95),
                "carbon_exposure_mean_g_per_kwh": mean_exposure,
                "co2e_estimated_total_g": co2e_total,
                "zone_counts": req_by_zone,
            })
    finally:
        CONFIG_PATH.write_text(original_config, encoding="utf-8")

    summary_json = out_dir / "summary.json"
    summary_csv = out_dir / "summary.csv"
    summary_md = out_dir / "summary.md"
    summary_json.write_text(json.dumps(summaries, indent=2), encoding="utf-8")

    baseline = next((r for r in summaries if r["scenario"] == "baseline_no_carbon_balanced"), None)
    baseline_exposure = baseline["carbon_exposure_mean_g_per_kwh"] if baseline else 0.0
    baseline_p95 = baseline["latency_p95_ms"] if baseline else 0.0
    for row in summaries:
        saved_abs = baseline_exposure - row["carbon_exposure_mean_g_per_kwh"]
        saved_pct = (saved_abs / baseline_exposure * 100.0) if baseline_exposure > 0 else 0.0
        row["carbon_exposure_saved_g_per_kwh_vs_baseline"] = saved_abs
        row["carbon_exposure_saved_percent_vs_baseline"] = saved_pct
        row["latency_p95_delta_ms_vs_baseline"] = row["latency_p95_ms"] - baseline_p95

    fields = [
        "scenario",
        "kind",
        "requests",
        "ok_count",
        "error_count",
        "latency_avg_ms",
        "latency_p95_ms",
        "latency_p95_delta_ms_vs_baseline",
        "carbon_exposure_mean_g_per_kwh",
        "carbon_exposure_saved_g_per_kwh_vs_baseline",
        "carbon_exposure_saved_percent_vs_baseline",
        "co2e_estimated_total_g",
    ]
    with summary_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for row in summaries:
            out = {k: row.get(k, "") for k in fields}
            w.writerow(out)

    lines = [
        "# Comparative Evaluation Summary",
        "",
        f"- Generated at: `{now_iso()}`",
        f"- Route: `{ROUTE}`",
        f"- Requests per region: `{REQUESTS_PER_REGION}`",
        f"- User region input mode: `{USER_REGION_INPUT_MODE}`",
        f"- Baseline for savings: `baseline_no_carbon_balanced`",
        "",
        "| scenario | avg latency ms | p95 latency ms | p95 delta vs baseline ms | mean carbon exposure g/kWh | saved g/kWh vs baseline | saved % vs baseline | co2e total g |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summaries:
        co2e = "" if row["co2e_estimated_total_g"] is None else f"{row['co2e_estimated_total_g']:.6f}"
        top_zone = ""
        if row.get("zone_counts"):
            top_zone = max(row["zone_counts"].items(), key=lambda it: it[1])[0]
        lines.append(
            f"| {row['scenario']} | {row['latency_avg_ms']:.2f} | {row['latency_p95_ms']:.2f} | "
            f"{row['latency_p95_delta_ms_vs_baseline']:+.2f} | {row['carbon_exposure_mean_g_per_kwh']:.2f} | "
            f"{row['carbon_exposure_saved_g_per_kwh_vs_baseline']:+.2f} | "
            f"{row['carbon_exposure_saved_percent_vs_baseline']:+.2f}% | {co2e} |"
        )
        if top_zone:
            lines.append(f"  - dominant zone: `{top_zone}`; zone split: `{row['zone_counts']}`")
    summary_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Comparative evaluation results saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
