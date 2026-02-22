use hyper::service::{make_service_fn, service_fn};
use hyper::{
    header::{HeaderName, HeaderValue},
    Body, Client, Request, Response, Server, StatusCode, Uri,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crate::{config, wasm_engine};

const CROSS_REGION_RTT_PENALTY_MS: f64 = 40.0;

#[derive(Serialize)]
struct WasmInput {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Clone)]
struct ZoneCandidate {
    name: String,
    app_uri: String,
    region: String,
    base_rtt_ms: f64,
    cost_weight: f64,
    max_in_flight: Option<usize>,
    tags: Vec<String>,
}

#[derive(Default, Clone)]
struct ZoneRuntimeStats {
    requests: u64,
    errors: u64,
}

#[derive(Clone)]
struct CachedCarbon {
    current: Option<f64>,
    forecast_next: Option<f64>,
    expires_at: Instant,
}

#[derive(Default, Clone)]
struct RouteZoneMetrics {
    requests_total: u64,
    errors_total: u64,
    co2e_estimated_total_g: f64,
    energy_estimated_total_j: f64,
    latency_sum_ms: f64,
    latency_count: u64,
    latency_buckets: [u64; 7],
}

#[derive(Default)]
struct MetricsStore {
    route_zone: HashMap<(String, String), RouteZoneMetrics>,
    carbon_intensity_g_per_kwh: HashMap<String, f64>,
}

#[derive(Clone)]
struct LastDecision {
    zone: String,
    score: f64,
    at: Instant,
}

#[derive(Default)]
struct RuntimeState {
    metrics: MetricsStore,
    zone_stats: HashMap<String, ZoneRuntimeStats>,
    zone_in_flight: HashMap<String, usize>,
    carbon_cache: HashMap<String, CachedCarbon>,
    refresh_in_flight: HashSet<String>,
    last_decision_by_route: HashMap<String, LastDecision>,
    decision_counter: u64,
}

#[derive(Clone)]
struct AppState {
    inner: Arc<RwLock<RuntimeState>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(RuntimeState::default())),
        }
    }
}

#[derive(Clone)]
struct StaticState {
    zones_by_route: Arc<HashMap<String, Vec<ZoneCandidate>>>,
}

#[derive(Clone)]
struct RouteClassified {
    route_class: String,
    carbon_cursor_enabled: bool,
    forecasting_enabled: bool,
    time_shift_enabled: bool,
    plugin_enabled: bool,
}

#[derive(Clone)]
struct ZoneScore {
    zone: ZoneCandidate,
    score: f64,
    carbon_g_per_kwh: Option<f64>,
    latency_ms: f64,
    error_rate: f64,
    cost: f64,
    filtered_out_reason: Option<String>,
}

#[derive(Clone)]
struct CarbonSignal {
    current: Option<f64>,
    forecast_next: Option<f64>,
}

pub async fn start_proxy(config: Arc<config::Config>) {
    let state = AppState::new();
    let static_state = build_static_state(&config);
    spawn_rollup_task(config.clone(), state.clone());

    let make_svc = make_service_fn(move |_conn| {
        let cfg = config.clone();
        let st = state.clone();
        let ss = static_state.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle_request(req, cfg.clone(), st.clone(), ss.clone())
            }))
        }
    });

    let host = std::env::var("RILOT_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("RILOT_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::new(host.parse().expect("Invalid host"), port);

    println!("🚀 Rilot proxy starting at http://{}", addr);
    let server = Server::bind(&addr).serve(make_svc);
    if let Err(e) = server.await {
        eprintln!("❌ Server error: {}", e);
    }
}

fn build_static_state(config: &config::Config) -> StaticState {
    let mut zones_by_route = HashMap::new();
    for proxy in &config.proxies {
        zones_by_route.insert(proxy.rule.path.clone(), resolve_zones(proxy));
    }
    StaticState {
        zones_by_route: Arc::new(zones_by_route),
    }
}

fn spawn_rollup_task(config: Arc<config::Config>, state: AppState) {
    if !config.metrics.enabled || config.metrics.rollup_interval_secs == 0 {
        return;
    }

    let interval_secs = config.metrics.rollup_interval_secs;
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(interval_secs));
        loop {
            ticker.tick().await;
            let lines = build_rollup_lines(&state);
            for line in lines {
                log::info!("rollup={}", line);
            }
        }
    });
}

