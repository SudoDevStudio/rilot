//! Routing configuration and routing-rule resolution.
//!
//! A config has root-level defaults plus optional `routing_rules`. Every value
//! a rule leaves unset is inherited from the root; `resolve` reports where each
//! effective value came from so UIs can show the inheritance explicitly.

use crate::geo::GeoPoint;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;

/// The simple, user-facing Rilot routing config.
///
/// Adapter-owned sections (such as `carbon`, `metrics`, `listen`) may appear
/// in the same JSON document; the core ignores fields it does not own.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoutingConfig {
    pub backends: Vec<Backend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<Policy>,
    /// Maximum user-to-backend distance. `None` means unlimited.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub radius_km: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Fallback>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub routing_rules: Vec<RoutingRule>,
    /// Research / advanced knobs. Normal configs never need these.
    #[serde(default, skip_serializing_if = "AdvancedSettings::is_empty")]
    pub advanced: AdvancedSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backend {
    pub id: String,
    /// Canonical Rilot region (e.g. `us-east-1`). Used for geography and as the
    /// key for carbon signals.
    pub region: String,
    /// Where the adapter forwards traffic. The core never dereferences it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Explicit coordinates for regions missing from the catalog.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<GeoPoint>,
    /// Advanced: read carbon from a different signal key than `region`. Lets
    /// research setups give several backends in one region distinct signals.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carbon_region: Option<String>,
    /// Advanced: configured base round-trip time. When set, latency is estimated
    /// as `rtt_ms` plus the cross-region penalty instead of from distance.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rtt_ms: Option<f64>,
    /// Advanced: relative cost, only used when the cost weight is non-zero.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    /// Advanced: reject this backend once this many requests are in flight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_in_flight: Option<u64>,
}

impl Backend {
    /// Key used to look up this backend's carbon signal.
    pub fn carbon_key(&self) -> &str {
        self.carbon_region.as_deref().unwrap_or(&self.region)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Policy {
    /// Lowest latency among eligible backends. Never needs carbon data.
    #[serde(alias = "latency-first")]
    Latency,
    /// Weighted carbon / latency / reliability tradeoff.
    #[serde(alias = "custom")]
    Balanced,
    /// Carbon-heavy weighting for flexible workloads.
    #[serde(alias = "carbon-first")]
    Carbon,
}

impl Policy {
    pub const DEFAULT: Policy = Policy::Balanced;

    pub fn as_str(self) -> &'static str {
        match self {
            Policy::Latency => "latency",
            Policy::Balanced => "balanced",
            Policy::Carbon => "carbon",
        }
    }

    /// Parses a policy name. Unknown names are `None`, never an error: a
    /// request carrying nonsense is ignored rather than rejected.
    pub fn parse(value: &str) -> Option<Policy> {
        match value {
            "latency" => Some(Policy::Latency),
            "balanced" => Some(Policy::Balanced),
            "carbon" => Some(Policy::Carbon),
            _ => None,
        }
    }

    pub fn preset_weights(self) -> Weights {
        match self {
            Policy::Latency => Weights {
                carbon: 0.0,
                latency: 1.0,
                reliability: 0.0,
                cost: 0.0,
            },
            Policy::Balanced => Weights {
                carbon: 0.50,
                latency: 0.35,
                reliability: 0.15,
                cost: 0.0,
            },
            Policy::Carbon => Weights {
                carbon: 0.70,
                latency: 0.20,
                reliability: 0.10,
                cost: 0.0,
            },
        }
    }
}

/// What to do when no backend passes the eligibility checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Fallback {
    /// Geographically nearest healthy backend (lowest latency if location is unknown).
    Nearest,
    /// Lowest-latency healthy backend.
    LowestLatency,
    /// Make no selection.
    None,
}

impl Fallback {
    pub const DEFAULT: Fallback = Fallback::Nearest;

