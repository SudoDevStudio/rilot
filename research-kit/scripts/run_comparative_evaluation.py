#!/usr/bin/env python3
import csv
import json
import math
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
KIT_DIR = ROOT / "research-kit"
CONFIG_PATH = KIT_DIR / "config.docker.json"
RESULTS_BASE = KIT_DIR / "results"
ROUTE = os.environ.get("ROUTE", "/")
REQUESTS_PER_REGION = int(os.environ.get("REQUESTS_PER_REGION", "150"))
RILOT_HOST_PORT = os.environ.get("RILOT_HOST_PORT", "18080")
RILOT_URL = os.environ.get("RILOT_URL", f"http://127.0.0.1:{RILOT_HOST_PORT}")
USER_REGION_INPUT_MODE = os.environ.get("USER_REGION_INPUT_MODE", "header-synthetic")
CARBON_VARIANCE_PROFILE = os.environ.get("CARBON_VARIANCE_PROFILE", "default")
ENABLE_FAILURE_SCENARIO = os.environ.get("ENABLE_FAILURE_SCENARIO", "1") not in ("0", "false", "False")
CARBON_PROVIDER_OVERRIDE = os.environ.get("CARBON_PROVIDER_OVERRIDE", "").strip()
ELECTRICITYMAP_FIXTURE_OVERRIDE = os.environ.get("ELECTRICITYMAP_FIXTURE_OVERRIDE", "").strip()
ELECTRICITYMAP_API_KEY_OVERRIDE = os.environ.get("ELECTRICITYMAP_API_KEY_OVERRIDE", "").strip()
COMPOSE = ["docker", "compose", "-f", str(KIT_DIR / "docker-compose.yml")]
COMPOSE_ENV = os.environ.copy()
COMPOSE_ENV["RILOT_HOST_PORT"] = RILOT_HOST_PORT

