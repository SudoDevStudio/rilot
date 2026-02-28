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
CONFIG_FILE_NAME = os.environ.get("CONFIG_FILE_NAME", "config.live.json")
CONFIG_PATH = KIT_DIR / CONFIG_FILE_NAME
RESULTS_DIR_NAME = os.environ.get("RESULTS_DIR_NAME", "result_live")
RESULTS_BASE = KIT_DIR / RESULTS_DIR_NAME
CLEAN_RESULTS_BASE = os.environ.get("CLEAN_RESULTS_BASE", "1") not in ("0", "false", "False")
ROUTE = os.environ.get("ROUTE", "/")
ROUTE_METRIC_FILTER = os.environ.get("ROUTE_METRIC_FILTER", "/")
REQUESTS_PER_REGION = int(os.environ.get("REQUESTS_PER_REGION", "150"))
RILOT_HOST_PORT = os.environ.get("RILOT_HOST_PORT", "18080")
RILOT_URL = os.environ.get("RILOT_URL", f"http://127.0.0.1:{RILOT_HOST_PORT}")
USER_REGION_INPUT_MODE = os.environ.get("USER_REGION_INPUT_MODE", "header-synthetic")
CARBON_VARIANCE_PROFILE = os.environ.get("CARBON_VARIANCE_PROFILE", "default")
ENABLE_FAILURE_SCENARIO = os.environ.get("ENABLE_FAILURE_SCENARIO", "1") not in ("0", "false", "False")
CARBON_PROVIDER_OVERRIDE = os.environ.get("CARBON_PROVIDER_OVERRIDE", "").strip()
ELECTRICITYMAP_FIXTURE_OVERRIDE = os.environ.get("ELECTRICITYMAP_FIXTURE_OVERRIDE", "").strip()
ELECTRICITYMAP_API_KEY_OVERRIDE = os.environ.get("ELECTRICITYMAP_API_KEY_OVERRIDE", "").strip()
ELECTRICITYMAP_BASE_URL_OVERRIDE = os.environ.get("ELECTRICITYMAP_BASE_URL_OVERRIDE", "").strip()
CARBON_API_RESET_URL = os.environ.get("CARBON_API_RESET_URL", "").strip()
COMPOSE_FILE_NAME = os.environ.get("COMPOSE_FILE_NAME", "docker-compose.live.yml")
COMPOSE = ["docker", "compose", "-f", str(KIT_DIR / COMPOSE_FILE_NAME)]
COMPOSE_ENV = os.environ.copy()
COMPOSE_ENV["RILOT_HOST_PORT"] = RILOT_HOST_PORT
RILOT_BUILD_MODE = os.environ.get("RILOT_BUILD_MODE", "reuse")
COMPOSE_RETRIES = int(os.environ.get("COMPOSE_RETRIES", "3"))
COMPOSE_RETRY_DELAY_SECONDS = float(os.environ.get("COMPOSE_RETRY_DELAY_SECONDS", "4"))
BACKEND_SERVICES = [
    s.strip()
    for s in os.environ.get(
        "BACKEND_SERVICES",
        "zone-01,zone-02,zone-03,zone-04,zone-05,zone-06,zone-07,zone-08,zone-09,zone-10",
    ).split(",")
    if s.strip()
]