    pub fn as_str(self) -> &'static str {
        match self {
            Fallback::Nearest => "nearest",
            Fallback::LowestLatency => "lowest-latency",
            Fallback::None => "none",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Weights {
    #[serde(alias = "w_carbon")]
    pub carbon: f64,
    #[serde(alias = "w_latency")]
    pub latency: f64,
    #[serde(alias = "w_errors", alias = "errors")]
    pub reliability: f64,
    #[serde(default, alias = "w_cost")]
    pub cost: f64,
}

impl Weights {
    /// Clamps to non-negative finite values and scales to sum to 1.
    /// All-zero weights degrade to pure latency.
    pub fn normalized(self) -> Weights {
        let clean = |v: f64| if v.is_finite() { v.max(0.0) } else { 0.0 };
        let w = Weights {
            carbon: clean(self.carbon),
            latency: clean(self.latency),
            reliability: clean(self.reliability),
            cost: clean(self.cost),
        };
        let sum = w.carbon + w.latency + w.reliability + w.cost;
        if sum <= 0.0 {
            return Policy::Latency.preset_weights();
        }
        Weights {
            carbon: w.carbon / sum,
            latency: w.latency / sum,
            reliability: w.reliability / sum,
            cost: w.cost / sum,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RouteClass {
    /// Default: any eligible backend may serve the request.
    Flexible,
    /// Restrict to backends in the user's region when one exists.
    StrictLocal,
    /// Deferrable work; enables forecast-based time shifting when configured.
    Background,
}

impl RouteClass {
    pub fn as_str(self) -> &'static str {
        match self {
            RouteClass::Flexible => "flexible",
            RouteClass::StrictLocal => "strict-local",
            RouteClass::Background => "background",
        }
    }
}

/// Research / advanced knobs. Every field is optional so rules can override
/// individual values while inheriting the rest from the root.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct AdvancedSettings {
    /// Explicit weights; replace the policy preset weights.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weights: Option<Weights>,
    /// `false` forces latency-only routing regardless of policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carbon_aware: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_class: Option<RouteClass>,
    /// Reject backends slower than the fastest candidate by more than this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_latency_delta_ms: Option<f64>,
    /// Reject backends whose latency exceeds this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hard_max_latency_ms: Option<f64>,
    /// Non-baseline backends must be at least this much cleaner than the
    /// lowest-latency candidate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_carbon_benefit_g_per_kwh: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_error_rate: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_request_share_percent: Option<f64>,
    /// Consider at most this many candidates (nearest/fastest first).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_candidates: Option<usize>,
    /// Keep the previous backend unless the new one scores better by this much.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hysteresis_delta: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_switch_interval_secs: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forecasting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_shift: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forecast_min_improvement_ratio: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_defer_seconds: Option<u64>,
    /// Latency added for cross-region traffic when estimating from `rtt_ms`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_region_rtt_penalty_ms: Option<f64>,
}

macro_rules! advanced_fields {
    ($m:ident) => {
        $m!(
            weights,
            carbon_aware,
            route_class,
            max_latency_delta_ms,
            hard_max_latency_ms,
            min_carbon_benefit_g_per_kwh,
            max_error_rate,
            max_request_share_percent,
            max_candidates,
            hysteresis_delta,
            min_switch_interval_secs,
            forecasting,
            time_shift,
            forecast_min_improvement_ratio,
            max_defer_seconds,
            cross_region_rtt_penalty_ms
        )
    };
}

impl AdvancedSettings {
    pub fn is_empty(&self) -> bool {
        self == &AdvancedSettings::default()
    }

    /// `over` wins field by field; unset fields fall through to `self`.
    pub fn merged_with(&self, over: &AdvancedSettings) -> AdvancedSettings {
        macro_rules! merge {
            ($($f:ident),*) => {
                AdvancedSettings { $($f: over.$f.clone().or_else(|| self.$f.clone())),* }
            };
        }
        advanced_fields!(merge)
    }

    /// Names of fields set in `self`.
    pub fn set_field_names(&self) -> Vec<&'static str> {
        let mut out = Vec::new();
        macro_rules! collect {
            ($($f:ident),*) => { $(if self.$f.is_some() { out.push(stringify!($f)); })* };
        }
        advanced_fields!(collect);
        out
    }
}

/// Fully-defaulted advanced settings used by the decision engine.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ResolvedAdvanced {
    pub weights: Option<Weights>,
    pub carbon_aware: bool,
    pub route_class: RouteClass,
    pub max_latency_delta_ms: Option<f64>,
    pub hard_max_latency_ms: Option<f64>,
    pub min_carbon_benefit_g_per_kwh: Option<f64>,
    pub max_error_rate: Option<f64>,
    pub max_request_share_percent: Option<f64>,
    pub max_candidates: Option<usize>,
    pub hysteresis_delta: f64,
    pub min_switch_interval_secs: u64,
    pub forecasting: bool,
    pub time_shift: bool,
    pub forecast_min_improvement_ratio: f64,
    pub max_defer_seconds: u64,
    pub cross_region_rtt_penalty_ms: f64,
}

pub const DEFAULT_HYSTERESIS_DELTA: f64 = 0.05;
pub const DEFAULT_MIN_SWITCH_INTERVAL_SECS: u64 = 30;
pub const DEFAULT_FORECAST_MIN_IMPROVEMENT_RATIO: f64 = 0.10;
pub const DEFAULT_CROSS_REGION_RTT_PENALTY_MS: f64 = 40.0;

impl ResolvedAdvanced {
    fn from_settings(s: &AdvancedSettings) -> Self {
        ResolvedAdvanced {
            weights: s.weights,
            carbon_aware: s.carbon_aware.unwrap_or(true),
            route_class: s.route_class.unwrap_or(RouteClass::Flexible),
            max_latency_delta_ms: s.max_latency_delta_ms,
            hard_max_latency_ms: s.hard_max_latency_ms,
            min_carbon_benefit_g_per_kwh: s.min_carbon_benefit_g_per_kwh,
            max_error_rate: s.max_error_rate,
            max_request_share_percent: s.max_request_share_percent,
            max_candidates: s.max_candidates,
            hysteresis_delta: s.hysteresis_delta.unwrap_or(DEFAULT_HYSTERESIS_DELTA),
            min_switch_interval_secs: s
                .min_switch_interval_secs
                .unwrap_or(DEFAULT_MIN_SWITCH_INTERVAL_SECS),
            forecasting: s.forecasting.unwrap_or(false),
            time_shift: s.time_shift.unwrap_or(false),
            forecast_min_improvement_ratio: s
                .forecast_min_improvement_ratio
                .unwrap_or(DEFAULT_FORECAST_MIN_IMPROVEMENT_RATIO),
            max_defer_seconds: s.max_defer_seconds.unwrap_or(0),
            cross_region_rtt_penalty_ms: s
                .cross_region_rtt_penalty_ms
                .unwrap_or(DEFAULT_CROSS_REGION_RTT_PENALTY_MS),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoutingRule {
    /// `/checkout/*` matches `/checkout` and everything below it; a trailing
    /// `*` without a slash is a plain prefix match; no `*` means exact match.
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<Policy>,
    /// Absent: inherit. `null`: unlimited. Number: override.
    #[serde(
        default,
        deserialize_with = "explicit_option",
        skip_serializing_if = "Option::is_none"
    )]
    pub radius_km: Option<Option<f64>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback: Option<Fallback>,
    /// Restrict this rule to a subset of root backend ids.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backends: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "AdvancedSettings::is_empty")]
    pub advanced: AdvancedSettings,
}

fn explicit_option<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

/// Where an effective value came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ValueSource {
    /// Built-in default (neither root nor rule set it).
    Default,
    /// Inherited from the root config.
    Root,
    /// Set by the matched routing rule.
    Rule,
    /// Overridden per request (e.g. `x-rilot-*` hints).
    Request,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct MatchedRule {
    pub index: usize,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EffectiveConfig {
    pub matched_rule: Option<MatchedRule>,
    pub policy: Policy,
    pub policy_source: ValueSource,
    pub radius_km: Option<f64>,
    pub radius_source: ValueSource,
    pub fallback: Fallback,
    pub fallback_source: ValueSource,
    /// Backend ids in scope for this request, in config order.
    pub backends: Vec<String>,
    pub backends_source: ValueSource,
    pub advanced: ResolvedAdvanced,
    /// Advanced fields the matched rule overrides.
    pub advanced_overrides: Vec<&'static str>,
    /// Advanced fields overridden by per-request hints.
    pub request_overrides: Vec<&'static str>,
}

/// Per-request overrides supplied by the adapter (natively: `x-rilot-*` headers).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct RequestHints {
    /// Overrides the policy for this one request, whatever the rules say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub policy: Option<Policy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub route_class: Option<RouteClass>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub carbon_aware: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub forecasting: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_shift: Option<bool>,
}

impl RequestHints {
    /// Parses the `x-rilot-policy`, `x-rilot-class`, `x-rilot-carbon-cursor`,
    /// `x-rilot-forecasting` and `x-rilot-time-shift` hints. `get` looks up a
    /// lower-case header name.
    pub fn from_headers<'a>(get: impl Fn(&str) -> Option<&'a str>) -> Self {
        let flag = |name: &str| match get(name).map(str::trim) {
            Some("1" | "true" | "on" | "yes") => Some(true),
            Some("0" | "false" | "off" | "no") => Some(false),
            _ => None,
        };
        RequestHints {
            policy: get("x-rilot-policy").and_then(|v| Policy::parse(v.trim())),
            route_class: get("x-rilot-class").and_then(|v| match v.trim() {
                "flexible" => Some(RouteClass::Flexible),
                "strict-local" => Some(RouteClass::StrictLocal),
                "background" => Some(RouteClass::Background),
                _ => None,
            }),
            carbon_aware: flag("x-rilot-carbon-cursor"),
            forecasting: flag("x-rilot-forecasting"),
            time_shift: flag("x-rilot-time-shift"),
        }
    }