BASE_MODES = [
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


def parse_size_to_mib(value: str) -> Optional[float]:
    raw = (value or "").strip().replace("iB", "B")
    if not raw:
        return None
    units = [("GB", 1024.0), ("MB", 1.0), ("KB", 1.0 / 1024.0), ("B", 1.0 / (1024.0 * 1024.0))]
    for unit, factor in units:
        if raw.endswith(unit):
            try:
                number = float(raw[: -len(unit)].strip())
                return number * factor
            except Exception:
                return None
    try:
        return float(raw) / (1024.0 * 1024.0)
    except Exception:
        return None


def collect_rilot_resource_sample() -> Tuple[Optional[float], Optional[float]]:
    try:
        out = subprocess.check_output(
            ["docker", "stats", "--no-stream", "--format", "{{.CPUPerc}},{{.MemUsage}}", "rilot"],
            cwd=str(ROOT),
            env=COMPOSE_ENV,
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if not out:
            return (None, None)
        cpu_raw, _, mem_raw = out.partition(",")
        cpu_raw = cpu_raw.strip()
        if cpu_raw.endswith("%"):
            cpu_raw = cpu_raw[:-1].strip()
        cpu_percent = float(cpu_raw) if cpu_raw else None
        mem_usage = mem_raw.split("/", 1)[0].strip() if mem_raw else ""
        memory_mb = parse_size_to_mib(mem_usage)
        return (cpu_percent, memory_mb)
    except Exception:
        return (None, None)


def bytes_to_mib(value: Optional[int]) -> Optional[float]:
    if value is None:
        return None
    return value / (1024.0 * 1024.0)


def docker_exec_capture(cmd: str) -> Optional[str]:
    try:
        out = subprocess.check_output(
            ["docker", "exec", "rilot", "sh", "-lc", cmd],
            cwd=str(ROOT),
            env=COMPOSE_ENV,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return out.strip()
    except Exception:
        return None


def read_cgroup_cpu_usage_usec() -> Optional[int]:
    # cgroup v2 primary path
    out = docker_exec_capture("cat /sys/fs/cgroup/cpu.stat 2>/dev/null || true")
    if out:
        for line in out.splitlines():
            parts = line.split()
            if len(parts) != 2:
                continue
            key, raw = parts
            if key == "usage_usec":
                try:
                    return int(raw)
                except Exception:
                    pass
            if key == "usage_nsec":
                try:
                    return int(int(raw) / 1000)
                except Exception:
                    pass

    # cgroup v1 fallback (nanoseconds)
    out = docker_exec_capture("cat /sys/fs/cgroup/cpuacct/cpuacct.usage 2>/dev/null || true")
    if out:
        try:
            return int(int(out) / 1000)
        except Exception:
            return None
    return None


def read_cgroup_memory_current_bytes() -> Optional[int]:
    out = docker_exec_capture(
        "cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || true"
    )
    if not out:
        return None
    try:
        return int(out)
    except Exception:
        return None


def read_cgroup_memory_peak_bytes() -> Optional[int]:
    out = docker_exec_capture(
        "cat /sys/fs/cgroup/memory.peak 2>/dev/null || cat /sys/fs/cgroup/memory/memory.max_usage_in_bytes 2>/dev/null || true"
    )
    if not out:
        return None
    try:
        return int(out)
    except Exception:
        return None


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


def zone_to_region(zone_name: str) -> str:
    z = (zone_name or "").lower()
    if "east" in z:
        return "us-east"
    if "west" in z:
        return "us-west"
    return ""


def local_vs_selected_relation(request_region: str, selected_zone: str) -> str:
    selected_region = zone_to_region(selected_zone)
    if not selected_region or not request_region:
        return "unknown"
    if request_region == selected_region:
        return "local"
    return "cross-region"


def load_fixture_expectation():
    fixture_path = KIT_DIR / "carbon-traces" / "electricitymap-latest-sample.json"
    try:
        data = json.loads(fixture_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    zones = data.get("zones", {})
    east = zones.get("us-east", {}).get("carbonIntensity")
    west = zones.get("us-west", {}).get("carbonIntensity")
    if east is None or west is None:
        return None
    if east < west:
        return {
            "greener_region": "us-east",
            "expected_cross_direction": "us-west->us-east",
        }
    if west < east:
        return {
            "greener_region": "us-west",
            "expected_cross_direction": "us-east->us-west",
        }
    return {
        "greener_region": "tie",
        "expected_cross_direction": "none",
    }


def build_modes():
    modes = list(BASE_MODES)
    if ENABLE_FAILURE_SCENARIO:
        modes.append(
            (
                "carbon_first_provider_timeout",
                {
                    "enabled": True,
                    "priority_mode": "carbon-first",
                    "provider": "slow-mock",
                    "provider_timeout_ms": 5,
                    "route_class": "flexible",
                },
            )
        )
    return modes


def apply_carbon_variance_profile(cfg: dict) -> dict:
    out = json.loads(json.dumps(cfg))
    if CARBON_VARIANCE_PROFILE != "high-variance":
        return out
    carbon = out.setdefault("carbon", {})
    carbon["zone_current"] = {
        "us-east": 120,
        "us-west": 780,
    }
    carbon["zone_forecast_next"] = {
        "us-east": 110,
        "us-west": 700,
    }
    return out


def apply_carbon_provider_overrides(cfg: dict) -> dict:
    out = json.loads(json.dumps(cfg))
    carbon = out.setdefault("carbon", {})
    if CARBON_PROVIDER_OVERRIDE:
        carbon["provider"] = CARBON_PROVIDER_OVERRIDE
    if ELECTRICITYMAP_FIXTURE_OVERRIDE:
        carbon["electricitymap_local_fixture"] = ELECTRICITYMAP_FIXTURE_OVERRIDE
    if ELECTRICITYMAP_API_KEY_OVERRIDE:
        carbon["electricitymap_api_key"] = ELECTRICITYMAP_API_KEY_OVERRIDE
    return out


def send_requests(base_url: str, scenario: str, out_csv: Path):
    latencies = []
    zone_counts = {}
    ok_count = 0
    err_count = 0
    cross_region_count = 0
    east_to_west_count = 0
    west_to_east_count = 0
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
                carbon_saved_vs_worst_percent = ""
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        code = resp.status
                        selected_carbon = resp.headers.get("x-rilot-selected-carbon-intensity", "")
                        decision_reason = resp.headers.get("x-rilot-decision-reason", "")
                        carbon_saved_vs_worst = resp.headers.get("x-rilot-carbon-saved-vs-worst", "")
                        carbon_saved_vs_worst_percent = resp.headers.get(
                            "x-rilot-carbon-saved-vs-worst-percent", ""
                        )
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
                selected_zone_region = zone_to_region(zone)
                route_relation = local_vs_selected_relation(header_region, zone)
                is_cross_region = route_relation == "cross-region"
                if is_cross_region:
                    cross_region_count += 1
                    if header_region == "us-east" and selected_zone_region == "us-west":
                        east_to_west_count += 1
                    elif header_region == "us-west" and selected_zone_region == "us-east":
                        west_to_east_count += 1
                w.writerow([
                    now_iso(),
                    scenario,
                    req_id,
                    region,
                    header_region,
                    selected_zone_region,
                    route_relation,
                    "true" if is_cross_region else "false",
                    f"{latency_ms:.3f}",
                    code,
                    zone,
                    selected_carbon,
                    carbon_saved_vs_worst,
                    carbon_saved_vs_worst_percent,
                    decision_reason,
                ])
    return {
        "latencies": latencies,
        "ok_count": ok_count,
        "error_count": err_count,
        "zone_counts": zone_counts,
        "cross_region_count": cross_region_count,
        "east_to_west_count": east_to_west_count,
        "west_to_east_count": west_to_east_count,
    }


def apply_mode(cfg: dict, mode_name: str, mode_cfg: dict) -> dict:
    out = json.loads(json.dumps(cfg))
    if "provider" in mode_cfg:
        out.setdefault("carbon", {})["provider"] = mode_cfg["provider"]
    if "provider_timeout_ms" in mode_cfg:
        out.setdefault("carbon", {})["provider_timeout_ms"] = int(mode_cfg["provider_timeout_ms"])
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
    RESULTS_BASE.mkdir(parents=True, exist_ok=True)
    for child in RESULTS_BASE.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = RESULTS_BASE / f"comparative-{timestamp}"
    out_dir.mkdir(parents=True, exist_ok=True)
    per_req_csv = out_dir / "requests.csv"
    with per_req_csv.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "timestamp_utc",
            "scenario",
            "request_id",
            "request_region",
            "routing_input_region",
            "selected_zone_region",
            "route_relation",
            "cross_region_reroute",
            "latency_ms",
            "http_code",
            "selected_zone",
            "selected_carbon_intensity_g_per_kwh",
            "carbon_saved_vs_worst_g_per_kwh",
            "carbon_saved_vs_worst_percent",
            "decision_reason",
        ])

    original_config = CONFIG_PATH.read_text(encoding="utf-8")
    base_cfg = apply_carbon_provider_overrides(
        apply_carbon_variance_profile(json.loads(original_config))
    )
    modes = build_modes()
    summaries = []
    try:
        run(COMPOSE + ["up", "-d", "us-east", "us-west"])

        for mode_name, mode_cfg in modes:
            mode_out = apply_mode(base_cfg, mode_name, mode_cfg)
            CONFIG_PATH.write_text(json.dumps(mode_out, indent=2) + "\n", encoding="utf-8")
            run(COMPOSE + ["up", "-d", "--build", "rilot"])
            if not wait_http_ok(f"{RILOT_URL}/metrics"):
                raise RuntimeError(f"rilot metrics not ready for mode={mode_name}")

            cpu_start_usec = read_cgroup_cpu_usage_usec()
            mem_peak_start = read_cgroup_memory_peak_bytes()
            start_wall = time.perf_counter()
            req_stats = send_requests(RILOT_URL, mode_name, per_req_csv)
            elapsed_wall = max(time.perf_counter() - start_wall, 0.001)
            cpu_end_usec = read_cgroup_cpu_usage_usec()
            mem_peak_end = read_cgroup_memory_peak_bytes()
            mem_current_end = read_cgroup_memory_current_bytes()
            metrics_text, req_total, req_by_zone, co2e_total, mean_exposure = collect_rilot_metrics(ROUTE)
            (out_dir / f"metrics-{mode_name}.prom").write_text(metrics_text, encoding="utf-8")

            lats = req_stats["latencies"]
            cpu_percent_stats, memory_mb_stats = collect_rilot_resource_sample()
            cpu_percent_window = None
            if cpu_start_usec is not None and cpu_end_usec is not None and cpu_end_usec >= cpu_start_usec:
                cpu_delta_secs = (cpu_end_usec - cpu_start_usec) / 1_000_000.0
                cpu_percent_window = (cpu_delta_secs / elapsed_wall) * 100.0
            cpu_percent = cpu_percent_window if cpu_percent_window is not None else cpu_percent_stats

            memory_peak_delta = None
            if mem_peak_start is not None and mem_peak_end is not None:
                memory_peak_delta = bytes_to_mib(max(mem_peak_end - mem_peak_start, 0))
            memory_mb = bytes_to_mib(mem_peak_end) if mem_peak_end is not None else memory_mb_stats
            memory_current_mb = bytes_to_mib(mem_current_end)
            summaries.append({
                "scenario": mode_name,
                "kind": "rilot_mode",
                "requests": int(req_total),
                "ok_count": req_stats["ok_count"],
                "error_count": req_stats["error_count"],
                "error_rate_percent": (req_stats["error_count"] / max(1, int(req_total))) * 100.0,
                "latency_avg_ms": (sum(lats) / len(lats)) if lats else 0.0,
                "latency_p95_ms": percentile(lats, 95),
                "carbon_exposure_mean_g_per_kwh": mean_exposure,
                "co2e_estimated_total_g": co2e_total,
                "cpu_percent_sample": cpu_percent,
                "cpu_sample_method": "cgroup_delta" if cpu_percent_window is not None else "docker_stats",
                "memory_mb_sample": memory_mb,
                "memory_current_mb_sample": memory_current_mb,
                "memory_peak_delta_mb": memory_peak_delta,
                "zone_counts": req_by_zone,
                "cross_region_reroutes": req_stats["cross_region_count"],
                "east_to_west_reroutes": req_stats["east_to_west_count"],
                "west_to_east_reroutes": req_stats["west_to_east_count"],
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
    baseline_co2e = baseline["co2e_estimated_total_g"] if baseline else 0.0
    baseline_cpu = baseline["cpu_percent_sample"] if baseline else None
    baseline_mem = baseline["memory_mb_sample"] if baseline else None
    for row in summaries:
        saved_abs = baseline_exposure - row["carbon_exposure_mean_g_per_kwh"]
        saved_pct = (saved_abs / baseline_exposure * 100.0) if baseline_exposure > 0 else 0.0
        row["carbon_exposure_saved_g_per_kwh_vs_baseline"] = saved_abs
        row["carbon_exposure_saved_percent_vs_baseline"] = saved_pct
        row["latency_p95_delta_ms_vs_baseline"] = row["latency_p95_ms"] - baseline_p95
        if baseline_co2e and row.get("co2e_estimated_total_g") is not None:
            co2e_saved = baseline_co2e - row["co2e_estimated_total_g"]
            row["co2e_saved_g_vs_baseline"] = co2e_saved
            row["co2e_saved_percent_vs_baseline"] = (co2e_saved / baseline_co2e) * 100.0
        else:
            row["co2e_saved_g_vs_baseline"] = 0.0
            row["co2e_saved_percent_vs_baseline"] = 0.0
        if baseline_cpu is not None and row.get("cpu_percent_sample") is not None:
            row["cpu_delta_percent_vs_baseline"] = row["cpu_percent_sample"] - baseline_cpu
        else:
            row["cpu_delta_percent_vs_baseline"] = None
        if baseline_mem is not None and row.get("memory_mb_sample") is not None:
            row["memory_delta_mb_vs_baseline"] = row["memory_mb_sample"] - baseline_mem
        else:
            row["memory_delta_mb_vs_baseline"] = None

    fields = [
        "scenario",
        "kind",
        "requests",
        "ok_count",
        "error_count",
        "error_rate_percent",
        "latency_avg_ms",
        "latency_p95_ms",
        "latency_p95_delta_ms_vs_baseline",
        "cpu_percent_sample",
        "cpu_sample_method",
        "cpu_delta_percent_vs_baseline",
        "memory_mb_sample",
        "memory_current_mb_sample",
        "memory_peak_delta_mb",
        "memory_delta_mb_vs_baseline",
        "cross_region_reroutes",
        "east_to_west_reroutes",
        "west_to_east_reroutes",
        "carbon_exposure_mean_g_per_kwh",
        "carbon_exposure_saved_g_per_kwh_vs_baseline",
        "carbon_exposure_saved_percent_vs_baseline",
        "co2e_estimated_total_g",
        "co2e_saved_g_vs_baseline",
        "co2e_saved_percent_vs_baseline",
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
        f"- Carbon variance profile: `{CARBON_VARIANCE_PROFILE}`",
        f"- Carbon provider override: `{CARBON_PROVIDER_OVERRIDE or 'none'}`",
        f"- Failure scenario enabled: `{ENABLE_FAILURE_SCENARIO}`",
        f"- Baseline for savings: `baseline_no_carbon_balanced`",
        "",
        "| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for row in summaries:
        cpu = "" if row.get("cpu_percent_sample") is None else f"{row['cpu_percent_sample']:.2f}"
        cpu_delta = "" if row.get("cpu_delta_percent_vs_baseline") is None else f"{row['cpu_delta_percent_vs_baseline']:+.2f}"
        mem = "" if row.get("memory_mb_sample") is None else f"{row['memory_mb_sample']:.2f}"
        mem_delta = "" if row.get("memory_delta_mb_vs_baseline") is None else f"{row['memory_delta_mb_vs_baseline']:+.2f}"
        top_zone = ""
        if row.get("zone_counts"):
            top_zone = max(row["zone_counts"].items(), key=lambda it: it[1])[0]
        lines.append(
            f"| {row['scenario']} | {row['error_rate_percent']:.2f}% | {row['latency_avg_ms']:.2f} | {row['latency_p95_ms']:.2f} | "
            f"{row['latency_p95_delta_ms_vs_baseline']:+.2f} | {row.get('cross_region_reroutes', 0)} | "
            f"{row.get('east_to_west_reroutes', 0)} | {row.get('west_to_east_reroutes', 0)} | "
            f"{cpu} | {cpu_delta} | {mem} | {mem_delta} | {row['carbon_exposure_mean_g_per_kwh']:.2f} | "
            f"{row['carbon_exposure_saved_percent_vs_baseline']:+.2f}% | {row['co2e_saved_percent_vs_baseline']:+.2f}% |"
        )
        if top_zone:
            lines.append(f"  - dominant zone: `{top_zone}`; zone split: `{row['zone_counts']}`")

    fixture_expectation = load_fixture_expectation()
    if fixture_expectation:
        lines.extend([
            "",
            "## Cross-Region Expectation Check",
            f"- Fixture greener region: `{fixture_expectation['greener_region']}`",
            f"- Expected cross-region direction (carbon-aware modes): `{fixture_expectation['expected_cross_direction']}`",
        ])
        for row in summaries:
            if row["scenario"] in ("carbon_first", "balanced", "latency_first"):
                lines.append(
                    f"- `{row['scenario']}` observed east->west: `{row.get('east_to_west_reroutes', 0)}`, "
                    f"west->east: `{row.get('west_to_east_reroutes', 0)}`"
                )
    summary_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Comparative evaluation results saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
