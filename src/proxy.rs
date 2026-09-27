//! Native HTTP adapter.
//!
//! All routing decisions come from `rilot_core`. This module only supplies
//! request metadata, runtime health, and carbon signals, then forwards the
//! request to whichever backend the core selected.

use hyper::service::{make_service_fn, service_fn};
use hyper::{
    header::{HeaderName, HeaderValue},
    Body, Client, Request, Response, Server, StatusCode, Uri,
};
use once_cell::sync::Lazy;
use rilot_core::cookie;
use rilot_core::{
    BackendRuntime, CandidateEvaluation, CarbonInput, CarbonSignal, DecisionContext,
    DecisionOutput, GeoPoint, PreviousDecision, RequestContext, RequestHints, RouteClass,
    RoutingConfig, Timestamp,
};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::convert::Infallible;
use std::future::Future;
use std::net::SocketAddr;
use std::sync::{Arc, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, Instant};

use crate::carbon::now_timestamp;
use crate::{config, wasm_engine};
use rilot_carbon::CarbonService;

const ERROR_RATE_WINDOW_SIZE: usize = 200;
static CACHE_TTL_LEFT_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-cc-ttl-left"));
static SELECTED_ZONE_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-selected-zone"));
static SELECTED_CARBON_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-selected-carbon-intensity"));
static ZONE_CARBON_SNAPSHOT_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-zone-carbon-intensity-g-per-kwh"));
static ELIGIBLE_ZONE_CARBON_SNAPSHOT_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-eligible-zone-carbon-intensity-g-per-kwh"));
static ZONE_FILTER_REASONS_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-zone-filter-reasons"));
static DECISION_REASON_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-decision-reason"));
static CARBON_SAVED_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-carbon-saved-vs-worst"));
static CARBON_SAVED_PERCENT_HEADER: Lazy<HeaderName> =
    Lazy::new(|| HeaderName::from_static("x-rilot-carbon-saved-vs-worst-percent"));
static EXPOSE_RESEARCH_HEADERS: Lazy<bool> =
    Lazy::new(|| env_flag("RILOT_EXPOSE_RESEARCH_HEADERS"));
static EMULATE_CROSS_REGION_RTT: Lazy<bool> =
    Lazy::new(|| env_flag("RILOT_EMULATE_CROSS_REGION_RTT"));

fn env_flag(name: &str) -> bool {
    std::env::var(name)
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"))
        .unwrap_or(false)
}

#[derive(Serialize)]
struct WasmInput {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Default, Clone)]
struct ZoneRuntimeStats {
    recent_outcomes: VecDeque<bool>,
    recent_error_count: usize,
}

#[derive(Default, Clone)]
struct RouteZoneMetrics {
    requests_total: u64,
    carbon_safe_calls_total: u64,
    errors_total: u64,
    carbon_intensity_exposure_total_g_per_kwh: f64,
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

#[derive(Default)]
struct RuntimeState {
    metrics: MetricsStore,
    zone_stats: HashMap<String, ZoneRuntimeStats>,
    zone_in_flight: HashMap<String, usize>,
    last_decision_by_route: HashMap<String, PreviousDecision>,
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

    fn read_guard(&self) -> RwLockReadGuard<'_, RuntimeState> {
        match self.inner.read() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::error!("state lock poisoned during read; recovering");
                poisoned.into_inner()
            }
        }
    }

    fn write_guard(&self) -> RwLockWriteGuard<'_, RuntimeState> {
        match self.inner.write() {
            Ok(guard) => guard,
            Err(poisoned) => {
                log::error!("state lock poisoned during write; recovering");
                poisoned.into_inner()
            }
        }
    }
}