    fn apply(&self, a: &mut ResolvedAdvanced) -> Vec<&'static str> {
        let mut applied = Vec::new();
        if let Some(v) = self.route_class {
            a.route_class = v;
            applied.push("route_class");
        }
        if let Some(v) = self.carbon_aware {
            a.carbon_aware = v;
            applied.push("carbon_aware");
        }
        if let Some(v) = self.forecasting {
            a.forecasting = v;
            applied.push("forecasting");
        }
        if let Some(v) = self.time_shift {
            a.time_shift = v;
            applied.push("time_shift");
        }
        // Strict-local traffic is never time-shifted.
        if a.route_class == RouteClass::StrictLocal {
            a.time_shift = false;
        }
        applied
    }
}

impl EffectiveConfig {
    /// Final normalized weights: latency policy (or carbon_aware=false) is pure latency.
    pub fn weights(&self) -> Weights {
        if self.policy == Policy::Latency {
            return Policy::Latency.preset_weights();
        }
        self.advanced
            .weights
            .unwrap_or_else(|| self.policy.preset_weights())
            .normalized()
    }
}

/// Returns `(is_exact, literal_len)` when `pattern` matches `path`; higher is more specific.
pub(crate) fn match_specificity(pattern: &str, path: &str) -> Option<(bool, usize)> {
    match pattern.strip_suffix('*') {
        Some(prefix) => {
            let matches = path.starts_with(prefix)
                || (prefix.len() > 1
                    && prefix.ends_with('/')
                    && path == &prefix[..prefix.len() - 1]);
            matches.then_some((false, prefix.len()))
        }
        None => (path == pattern).then_some((true, pattern.len())),
    }
}