fn build_rollup_lines(state: &AppState) -> Vec<String> {
    let s = state.inner.read().expect("state lock poisoned");
    let mut per_route: HashMap<String, (u64, u64, f64, f64)> = HashMap::new();
    for ((route, _zone), m) in &s.metrics.route_zone {
        let entry = per_route
            .entry(route.clone())
            .or_insert((0, 0, 0.0, 0.0));
        entry.0 += m.requests_total;
        entry.1 += m.errors_total;
        entry.2 += m.co2e_estimated_total_g;
        entry.3 += m.latency_sum_ms;
    }

    per_route
        .into_iter()
        .map(|(route, (reqs, errs, co2e, latency_sum))| {
            let avg_latency = if reqs > 0 { latency_sum / reqs as f64 } else { 0.0 };
            json!({
                "route": route,
                "requests_total": reqs,
                "errors_total": errs,
                "co2e_estimated_total_g": co2e,
                "avg_latency_ms": avg_latency
            })
            .to_string()
        })
        .collect()
}

fn simple_response(status: StatusCode, body: impl Into<Body>) -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "text/plain")
        .body(body.into())
        .unwrap())
}

async fn handle_request(
    mut req: Request<Body>,
    config: Arc<config::Config>,
    state: AppState,
    static_state: StaticState,
) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    if config.metrics.enabled && path == config.metrics.path {
        return render_metrics(state);
    }

    let matched_proxy = config.proxies.iter().find(|p| match p.rule.r#type.as_str() {
        "exact" => path == p.rule.path,
        _ => path.starts_with(&p.rule.path),
    });

    let proxy_config = match matched_proxy {
        Some(p) => p,
        None => return simple_response(StatusCode::NOT_FOUND, "Not Found: No matching proxy rule."),
    };

    let headers_map = collect_headers(&req);
    let body_bytes = match hyper::body::to_bytes(req.body_mut()).await {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("⚠️ Failed to read request body: {}", e);
            return simple_response(StatusCode::INTERNAL_SERVER_ERROR, "Error reading request body.");
        }
    };
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    let classified = classify_route(proxy_config, &headers_map);
    let decision = choose_zone(
        proxy_config,
        &classified,
        &headers_map,
        &config.carbon,
        &state,
        &static_state,
    );
    let mut target_uri_str = decision
        .as_ref()
        .map(|d| d.zone.app_uri.clone())
        .unwrap_or_else(|| proxy_config.app_uri.clone());
    let mut plugin_energy_joules_override: Option<f64> = None;
    let mut plugin_carbon_intensity_override: Option<f64> = None;
    let mut plugin_energy_source: Option<String> = None;
    let selected_zone_name = decision
        .as_ref()
        .map(|d| d.zone.name.clone())
        .unwrap_or_else(|| "default".to_string());

    if let Some(d) = &decision {
        if d.filtered_out_reason.as_deref() == Some("deferred-for-greener-window")
            && classified.time_shift_enabled
            && proxy_config.policy.max_defer_seconds > 0
        {
            tokio::time::sleep(Duration::from_secs(proxy_config.policy.max_defer_seconds)).await;
        }
    }

    if classified.plugin_enabled && classified.route_class != "strict-local" {
        if let Some(wasm_file) = &proxy_config.override_file {
            let wasm_input = WasmInput {
                method: method.to_string(),
                path: path.clone(),
                headers: headers_map.clone(),
                body: body_str,
            };
            let input_json = match serde_json::to_string(&wasm_input) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("⚠️ Failed to serialize input for Wasm: {}", e);
                    return simple_response(StatusCode::INTERNAL_SERVER_ERROR, "Error preparing Wasm input.");
                }
            };

            let wasm_result = tokio::time::timeout(
                Duration::from_millis(proxy_config.policy.plugin_timeout_ms),
                wasm_engine::run_modify_request(wasm_file, &input_json),
            )
            .await;

            match wasm_result {
                Ok(Ok(out)) => {
                    if let Some(new_target) = out.app_url {
                        target_uri_str = new_target;
                    }
                    if let Some(v) = out.energy_joules_override {
                        if v.is_finite() && v >= 0.0 {
                            plugin_energy_joules_override = Some(v);
                        }
                    }
                    if let Some(v) = out.carbon_intensity_g_per_kwh_override {
                        if v.is_finite() && v >= 0.0 {
                            plugin_carbon_intensity_override = Some(v);
                        }
                    }
                    if let Some(source) = out.energy_source {
                        if !source.trim().is_empty() {
                            plugin_energy_source = Some(source);
                        }
                    }
                    for (k, v) in out.headers_to_update {
                        if let (Ok(name), Ok(value)) =
                            (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(&v))
                        {
                            req.headers_mut().insert(name, value);
                        }
                    }
                    for k in out.headers_to_remove {
                        if let Ok(name) = HeaderName::from_bytes(k.as_bytes()) {
                            req.headers_mut().remove(name);
                        }
                    }
                }
                Ok(Err(e)) => {
                    eprintln!("❌ Wasm execution failed: {}", e);
                }
                Err(_) => {
                    eprintln!("⚠️ Wasm plugin timed out for route {}", proxy_config.rule.path);
                }
            }
        }
    }

    let final_path_and_query = match proxy_config.rewrite.as_str() {
        "strip" => req
            .uri()
            .path_and_query()
            .map(|pq| pq.as_str().strip_prefix(&proxy_config.rule.path).unwrap_or(pq.as_str()))
            .unwrap_or(""),
        _ => req.uri().path_and_query().map(|pq| pq.as_str()).unwrap_or(""),
    };
    let final_target_uri_str = format!("{}{}", target_uri_str.trim_end_matches('/'), final_path_and_query);
    let final_uri = match Uri::try_from(&final_target_uri_str) {
        Ok(uri) => uri,
        Err(e) => {
            eprintln!("⚠️ Failed to construct final target URI '{}': {}", final_target_uri_str, e);
            return simple_response(StatusCode::INTERNAL_SERVER_ERROR, "Error constructing target URL.");
        }
    };

    *req.uri_mut() = final_uri;
    *req.body_mut() = Body::from(body_bytes.clone());
    increment_in_flight(&state, &selected_zone_name, 1);
    let start = Instant::now();
    let client = Client::new();
    let forward_result = client.request(req).await;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let (response, status, is_error) = match forward_result {
        Ok(res) => {
            let status = res.status();
            let is_error = status.is_server_error();
            (Ok(res), status, is_error)
        }
        Err(e) => {
            eprintln!("❌ Error forwarding request: {}", e);
            (
                simple_response(StatusCode::BAD_GATEWAY, "Error connecting to upstream service."),
                StatusCode::BAD_GATEWAY,
                true,
            )
        }
    };
    increment_in_flight(&state, &selected_zone_name, -1);

    let bytes_count = body_bytes.len() as f64;
    let estimated_energy_j = plugin_energy_joules_override
        .unwrap_or_else(|| estimate_energy_joules(elapsed_ms, bytes_count));
    let carbon_g_per_kwh = plugin_carbon_intensity_override
        .or_else(|| decision.as_ref().and_then(|d| d.carbon_g_per_kwh))
        .unwrap_or(0.0);
    let co2e_g = estimate_co2e_g(estimated_energy_j, carbon_g_per_kwh);
    record_metrics(
        &state,
        &proxy_config.rule.path,
        &selected_zone_name,
        elapsed_ms,
        carbon_g_per_kwh,
        estimated_energy_j,
        co2e_g,
        is_error,
    );

    log_decision(
        &state,
        &config.metrics,
        proxy_config,
        &classified,
        &decision,
        method.as_str(),
        status,
        elapsed_ms,
        co2e_g,
        is_error,
        plugin_energy_source.as_deref(),
    );

    response
}

