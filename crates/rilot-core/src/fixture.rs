//! Shared decision fixtures (`fixtures/decisions/*.json`).
//!
//! The same files are checked by rilot-core's tests, native Rilot's tests, and
//! the browser playground, which guarantees every target agrees on the result.
//!
//! A fixture is `{name, description, input: DecisionInput, expect}` where
//! `expect` may contain `selected_backend_id`, `reason_code`, `fallback_used`,
//! `needs_carbon`, `defer_seconds`, `next_state`, `effective` (a subset of the
//! effective config) and `rejections` (`backend id -> [rejection kinds]`, which
//! must list every candidate).

use crate::decision::{DecisionInput, DecisionOutput};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
pub struct Fixture {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub input: DecisionInput,
    pub expect: Value,
}

impl Fixture {
    pub fn parse(json: &str) -> Result<Fixture, String> {
        serde_json::from_str(json).map_err(|e| format!("invalid fixture: {e}"))
    }

    /// Compares a decision against this fixture's expectations.
    pub fn check(&self, output: &DecisionOutput) -> Result<(), String> {
        let actual = serde_json::to_value(output).map_err(|e| e.to_string())?;
        let mut problems = Vec::new();
        let expect = self.expect.as_object().ok_or("expect must be an object")?;

        for (key, want) in expect {
            let got = match key.as_str() {
                "reason_code" => actual["reason"]["code"].clone(),
                "rejections" => rejections_of(&actual),
                other => actual.get(other).cloned().unwrap_or(Value::Null),
            };
            if !is_subset(want, &got) {
                problems.push(format!("{key}: expected {want}, got {got}"));
            }
        }
        if let Some(want) = expect.get("rejections").and_then(Value::as_object) {
            let got = rejections_of(&actual);
            let got = got.as_object().expect("object");
            if want.len() != got.len() {
                problems.push(format!(
                    "rejections: expected entries for {:?}, got {:?}",
                    want.keys().collect::<Vec<_>>(),
                    got.keys().collect::<Vec<_>>()
                ));
            }
        }

        if problems.is_empty() {
            Ok(())
        } else {
            Err(format!(
                "fixture {:?} failed:\n  {}\n  reason: {}",
                self.name,
                problems.join("\n  "),
                actual["reason"]["message"]
            ))
        }
    }
}

fn rejections_of(output: &Value) -> Value {
    let mut map = serde_json::Map::new();
    for c in output["candidates"].as_array().into_iter().flatten() {
        let kinds: Vec<Value> = c["rejections"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| r["kind"].clone())
            .collect();
        map.insert(
            c["backend_id"].as_str().unwrap_or_default().to_string(),
            Value::Array(kinds),
        );
    }
    Value::Object(map)
}

/// Objects match when every expected key matches; arrays and scalars must be equal
/// (numbers compared as f64).
fn is_subset(want: &Value, got: &Value) -> bool {
    match (want, got) {
        (Value::Object(w), Value::Object(g)) => w
            .iter()
            .all(|(k, v)| g.get(k).is_some_and(|gv| is_subset(v, gv))),
        (Value::Array(w), Value::Array(g)) => {
            w.len() == g.len() && w.iter().zip(g).all(|(a, b)| is_subset(a, b))
        }
        (Value::Number(w), Value::Number(g)) => w.as_f64() == g.as_f64(),
        _ => want == got,
    }
}