impl RoutingConfig {
    pub fn policy_or_default(&self) -> Policy {
        self.policy.unwrap_or(Policy::DEFAULT)
    }

    pub fn fallback_or_default(&self) -> Fallback {
        self.fallback.unwrap_or(Fallback::DEFAULT)
    }

    pub fn backend(&self, id: &str) -> Option<&Backend> {
        self.backends.iter().find(|b| b.id == id)
    }

    /// Most specific rule wins: exact beats wildcard, then longer literal
    /// prefix; ties go to the earliest rule.
    pub fn match_rule(&self, path: &str) -> Option<(usize, &RoutingRule)> {
        let mut best: Option<((bool, usize), usize)> = None;
        for (idx, rule) in self.routing_rules.iter().enumerate() {
            if let Some(spec) = match_specificity(&rule.path, path) {
                if best.is_none_or(|(b, _)| spec > b) {
                    best = Some((spec, idx));
                }
            }
        }
        best.map(|(_, idx)| (idx, &self.routing_rules[idx]))
    }

    /// Resolves the effective config for a request path.
    pub fn resolve(&self, path: &str) -> EffectiveConfig {
        self.resolve_with_hints(path, &RequestHints::default())
    }

    /// Resolves the effective config for a request path, applying per-request hints last.
    pub fn resolve_with_hints(&self, path: &str, hints: &RequestHints) -> EffectiveConfig {
        let rule = self.match_rule(path);
        let root_or_default = |set: bool| {
            if set {
                ValueSource::Root
            } else {
                ValueSource::Default
            }
        };

        let (policy, policy_source) = match rule.and_then(|(_, r)| r.policy) {
            Some(p) => (p, ValueSource::Rule),
            None => (
                self.policy_or_default(),
                root_or_default(self.policy.is_some()),
            ),
        };
        let (radius_km, radius_source) = match rule.and_then(|(_, r)| r.radius_km) {
            Some(r) => (r, ValueSource::Rule),
            None => (self.radius_km, root_or_default(self.radius_km.is_some())),
        };
        let (fallback, fallback_source) = match rule.and_then(|(_, r)| r.fallback) {
            Some(f) => (f, ValueSource::Rule),
            None => (
                self.fallback_or_default(),
                root_or_default(self.fallback.is_some()),
            ),
        };
        let (backends, backends_source) = match rule.and_then(|(_, r)| r.backends.as_ref()) {
            Some(ids) => (
                self.backends
                    .iter()
                    .filter(|b| ids.contains(&b.id))
                    .map(|b| b.id.clone())
                    .collect(),
                ValueSource::Rule,
            ),
            None => (
                self.backends.iter().map(|b| b.id.clone()).collect(),
                ValueSource::Root,
            ),
        };
        let (advanced, advanced_overrides) = match rule {
            Some((_, r)) => (
                self.advanced.merged_with(&r.advanced),
                r.advanced.set_field_names(),
            ),
            None => (self.advanced.clone(), Vec::new()),
        };

        // A per-request policy (a header, or a cookie an adapter translated)
        // beats both the rule and the root config.
        let (policy, policy_source) = match hints.policy {
            Some(p) => (p, ValueSource::Request),
            None => (policy, policy_source),
        };

        let mut resolved_advanced = ResolvedAdvanced::from_settings(&advanced);
        let request_overrides = hints.apply(&mut resolved_advanced);
        let (policy, policy_source) = if resolved_advanced.carbon_aware {
            (policy, policy_source)
        } else if request_overrides.contains(&"carbon_aware") {
            (Policy::Latency, ValueSource::Request)
        } else {
            (Policy::Latency, policy_source)
        };
        if policy == Policy::Latency {
            resolved_advanced.weights = None;
        }

        EffectiveConfig {
            matched_rule: rule.map(|(index, r)| MatchedRule {
                index,
                path: r.path.clone(),
            }),
            policy,
            policy_source,
            radius_km,
            radius_source,
            fallback,
            fallback_source,
            backends,
            backends_source,
            advanced: resolved_advanced,
            advanced_overrides,
            request_overrides,
        }
    }

