//! The routing decision engine.
//!
//! Two entry points share one evaluation pipeline:
//!
//! * [`plan`] runs everything that does not need carbon data (rule resolution,
//!   scope, strict-local, radius, candidate limit, health/capacity/latency
//!   constraints) and reports which regions still need a carbon signal. For a
//!   latency policy that list is empty, so adapters can skip carbon lookups.
//! * [`decide`] runs the full pipeline with the carbon signals the adapter
//!   fetched and returns the selected backend plus a per-candidate explanation.
//!
//! Everything here is pure: time comes in as `now`, runtime health comes in as
//! [`BackendRuntime`], and the previous decision comes in as [`PreviousDecision`].

use crate::config::{
    Backend, EffectiveConfig, Fallback, Policy, RequestHints, RouteClass, RoutingConfig, Weights,
};
use crate::geo::{distance_km, region_location, GeoPoint};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap};

pub const DEFAULT_CARBON_MAX_AGE_SECONDS: u64 = 300;
/// Latency when nothing better is known.
pub const DEFAULT_LATENCY_MS: f64 = 20.0;
/// Distance-based latency estimate: fixed overhead plus fibre round trip with
/// typical path inflation (~1.5x straight-line distance).
pub const DISTANCE_LATENCY_BASE_MS: f64 = 5.0;
pub const DISTANCE_LATENCY_MS_PER_KM: f64 = 0.015;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// Normalized carbon signal. Keyed by Rilot region, never by provider zone id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarbonSignal {
    pub region: String,
    pub carbon_g_per_kwh: f64,
    pub observed_at: Timestamp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forecast_g_per_kwh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<SignalSource>,
}

/// Where the adapter's carbon service obtained a signal (display only).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SignalSource {
    Live,
    LocalCache,
    LastKnownGood,
    Mock,
    Json,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarbonInput {
    #[serde(default = "default_max_age")]
    pub max_age_seconds: u64,
    #[serde(default)]
    pub signals: Vec<CarbonSignal>,
}

fn default_max_age() -> u64 {
    DEFAULT_CARBON_MAX_AGE_SECONDS
}