pub async fn start_proxy(config: Arc<config::Config>, carbon: Arc<CarbonService>) {
    let state = AppState::new();
    spawn_rollup_task(config.clone(), state.clone());

    let make_svc = make_service_fn(move |_conn| {
        let cfg = config.clone();
        let st = state.clone();
        let cs = carbon.clone();
        async move {
            Ok::<_, Infallible>(service_fn(move |req| {
                handle_request(req, cfg.clone(), st.clone(), cs.clone())
            }))
        }
    });

    let host = std::env::var("RILOT_HOST").unwrap_or_else(|_| "127.0.0.1".to_string());
    let port = std::env::var("RILOT_PORT")
        .ok()
        .and_then(|p| p.parse::<u16>().ok())
        .unwrap_or(8080);
    let addr = SocketAddr::new(host.parse().expect("Invalid host"), port);

    println!("Rilot proxy starting at http://{}", addr);
    let server = Server::bind(&addr).serve(make_svc);
    if let Err(e) = server.await {
        eprintln!("Server error: {}", e);
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
    let s = state.read_guard();
    let mut per_route: HashMap<String, (u64, u64, f64, f64)> = HashMap::new();
    for ((route, _zone), m) in &s.metrics.route_zone {
        let entry = per_route.entry(route.clone()).or_insert((0, 0, 0.0, 0.0));
        entry.0 += m.requests_total;
        entry.1 += m.errors_total;
        entry.2 += m.co2e_estimated_total_g;
        entry.3 += m.latency_sum_ms;
    }

    per_route
        .into_iter()
        .map(|(route, (reqs, errs, co2e, latency_sum))| {
            let avg_latency = if reqs > 0 {
                latency_sum / reqs as f64
            } else {
                0.0
            };
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

fn simple_response(
    status: StatusCode,
    body: impl Into<Body>,
) -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "text/plain")
        .body(body.into())
        .unwrap())
}

/// Cookie a site sets to route its own pages per session, for example
/// `rilot_policy=/products/*:carbon,/checkout/*:latency`.
pub const POLICY_COOKIE: &str = "rilot_policy";

/// Builds the core request context from HTTP headers.
///
/// Location comes from `x-user-location: <lat>,<lon>` (one header, easiest for
/// testing), or from the separate `x-user-lat` / `x-user-lon` pair. An
/// unparseable value is treated as "location unknown" rather than an error.
///
/// A per-request policy can arrive as `x-rilot-policy` or in the session
/// cookie; an explicit header wins. Both the cookie parsing and the pattern
/// matching live in `rilot_core::cookie`, so the Cloudflare Worker and this
/// proxy cannot disagree about what a cookie means.
fn request_context(path: &str, headers: &HashMap<String, String>) -> RequestContext {
    let get = |k: &str| headers.get(k).map(|v| v.trim()).filter(|v| !v.is_empty());
    let user_location = get("x-user-location")
        .and_then(GeoPoint::parse)
        .or_else(|| {
            match (
                get("x-user-lat").and_then(|v| v.parse::<f64>().ok()),
                get("x-user-lon").and_then(|v| v.parse::<f64>().ok()),
            ) {
                (Some(lat), Some(lon)) => Some(GeoPoint { lat, lon }).filter(GeoPoint::is_valid),
                _ => None,
            }
        });
    let mut hints = RequestHints::from_headers(|k| headers.get(k).map(String::as_str));
    if hints.policy.is_none() {
        hints.policy = get("cookie")
            .and_then(|header| cookie::from_header(header, POLICY_COOKIE))
            .and_then(|value| cookie::policy_for_path(&value, path));
    }
    RequestContext {
        path: path.to_string(),
        user_region: get("x-user-region").map(str::to_string),
        user_location,
        hints,
    }
}

/// Snapshot of per-backend runtime health for the core.
fn backend_runtime(
    state: &AppState,
    routing: &RoutingConfig,
    route_label: &str,
) -> BTreeMap<String, BackendRuntime> {
    let s = state.read_guard();
    let route_total: u64 = s
        .metrics
        .route_zone
        .iter()
        .filter(|((r, _), _)| r == route_label)
        .map(|(_, m)| m.requests_total)
        .sum();
    routing
        .backends
        .iter()
        .map(|b| {
            let error_rate = s.zone_stats.get(&b.id).and_then(|stats| {
                let n = stats.recent_outcomes.len();
                (n > 0).then(|| stats.recent_error_count as f64 / n as f64)
            });
            let share = (route_total > 0).then(|| {
                let zone = s
                    .metrics
                    .route_zone
                    .get(&(route_label.to_string(), b.id.clone()))
                    .map(|m| m.requests_total)
                    .unwrap_or(0);
                zone as f64 / route_total as f64 * 100.0
            });
            (
                b.id.clone(),
                BackendRuntime {
                    latency_ms: None,
                    error_rate,
                    in_flight: s.zone_in_flight.get(&b.id).map(|v| *v as u64),
                    request_share_percent: share,
                    healthy: None,
                },
            )
        })
        .collect()
}

/// plan → fetch carbon only for the regions the core asks for → decide.
async fn run_decision<F, Fut>(
    routing: &RoutingConfig,
    request: RequestContext,
    runtime: BTreeMap<String, BackendRuntime>,
    previous: Option<PreviousDecision>,
    now: Timestamp,
    max_age_seconds: u64,
    fetch_signals: F,
) -> DecisionOutput
where
    F: FnOnce(Vec<String>) -> Fut,
    Fut: Future<Output = Vec<CarbonSignal>>,
{
    let plan = rilot_core::plan(routing, &request, &runtime);
    let signals = if plan.carbon_regions.is_empty() {
        Vec::new()
    } else {
        fetch_signals(plan.carbon_regions).await
    };
    rilot_core::decide(
        routing,
        &DecisionContext {
            request,
            now,
            carbon: CarbonInput {
                max_age_seconds,
                signals,
            },
            runtime,
            previous,
        },
    )
}

async fn handle_request(
    mut req: Request<Body>,
    config: Arc<config::Config>,
    state: AppState,
    carbon: Arc<CarbonService>,
) -> Result<Response<Body>, Infallible> {
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    if config.metrics.enabled && path == config.metrics.path {
        return render_metrics(state);
    }

    if path == CARBON_ENDPOINT {
        return render_carbon(&config, &carbon, req.uri().query()).await;
    }

    let rule_index = config.routing.match_rule(&path).map(|(i, _)| i);
    if config.require_rule_match && rule_index.is_none() {
        return simple_response(StatusCode::NOT_FOUND, "Not Found: No matching proxy rule.");
    }
    let extras = config.extras_for(rule_index);
    let route_label = extras.label.clone();

    let headers_map = collect_headers(&req);
    let body_bytes = match hyper::body::to_bytes(req.body_mut()).await {
        Ok(bytes) => bytes,
        Err(e) => {
            eprintln!("Failed to read request body: {}", e);
            return simple_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Error reading request body.",
            );
        }
    };
    let body_str = String::from_utf8_lossy(&body_bytes).to_string();

    let request_ctx = request_context(&path, &headers_map);
    let runtime = backend_runtime(&state, &config.routing, &route_label);
    let previous = state
        .read_guard()
        .last_decision_by_route
        .get(&route_label)
        .cloned();
    let decision = run_decision(
        &config.routing,
        request_ctx,
        runtime,
        previous,
        now_timestamp(),
        carbon.policy().max_age_seconds(),
        |regions| {
            let carbon = carbon.clone();
            async move { carbon.get_signals(&regions, now_timestamp()).await }
        },
    )
    .await;
    if let Some(next) = &decision.next_state {
        state
            .write_guard()
            .last_decision_by_route
            .insert(route_label.clone(), next.clone());
    }

    let Some(selected) = decision.selected().cloned() else {
        log_decision(
            &state,
            &config.metrics,
            &route_label,
            &decision,
            method.as_str(),
            StatusCode::SERVICE_UNAVAILABLE,
            0.0,
            0.0,
            true,
            None,
        );
        return simple_response(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("No eligible backend: {}", decision.reason.message),
        );
    };
    let mut target_uri_str = selected.url.clone().unwrap_or_default();
    let selected_zone_name = selected.backend_id.clone();
    let route_class = decision.effective.advanced.route_class;
    let mut plugin_energy_joules_override: Option<f64> = None;
    let mut plugin_carbon_intensity_override: Option<f64> = None;
    let mut plugin_energy_source: Option<String> = None;
    let expose_research_headers = *EXPOSE_RESEARCH_HEADERS;
    let research_headers = if expose_research_headers {
        research_header_values(&decision, &selected, &carbon)
    } else {
        Vec::new()
    };

    if decision.defer_seconds > 0 {
        tokio::time::sleep(Duration::from_secs(decision.defer_seconds)).await;
    }

    let plugin_enabled = match headers_map.get("x-rilot-plugin").map(|v| v.trim()) {
        Some("1" | "true" | "on" | "yes") => true,
        Some("0" | "false" | "off" | "no") => false,
        _ => extras.plugin_enabled,
    };
    if plugin_enabled && route_class != RouteClass::StrictLocal {
        if let Some(wasm_file) = &extras.override_file {
            let wasm_input = WasmInput {
                method: method.to_string(),
                path: path.clone(),
                headers: headers_map.clone(),
                body: body_str,
            };
            let input_json = match serde_json::to_string(&wasm_input) {
                Ok(json) => json,
                Err(e) => {
                    eprintln!("Failed to serialize input for Wasm: {}", e);
                    return simple_response(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Error preparing Wasm input.",
                    );
                }
            };

            let wasm_result = tokio::time::timeout(
                Duration::from_millis(extras.plugin_timeout_ms),
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
                        if let (Ok(name), Ok(value)) = (
                            HeaderName::from_bytes(k.as_bytes()),
                            HeaderValue::from_str(&v),
                        ) {
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
                    eprintln!("Wasm execution failed: {}", e);
                }
                Err(_) => {
                    eprintln!(
                        "Wasm plugin timed out for route {} after {}ms (component: {})",
                        route_label, extras.plugin_timeout_ms, wasm_file
                    );
                }
            }
        }
    }

    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("");
    let final_path_and_query = match &extras.strip_prefix {
        Some(prefix) => path_and_query
            .strip_prefix(prefix.as_str())
            .unwrap_or(path_and_query),
        None => path_and_query,
    };
    let final_target_uri_str = format!(
        "{}{}",
        target_uri_str.trim_end_matches('/'),
        final_path_and_query
    );
    let final_uri = match Uri::try_from(&final_target_uri_str) {
        Ok(uri) => uri,
        Err(e) => {
            eprintln!(
                "Failed to construct final target URI '{}': {}",
                final_target_uri_str, e
            );
            return simple_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Error constructing target URL.",
            );
        }
    };

    *req.uri_mut() = final_uri;
    *req.body_mut() = Body::from(body_bytes.clone());
    if *EMULATE_CROSS_REGION_RTT {
        if let Some(user_region) = &decision.user.region {
            if !user_region.eq_ignore_ascii_case(&selected.region) {
                let penalty_ms = decision
                    .effective
                    .advanced
                    .cross_region_rtt_penalty_ms
                    .max(0.0);
                if penalty_ms > 0.0 {
                    tokio::time::sleep(Duration::from_millis(penalty_ms.round() as u64)).await;
                }
            }
        }
    }
    increment_in_flight(&state, &selected_zone_name, 1);
    let start = Instant::now();
    let client = Client::new();
    let forward_result = client.request(req).await;
    let elapsed_ms = start.elapsed().as_secs_f64() * 1000.0;

    let (response, status, is_error) = match forward_result {
        Ok(mut res) => {
            for (name, value) in &research_headers {
                if let Ok(value) = HeaderValue::from_str(value) {
                    res.headers_mut().insert(name.clone(), value);
                }
            }
            let status = res.status();
            let is_error = status.is_server_error();
            (Ok(res), status, is_error)
        }
        Err(e) => {
            eprintln!("Error forwarding request: {}", e);
            (
                simple_response(
                    StatusCode::BAD_GATEWAY,
                    "Error connecting to upstream service.",
                ),
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
        .or(selected.carbon.used_g_per_kwh)
        .or(selected.carbon.carbon_g_per_kwh)
        .unwrap_or(0.0);
    let is_carbon_safe =
        carbon_g_per_kwh > 0.0 && carbon_g_per_kwh <= config.carbon.carbon_safe_threshold_g_per_kwh;
    let co2e_g = estimate_co2e_g(estimated_energy_j, carbon_g_per_kwh);
    record_metrics(
        &state,
        &route_label,
        &selected_zone_name,
        elapsed_ms,
        carbon_g_per_kwh,
        is_carbon_safe,
        estimated_energy_j,
        co2e_g,
        is_error,
    );

    log_decision(
        &state,
        &config.metrics,
        &route_label,
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

fn carbon_label(c: &CandidateEvaluation) -> String {
    c.carbon
        .used_g_per_kwh
        .or(c.carbon.carbon_g_per_kwh)
        .map(|v| format!("{:.3}", v))
        .unwrap_or_else(|| "na".to_string())
}

/// Research headers, in the same formats the research kit already parses.
fn research_header_values(
    decision: &DecisionOutput,
    selected: &CandidateEvaluation,
    carbon: &CarbonService,
) -> Vec<(HeaderName, String)> {
    let mut by_carbon: Vec<&CandidateEvaluation> = decision.candidates.iter().collect();
    by_carbon.sort_by(|a, b| {
        let key = |c: &CandidateEvaluation| {
            c.carbon
                .used_g_per_kwh
                .or(c.carbon.carbon_g_per_kwh)
                .unwrap_or(f64::INFINITY)
        };
        key(a).total_cmp(&key(b))
    });
    let snapshot = |filter: &dyn Fn(&CandidateEvaluation) -> bool| {
        by_carbon
            .iter()
            .filter(|c| filter(c))
            .map(|c| format!("{}:{}", c.backend_id, carbon_label(c)))
            .collect::<Vec<_>>()
            .join(";")
    };

    let mut out = vec![
        (SELECTED_ZONE_HEADER.clone(), selected.backend_id.clone()),
        (ZONE_CARBON_SNAPSHOT_HEADER.clone(), snapshot(&|_| true)),
        (
            ELIGIBLE_ZONE_CARBON_SNAPSHOT_HEADER.clone(),
            snapshot(&|c| c.is_eligible()),
        ),
        (
            ZONE_FILTER_REASONS_HEADER.clone(),
            by_carbon
                .iter()
                .map(|c| format!("{}:{}", c.backend_id, c.primary_reason()))
                .collect::<Vec<_>>()
                .join(";"),
        ),
        (
            DECISION_REASON_HEADER.clone(),
            decision.reason.code.as_str().to_string(),
        ),
        (
            CARBON_SAVED_HEADER.clone(),
            format!("{:.3}", decision.carbon_saved_vs_worst_g_per_kwh.max(0.0)),
        ),
        (
            CARBON_SAVED_PERCENT_HEADER.clone(),
            format!("{:.2}", decision.carbon_saved_vs_worst_percent.max(0.0)),
        ),
    ];
    if let Some(v) = selected
        .carbon
        .used_g_per_kwh
        .or(selected.carbon.carbon_g_per_kwh)
    {
        out.push((SELECTED_CARBON_HEADER.clone(), format!("{:.3}", v)));
    }
    if let Some(age) = selected.carbon.age_seconds {
        let ttl_left = carbon
            .policy()
            .refresh_seconds()
            .saturating_sub(age.max(0) as u64);
        out.push((CACHE_TTL_LEFT_HEADER.clone(), ttl_left.to_string()));
    }
    out.retain(|(_, v)| !v.is_empty());
    out
}

fn collect_headers(req: &Request<Body>) -> HashMap<String, String> {
    req.headers()
        .iter()
        .filter_map(|(k, v)| {
            v.to_str()
                .ok()
                .map(|vv| (k.as_str().to_string(), vv.to_string()))
        })
        .collect()
}

fn increment_in_flight(state: &AppState, zone: &str, delta: i32) {
    let mut s = state.write_guard();
    let entry = s.zone_in_flight.entry(zone.to_string()).or_insert(0);
    if delta > 0 {
        *entry = entry.saturating_add(delta as usize);
    } else {
        *entry = entry.saturating_sub(delta.unsigned_abs() as usize);
    }
}

#[allow(clippy::too_many_arguments)]
fn record_metrics(
    state: &AppState,
    route: &str,
    zone: &str,
    latency_ms: f64,
    carbon_g_per_kwh: f64,
    is_carbon_safe: bool,
    energy_j: f64,
    co2e_g: f64,
    is_error: bool,
) {
    let mut s = state.write_guard();
    s.metrics
        .carbon_intensity_g_per_kwh
        .insert(zone.to_string(), carbon_g_per_kwh);

    let key = (route.to_string(), zone.to_string());
    let m = s.metrics.route_zone.entry(key).or_default();
    m.requests_total += 1;
    if is_carbon_safe {
        m.carbon_safe_calls_total += 1;
    }
    if is_error {
        m.errors_total += 1;
    }
    m.carbon_intensity_exposure_total_g_per_kwh += carbon_g_per_kwh;
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
    if zone_stat.recent_outcomes.len() >= ERROR_RATE_WINDOW_SIZE {
        if let Some(old_is_error) = zone_stat.recent_outcomes.pop_front() {
            if old_is_error {
                zone_stat.recent_error_count = zone_stat.recent_error_count.saturating_sub(1);
            }
        }
    }
    zone_stat.recent_outcomes.push_back(is_error);
    if is_error {
        zone_stat.recent_error_count += 1;
    }
}

/// Read-only view of the carbon signals this proxy is routing on.
pub const CARBON_ENDPOINT: &str = "/__rilot/carbon";

/// `GET /__rilot/carbon[?regions=a,b]` — the signals from the shared carbon
/// layer (cache, then provider), with the age and staleness a caller would
/// otherwise have to work out. It never exposes the provider's API key.
async fn render_carbon(
    config: &config::Config,
    carbon: &Arc<CarbonService>,
    query: Option<&str>,
) -> Result<Response<Body>, Infallible> {
    let known: Vec<String> = config
        .routing
        .backends
        .iter()
        .map(|b| b.carbon_key().to_string())
        .collect::<std::collections::BTreeSet<_>>()
        .into_iter()
        .collect();

    let asked = query
        .and_then(|q| {
            q.split('&')
                .filter_map(|pair| pair.split_once('='))
                .find(|(k, _)| *k == "regions")
                .map(|(_, v)| v.to_string())
        })
        .map(|value| {
            value
                .split(',')
                .map(|r| r.trim().to_string())
                .filter(|r| known.contains(r))
                .collect::<Vec<_>>()
        });

    if let Some(regions) = &asked {
        if regions.is_empty() {
            return json_response(
                StatusCode::BAD_REQUEST,
                &json!({ "error": "No known region in ?regions", "known": known }),
            );
        }
    }
    let regions = asked.unwrap_or(known);

    let now = now_timestamp();
    let signals = carbon.get_signals(&regions, now).await;
    let max_age = carbon.policy().max_age_seconds();
    let described: Vec<_> = signals
        .iter()
        .map(|signal| {
            let age = now.unix_seconds().saturating_sub(signal.observed_at.unix_seconds());
            let age = age.max(0) as u64;
            json!({
                "region": signal.region,
                "carbon_g_per_kwh": signal.carbon_g_per_kwh,
                "observed_at": signal.observed_at.to_rfc3339(),
                "source": signal.source,
                "age_seconds": age,
                "stale": age > max_age,
            })
        })
        .collect();
    let missing: Vec<&String> = regions
        .iter()
        .filter(|region| !signals.iter().any(|s| &s.region == *region))
        .collect();

    json_response(
        StatusCode::OK,
        &json!({
            "max_age_seconds": max_age,
            "asked_for": regions,
            "missing": missing,
            "signals": described,
        }),
    )
}

fn json_response<T: Serialize>(status: StatusCode, body: &T) -> Result<Response<Body>, Infallible> {
    Ok(Response::builder()
        .status(status)
        .header("Content-Type", "application/json; charset=utf-8")
        // Grid data, not user data: safe for a browser demo to read.
        .header("Access-Control-Allow-Origin", "*")
        .body(serde_json::to_string_pretty(body).unwrap_or_default().into())
        .unwrap())
}

fn render_metrics(state: AppState) -> Result<Response<Body>, Infallible> {
    let s = state.read_guard();
    let mut out = String::new();
    out.push_str("# TYPE requests_total counter\n");
    out.push_str("# TYPE carbon_safe_calls_total counter\n");
    out.push_str("# TYPE carbon_safe_call_ratio gauge\n");
    out.push_str("# TYPE errors_total counter\n");
    out.push_str("# TYPE latency_ms_bucket counter\n");
    out.push_str("# TYPE carbon_intensity_g_per_kwh gauge\n");
    out.push_str("# TYPE carbon_intensity_exposure_total counter\n");
    out.push_str("# TYPE co2e_estimated_total counter\n");
    out.push_str("# TYPE energy_joules_estimated_total counter\n");

    for ((route, zone), m) in &s.metrics.route_zone {
        let labels = format!(
            "route=\"{}\",zone=\"{}\"",
            escape_label(route),
            escape_label(zone)
        );
        let safe_ratio = if m.requests_total > 0 {
            m.carbon_safe_calls_total as f64 / m.requests_total as f64
        } else {
            0.0
        };
        out.push_str(&format!(
            "requests_total{{{labels}}} {}\n",
            m.requests_total
        ));
        out.push_str(&format!(
            "carbon_safe_calls_total{{{labels}}} {}\n",
            m.carbon_safe_calls_total
        ));
        out.push_str(&format!(
            "carbon_safe_call_ratio{{{labels}}} {:.8}\n",
            safe_ratio
        ));
        out.push_str(&format!("errors_total{{{labels}}} {}\n", m.errors_total));
        out.push_str(&format!(
            "carbon_intensity_exposure_total{{{labels}}} {:.8}\n",
            m.carbon_intensity_exposure_total_g_per_kwh
        ));
        out.push_str(&format!(
            "co2e_estimated_total{{{labels}}} {:.8}\n",
            m.co2e_estimated_total_g
        ));
        out.push_str(&format!(
            "energy_joules_estimated_total{{{labels}}} {:.8}\n",
            m.energy_estimated_total_j
        ));
        let bounds = ["25", "50", "100", "250", "500", "1000", "2000"];
        for (i, b) in bounds.iter().enumerate() {
            out.push_str(&format!(
                "latency_ms_bucket{{{labels},le=\"{}\"}} {}\n",
                b, m.latency_buckets[i]
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

#[allow(clippy::too_many_arguments)]
fn log_decision(
    state: &AppState,
    metrics: &config::MetricsConfig,
    route_label: &str,
    decision: &DecisionOutput,
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
        "route": route_label,
        "matched_rule": decision.effective.matched_rule.as_ref().map(|r| r.path.clone()),
        "policy": decision.effective.policy.as_str(),
        "class": decision.effective.advanced.route_class.as_str(),
        "method": method,
        "status": status.as_u16(),
        "selected_zone": decision.selected_backend_id.clone().unwrap_or_else(|| "none".to_string()),
        "score": decision.selected_score,
        "reason": decision.reason.code.as_str(),
        "fallback_used": decision.fallback_used,
        "carbon_g_per_kwh": decision.selected_carbon_g_per_kwh,
        "latency_ms_estimate": decision.selected_latency_ms,
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
    let mut s = state.write_guard();
    s.decision_counter = s.decision_counter.saturating_add(1);
    let n = (1.0 / sample_rate).round() as u64;
    let n = n.max(1);
    s.decision_counter.is_multiple_of(n)
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

#[cfg(test)]
mod tests {
    use super::*;
    use rilot_core::fixture::Fixture;
    use std::path::PathBuf;

    fn block_on<F: Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
            .block_on(f)
    }

    #[test]
    fn poisoned_state_lock_recovers() {
        let state = AppState::new();
        let _ = std::panic::catch_unwind({
            let state = state.clone();
            move || {
                let _guard = state.write_guard();
                panic!("poison state lock");
            }
        });

        {
            let mut s = state.write_guard();
            s.decision_counter = 7;
        }

        let s = state.read_guard();
        assert_eq!(s.decision_counter, 7);
    }

    #[test]
    fn error_rate_uses_recent_window() {
        let cfg = config::parse_config(
            r#"{"backends": [{"id": "zone-a", "region": "us-east-1", "url": "http://a"}]}"#,
        )
        .unwrap();
        let state = AppState::new();
        for _ in 0..ERROR_RATE_WINDOW_SIZE {
            record_metrics(&state, "/", "zone-a", 10.0, 100.0, false, 1.0, 1.0, true);
        }
        let rt = backend_runtime(&state, &cfg.routing, "/");
        assert_eq!(rt["zone-a"].error_rate, Some(1.0));
        assert_eq!(rt["zone-a"].request_share_percent, Some(100.0));

        for _ in 0..ERROR_RATE_WINDOW_SIZE {
            record_metrics(&state, "/", "zone-a", 10.0, 100.0, false, 1.0, 1.0, false);
        }
        let rt = backend_runtime(&state, &cfg.routing, "/");
        assert_eq!(rt["zone-a"].error_rate, Some(0.0));
    }

    #[test]
    fn request_context_reads_a_single_location_header() {
        let ctx = request_context(
            "/x",
            &HashMap::from([("x-user-location".to_string(), "51.5,-0.13".to_string())]),
        );
        assert_eq!(
            ctx.user_location,
            Some(GeoPoint {
                lat: 51.5,
                lon: -0.13
            })
        );
        assert_eq!(ctx.user_region, None);
    }

    #[test]
    fn request_context_ignores_an_unparseable_location() {
        let ctx = request_context(
            "/x",
            &HashMap::from([("x-user-location".to_string(), "not-a-location".to_string())]),
        );
        assert_eq!(ctx.user_location, None);
    }

    #[test]
    fn request_context_reads_region_location_and_hints() {
        let headers = HashMap::from([
            ("x-user-region".to_string(), "us-east-1".to_string()),
            ("x-user-lat".to_string(), "40.7".to_string()),
            ("x-user-lon".to_string(), "-74.0".to_string()),
            ("x-rilot-class".to_string(), "background".to_string()),
            ("x-rilot-carbon-cursor".to_string(), "off".to_string()),
        ]);
        let ctx = request_context("/x", &headers);
        assert_eq!(ctx.user_region.as_deref(), Some("us-east-1"));
        assert_eq!(
            ctx.user_location,
            Some(GeoPoint {
                lat: 40.7,
                lon: -74.0
            })
        );
        assert_eq!(ctx.hints.route_class, Some(RouteClass::Background));
        assert_eq!(ctx.hints.carbon_aware, Some(false));
    }

    #[test]
    fn request_context_takes_the_policy_from_the_session_cookie() {
        let headers = HashMap::from([(
            "cookie".to_string(),
            "sid=abc; rilot_policy=%2Fproducts%2F*%3Acarbon,%2Fcheckout%2F*%3Alatency".to_string(),
        )]);
        assert_eq!(
            request_context("/products/bottle", &headers).hints.policy,
            Some(rilot_core::Policy::Carbon)
        );
        assert_eq!(
            request_context("/checkout/pay", &headers).hints.policy,
            Some(rilot_core::Policy::Latency)
        );
        // A path the cookie says nothing about keeps the configured policy.
        assert_eq!(request_context("/cart", &headers).hints.policy, None);
    }

    #[test]
    fn an_explicit_policy_header_beats_the_cookie() {
        let headers = HashMap::from([
            ("cookie".to_string(), "rilot_policy=/*:carbon".to_string()),
            ("x-rilot-policy".to_string(), "latency".to_string()),
        ]);
        assert_eq!(
            request_context("/anything", &headers).hints.policy,
            Some(rilot_core::Policy::Latency)
        );
    }

    #[test]
    fn a_malformed_cookie_is_ignored_not_an_error() {
        let headers = HashMap::from([(
            "cookie".to_string(),
            "rilot_policy=nonsense; other=1".to_string(),
        )]);
        assert_eq!(request_context("/products", &headers).hints.policy, None);
    }

    #[test]
    fn the_policy_hint_overrides_the_matched_rule() {
        // /checkout/* is a latency rule; a session that asked for carbon gets it.
        let config: RoutingConfig = serde_json::from_str(
            r#"{
                "backends": [{"id": "east", "region": "us-east-1", "url": "http://e"}],
                "policy": "balanced",
                "routing_rules": [{"path": "/checkout/*", "policy": "latency"}]
            }"#,
        )
        .unwrap();
        let mut headers = HashMap::new();
        headers.insert(
            "cookie".to_string(),
            "rilot_policy=/checkout/*:carbon".to_string(),
        );
        let ctx = request_context("/checkout/pay", &headers);
        let effective = config.resolve_with_hints(&ctx.path, &ctx.hints);
        assert_eq!(effective.policy, rilot_core::Policy::Carbon);
        assert_eq!(effective.policy_source, rilot_core::ValueSource::Request);
    }

    /// The native flow fetches carbon only for the regions `plan` requests.
    /// It must still reach exactly the decision the core makes when handed
    /// every signal, for every shared fixture.
    #[test]
    fn native_flow_matches_shared_fixtures() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/decisions");
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .expect("fixtures dir")
            .map(|e| e.unwrap().path())
            .filter(|p| p.extension().is_some_and(|e| e == "json"))
            .collect();
        files.sort();
        assert!(!files.is_empty());

        for path in files {
            let fixture = Fixture::parse(&std::fs::read_to_string(&path).unwrap()).unwrap();
            let ctx = fixture.input.context.clone();
            let all_signals = ctx.carbon.signals.clone();
            let output = block_on(run_decision(
                &fixture.input.config,
                ctx.request.clone(),
                ctx.runtime.clone(),
                ctx.previous.clone(),
                ctx.now,
                ctx.carbon.max_age_seconds,
                |regions| async move {
                    all_signals
                        .into_iter()
                        .filter(|s| regions.contains(&s.region))
                        .collect()
                },
            ));
            fixture.check(&output).unwrap_or_else(|e| panic!("{e}"));
            let direct = rilot_core::decide(&fixture.input.config, &fixture.input.context);
            assert_eq!(
                output.selected_backend_id, direct.selected_backend_id,
                "{}",
                fixture.name
            );
            assert_eq!(output.reason, direct.reason, "{}", fixture.name);
        }
    }

    #[test]
    fn latency_policy_never_calls_the_carbon_service() {
        let cfg = config::parse_config(
            r#"{"policy": "latency", "backends": [
                {"id": "east", "region": "us-east-1", "url": "http://e"},
                {"id": "west", "region": "us-west-2", "url": "http://w"}]}"#,
        )
        .unwrap();
        let output = block_on(run_decision(
            &cfg.routing,
            request_context(
                "/",
                &HashMap::from([("x-user-region".into(), "us-west-2".into())]),
            ),
            BTreeMap::new(),
            None,
            now_timestamp(),
            300,
            |_regions| async { panic!("carbon lookup for a latency policy") },
        ));
        assert_eq!(output.selected_backend_id.as_deref(), Some("west"));
    }

    #[test]
    fn legacy_example_config_routes_through_core() {
        let raw = std::fs::read_to_string(
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("examples/config/legacy-proxies.json"),
        )
        .unwrap();
        let cfg = config::parse_config(&raw).unwrap();
        let headers = HashMap::from([("x-user-region".to_string(), "us-east".to_string())]);
        let signals = |regions: Vec<String>| async move {
            regions
                .into_iter()
                .map(|region| CarbonSignal {
                    carbon_g_per_kwh: if region == "us-west" { 300.0 } else { 430.0 },
                    region,
                    observed_at: now_timestamp(),
                    forecast_g_per_kwh: None,
                    source: None,
                })
                .collect()
        };

        let checkout = block_on(run_decision(
            &cfg.routing,
            request_context("/checkout/pay", &headers),
            BTreeMap::new(),
            None,
            now_timestamp(),
            300,
            signals,
        ));
        assert_eq!(
            cfg.extras_for(checkout.effective.matched_rule.as_ref().map(|r| r.index))
                .label,
            "/checkout"
        );
        assert_eq!(
            checkout.selected_backend_id.as_deref(),
            Some("checkout-local")
        );
        assert!(!checkout.needs_carbon);

        let search = block_on(run_decision(
            &cfg.routing,
            request_context("/search", &headers),
            BTreeMap::new(),
            None,
            now_timestamp(),
            300,
            signals,
        ));
        assert_eq!(search.effective.matched_rule.unwrap().path, "/search*");
        assert!(search.selected_backend_id.is_some());
        assert!(
            cfg.routing.match_rule("/nothing-here").is_some(),
            "legacy '/' prefix catches all"
        );
    }
}