    /// Checks structural validity. Returns every problem found.
    pub fn validate(&self) -> Result<(), Vec<String>> {
        let mut errors = Vec::new();
        if self.backends.is_empty() {
            errors.push("config must define at least one backend".to_string());
        }
        let mut ids = HashSet::new();
        for (i, b) in self.backends.iter().enumerate() {
            if b.id.trim().is_empty() {
                errors.push(format!("backends[{i}].id must not be empty"));
            } else if !ids.insert(b.id.as_str()) {
                errors.push(format!("duplicate backend id {:?}", b.id));
            }
            if b.region.trim().is_empty() {
                errors.push(format!("backend {:?} must have a region", b.id));
            }
            if let Some(loc) = b.location {
                if !loc.is_valid() {
                    errors.push(format!("backend {:?} has an invalid location", b.id));
                }
            }
            check_non_negative(&mut errors, &format!("backend {:?} rtt_ms", b.id), b.rtt_ms);
            check_non_negative(&mut errors, &format!("backend {:?} cost", b.id), b.cost);
        }
        check_non_negative(&mut errors, "radius_km", self.radius_km);
        validate_advanced(&mut errors, "advanced", &self.advanced);

        let mut paths = HashSet::new();
        for (i, rule) in self.routing_rules.iter().enumerate() {
            let at = format!("routing_rules[{i}]");
            if !rule.path.starts_with('/') {
                errors.push(format!(
                    "{at}.path must start with '/' (got {:?})",
                    rule.path
                ));
            }
            if rule.path.trim_end_matches('*').contains('*') {
                errors.push(format!("{at}.path may only use '*' as the final character"));
            }
            if !paths.insert(rule.path.as_str()) {
                errors.push(format!("duplicate routing rule path {:?}", rule.path));
            }
            if let Some(Some(r)) = rule.radius_km {
                check_non_negative(&mut errors, &format!("{at}.radius_km"), Some(r));
            }
            if let Some(list) = &rule.backends {
                if list.is_empty() {
                    errors.push(format!("{at}.backends must not be empty"));
                }
                for id in list {
                    if !ids.contains(id.as_str()) {
                        errors.push(format!("{at}.backends references unknown backend {id:?}"));
                    }
                }
            }
            validate_advanced(&mut errors, &format!("{at}.advanced"), &rule.advanced);
        }

        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }
}

