//! rilot-core: the single authoritative Rilot routing engine.
//!
//! Native Rilot, edge adapters, and the browser playground (via Wasm) all call
//! into this crate. It is pure and platform-independent: no I/O, no clocks, no
//! async runtime, no provider knowledge.
//!
//! Typical adapter flow:
//!
//! ```text
//! request ─▶ plan()  ─▶ carbon_regions ─▶ CarbonService (adapter) ─▶ signals
//!                                                                     │
//!        selected backend ◀─ DecisionOutput ◀─ decide() ◀─────────────┘
//! ```

pub mod config;
pub mod cookie;
pub mod decision;
pub mod fixture;
pub mod geo;
pub mod json;
pub mod time;

pub use config::{
    AdvancedSettings, Backend, EffectiveConfig, Fallback, MatchedRule, Policy, RequestHints,
    ResolvedAdvanced, RouteClass, RoutingConfig, RoutingRule, ValueSource, Weights,
};
pub use decision::{
    decide, plan, BackendRuntime, CandidateEvaluation, CandidatePlan, CandidateStatus, CarbonInput,
    CarbonReading, CarbonSignal, CarbonStatus, DecisionContext, DecisionInput, DecisionOutput,
    DecisionReason, LatencySource, LocationSource, PreviousDecision, ReasonCode, Rejection,
    RejectionKind, RequestContext, ScoreBreakdown, SignalSource, UserView,
};
pub use geo::GeoPoint;
pub use json::{compute_decision_json, cookie_policy_json, plan_json, resolve_config_json};
pub use time::Timestamp;