fn collect_headers(req: &Request<Body>) -> HashMap<String, String> {
    req.headers()
        .iter()
        .filter_map(|(k, v)| v.to_str().ok().map(|vv| (k.as_str().to_string(), vv.to_string())))
        .collect()
}

fn classify_route(proxy: &config::ProxyConfig, headers: &HashMap<String, String>) -> RouteClassified {
    let mut route_class = header_or_none(headers, "x-rilot-class")
        .unwrap_or_else(|| proxy.policy.route_class.clone());
    if route_class.is_empty() {
        route_class = "flexible".to_string();
    }

    let mut classified = RouteClassified {
        route_class,
        carbon_cursor_enabled: bool_override(
            headers,
            "x-rilot-carbon-cursor",
            proxy.policy.carbon_cursor_enabled,
        ),
        forecasting_enabled: bool_override(
            headers,
            "x-rilot-forecasting",
            proxy.policy.forecasting_enabled,
        ),
        time_shift_enabled: bool_override(
            headers,
            "x-rilot-time-shift",
            proxy.policy.time_shift_enabled,
        ),
        plugin_enabled: bool_override(headers, "x-rilot-plugin", proxy.policy.plugin_enabled),
    };

    // strict-local routes always bypass plugin execution and time-shifting.
    if classified.route_class == "strict-local" {
        classified.plugin_enabled = false;
        classified.time_shift_enabled = false;
    }
    classified
}

