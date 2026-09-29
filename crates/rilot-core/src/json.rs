//! String-in / string-out interface for Wasm and other language bindings.
//!
//! Every function returns a JSON envelope: `{"ok": true, "output": ...}` or
//! `{"ok": false, "error": "..."}`. They never panic on bad input.

use crate::config::RoutingConfig;
use crate::decision::{decide, plan, BackendRuntime, DecisionInput, RequestContext};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::BTreeMap;

fn ok<T: Serialize>(output: &T) -> String {
    match serde_json::to_value(output) {
        Ok(v) => json!({ "ok": true, "output": v }).to_string(),
        Err(e) => err(format!("failed to serialize output: {e}")),
    }
}

fn err(message: impl Into<String>) -> String {
    json!({ "ok": false, "error": message.into() }).to_string()
}

fn validated(config: &RoutingConfig) -> Result<(), String> {
    config
        .validate()
        .map_err(|errors| format!("invalid config: {}", errors.join("; ")))
}

/// `DecisionInput` JSON → `DecisionOutput` envelope.
pub fn compute_decision_json(input: &str) -> String {
    let input: DecisionInput = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return err(format!("invalid decision input: {e}")),
    };
    if let Err(e) = validated(&input.config) {
        return err(e);
    }
    ok(&decide(&input.config, &input.context))
}

#[derive(Deserialize)]
struct PlanInput {
    config: RoutingConfig,
    request: RequestContext,
    #[serde(default)]
    runtime: BTreeMap<String, BackendRuntime>,
}

/// `{config, request, runtime?}` JSON → `CandidatePlan` envelope.
pub fn plan_json(input: &str) -> String {
    let input: PlanInput = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return err(format!("invalid plan input: {e}")),
    };
    if let Err(e) = validated(&input.config) {
        return err(e);
    }
    ok(&plan(&input.config, &input.request, &input.runtime))
}

#[derive(Deserialize)]
struct ResolveInput {
    config: RoutingConfig,
    path: String,
    /// Per-request hints, applied last — same as a real decision.
    #[serde(default)]
    hints: crate::config::RequestHints,
}

/// `{config, path, hints?}` JSON → `EffectiveConfig` envelope.
pub fn resolve_config_json(input: &str) -> String {
    let input: ResolveInput = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return err(format!("invalid resolve input: {e}")),
    };
    if let Err(e) = validated(&input.config) {
        return err(e);
    }
    ok(&input.config.resolve_with_hints(&input.path, &input.hints))
}

#[derive(Deserialize)]
struct CookieInput {
    /// The raw cookie value, or a whole `Cookie:` header when `name` is given.
    cookie: String,
    path: String,
    /// Cookie name to pick out of a `Cookie:` header first.
    #[serde(default)]
    name: Option<String>,
}

/// `{cookie, path, name?}` JSON → `{"policy": "carbon"|null}` envelope.
///
/// Lets an adapter that cannot call Rust directly (the Cloudflare Worker, the
/// browser demo) use the engine's own cookie parsing and pattern matching.
pub fn cookie_policy_json(input: &str) -> String {
    let input: CookieInput = match serde_json::from_str(input) {
        Ok(v) => v,
        Err(e) => return err(format!("invalid cookie input: {e}")),
    };
    let value = match &input.name {
        Some(name) => crate::cookie::from_header(&input.cookie, name).unwrap_or_default(),
        None => input.cookie,
    };
    ok(&serde_json::json!({
        "policy": crate::cookie::policy_for_path(&value, &input.path).map(|p| p.as_str())
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_policy_matches_by_specificity() {
        let out: serde_json::Value = serde_json::from_str(&cookie_policy_json(
            r#"{"cookie":"/*:balanced,/products/*:carbon","path":"/products/bottle"}"#,
        ))
        .unwrap();
        assert_eq!(out["ok"], true);
        assert_eq!(out["output"]["policy"], "carbon");
    }

    #[test]
    fn cookie_policy_can_read_a_whole_header() {
        let out: serde_json::Value = serde_json::from_str(&cookie_policy_json(
            r#"{"cookie":"sid=1; rilot_policy=%2Fcart%2F*%3Alatency","path":"/cart","name":"rilot_policy"}"#,
        ))
        .unwrap();
        assert_eq!(out["output"]["policy"], "latency");
    }

    #[test]
    fn cookie_policy_reports_no_match_as_null() {
        let out: serde_json::Value = serde_json::from_str(&cookie_policy_json(
            r#"{"cookie":"/products/*:carbon","path":"/checkout/pay"}"#,
        ))
        .unwrap();
        assert_eq!(out["ok"], true);
        assert!(out["output"]["policy"].is_null());
    }

    #[test]
    fn bad_json_returns_error_envelope() {
        let out: serde_json::Value = serde_json::from_str(&compute_decision_json("{")).unwrap();
        assert_eq!(out["ok"], false);
    }

    #[test]
    fn invalid_config_returns_error_envelope() {
        let out: serde_json::Value = serde_json::from_str(&compute_decision_json(
            r#"{"config": {"backends": []}, "request": {"path": "/"}, "now": 0}"#,
        ))
        .unwrap();
        assert_eq!(out["ok"], false);
        assert!(out["error"]
            .as_str()
            .unwrap()
            .contains("at least one backend"));
    }

    #[test]
    fn resolve_reports_inheritance() {
        let out: serde_json::Value = serde_json::from_str(&resolve_config_json(
            r#"{"config": {"backends": [{"id": "a", "region": "us-east-1"}], "fallback": "nearest",
                "routing_rules": [{"path": "/checkout/*", "policy": "latency", "radius_km": 800}]},
                "path": "/checkout/pay"}"#,
        ))
        .unwrap();
        assert_eq!(out["ok"], true);
        assert_eq!(out["output"]["policy"], "latency");
        assert_eq!(out["output"]["policy_source"], "rule");
        assert_eq!(out["output"]["fallback_source"], "root");
        assert_eq!(out["output"]["backends_source"], "root");
    }
}