impl Default for CarbonInput {
    fn default() -> Self {
        CarbonInput {
            max_age_seconds: DEFAULT_CARBON_MAX_AGE_SECONDS,
            signals: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RequestContext {
    pub path: String,
    /// Canonical region of the user (e.g. `us-east-1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_region: Option<String>,
    /// Precise user location; takes precedence over `user_region` for distance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_location: Option<GeoPoint>,
    #[serde(default)]
    pub hints: RequestHints,
}

/// Observed runtime state for one backend. All fields optional.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BackendRuntime {
    /// Measured latency; overrides any estimate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_rate: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_flight: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub request_share_percent: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub healthy: Option<bool>,
}

/// Hysteresis state carried between decisions for the same route.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PreviousDecision {
    pub backend_id: String,
    /// When traffic last switched to `backend_id`.
    pub since: Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionContext {
    pub request: RequestContext,
    pub now: Timestamp,
    #[serde(default)]
    pub carbon: CarbonInput,
    /// Keyed by backend id.
    #[serde(default)]
    pub runtime: BTreeMap<String, BackendRuntime>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<PreviousDecision>,
}

/// Self-contained input, as used by the JSON / Wasm interface and fixtures.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionInput {
    pub config: RoutingConfig,
    #[serde(flatten)]
    pub context: DecisionContext,
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RejectionKind {
    /// Strict-local route and the backend is outside the user's region.
    RegionConstraint,
    OutsideRadius,
    /// Beyond `max_candidates`.
    CandidateLimit,
    HealthConstraint,
    CapacityConstraint,
    LatencyConstraint,
    CarbonUnavailable,
    InsufficientCarbonBenefit,
}

impl RejectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            RejectionKind::RegionConstraint => "region-constraint",
            RejectionKind::OutsideRadius => "outside-radius",
            RejectionKind::CandidateLimit => "candidate-limit",
            RejectionKind::HealthConstraint => "health-constraint",
            RejectionKind::CapacityConstraint => "capacity-constraint",
            RejectionKind::LatencyConstraint => "latency-constraint",
            RejectionKind::CarbonUnavailable => "carbon-unavailable",
            RejectionKind::InsufficientCarbonBenefit => "insufficient-carbon-benefit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rejection {
    pub kind: RejectionKind,
    pub detail: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LatencySource {
    Measured,
    Configured,
    DistanceEstimate,
    Default,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CarbonStatus {
    Fresh,
    Stale,
    Missing,
    /// Not looked up (carbon not needed, or rejected before the carbon stage).
    NotRequested,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CarbonReading {
    pub status: CarbonStatus,
    pub key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub carbon_g_per_kwh: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forecast_g_per_kwh: Option<f64>,
    /// Value used for scoring (forecast when time shifting, else current).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub used_g_per_kwh: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub observed_at: Option<Timestamp>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub age_seconds: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SignalSource>,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct ScoreComponents {
    pub carbon: f64,
    pub latency: f64,
    pub reliability: f64,
    pub cost: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScoreBreakdown {
    /// Each metric divided by the maximum among eligible candidates (0..1).
    pub normalized: ScoreComponents,
    pub weighted: ScoreComponents,
    /// Lower is better.
    pub total: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CandidateStatus {
    Eligible,
    Rejected,
    Selected,
    /// Chosen by the fallback strategy after every candidate was rejected.
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CandidateEvaluation {
    pub backend_id: String,
    pub region: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance_km: Option<f64>,
    pub latency_ms: f64,
    pub latency_source: LatencySource,
    pub error_rate: f64,
    pub carbon: CarbonReading,
    pub status: CandidateStatus,
    pub rejections: Vec<Rejection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<ScoreBreakdown>,
    /// Forecast is cleaner by at least the configured ratio.
    pub deferrable: bool,
}

impl CandidateEvaluation {
    pub fn is_eligible(&self) -> bool {
        self.rejections.is_empty()
    }

    /// First rejection kind, or `"eligible"`.
    pub fn primary_reason(&self) -> &'static str {
        self.rejections
            .first()
            .map(|r| r.kind.as_str())
            .unwrap_or("eligible")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LocationSource {
    Request,
    RegionCatalog,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UserView {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<GeoPoint>,
    pub location_source: LocationSource,
    /// `false` when a radius is configured but the user location is unknown.
    pub radius_applied: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ReasonCode {
    /// Weighted score winner (balanced / carbon policy).
    ScoreWin,
    /// Latency policy winner.
    LowestLatency,
    /// Previous backend kept because the improvement was below the hysteresis delta.
    HysteresisStickyZone,
    /// Background request whose backend has a markedly cleaner forecast.
    DeferredForGreenerWindow,
    FallbackNearest,
    FallbackLowestLatency,
    NoEligibleBackend,
    NoBackends,
}

impl ReasonCode {
    pub fn as_str(self) -> &'static str {
        match self {
            ReasonCode::ScoreWin => "score-win",
            ReasonCode::LowestLatency => "lowest-latency",
            ReasonCode::HysteresisStickyZone => "hysteresis-sticky-zone",
            ReasonCode::DeferredForGreenerWindow => "deferred-for-greener-window",
            ReasonCode::FallbackNearest => "fallback-nearest",
            ReasonCode::FallbackLowestLatency => "fallback-lowest-latency",
            ReasonCode::NoEligibleBackend => "no-eligible-backend",
            ReasonCode::NoBackends => "no-backends",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionReason {
    pub code: ReasonCode,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CandidatePlan {
    pub path: String,
    pub effective: EffectiveConfig,
    pub user: UserView,
    pub needs_carbon: bool,
    /// Distinct carbon keys the adapter should fetch (empty when `needs_carbon` is false).
    pub carbon_regions: Vec<String>,
    pub candidates: Vec<CandidateEvaluation>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DecisionOutput {
    pub path: String,
    pub effective: EffectiveConfig,
    pub user: UserView,
    pub needs_carbon: bool,
    /// Normalized weights actually used for scoring.
    pub weights: Weights,
    pub selected_backend_id: Option<String>,
    pub selected_region: Option<String>,
    pub selected_url: Option<String>,
    pub selected_score: Option<f64>,
    pub selected_carbon_g_per_kwh: Option<f64>,
    pub selected_latency_ms: Option<f64>,
    pub fallback_used: bool,
    pub reason: DecisionReason,
    /// Selected vs. the highest-carbon eligible candidate.
    pub carbon_saved_vs_worst_g_per_kwh: f64,
    pub carbon_saved_vs_worst_percent: f64,
    /// How long a background request may be deferred (0 = forward now).
    pub defer_seconds: u64,
    pub candidates: Vec<CandidateEvaluation>,
    /// State to persist and pass back as `previous` on the next decision for this route.
    pub next_state: Option<PreviousDecision>,
}

impl DecisionOutput {
    pub fn selected(&self) -> Option<&CandidateEvaluation> {
        let id = self.selected_backend_id.as_deref()?;
        self.candidates.iter().find(|c| c.backend_id == id)
    }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

struct PreCarbon<'a> {
    effective: EffectiveConfig,
    user: UserView,
    needs_carbon: bool,
    backends: Vec<&'a Backend>,
    candidates: Vec<CandidateEvaluation>,
}

fn reject(c: &mut CandidateEvaluation, kind: RejectionKind, detail: String) {
    c.rejections.push(Rejection { kind, detail });
}

fn cmp_f64(a: f64, b: f64) -> Ordering {
    a.partial_cmp(&b).unwrap_or(Ordering::Equal)
}

fn fmt_km(km: f64) -> String {
    format!("{:.0} km", km)
}

fn same_region(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

fn resolve_user(request: &RequestContext) -> UserView {
    let region = request
        .user_region
        .as_ref()
        .map(|r| r.trim().to_string())
        .filter(|r| !r.is_empty());
    let (location, location_source) = match request.user_location.filter(GeoPoint::is_valid) {
        Some(loc) => (Some(loc), LocationSource::Request),
        None => match region.as_deref().and_then(region_location) {
            Some(loc) => (Some(loc), LocationSource::RegionCatalog),
            None => (None, LocationSource::Unknown),
        },
    };
    UserView {
        region,
        location,
        location_source,
        radius_applied: false,
    }
}

fn estimate_latency(
    backend: &Backend,
    runtime: Option<&BackendRuntime>,
    user: &UserView,
    distance: Option<f64>,
    penalty_ms: f64,
) -> (f64, LatencySource) {
    if let Some(ms) = runtime
        .and_then(|r| r.latency_ms)
        .filter(|v| v.is_finite() && *v >= 0.0)
    {
        return (ms, LatencySource::Measured);
    }
    let cross_region = user
        .region
        .as_deref()
        .is_some_and(|r| !same_region(r, &backend.region));
    let penalty = if cross_region {
        penalty_ms.max(0.0)
    } else {
        0.0
    };
    if let Some(rtt) = backend.rtt_ms {
        return (rtt + penalty, LatencySource::Configured);
    }
    if let Some(d) = distance {
        return (
            DISTANCE_LATENCY_BASE_MS + d * DISTANCE_LATENCY_MS_PER_KM,
            LatencySource::DistanceEstimate,
        );
    }
    (DEFAULT_LATENCY_MS + penalty, LatencySource::Default)
}

fn evaluate_pre_carbon<'a>(
    config: &'a RoutingConfig,
    request: &RequestContext,
    runtime: &BTreeMap<String, BackendRuntime>,
) -> PreCarbon<'a> {
    let effective = config.resolve_with_hints(&request.path, &request.hints);
    let adv = &effective.advanced;
    let mut user = resolve_user(request);
    let needs_carbon = effective.weights().carbon > 0.0;

    let backends: Vec<&Backend> = effective
        .backends
        .iter()
        .filter_map(|id| config.backend(id))
        .collect();

    let mut candidates: Vec<CandidateEvaluation> = backends
        .iter()
        .map(|b| {
            let rt = runtime.get(&b.id);
            let backend_location = b.location.or_else(|| region_location(&b.region));
            let distance = match (user.location, backend_location) {
                (Some(u), Some(l)) => Some(distance_km(u, l)),
                _ => None,
            };
            let (latency_ms, latency_source) =
                estimate_latency(b, rt, &user, distance, adv.cross_region_rtt_penalty_ms);
            CandidateEvaluation {
                backend_id: b.id.clone(),
                region: b.region.clone(),
                url: b.url.clone(),
                distance_km: distance,
                latency_ms,
                latency_source,
                error_rate: rt
                    .and_then(|r| r.error_rate)
                    .filter(|v| v.is_finite())
                    .unwrap_or(0.0)
                    .max(0.0),
                carbon: CarbonReading {
                    status: CarbonStatus::NotRequested,
                    key: b.carbon_key().to_string(),
                    carbon_g_per_kwh: None,
                    forecast_g_per_kwh: None,
                    used_g_per_kwh: None,
                    observed_at: None,
                    age_seconds: None,
                    source: None,
                },
                status: CandidateStatus::Eligible,
                rejections: Vec::new(),
                score: None,
                deferrable: false,
            }
        })
        .collect();

    // Strict-local: pin to the user's region when at least one backend is there.
    if adv.route_class == RouteClass::StrictLocal {
        if let Some(region) = user.region.clone() {
            if candidates.iter().any(|c| same_region(&c.region, &region)) {
                for c in candidates
                    .iter_mut()
                    .filter(|c| !same_region(&c.region, &region))
                {
                    let detail = format!("strict-local route pins traffic to {region}");
                    reject(c, RejectionKind::RegionConstraint, detail);
                }
            }
        }
    }

    // Radius.
    if let Some(radius) = effective.radius_km {
        if user.location.is_some() {
            user.radius_applied = true;
            for c in candidates.iter_mut() {
                match c.distance_km {
                    Some(d) if d > radius => {
                        let detail = format!("{} away, radius is {}", fmt_km(d), fmt_km(radius));
                        reject(c, RejectionKind::OutsideRadius, detail);
                    }
                    Some(_) => {}
                    None => {
                        let detail = format!(
                            "region {} has no known location, so the {} radius cannot be verified",
                            c.region,
                            fmt_km(radius)
                        );
                        reject(c, RejectionKind::OutsideRadius, detail);
                    }
                }
            }
        }
    }

    // Candidate limit: keep the N best-placed (local first, then fastest).
    if let Some(limit) = adv.max_candidates {
        let limit = limit.max(1);
        let mut order: Vec<usize> = (0..candidates.len())
            .filter(|&i| candidates[i].is_eligible())
            .collect();
        let local = |c: &CandidateEvaluation| {
            !user
                .region
                .as_deref()
                .is_some_and(|r| same_region(r, &c.region))
        };
        order.sort_by(|&a, &b| {
            let (ca, cb) = (&candidates[a], &candidates[b]);
            local(ca)
                .cmp(&local(cb))
                .then_with(|| cmp_f64(ca.latency_ms, cb.latency_ms))
                .then_with(|| a.cmp(&b))
        });
        for &i in order.iter().skip(limit) {
            let detail = format!("only the {limit} best-placed candidates are considered");
            reject(&mut candidates[i], RejectionKind::CandidateLimit, detail);
        }
    }

    for (c, b) in candidates.iter_mut().zip(&backends) {
        let rt = runtime.get(&b.id);

        if rt.and_then(|r| r.healthy) == Some(false) {
            reject(
                c,
                RejectionKind::HealthConstraint,
                "marked unhealthy".to_string(),
            );
        }
        if let Some(max) = adv.max_error_rate {
            if c.error_rate > max {
                let detail = format!("error rate {:.3} exceeds {:.3}", c.error_rate, max);
                reject(c, RejectionKind::HealthConstraint, detail);
            }
        }

        if let (Some(limit), Some(in_flight)) = (b.max_in_flight, rt.and_then(|r| r.in_flight)) {
            if in_flight >= limit {
                let detail = format!("{in_flight} requests in flight (limit {limit})");
                reject(c, RejectionKind::CapacityConstraint, detail);
            }
        }
        if let Some(cap) = adv.max_request_share_percent {
            let cap = cap.clamp(0.0, 100.0);
            let share = rt.and_then(|r| r.request_share_percent).unwrap_or(0.0);
            if cap < 100.0 && share >= cap {
                let detail = format!("request share {share:.1}% reached cap {cap:.1}%");
                reject(c, RejectionKind::CapacityConstraint, detail);
            }
        }
    }

    // The latency reference is the fastest backend that could actually serve
    // the request: unhealthy or saturated backends must not tighten it.
    let best_latency = candidates
        .iter()
        .filter(|c| c.is_eligible())
        .map(|c| c.latency_ms)
        .fold(f64::INFINITY, f64::min);

    for c in candidates.iter_mut() {
        if let Some(max) = adv.hard_max_latency_ms {
            if c.latency_ms > max {
                let detail = format!(
                    "latency {:.1} ms exceeds hard max {:.1} ms",
                    c.latency_ms, max
                );
                reject(c, RejectionKind::LatencyConstraint, detail);
            }
        }
        if let Some(delta) = adv.max_latency_delta_ms {
            if best_latency.is_finite() && c.latency_ms > best_latency + delta {
                let detail = format!(
                    "latency {:.1} ms is more than {:.1} ms above the fastest candidate ({:.1} ms)",
                    c.latency_ms, delta, best_latency
                );
                reject(c, RejectionKind::LatencyConstraint, detail);
            }
        }
    }

    PreCarbon {
        effective,
        user,
        needs_carbon,
        backends,
        candidates,
    }
}

/// Runs every carbon-independent step and reports which carbon keys to fetch.
pub fn plan(
    config: &RoutingConfig,
    request: &RequestContext,
    runtime: &BTreeMap<String, BackendRuntime>,
) -> CandidatePlan {
    let pre = evaluate_pre_carbon(config, request, runtime);
    let mut carbon_regions: Vec<String> = Vec::new();
    if pre.needs_carbon {
        for c in pre.candidates.iter().filter(|c| c.is_eligible()) {
            if !carbon_regions.contains(&c.carbon.key) {
                carbon_regions.push(c.carbon.key.clone());
            }
        }
    }
    CandidatePlan {
        path: request.path.clone(),
        effective: pre.effective,
        user: pre.user,
        needs_carbon: pre.needs_carbon,
        carbon_regions,
        candidates: pre.candidates,
    }
}

/// Computes the full routing decision.
pub fn decide(config: &RoutingConfig, ctx: &DecisionContext) -> DecisionOutput {
    let PreCarbon {
        effective,
        user,
        needs_carbon,
        backends,
        mut candidates,
    } = evaluate_pre_carbon(config, &ctx.request, &ctx.runtime);
    let adv = effective.advanced.clone();
    let weights = effective.weights();
    let now = ctx.now;

    // Newest signal per carbon key.
    let mut signals: HashMap<&str, &CarbonSignal> = HashMap::new();
    for s in &ctx.carbon.signals {
        if !s.carbon_g_per_kwh.is_finite() || s.carbon_g_per_kwh < 0.0 {
            continue;
        }
        let entry = signals.entry(s.region.as_str()).or_insert(s);
        if s.observed_at > entry.observed_at {
            *entry = s;
        }
    }

    let forecast_mode = needs_carbon
        && adv.route_class == RouteClass::Background
        && adv.forecasting
        && adv.time_shift;

    for c in candidates.iter_mut() {
        let pre_eligible = c.is_eligible();
        match signals.get(c.carbon.key.as_str()) {
            Some(s) => {
                let age = now.seconds_since(s.observed_at).max(0);
                let fresh = age as u64 <= ctx.carbon.max_age_seconds;
                c.carbon.status = if fresh {
                    CarbonStatus::Fresh
                } else {
                    CarbonStatus::Stale
                };
                c.carbon.carbon_g_per_kwh = Some(s.carbon_g_per_kwh);
                c.carbon.forecast_g_per_kwh =
                    s.forecast_g_per_kwh.filter(|v| v.is_finite() && *v >= 0.0);
                c.carbon.observed_at = Some(s.observed_at);
                c.carbon.age_seconds = Some(age);
                c.carbon.source = s.source;
                if fresh {
                    let current = s.carbon_g_per_kwh;
                    c.carbon.used_g_per_kwh = Some(current);
                    if forecast_mode {
                        if let Some(next) = c.carbon.forecast_g_per_kwh {
                            c.carbon.used_g_per_kwh = Some(next);
                            let improvement = if current > 0.0 {
                                (current - next) / current
                            } else {
                                0.0
                            };
                            c.deferrable = improvement >= adv.forecast_min_improvement_ratio;
                        }
                    }
                }
            }
            None if needs_carbon && pre_eligible => c.carbon.status = CarbonStatus::Missing,
            None => {}
        }

        if needs_carbon && pre_eligible && c.carbon.used_g_per_kwh.is_none() {
            let detail = match (c.carbon.status, c.carbon.age_seconds) {
                (CarbonStatus::Stale, Some(age)) => format!(
                    "carbon signal for {} is {}s old (max {}s)",
                    c.carbon.key, age, ctx.carbon.max_age_seconds
                ),
                _ => format!("no carbon signal for {}", c.carbon.key),
            };
            reject(c, RejectionKind::CarbonUnavailable, detail);
        }
    }

    // Minimum carbon benefit vs. the lowest-latency eligible candidate.
    if let (true, Some(min_benefit)) = (needs_carbon, adv.min_carbon_benefit_g_per_kwh) {
        let baseline = candidates
            .iter()
            .enumerate()
            .filter(|(_, c)| c.is_eligible())
            .min_by(|(ia, a), (ib, b)| cmp_f64(a.latency_ms, b.latency_ms).then(ia.cmp(ib)))
            .and_then(|(i, c)| c.carbon.used_g_per_kwh.map(|v| (i, v)));
        if let Some((baseline_idx, baseline_carbon)) = baseline {
            let baseline_id = candidates[baseline_idx].backend_id.clone();
            for (i, c) in candidates.iter_mut().enumerate() {
                if i == baseline_idx || !c.is_eligible() {
                    continue;
                }
                if let Some(v) = c.carbon.used_g_per_kwh {
                    let benefit = baseline_carbon - v;
                    if benefit < min_benefit {
                        let detail = format!(
                            "only {benefit:.1} gCO2/kWh cleaner than {baseline_id} (minimum {min_benefit:.1})"
                        );
                        reject(c, RejectionKind::InsufficientCarbonBenefit, detail);
                    }
                }
            }
        }
    }

    // Score eligible candidates: each metric divided by the eligible maximum.
    let eligible: Vec<usize> = (0..candidates.len())
        .filter(|&i| candidates[i].is_eligible())
        .collect();
    let max_of = |f: &dyn Fn(usize) -> f64| {
        eligible
            .iter()
            .map(|&i| f(i))
            .fold(0.0_f64, |acc, v| acc.max(v))
    };
    let carbon_of = |c: &CandidateEvaluation| {
        if needs_carbon {
            c.carbon.used_g_per_kwh.unwrap_or(0.0)
        } else {
            0.0
        }
    };
    let cost_of = |i: usize| backends[i].cost.unwrap_or(0.0).max(0.0);
    let max_carbon = max_of(&|i| carbon_of(&candidates[i]));
    let max_latency = max_of(&|i| candidates[i].latency_ms);
    let max_error = max_of(&|i| candidates[i].error_rate);
    let max_cost = max_of(&|i| cost_of(i));
    let norm = |v: f64, max: f64| if max > 0.0 { v / max } else { 0.0 };

    for &i in &eligible {
        let cost = cost_of(i);
        let c = &mut candidates[i];
        let normalized = ScoreComponents {
            carbon: norm(carbon_of(c), max_carbon),
            latency: norm(c.latency_ms, max_latency),
            reliability: norm(c.error_rate, max_error),
            cost: norm(cost, max_cost),
        };
        let weighted = ScoreComponents {
            carbon: normalized.carbon * weights.carbon,
            latency: normalized.latency * weights.latency,
            reliability: normalized.reliability * weights.reliability,
            cost: normalized.cost * weights.cost,
        };
        c.score = Some(ScoreBreakdown {
            normalized,
            weighted,
            total: weighted.carbon + weighted.latency + weighted.reliability + weighted.cost,
        });
    }
    let total = |c: &CandidateEvaluation| c.score.map(|s| s.total).unwrap_or(f64::INFINITY);

    let best = eligible
        .iter()
        .copied()
        .min_by(|&a, &b| cmp_f64(total(&candidates[a]), total(&candidates[b])).then(a.cmp(&b)));

    let mut fallback_used = false;
    let (selected, reason) = match best {
        Some(best) => select_with_hysteresis(&candidates, best, &effective, ctx, weights),
        None if candidates.is_empty() => (
            None,
            DecisionReason {
                code: ReasonCode::NoBackends,
                message: "no backends are in scope for this route".to_string(),
            },
        ),
        None => {
            let (idx, reason) = apply_fallback(&candidates, &ctx.runtime, effective.fallback);
            fallback_used = idx.is_some();
            (idx, reason)
        }
    };

    if let Some(i) = selected {
        candidates[i].status = if fallback_used {
            CandidateStatus::Fallback
        } else {
            CandidateStatus::Selected
        };
    }
    for c in candidates.iter_mut() {
        if c.status == CandidateStatus::Eligible && !c.is_eligible() {
            c.status = CandidateStatus::Rejected;
        }
    }

    // Deferral applies to a normally selected background candidate.
    let mut reason = reason;
    let mut defer_seconds = 0;
    if let Some(i) = selected {
        let c = &candidates[i];
        if !fallback_used && c.deferrable && reason.code != ReasonCode::HysteresisStickyZone {
            defer_seconds = adv.max_defer_seconds;
            reason = DecisionReason {
                code: ReasonCode::DeferredForGreenerWindow,
                message: format!(
                    "{} selected; its forecast ({:.0} gCO2/kWh) is at least {:.0}% cleaner than now, so the request may wait up to {}s",
                    c.backend_id,
                    c.carbon.forecast_g_per_kwh.unwrap_or(0.0),
                    adv.forecast_min_improvement_ratio * 100.0,
                    defer_seconds
                ),
            };
        }
    }

    // Savings vs. the dirtiest eligible candidate.
    let worst = candidates
        .iter()
        .filter(|c| c.is_eligible())
        .filter_map(|c| c.carbon.used_g_per_kwh)
        .fold(None, |acc: Option<f64>, v| {
            Some(acc.map_or(v, |a| a.max(v)))
        });
    let selected_carbon = selected.and_then(|i| candidates[i].carbon.used_g_per_kwh);
    let (saved, saved_pct) = match (worst, selected_carbon) {
        (Some(w), Some(s)) => {
            let saved = (w - s).max(0.0);
            (saved, if w > 0.0 { saved / w * 100.0 } else { 0.0 })
        }
        _ => (0.0, 0.0),
    };

    let next_state = selected.map(|i| {
        let id = &candidates[i].backend_id;
        let since = match &ctx.previous {
            Some(prev) if &prev.backend_id == id => prev.since,
            _ => now,
        };
        PreviousDecision {
            backend_id: id.clone(),
            since,
        }
    });

    let sel = selected.map(|i| &candidates[i]);
    DecisionOutput {
        path: ctx.request.path.clone(),
        needs_carbon,
        weights,
        selected_backend_id: sel.map(|c| c.backend_id.clone()),
        selected_region: sel.map(|c| c.region.clone()),
        selected_url: sel.and_then(|c| c.url.clone()),
        selected_score: sel.and_then(|c| c.score.map(|s| s.total)),
        selected_carbon_g_per_kwh: sel.and_then(|c| c.carbon.used_g_per_kwh),
        selected_latency_ms: sel.map(|c| c.latency_ms),
        fallback_used,
        reason,
        carbon_saved_vs_worst_g_per_kwh: saved,
        carbon_saved_vs_worst_percent: saved_pct,
        defer_seconds,
        next_state,
        effective,
        user,
        candidates,
    }
}

fn select_with_hysteresis(
    candidates: &[CandidateEvaluation],
    best: usize,
    effective: &EffectiveConfig,
    ctx: &DecisionContext,
    weights: Weights,
) -> (Option<usize>, DecisionReason) {
    let adv = &effective.advanced;
    let b = &candidates[best];
    let score = b.score.map(|s| s.total).unwrap_or(0.0);

    if let Some(prev) = &ctx.previous {
        let elapsed = ctx.now.seconds_since(prev.since).max(0) as u64;
        let prev_idx = candidates
            .iter()
            .position(|c| c.backend_id == prev.backend_id && c.is_eligible());
        if let (Some(pi), true) = (prev_idx, elapsed < adv.min_switch_interval_secs) {
            let prev_score = candidates[pi]
                .score
                .map(|s| s.total)
                .unwrap_or(f64::INFINITY);
            let gain = prev_score - score;
            if pi != best && gain < adv.hysteresis_delta {
                return (
                    Some(pi),
                    DecisionReason {
                        code: ReasonCode::HysteresisStickyZone,
                        message: format!(
                            "kept {} because switching to {} would improve the score by only {:.3} (< {:.3}) within the {}s switch interval",
                            prev.backend_id, b.backend_id, gain, adv.hysteresis_delta, adv.min_switch_interval_secs
                        ),
                    },
                );
            }
        }
    }

    let reason = if effective.policy == Policy::Latency {
        DecisionReason {
            code: ReasonCode::LowestLatency,
            message: format!(
                "{} is the lowest-latency eligible backend ({:.1} ms)",
                b.backend_id, b.latency_ms
            ),
        }
    } else {
        DecisionReason {
            code: ReasonCode::ScoreWin,
            message: format!(
                "{} has the lowest weighted score ({:.3}) among eligible backends (carbon {:.0}%, latency {:.0}%, reliability {:.0}%, cost {:.0}%)",
                b.backend_id,
                score,
                weights.carbon * 100.0,
                weights.latency * 100.0,
                weights.reliability * 100.0,
                weights.cost * 100.0
            ),
        }
    };
    (Some(best), reason)
}

fn apply_fallback(
    candidates: &[CandidateEvaluation],
    runtime: &BTreeMap<String, BackendRuntime>,
    fallback: Fallback,
) -> (Option<usize>, DecisionReason) {
    let pool: Vec<usize> = (0..candidates.len())
        .filter(|&i| {
            runtime
                .get(&candidates[i].backend_id)
                .and_then(|r| r.healthy)
                != Some(false)
        })
        .collect();

    let none = |message: String| {
        (
            None,
            DecisionReason {
                code: ReasonCode::NoEligibleBackend,
                message,
            },
        )
    };
    if fallback == Fallback::None {
        return none("no backend passed the eligibility checks and fallback is 'none'".into());
    }
    if pool.is_empty() {
        return none(
            "no backend passed the eligibility checks and every backend is unhealthy".into(),
        );
    }

    let by_latency = |a: &usize, b: &usize| {
        cmp_f64(candidates[*a].latency_ms, candidates[*b].latency_ms).then(a.cmp(b))
    };
    let use_distance =
        fallback == Fallback::Nearest && pool.iter().any(|&i| candidates[i].distance_km.is_some());
    let chosen = if use_distance {
        *pool
            .iter()
            .min_by(|a, b| {
                let da = candidates[**a].distance_km.unwrap_or(f64::INFINITY);
                let db = candidates[**b].distance_km.unwrap_or(f64::INFINITY);
                cmp_f64(da, db).then_with(|| by_latency(a, b))
            })
            .expect("pool is not empty")
    } else {
        *pool
            .iter()
            .min_by(|a, b| by_latency(a, b))
            .expect("pool is not empty")
    };

    let c = &candidates[chosen];
    let (code, how) = match (fallback, use_distance) {
        (Fallback::Nearest, true) => (
            ReasonCode::FallbackNearest,
            format!(
                "the nearest backend {} ({} away)",
                c.backend_id,
                fmt_km(c.distance_km.unwrap_or(0.0))
            ),
        ),
        (Fallback::Nearest, false) => (
            ReasonCode::FallbackNearest,
            format!(
                "{} (user location unknown, so nearest = lowest latency, {:.1} ms)",
                c.backend_id, c.latency_ms
            ),
        ),
        _ => (
            ReasonCode::FallbackLowestLatency,
            format!(
                "the lowest-latency backend {} ({:.1} ms)",
                c.backend_id, c.latency_ms
            ),
        ),
    };
    (
        Some(chosen),
        DecisionReason {
            code,
            message: format!(
                "no backend passed the eligibility checks; fallback '{}' selected {}",
                fallback.as_str(),
                how
            ),
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_789_761_900;

    fn config(extra: &str) -> RoutingConfig {
        serde_json::from_str(&format!(
            r#"{{
              "backends": [
                {{"id": "east", "region": "us-east-1", "max_in_flight": 10}},
                {{"id": "west", "region": "us-west-2"}}
              ]{extra}
            }}"#
        ))
        .unwrap()
    }

    fn ctx(signals: &[(&str, f64)]) -> DecisionContext {
        DecisionContext {
            request: RequestContext {
                path: "/".into(),
                user_region: Some("us-east-1".into()),
                ..Default::default()
            },
            now: Timestamp(NOW),
            carbon: CarbonInput {
                max_age_seconds: 300,
                signals: signals
                    .iter()
                    .map(|(r, c)| CarbonSignal {
                        region: r.to_string(),
                        carbon_g_per_kwh: *c,
                        observed_at: Timestamp(NOW - 60),
                        forecast_g_per_kwh: None,
                        source: None,
                    })
                    .collect(),
            },
            runtime: BTreeMap::new(),
            previous: None,
        }
    }

    fn kinds(out: &DecisionOutput, id: &str) -> Vec<RejectionKind> {
        let c = out.candidates.iter().find(|c| c.backend_id == id).unwrap();
        c.rejections.iter().map(|r| r.kind).collect()
    }

    #[test]
    fn capacity_and_error_rate_reject() {
        let cfg = config(r#", "policy": "latency", "advanced": {"max_error_rate": 0.05}"#);
        let mut c = ctx(&[]);
        c.runtime.insert(
            "east".into(),
            BackendRuntime {
                in_flight: Some(10),
                ..Default::default()
            },
        );
        c.runtime.insert(
            "west".into(),
            BackendRuntime {
                error_rate: Some(0.2),
                ..Default::default()
            },
        );
        let out = decide(&cfg, &c);
        assert_eq!(kinds(&out, "east"), vec![RejectionKind::CapacityConstraint]);
        assert_eq!(kinds(&out, "west"), vec![RejectionKind::HealthConstraint]);
        assert!(out.fallback_used);
        assert_eq!(out.selected_backend_id.as_deref(), Some("east"));
    }

    #[test]
    fn unhealthy_backends_are_never_fallback_targets() {
        let cfg = config(r#", "policy": "latency", "fallback": "nearest""#);
        let mut c = ctx(&[]);
        for id in ["east", "west"] {
            c.runtime.insert(
                id.into(),
                BackendRuntime {
                    healthy: Some(false),
                    ..Default::default()
                },
            );
        }
        let out = decide(&cfg, &c);
        assert_eq!(out.selected_backend_id, None);
        assert_eq!(out.reason.code, ReasonCode::NoEligibleBackend);
    }

    #[test]
    fn candidate_limit_keeps_local_first() {
        let cfg = config(r#", "policy": "latency", "advanced": {"max_candidates": 1}"#);
        let out = decide(&cfg, &ctx(&[]));
        assert_eq!(kinds(&out, "west"), vec![RejectionKind::CandidateLimit]);
    }

    #[test]
    fn min_carbon_benefit_rejects_marginal_gains() {
        let cfg =
            config(r#", "policy": "carbon", "advanced": {"min_carbon_benefit_g_per_kwh": 50}"#);
        let out = decide(&cfg, &ctx(&[("us-east-1", 300.0), ("us-west-2", 280.0)]));
        assert_eq!(
            kinds(&out, "west"),
            vec![RejectionKind::InsufficientCarbonBenefit]
        );
        assert_eq!(out.selected_backend_id.as_deref(), Some("east"));
    }

    #[test]
    fn carbon_cursor_hint_forces_latency_and_skips_carbon() {
        let cfg = config(r#", "policy": "carbon""#);
        let mut c = ctx(&[("us-east-1", 900.0), ("us-west-2", 10.0)]);
        c.request.hints.carbon_aware = Some(false);
        let out = decide(&cfg, &c);
        assert!(!out.needs_carbon);
        assert_eq!(
            out.effective.policy_source,
            crate::config::ValueSource::Request
        );
        assert_eq!(out.reason.code, ReasonCode::LowestLatency);
        assert_eq!(out.selected_backend_id.as_deref(), Some("east"));
    }

    #[test]
    fn hysteresis_expires_after_switch_interval() {
        let cfg = config(r#", "policy": "carbon""#);
        let mut c = ctx(&[("us-east-1", 400.0), ("us-west-2", 50.0)]);
        c.previous = Some(PreviousDecision {
            backend_id: "east".into(),
            since: Timestamp(NOW - 3600),
        });
        let out = decide(&cfg, &c);
        assert_eq!(out.selected_backend_id.as_deref(), Some("west"));
        assert_eq!(out.next_state.unwrap().since, Timestamp(NOW));
    }

    #[test]
    fn unhealthy_or_saturated_backends_do_not_set_the_latency_reference() {
        let cfg = config(r#", "policy": "latency", "advanced": {"max_latency_delta_ms": 10}"#);
        let mut c = ctx(&[]);
        c.runtime.insert(
            "east".into(),
            BackendRuntime {
                latency_ms: Some(5.0),
                healthy: Some(false),
                ..Default::default()
            },
        );
        c.runtime.insert(
            "west".into(),
            BackendRuntime {
                latency_ms: Some(40.0),
                ..Default::default()
            },
        );
        let out = decide(&cfg, &c);
        assert_eq!(kinds(&out, "east"), vec![RejectionKind::HealthConstraint]);
        assert!(
            kinds(&out, "west").is_empty(),
            "west measured against a dead backend"
        );
        assert_eq!(out.selected_backend_id.as_deref(), Some("west"));
        assert!(!out.fallback_used);
    }

    #[test]
    fn radius_is_skipped_when_user_location_is_unknown() {
        let cfg = config(r#", "policy": "latency", "radius_km": 10"#);
        let mut c = ctx(&[]);
        c.request.user_region = None;
        let out = decide(&cfg, &c);
        assert!(!out.user.radius_applied);
        assert!(out.candidates.iter().all(|c| c.is_eligible()));
    }
}