fn check_non_negative(errors: &mut Vec<String>, name: &str, value: Option<f64>) {
    if let Some(v) = value {
        if !v.is_finite() || v < 0.0 {
            errors.push(format!("{name} must be a non-negative number"));
        }
    }
}

fn validate_advanced(errors: &mut Vec<String>, at: &str, a: &AdvancedSettings) {
    if let Some(w) = a.weights {
        for (name, v) in [
            ("carbon", w.carbon),
            ("latency", w.latency),
            ("reliability", w.reliability),
            ("cost", w.cost),
        ] {
            check_non_negative(errors, &format!("{at}.weights.{name}"), Some(v));
        }
    }
    for (name, v) in [
        ("max_latency_delta_ms", a.max_latency_delta_ms),
        ("hard_max_latency_ms", a.hard_max_latency_ms),
        (
            "min_carbon_benefit_g_per_kwh",
            a.min_carbon_benefit_g_per_kwh,
        ),
        ("max_error_rate", a.max_error_rate),
        ("max_request_share_percent", a.max_request_share_percent),
        ("hysteresis_delta", a.hysteresis_delta),
        (
            "forecast_min_improvement_ratio",
            a.forecast_min_improvement_ratio,
        ),
        ("cross_region_rtt_penalty_ms", a.cross_region_rtt_penalty_ms),
    ] {
        check_non_negative(errors, &format!("{at}.{name}"), v);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(json: &str) -> RoutingConfig {
        serde_json::from_str(json).expect("config")
    }

    fn sample() -> RoutingConfig {
        cfg(r#"{
          "backends": [
            {"id": "east", "region": "us-east-1", "url": "https://east.example.com"},
            {"id": "west", "region": "us-west-2", "url": "https://west.example.com"}
          ],
          "policy": "balanced",
          "radius_km": 2000,
          "fallback": "nearest",
          "routing_rules": [
            {"path": "/checkout/*", "policy": "latency", "radius_km": 800},
            {"path": "/checkout/health"},
            {"path": "/reports*", "radius_km": null, "backends": ["west"]}
          ]
        }"#)
    }

    #[test]
    fn rule_overrides_and_inherits() {
        let eff = sample().resolve("/checkout/pay");
        assert_eq!(eff.matched_rule.as_ref().unwrap().path, "/checkout/*");
        assert_eq!(eff.policy, Policy::Latency);
        assert_eq!(eff.policy_source, ValueSource::Rule);
        assert_eq!(eff.radius_km, Some(800.0));
        assert_eq!(eff.radius_source, ValueSource::Rule);
        assert_eq!(eff.fallback, Fallback::Nearest);
        assert_eq!(eff.fallback_source, ValueSource::Root);
        assert_eq!(eff.backends, vec!["east", "west"]);
        assert_eq!(eff.backends_source, ValueSource::Root);
    }

    #[test]
    fn slash_star_matches_bare_prefix_and_exact_beats_wildcard() {
        let c = sample();
        assert_eq!(c.match_rule("/checkout").unwrap().1.path, "/checkout/*");
        assert_eq!(
            c.match_rule("/checkout/health").unwrap().1.path,
            "/checkout/health"
        );
        assert!(c.match_rule("/checkoutx").is_none());
        assert_eq!(c.match_rule("/reports-2026").unwrap().1.path, "/reports*");
    }

    #[test]
    fn explicit_null_radius_means_unlimited() {
        let eff = sample().resolve("/reports/monthly");
        assert_eq!(eff.radius_km, None);
        assert_eq!(eff.radius_source, ValueSource::Rule);
        assert_eq!(eff.backends, vec!["west"]);
    }

    #[test]
    fn unmatched_path_uses_root_and_defaults() {
        let mut c = sample();
        c.fallback = None;
        let eff = c.resolve("/other");
        assert!(eff.matched_rule.is_none());
        assert_eq!(eff.policy_source, ValueSource::Root);
        assert_eq!(eff.fallback, Fallback::Nearest);
        assert_eq!(eff.fallback_source, ValueSource::Default);
    }

    #[test]
    fn rule_advanced_merges_field_by_field() {
        let c = cfg(r#"{
          "backends": [{"id": "a", "region": "us-east-1"}],
          "advanced": {"hysteresis_delta": 0.2, "max_error_rate": 0.05},
          "routing_rules": [{"path": "/x*", "advanced": {"max_error_rate": 0.01}}]
        }"#);
        let eff = c.resolve("/x");
        assert_eq!(eff.advanced.hysteresis_delta, 0.2);
        assert_eq!(eff.advanced.max_error_rate, Some(0.01));
        assert_eq!(eff.advanced_overrides, vec!["max_error_rate"]);
    }

    #[test]
    fn carbon_aware_false_forces_latency() {
        let c = cfg(r#"{
          "backends": [{"id": "a", "region": "us-east-1"}],
          "policy": "carbon",
          "advanced": {"carbon_aware": false, "weights": {"carbon": 1, "latency": 0, "reliability": 0}}
        }"#);
        let eff = c.resolve("/");
        assert_eq!(eff.policy, Policy::Latency);
        assert_eq!(eff.weights().carbon, 0.0);
    }

    #[test]
    fn legacy_policy_names_are_accepted() {
        let c = cfg(r#"{"backends": [{"id": "a", "region": "r"}], "policy": "carbon-first"}"#);
        assert_eq!(c.policy, Some(Policy::Carbon));
    }

    #[test]
    fn validation_reports_all_problems() {
        let c = cfg(r#"{
          "backends": [{"id": "a", "region": "r"}, {"id": "a", "region": ""}],
          "radius_km": -1,
          "routing_rules": [
            {"path": "checkout", "backends": ["nope"]},
            {"path": "/a*b*"}
          ]
        }"#);
        let errs = c.validate().unwrap_err();
        let joined = errs.join("\n");
        assert!(joined.contains("duplicate backend id"));
        assert!(joined.contains("must have a region"));
        assert!(joined.contains("radius_km"));
        assert!(joined.contains("must start with '/'"));
        assert!(joined.contains("unknown backend"));
        assert!(joined.contains("final character"));
    }
}