BASE_MODES = [
    (
        "carbon_first",
        {
            "enabled": True,
            "priority_mode": "carbon-first",
            "constraints_override": {
                "max_added_latency_ms": 300,
                "max_request_share_percent": 100,
                "max_error_rate": 1.0,
            },
            "weights_override": {
                "w_carbon": 1.0,
                "w_latency": 0.0,
                "w_errors": 0.0,
                "w_cost": 0.0,
            },
        },
    ),
    ("balanced", {"enabled": True, "priority_mode": "balanced"}),
    (
        "latency_first",
        {
            "enabled": True,
            "priority_mode": "latency-first",
            "constraints_override": {
                "max_added_latency_ms": 30,
                "max_request_share_percent": 100,
            },
            "weights_override": {
                "w_carbon": 0.0,
                "w_latency": 1.0,
                "w_errors": 0.0,
                "w_cost": 0.0,
            },
        },
    ),
    ("baseline_no_carbon_strict_local", {"enabled": False, "priority_mode": "latency-first", "route_class": "strict-local"}),
    ("baseline_no_carbon_latency_first", {"enabled": False, "priority_mode": "latency-first", "route_class": "flexible"}),
    ("baseline_no_carbon_balanced", {"enabled": False, "priority_mode": "balanced", "route_class": "flexible"}),
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


def run(cmd, cwd=ROOT, retries=0, retry_delay_s=2.0):
    attempts = max(1, retries + 1)
    last_err = None
    for i in range(attempts):
        try:
            subprocess.run(cmd, cwd=str(cwd), check=True, env=COMPOSE_ENV)
            return
        except subprocess.CalledProcessError as e:
            last_err = e
            if i >= attempts - 1:
                raise
            time.sleep(retry_delay_s)
    if last_err:
        raise last_err


def maybe_reset_carbon_api():
    if not CARBON_API_RESET_URL:
        return
    try:
        with urllib.request.urlopen(CARBON_API_RESET_URL, timeout=3) as _:
            return
    except Exception:
        print(f"warning: failed to reset carbon api via {CARBON_API_RESET_URL}", file=sys.stderr)


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


def zone_to_region(zone_name: str, zone_region_map: Optional[dict] = None) -> str:
    if zone_region_map:
        mapped = zone_region_map.get(zone_name)
        if mapped:
            return mapped
    z = (zone_name or "").lower()
    if "east" in z:
        return "us-east"
    if "west" in z:
        return "us-west"
    return ""


def parse_zone_intensity_pairs(raw: str) -> dict:
    out = {}
    for part in (raw or "").split(";"):
        item = part.strip()
        if not item or ":" not in item:
            continue
        name, value = item.split(":", 1)
        key = name.strip()
        if not key:
            continue
        try:
            out[key] = float(value.strip())
        except Exception:
            continue
    return out


def reroute_savings_vs_local(
    request_region: str,
    selected_region: str,
    selected_carbon: str,
    eligible_zone_carbon_intensity: str,
    zone_region_map: dict,
) -> Tuple[str, str]:
    if not request_region or not selected_region or request_region == selected_region:
        return ("0.000", "0.00")

    try:
        selected_value = float(selected_carbon)
    except Exception:
        return ("0.000", "0.00")

    pairs = parse_zone_intensity_pairs(eligible_zone_carbon_intensity)
    local_candidates = []
    for zone_name, intensity in pairs.items():
        zone_region = zone_to_region(zone_name, zone_region_map)
        if zone_region == request_region:
            local_candidates.append(intensity)

    if not local_candidates:
        return ("0.000", "0.00")

    local_best = min(local_candidates)
    saved = max(local_best - selected_value, 0.0)
    if local_best <= 0:
        return (f"{saved:.3f}", "0.00")
    saved_pct = (saved / local_best) * 100.0
    return (f"{saved:.3f}", f"{saved_pct:.2f}")


def parse_zone_filter_reasons(raw: str) -> dict:
    out = {}
    for part in (raw or "").split(";"):
        item = part.strip()
        if not item or ":" not in item:
            continue
        zone, reason = item.split(":", 1)
        zone = zone.strip()
        reason = reason.strip()
        if zone:
            out[zone] = reason
    return out


def build_decision_reason_brief(
    decision_reason: str,
    request_region: str,
    selected_region: str,
    zone_filter_reasons: str,
    is_cross_region: bool,
) -> str:
    reasons = parse_zone_filter_reasons(zone_filter_reasons)
    local_filtered = []
    for zone_name, reason in reasons.items():
        zone_region = zone_to_region(zone_name)
        if zone_region == request_region and reason != "eligible":
            local_filtered.append(reason)

    if local_filtered and is_cross_region:
        uniq = ",".join(sorted(set(local_filtered)))
        return f"reroute-fallback: local filtered({uniq})"

    if is_cross_region:
        return "reroute-green" if decision_reason == "score-win" else "reroute"

    if request_region and selected_region and request_region == selected_region:
        return "local-green" if decision_reason == "score-win" else "local"

    return decision_reason or "unknown"


def build_zone_region_map(cfg: dict) -> dict:
    out = {}
    for proxy in cfg.get("proxies", []):
        for zone in proxy.get("zones", []):
            name = str(zone.get("name", "")).strip()
            region = str(zone.get("region", "")).strip()
            if name and region:
                out[name] = region
    return out


def local_vs_selected_relation(request_region: str, selected_zone: str) -> str:
    selected_region = zone_to_region(selected_zone)
    if not selected_region or not request_region:
        return "unknown"
    if request_region == selected_region:
        return "local"
    return "cross-region"


def load_fixture_expectation(fixture_path: Path):
    try:
        if not fixture_path.exists():
            return None
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


def dict_delta(after: dict, before: dict) -> dict:
    out = {}
    keys = set(after.keys()) | set(before.keys())
    for k in keys:
        val = after.get(k, 0.0) - before.get(k, 0.0)
        if val > 0:
            out[k] = val
    return out


def build_modes(fixture_expectation=None):
    explicit_cross_region_mode = (
        "explicit_cross_region_to_green",
        {
            "enabled": True,
            "priority_mode": "carbon-first",
            "route_class": "flexible",
            "constraints_override": {
                "max_added_latency_ms": 1000,
                "max_error_rate": 1.0,
                "max_request_share_percent": 100,
            },
            "weights_override": {
                "w_carbon": 1.0,
                "w_latency": 0.0,
                "w_errors": 0.0,
                "w_cost": 0.0,
            },
        },
    )
    timeout_mode = (
        "carbon_first_provider_timeout",
        {
            "enabled": True,
            "priority_mode": "carbon-first",
            "provider": "slow-mock",
            "provider_timeout_ms": 5,
            "route_class": "flexible",
        },
    )
    mode_map = {name: cfg for (name, cfg) in BASE_MODES}
    ordered_names = [
        "carbon_first",
        "balanced",
        "latency_first",
        "carbon_first_provider_timeout",
        "explicit_cross_region_to_green",
        "baseline_no_carbon_strict_local",
        "baseline_no_carbon_latency_first",
        "baseline_no_carbon_balanced",
    ]
    modes = []
    for name in ordered_names:
        if name == "carbon_first_provider_timeout":
            if ENABLE_FAILURE_SCENARIO:
                modes.append(timeout_mode)
            continue
        if name == "explicit_cross_region_to_green":
            if mode_map.get("carbon_first") is not None:
                modes.append(explicit_cross_region_mode)
            continue
        cfg = mode_map.get(name)
        if cfg is not None:
            modes.append((name, cfg))
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
    if ELECTRICITYMAP_BASE_URL_OVERRIDE:
        carbon["electricitymap_base_url"] = ELECTRICITYMAP_BASE_URL_OVERRIDE
    if ELECTRICITYMAP_FIXTURE_OVERRIDE:
        carbon["electricitymap_local_fixture"] = ELECTRICITYMAP_FIXTURE_OVERRIDE
    if ELECTRICITYMAP_API_KEY_OVERRIDE:
        carbon["electricitymap_api_key"] = ELECTRICITYMAP_API_KEY_OVERRIDE
    return out


def send_requests(
    base_url: str,
    scenario: str,
    out_csv: Path,
    zone_region_map: dict,
    expected_cross_direction: Optional[str] = None,
):
    latencies = []
    zone_counts = {}
    ok_count = 0
    err_count = 0
    cross_region_count = 0
    east_to_west_count = 0
    west_to_east_count = 0
    expected_cross_hits = 0
    expected_cross_eligible_requests = 0
    selected_carbon_values = []
    expected_from = ""
    expected_to = ""
    if expected_cross_direction and "->" in expected_cross_direction:
        expected_from, expected_to = [p.strip() for p in expected_cross_direction.split("->", 1)]
    with out_csv.open("a", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        for region in ("us-east", "us-west"):
            for _ in range(1, REQUESTS_PER_REGION + 1):
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
                zone_region_from_payload = ""
                selected_carbon = ""
                zone_carbon_intensity = ""
                eligible_zone_carbon_intensity = ""
                zone_filter_reasons = ""
                decision_reason = ""
                decision_reason_brief = ""
                carbon_saved_vs_worst = ""
                carbon_saved_vs_worst_percent = ""
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        code = resp.status
                        selected_carbon = resp.headers.get("x-rilot-selected-carbon-intensity", "")
                        zone_carbon_intensity = resp.headers.get(
                            "x-rilot-zone-carbon-intensity-g-per-kwh", ""
                        )
                        eligible_zone_carbon_intensity = resp.headers.get(
                            "x-rilot-eligible-zone-carbon-intensity-g-per-kwh", ""
                        )
                        zone_filter_reasons = resp.headers.get(
                            "x-rilot-zone-filter-reasons", ""
                        )
                        decision_reason = resp.headers.get("x-rilot-decision-reason", "")
                        carbon_saved_vs_worst = resp.headers.get("x-rilot-carbon-saved-vs-worst", "")
                        carbon_saved_vs_worst_percent = resp.headers.get(
                            "x-rilot-carbon-saved-vs-worst-percent", ""
                        )
                        body = resp.read().decode("utf-8", errors="replace")
                        try:
                            data = json.loads(body)
                            zone = data.get("zone", "")
                            zone_region_from_payload = str(data.get("region", "") or "")
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
                selected_zone_region = zone_to_region(zone, zone_region_map) or zone_region_from_payload
                route_relation = local_vs_selected_relation(header_region, zone)
                if selected_zone_region:
                    if header_region == selected_zone_region:
                        route_relation = "local"
                    else:
                        route_relation = "cross-region"
                is_cross_region = route_relation == "cross-region"
                if is_cross_region:
                    cross_region_count += 1
                    if header_region == "us-east" and selected_zone_region == "us-west":
                        east_to_west_count += 1
                    elif header_region == "us-west" and selected_zone_region == "us-east":
                        west_to_east_count += 1
                if expected_from and expected_to and header_region == expected_from:
                    expected_cross_eligible_requests += 1
                    if is_cross_region and selected_zone_region == expected_to:
                        expected_cross_hits += 1
                if scenario.startswith("baseline_no_carbon_"):
                    carbon_saved_vs_worst = "0.000"
                    carbon_saved_vs_worst_percent = "0.00"
                else:
                    carbon_saved_vs_worst, carbon_saved_vs_worst_percent = reroute_savings_vs_local(
                        header_region,
                        selected_zone_region,
                        selected_carbon,
                        eligible_zone_carbon_intensity,
                        zone_region_map,
                    )
                decision_reason_brief = build_decision_reason_brief(
                    decision_reason,
                    header_region,
                    selected_zone_region,
                    zone_filter_reasons,
                    is_cross_region,
                )
                try:
                    if selected_carbon:
                        selected_carbon_values.append(float(selected_carbon))
                except Exception:
                    pass
                w.writerow([
                    now_iso(),
                    scenario,
                    region,
                    selected_zone_region,
                    "true" if is_cross_region else "false",
                    f"{latency_ms:.3f}",
                    code,
                    selected_carbon,
                    zone_filter_reasons,
                    carbon_saved_vs_worst,
                    carbon_saved_vs_worst_percent,
                    decision_reason,
                    decision_reason_brief,
                ])
    return {
        "latencies": latencies,
        "ok_count": ok_count,
        "error_count": err_count,
        "zone_counts": zone_counts,
        "cross_region_count": cross_region_count,
        "east_to_west_count": east_to_west_count,
        "west_to_east_count": west_to_east_count,
        "expected_cross_hits": expected_cross_hits,
        "expected_cross_eligible_requests": expected_cross_eligible_requests,
        "selected_carbon_mean": (
            (sum(selected_carbon_values) / len(selected_carbon_values))
            if selected_carbon_values
            else None
        ),
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
        if mode_cfg.get("constraints_override"):
            constraints = policy.get("constraints", {})
            constraints.update(mode_cfg["constraints_override"])
            policy["constraints"] = constraints
        if mode_cfg.get("weights_override"):
            weights = policy.get("weights", {})
            weights.update(mode_cfg["weights_override"])
            policy["weights"] = weights
        proxy["policy"] = policy
    return out


def collect_rilot_metrics(route: str):
    with urllib.request.urlopen(f"{RILOT_URL}/metrics", timeout=5) as resp:
        metrics_text = resp.read().decode("utf-8")
    req_total, req_by_zone = parse_prom_sum(metrics_text, "requests_total", route)
    co2e_total, _ = parse_prom_sum(metrics_text, "co2e_estimated_total", route)
    exposure_total, _ = parse_prom_sum(metrics_text, "carbon_intensity_exposure_total", route)
    return metrics_text, req_total, req_by_zone, co2e_total, exposure_total


def main():
    RESULTS_BASE.mkdir(parents=True, exist_ok=True)
    if CLEAN_RESULTS_BASE:
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
            "request_region",
            "selected_region",
            "cross_region_reroute",
            "latency_ms",
            "http_code",
            "selected_carbon_intensity_g_per_kwh",
            "zone_filter_reasons",
            "carbon_saved_vs_worst_g_per_kwh",
            "carbon_saved_vs_worst_percent",
            "decision_reason",
            "decision_reason_brief",
        ])

    original_config = CONFIG_PATH.read_text(encoding="utf-8")
    base_cfg = apply_carbon_provider_overrides(
        apply_carbon_variance_profile(json.loads(original_config))
    )
    zone_region_map = build_zone_region_map(base_cfg)
    if ELECTRICITYMAP_FIXTURE_OVERRIDE:
        fixture_candidate = Path(ELECTRICITYMAP_FIXTURE_OVERRIDE)
        fixture_path = fixture_candidate if fixture_candidate.is_absolute() else (KIT_DIR / fixture_candidate)
    else:
        fixture_path = KIT_DIR / "carbon-traces" / "electricitymap-latest-sample.json"
    fixture_expectation = load_fixture_expectation(fixture_path)
    unique_regions = {r for r in zone_region_map.values() if r}
    if not (len(zone_region_map) == 2 and unique_regions == {"us-east", "us-west"}):
        fixture_expectation = None
    expected_cross_direction = (
        fixture_expectation.get("expected_cross_direction")
        if fixture_expectation
        else None
    )
    modes = build_modes(fixture_expectation)
    summaries = []
    try:
        run(
            COMPOSE + ["up", "-d", "--remove-orphans"] + BACKEND_SERVICES,
            retries=COMPOSE_RETRIES,
            retry_delay_s=COMPOSE_RETRY_DELAY_SECONDS,
        )

        if RILOT_BUILD_MODE == "build-once":
            run(
                COMPOSE + ["up", "-d", "--remove-orphans", "--build", "rilot"],
                retries=COMPOSE_RETRIES,
                retry_delay_s=COMPOSE_RETRY_DELAY_SECONDS,
            )

        for mode_name, mode_cfg in modes:
            maybe_reset_carbon_api()
            mode_out = apply_mode(base_cfg, mode_name, mode_cfg)
            CONFIG_PATH.write_text(json.dumps(mode_out, indent=2) + "\n", encoding="utf-8")
            if RILOT_BUILD_MODE == "build-per-mode":
                run(
                    COMPOSE + ["up", "-d", "--remove-orphans", "--build", "--force-recreate", "rilot"],
                    retries=COMPOSE_RETRIES,
                    retry_delay_s=COMPOSE_RETRY_DELAY_SECONDS,
                )
            else:
                run(
                    COMPOSE + ["up", "-d", "--remove-orphans", "--force-recreate", "rilot"],
                    retries=COMPOSE_RETRIES,
                    retry_delay_s=COMPOSE_RETRY_DELAY_SECONDS,
                )
            if not wait_http_ok(f"{RILOT_URL}/metrics"):
                raise RuntimeError(f"rilot metrics not ready for mode={mode_name}")

            _, req_total_before, req_by_zone_before, co2e_before, exposure_before = collect_rilot_metrics(
                ROUTE_METRIC_FILTER
            )
            cpu_start_usec = read_cgroup_cpu_usage_usec()
            mem_peak_start = read_cgroup_memory_peak_bytes()
            start_wall = time.perf_counter()
            req_stats = send_requests(
                RILOT_URL,
                mode_name,
                per_req_csv,
                zone_region_map,
                expected_cross_direction=expected_cross_direction,
            )
            elapsed_wall = max(time.perf_counter() - start_wall, 0.001)
            cpu_end_usec = read_cgroup_cpu_usage_usec()
            mem_peak_end = read_cgroup_memory_peak_bytes()
            mem_current_end = read_cgroup_memory_current_bytes()
            metrics_text, req_total_after, req_by_zone_after, co2e_after, exposure_after = collect_rilot_metrics(
                ROUTE_METRIC_FILTER
            )
            (out_dir / f"metrics-{mode_name}.prom").write_text(metrics_text, encoding="utf-8")
            req_total_delta = max(req_total_after - req_total_before, 0.0)
            co2e_total = max(co2e_after - co2e_before, 0.0)
            exposure_total = max(exposure_after - exposure_before, 0.0)
            mean_exposure_prom = (exposure_total / req_total_delta) if req_total_delta > 0 else 0.0
            mean_exposure = (
                req_stats["selected_carbon_mean"]
                if req_stats.get("selected_carbon_mean") is not None
                else mean_exposure_prom
            )
            req_by_zone_delta = dict_delta(req_by_zone_after, req_by_zone_before)

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
            scenario_requests = req_stats["ok_count"] + req_stats["error_count"]
            summaries.append({
                "scenario": mode_name,
                "kind": "rilot_mode",
                "requests": int(scenario_requests),
                "ok_count": req_stats["ok_count"],
                "error_count": req_stats["error_count"],
                "error_rate_percent": (req_stats["error_count"] / max(1, int(scenario_requests))) * 100.0,
                "latency_avg_ms": (sum(lats) / len(lats)) if lats else 0.0,
                "latency_p95_ms": percentile(lats, 95),
                "carbon_exposure_mean_g_per_kwh": mean_exposure,
                "carbon_exposure_mean_source": (
                    "request_headers"
                    if req_stats.get("selected_carbon_mean") is not None
                    else "prometheus_delta"
                ),
                "co2e_estimated_total_g": co2e_total,
                "cpu_percent_sample": cpu_percent,
                "cpu_sample_method": "cgroup_delta" if cpu_percent_window is not None else "docker_stats",
                "memory_mb_sample": memory_mb,
                "memory_current_mb_sample": memory_current_mb,
                "memory_peak_delta_mb": memory_peak_delta,
                "zone_counts": req_stats["zone_counts"],
                "requests_total_metric_delta": req_total_delta,
                "requests_by_zone_metric_delta": req_by_zone_delta,
                "cross_region_reroutes": req_stats["cross_region_count"],
                "east_to_west_reroutes": req_stats["east_to_west_count"],
                "west_to_east_reroutes": req_stats["west_to_east_count"],
                "expected_cross_hits": req_stats["expected_cross_hits"],
                "expected_cross_eligible_requests": req_stats["expected_cross_eligible_requests"],
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
        eligible = row.get("expected_cross_eligible_requests", 0) or 0
        hits = row.get("expected_cross_hits", 0) or 0
        row["expected_cross_to_green_rate_percent"] = ((hits / eligible) * 100.0) if eligible > 0 else 0.0

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
        "expected_cross_hits",
        "expected_cross_eligible_requests",
        "expected_cross_to_green_rate_percent",
        "carbon_exposure_mean_g_per_kwh",
        "carbon_exposure_mean_source",
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
        f"- Metrics route filter: `{ROUTE_METRIC_FILTER}`",
        f"- Config file: `{CONFIG_FILE_NAME}`",
        f"- Compose file: `{COMPOSE_FILE_NAME}`",
        f"- Results dir: `{RESULTS_DIR_NAME}`",
        f"- Requests per region: `{REQUESTS_PER_REGION}`",
        f"- Backend services: `{','.join(BACKEND_SERVICES)}`",
        f"- User region input mode: `{USER_REGION_INPUT_MODE}`",
        f"- Carbon variance profile: `{CARBON_VARIANCE_PROFILE}`",
        f"- Carbon provider override: `{CARBON_PROVIDER_OVERRIDE or 'none'}`",
        f"- Failure scenario enabled: `{ENABLE_FAILURE_SCENARIO}`",
        f"- Baseline for savings: `baseline_no_carbon_balanced`",
        "",
        "| scenario | err % | avg latency ms | p95 latency ms | p95 delta ms | reroutes (cross-region) | east->west | west->east | expected cross->green % | cpu % sample | cpu delta % | mem MB sample | mem delta MB | mean exposure g/kWh | exposure saved % | co2e saved % |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
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
            f"{row.get('expected_cross_to_green_rate_percent', 0.0):.2f}% | "
            f"{cpu} | {cpu_delta} | {mem} | {mem_delta} | {row['carbon_exposure_mean_g_per_kwh']:.2f} | "
            f"{row['carbon_exposure_saved_percent_vs_baseline']:+.2f}% | {row['co2e_saved_percent_vs_baseline']:+.2f}% |"
        )
        if top_zone:
            lines.append(f"  - dominant zone: `{top_zone}`; zone split: `{row['zone_counts']}`")

    if fixture_expectation:
        lines.extend([
            "",
            "## Cross-Region Expectation Check",
            f"- Fixture greener region: `{fixture_expectation['greener_region']}`",
            f"- Expected cross-region direction (carbon-aware modes): `{fixture_expectation['expected_cross_direction']}`",
        ])
        for row in summaries:
            if row["scenario"] in ("carbon_first", "balanced", "latency_first", "explicit_cross_region_to_green"):
                lines.append(
                    f"- `{row['scenario']}` observed east->west: `{row.get('east_to_west_reroutes', 0)}`, "
                    f"west->east: `{row.get('west_to_east_reroutes', 0)}`, "
                    f"expected cross->green rate: `{row.get('expected_cross_to_green_rate_percent', 0.0):.2f}%` "
                    f"({row.get('expected_cross_hits', 0)}/{row.get('expected_cross_eligible_requests', 0)})"
                )
    summary_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Comparative evaluation results saved to: {out_dir}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