fn choose_zone(
    proxy: &config::ProxyConfig,
    classified: &RouteClassified,
    headers: &HashMap<String, String>,
    carbon_cfg: &config::CarbonProviderConfig,
    state: &AppState,
    static_state: &StaticState,
) -> Option<ZoneScore> {
    let zones = static_state
        .zones_by_route
        .get(&proxy.rule.path)
        .cloned()
        .unwrap_or_else(|| resolve_zones(proxy));
    if zones.is_empty() {
        return None;
    }

    let user_region = header_or_none(headers, "x-user-region").unwrap_or_default();
    let preselected = preselect_candidates(&zones, &proxy.policy.constraints, &user_region);
    let best_latency = preselected
        .iter()
        .map(|z| estimate_latency_ms(&user_region, z))
        .fold(f64::INFINITY, |acc, v| acc.min(v))
        .max(0.0);

    let mut scores = Vec::new();
    let mut max_carbon: f64 = 1.0;
    let mut max_latency: f64 = 1.0;
    let mut max_error: f64 = 0.001;
    let mut max_cost: f64 = 0.001;
    let mut has_any_carbon = false;

    for zone in preselected {
        let signal = get_signal_nonblocking(&zone.name, carbon_cfg, state);
        let latency_ms = estimate_latency_ms(&user_region, &zone);
        let error_rate = current_error_rate(state, &zone.name);
        let cost = zone.cost_weight;
        let mut filtered_out_reason =
            apply_constraints(&proxy.policy.constraints, &zone, latency_ms, error_rate, best_latency, state);

        let chosen_carbon = if classified.carbon_cursor_enabled {
            if classified.forecasting_enabled
                && classified.time_shift_enabled
                && classified.route_class == "background"
                && proxy.policy.forecast_window_minutes > 0
            {
                if let (Some(now), Some(next)) = (signal.current, signal.forecast_next) {
                    let improvement = if now > 0.0 { (now - next) / now } else { 0.0 };
                    if improvement >= proxy.policy.forecast_min_improvement_ratio {
                        filtered_out_reason = Some("deferred-for-greener-window".to_string());
                    }
                    Some(next)
                } else {
                    signal.current
                }
            } else {
                signal.current
            }
        } else {
            None
        };

        if let Some(c) = chosen_carbon {
            has_any_carbon = true;
            max_carbon = max_carbon.max(c);
        }
        max_latency = max_latency.max(latency_ms);
        max_error = max_error.max(error_rate);
        max_cost = max_cost.max(cost.max(0.001));

        scores.push(ZoneScore {
            zone,
            score: 0.0,
            carbon_g_per_kwh: chosen_carbon,
            latency_ms,
            error_rate,
            cost,
            filtered_out_reason,
        });
    }

    if !classified.carbon_cursor_enabled || !has_any_carbon {
        return lowest_latency_with_hysteresis(proxy, scores, state);
    }

    let mode_weights = effective_weights(&proxy.policy);
    for score in &mut scores {
        let n_carbon = score.carbon_g_per_kwh.unwrap_or(max_carbon) / max_carbon;
        let n_latency = score.latency_ms / max_latency;
        let n_errors = score.error_rate / max_error.max(0.001);
        let n_cost = if max_cost > 0.0 { score.cost / max_cost } else { 0.0 };
        score.score = (mode_weights.w_carbon * n_carbon)
            + (mode_weights.w_latency * n_latency)
            + (mode_weights.w_errors * n_errors)
            + (mode_weights.w_cost * n_cost);
    }

    let mut eligible: Vec<ZoneScore> = scores
        .into_iter()
        .filter(|s| {
            s.filtered_out_reason.is_none()
                || s.filtered_out_reason.as_deref() == Some("deferred-for-greener-window")
        })
        .collect();
    eligible.sort_by(|a, b| {
        a.score
            .partial_cmp(&b.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    if let Some(best) = eligible.first().cloned() {
        return Some(apply_hysteresis(proxy, best, state));
    }
    if proxy.policy.fail_safe_lowest_latency {
        return lowest_latency_with_hysteresis(proxy, eligible, state);
    }
    None
}

fn lowest_latency_with_hysteresis(
    proxy: &config::ProxyConfig,
    mut candidates: Vec<ZoneScore>,
    state: &AppState,
) -> Option<ZoneScore> {
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        a.latency_ms
            .partial_cmp(&b.latency_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut best = candidates.remove(0);
    best.score = 9999.0;
    best.filtered_out_reason = Some("fallback-lowest-latency".to_string());
    Some(apply_hysteresis(proxy, best, state))
}

fn preselect_candidates(
    zones: &[ZoneCandidate],
    constraints: &config::PolicyConstraints,
    user_region: &str,
) -> Vec<ZoneCandidate> {
    let mut filtered: Vec<ZoneCandidate> = zones
        .iter()
        .filter(|z| {
            if constraints.zone_allowlist.is_empty() {
                return true;
            }
            if constraints.zone_allowlist.contains(&z.name) {
                return true;
            }
            if !user_region.is_empty() && constraints.zone_allowlist.contains(&z.region) {
                return true;
            }
            constraints
                .zone_allowlist
                .iter()
                .filter_map(|entry| entry.strip_prefix("tag:"))
                .any(|tag| z.tags.iter().any(|t| t == tag))
        })
        .cloned()
        .collect();
    if filtered.is_empty() {
        filtered = zones.to_vec();
    }

    filtered.sort_by(|a, b| {
        let ak = if !user_region.is_empty() && a.region == user_region {
            0
        } else {
            1
        };
        let bk = if !user_region.is_empty() && b.region == user_region {
            0
        } else {
            1
        };
        ak.cmp(&bk).then_with(|| {
            a.base_rtt_ms
                .partial_cmp(&b.base_rtt_ms)
                .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    filtered.into_iter().take(constraints.max_candidates.max(1)).collect()
}

fn apply_constraints(
    constraints: &config::PolicyConstraints,
    zone: &ZoneCandidate,
    latency_ms: f64,
    error_rate: f64,
    best_latency_ms: f64,
    state: &AppState,
) -> Option<String> {
    if let Some(max_added) = constraints.max_added_latency_ms {
        if latency_ms > (best_latency_ms + max_added) {
            return Some(format!("added-latency>{}", max_added));
        }
    }
    if let Some(latency_budget) = constraints.p95_latency_budget_ms {
        if latency_ms > latency_budget {
            return Some(format!("latency>{}", latency_budget));
        }
    }
    if let Some(max_error) = constraints.max_error_rate {
        if error_rate > max_error {
            return Some(format!("error-rate>{}", max_error));
        }
    }
    if let Some(limit) = zone.max_in_flight {
        let in_flight = current_in_flight(state, &zone.name);
        if in_flight >= limit {
            return Some(format!("capacity>{}", limit));
        }
    }
    None
}

fn apply_hysteresis(proxy: &config::ProxyConfig, candidate: ZoneScore, state: &AppState) -> ZoneScore {
    let route_key = proxy.rule.path.clone();
    let mut s = state.inner.write().expect("state lock poisoned");
    if let Some(last) = s.last_decision_by_route.get(&route_key) {
        let interval = last.at.elapsed().as_secs();
        let score_gain = last.score - candidate.score;
        if interval < proxy.policy.min_switch_interval_secs
            && score_gain < proxy.policy.hysteresis_delta
            && last.zone != candidate.zone.name
        {
            if let Some(existing) = resolve_zones(proxy).into_iter().find(|z| z.name == last.zone) {
                return ZoneScore {
                    zone: existing,
                    score: last.score,
                    carbon_g_per_kwh: candidate.carbon_g_per_kwh,
                    latency_ms: candidate.latency_ms,
                    error_rate: candidate.error_rate,
                    cost: candidate.cost,
                    filtered_out_reason: Some("hysteresis-sticky-zone".to_string()),
                };
            }
        }
    }
    s.last_decision_by_route.insert(
        route_key,
        LastDecision {
            zone: candidate.zone.name.clone(),
            score: candidate.score,
            at: Instant::now(),
        },
    );
    candidate
}

fn effective_weights(policy: &config::RoutePolicy) -> config::PolicyWeights {
    match policy.priority_mode.as_str() {
        "latency-first" => config::PolicyWeights {
            w_carbon: 0.15,
            w_latency: 0.65,
            w_errors: 0.20,
            w_cost: 0.0,
        },
        "carbon-first" => config::PolicyWeights {
            w_carbon: 0.70,
            w_latency: 0.20,
            w_errors: 0.10,
            w_cost: 0.0,
        },
        _ => policy.weights.clone(),
    }
}

fn resolve_zones(proxy: &config::ProxyConfig) -> Vec<ZoneCandidate> {
    if !proxy.zones.is_empty() {
        return proxy
            .zones
            .iter()
            .map(|z| ZoneCandidate {
                name: z.name.clone(),
                app_uri: z.app_uri.clone(),
                region: z.region.clone().unwrap_or_else(|| z.name.clone()),
                base_rtt_ms: z.base_rtt_ms.unwrap_or(35.0),
                cost_weight: z.cost_weight.unwrap_or(0.0),
                max_in_flight: z.max_in_flight,
                tags: z.tags.clone(),
            })
            .collect();
    }
    vec![ZoneCandidate {
        name: proxy.app_name.clone(),
        app_uri: proxy.app_uri.clone(),
        region: proxy.app_name.clone(),
        base_rtt_ms: 20.0,
        cost_weight: 0.0,
        max_in_flight: None,
        tags: Vec::new(),
    }]
}

fn estimate_latency_ms(user_region: &str, zone: &ZoneCandidate) -> f64 {
    if user_region.is_empty() || user_region == zone.region {
        zone.base_rtt_ms
    } else {
        zone.base_rtt_ms + CROSS_REGION_RTT_PENALTY_MS
    }
}

fn get_signal_nonblocking(zone: &str, cfg: &config::CarbonProviderConfig, state: &AppState) -> CarbonSignal {
    let now = Instant::now();
    {
        let s = state.inner.read().expect("state lock poisoned");
        if let Some(entry) = s.carbon_cache.get(zone) {
            if now <= entry.expires_at {
                return CarbonSignal {
                    current: entry.current,
                    forecast_next: entry.forecast_next,
                };
            }
        }
    }

    trigger_refresh(zone.to_string(), cfg.clone(), state.clone());

    let fallback_current = cfg
        .zone_current
        .get(zone)
        .copied()
        .or(Some(cfg.default_carbon_intensity));
    let fallback_next = cfg.zone_forecast_next.get(zone).copied();
    CarbonSignal {
        current: fallback_current,
        forecast_next: fallback_next,
    }
}

fn trigger_refresh(zone: String, cfg: config::CarbonProviderConfig, state: AppState) {
    {
        let mut s = state.inner.write().expect("state lock poisoned");
        if s.refresh_in_flight.contains(&zone) {
            return;
        }
        s.refresh_in_flight.insert(zone.clone());
    }

    tokio::spawn(async move {
        let fetch = tokio::time::timeout(
            Duration::from_millis(cfg.provider_timeout_ms),
            fetch_provider_signal(&zone, &cfg),
        )
        .await;

        let mut s = state.inner.write().expect("state lock poisoned");
        s.refresh_in_flight.remove(&zone);
        match fetch {
            Ok((current, forecast_next)) => {
                s.carbon_cache.insert(
                    zone,
                    CachedCarbon {
                        current,
                        forecast_next,
                        expires_at: Instant::now() + Duration::from_secs(cfg.cache_ttl_secs),
                    },
                );
            }
            Err(_) => {
                // Provider timeout: keep old cache if present; otherwise no update.
                log::warn!("carbon_provider_timeout=true");
            }
        }
    });
}

async fn fetch_provider_signal(zone: &str, cfg: &config::CarbonProviderConfig) -> (Option<f64>, Option<f64>) {
    // Placeholder provider hook. Keep this async so external providers can be added without changing the hot path.
    if cfg.provider == "slow-mock" {
        tokio::time::sleep(Duration::from_millis(cfg.provider_timeout_ms + 10)).await;
    }
    let current_from_cfg = cfg
        .zone_current
        .get(zone)
        .copied()
        .or(Some(cfg.default_carbon_intensity));
    let forecast_from_cfg = cfg.zone_forecast_next.get(zone).copied();

    if cfg.provider == "mock" || cfg.provider == "slow-mock" {
        let epoch_secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        let wave = (epoch_secs / 300.0).sin() * 0.08;
        let current = current_from_cfg.map(|v| (v * (1.0 + wave)).max(0.0));
        let forecast = forecast_from_cfg.or_else(|| current.map(|c| (c * 0.92).max(0.0)));
        (current, forecast)
    } else {
        (current_from_cfg, forecast_from_cfg)
    }
}

fn current_error_rate(state: &AppState, zone: &str) -> f64 {
    let s = state.inner.read().expect("state lock poisoned");
    let Some(stats) = s.zone_stats.get(zone) else {
        return 0.0;
    };
    if stats.requests == 0 {
        return 0.0;
    }
    stats.errors as f64 / stats.requests as f64
}

fn current_in_flight(state: &AppState, zone: &str) -> usize {
    let s = state.inner.read().expect("state lock poisoned");
    s.zone_in_flight.get(zone).copied().unwrap_or(0)
}

fn increment_in_flight(state: &AppState, zone: &str, delta: i32) {
    let mut s = state.inner.write().expect("state lock poisoned");
    let entry = s.zone_in_flight.entry(zone.to_string()).or_insert(0);
    if delta > 0 {
        *entry = entry.saturating_add(delta as usize);
    } else {
        *entry = entry.saturating_sub(delta.unsigned_abs() as usize);
    }
}

fn record_metrics(
    state: &AppState,
    route: &str,
    zone: &str,
    latency_ms: f64,
    carbon_g_per_kwh: f64,
    energy_j: f64,
    co2e_g: f64,
    is_error: bool,
) {
    let mut s = state.inner.write().expect("state lock poisoned");
    s.metrics
        .carbon_intensity_g_per_kwh
        .insert(zone.to_string(), carbon_g_per_kwh);

    let key = (route.to_string(), zone.to_string());
    let m = s.metrics.route_zone.entry(key).or_default();
    m.requests_total += 1;
    if is_error {
        m.errors_total += 1;
    }
    m.co2e_estimated_total_g += co2e_g;
    m.energy_estimated_total_j += energy_j;
    m.latency_sum_ms += latency_ms;
    m.latency_count += 1;
    let buckets = [25.0, 50.0, 100.0, 250.0, 500.0, 1000.0, 2000.0];
    for (idx, upper) in buckets.iter().enumerate() {
        if latency_ms <= *upper {
            m.latency_buckets[idx] += 1;
        }
    }

    let zone_stat = s.zone_stats.entry(zone.to_string()).or_default();
    zone_stat.requests += 1;
    if is_error {
        zone_stat.errors += 1;
    }
}

fn render_metrics(state: AppState) -> Result<Response<Body>, Infallible> {
    let s = state.inner.read().expect("state lock poisoned");
    let mut out = String::new();
    out.push_str("# TYPE requests_total counter\n");
    out.push_str("# TYPE errors_total counter\n");
    out.push_str("# TYPE latency_ms_bucket counter\n");
    out.push_str("# TYPE carbon_intensity_g_per_kwh gauge\n");
    out.push_str("# TYPE co2e_estimated_total counter\n");
    out.push_str("# TYPE energy_joules_estimated_total counter\n");

    for ((route, zone), m) in &s.metrics.route_zone {
        out.push_str(&format!(
            "requests_total{{route=\"{}\",zone=\"{}\"}} {}\n",
            escape_label(route),
            escape_label(zone),
            m.requests_total
        ));
        out.push_str(&format!(
            "errors_total{{route=\"{}\",zone=\"{}\"}} {}\n",
            escape_label(route),
            escape_label(zone),
            m.errors_total
        ));
        out.push_str(&format!(
            "co2e_estimated_total{{route=\"{}\",zone=\"{}\"}} {:.8}\n",
            escape_label(route),
            escape_label(zone),
            m.co2e_estimated_total_g
        ));
        out.push_str(&format!(
            "energy_joules_estimated_total{{route=\"{}\",zone=\"{}\"}} {:.8}\n",
            escape_label(route),
            escape_label(zone),
            m.energy_estimated_total_j
        ));
        let bounds = ["25", "50", "100", "250", "500", "1000", "2000"];
        for (i, b) in bounds.iter().enumerate() {
            out.push_str(&format!(
                "latency_ms_bucket{{route=\"{}\",zone=\"{}\",le=\"{}\"}} {}\n",
                escape_label(route),
                escape_label(zone),
                b,
                m.latency_buckets[i]
            ));
        }
    }

    for (zone, v) in &s.metrics.carbon_intensity_g_per_kwh {
        out.push_str(&format!(
            "carbon_intensity_g_per_kwh{{zone=\"{}\"}} {:.6}\n",
            escape_label(zone),
            v
        ));
    }

    Ok(Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", "text/plain; version=0.0.4")
        .body(Body::from(out))
        .unwrap())
}

fn log_decision(
    state: &AppState,
    metrics: &config::MetricsConfig,
    proxy: &config::ProxyConfig,
    classified: &RouteClassified,
    decision: &Option<ZoneScore>,
    method: &str,
    status: StatusCode,
    latency_ms: f64,
    co2e_g: f64,
    is_error: bool,
    energy_source: Option<&str>,
) {
    let log_full = should_log_decision(state, metrics.decision_log_sample_rate) || is_error;
    if !log_full {
        return;
    }

    let entry = json!({
        "route": proxy.rule.path,
        "class": classified.route_class,
        "method": method,
        "status": status.as_u16(),
        "selected_zone": decision.as_ref().map(|d| d.zone.name.clone()).unwrap_or_else(|| "default".to_string()),
        "score": decision.as_ref().map(|d| d.score),
        "reason": decision.as_ref().and_then(|d| d.filtered_out_reason.clone()),
        "carbon_g_per_kwh": decision.as_ref().and_then(|d| d.carbon_g_per_kwh),
        "latency_ms_estimate": decision.as_ref().map(|d| d.latency_ms),
        "latency_ms_observed": latency_ms,
        "co2e_g": co2e_g,
        "is_error": is_error,
        "energy_source": energy_source
    });
    log::info!("decision={}", entry);
}

fn should_log_decision(state: &AppState, sample_rate: f64) -> bool {
    if sample_rate <= 0.0 {
        return false;
    }
    if sample_rate >= 1.0 {
        return true;
    }
    let mut s = state.inner.write().expect("state lock poisoned");
    s.decision_counter = s.decision_counter.saturating_add(1);
    let n = (1.0 / sample_rate).round() as u64;
    let n = n.max(1);
    s.decision_counter % n == 0
}

fn header_or_none(headers: &HashMap<String, String>, key: &str) -> Option<String> {
    headers.get(key).cloned()
}

fn bool_override(headers: &HashMap<String, String>, key: &str, default_value: bool) -> bool {
    match headers.get(key).map(|v| v.as_str()) {
        Some("1") | Some("true") | Some("on") | Some("yes") => true,
        Some("0") | Some("false") | Some("off") | Some("no") => false,
        _ => default_value,
    }
}

fn escape_label(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn estimate_energy_joules(latency_ms: f64, bytes: f64) -> f64 {
    let net_component = bytes * 0.00001;
    let cpu_component = latency_ms * 0.003;
    (net_component + cpu_component).max(0.0)
}

fn estimate_co2e_g(energy_j: f64, carbon_g_per_kwh: f64) -> f64 {
    let kwh = energy_j / 3_600_000.0;
    kwh * carbon_g_per_kwh
}
