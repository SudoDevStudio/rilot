// TypeScript mirror of rilot-core's JSON interface (crates/rilot-core/src/{config,decision}.rs).
// These are data shapes only; every routing decision is computed by rilot-core.wasm.

export type Policy = 'latency' | 'balanced' | 'carbon';
export type Fallback = 'nearest' | 'lowest-latency' | 'none';
export type RouteClass = 'flexible' | 'strict-local' | 'background';
export type ValueSource = 'default' | 'root' | 'rule' | 'request';

export type GeoPoint = { lat: number; lon: number };

export type Weights = {
  carbon: number;
  latency: number;
  reliability: number;
  cost: number;
};

export type AdvancedSettings = {
  weights?: Weights;
  carbon_aware?: boolean;
  route_class?: RouteClass;
  max_latency_delta_ms?: number;
  hard_max_latency_ms?: number;
  min_carbon_benefit_g_per_kwh?: number;
  max_error_rate?: number;
  max_request_share_percent?: number;
  max_candidates?: number;
  hysteresis_delta?: number;
  min_switch_interval_secs?: number;
  forecasting?: boolean;
  time_shift?: boolean;
  forecast_min_improvement_ratio?: number;
  max_defer_seconds?: number;
  cross_region_rtt_penalty_ms?: number;
};

export type Backend = {
  id: string;
  region: string;
  url?: string;
  location?: GeoPoint;
  carbon_region?: string;
  rtt_ms?: number;
  cost?: number;
  max_in_flight?: number;
};

export type RoutingRule = {
  path: string;
  policy?: Policy;
  /** Omitted: inherit. `null`: unlimited. */
  radius_km?: number | null;
  fallback?: Fallback;
  backends?: string[];
  advanced?: AdvancedSettings;
};

export type RoutingConfig = {
  backends: Backend[];
  policy?: Policy;
  radius_km?: number;
  fallback?: Fallback;
  routing_rules?: RoutingRule[];
  advanced?: AdvancedSettings;
};

export type SignalSource = 'live' | 'local-cache' | 'last-known-good' | 'mock' | 'json';

export type CarbonSignal = {
  region: string;
  carbon_g_per_kwh: number;
  /** RFC 3339 */
  observed_at: string;
  forecast_g_per_kwh?: number;
  source?: SignalSource;
};

export type RequestHints = {
  /** Overrides the policy for this one request, whatever the rules say. */
  policy?: Policy;
  route_class?: RouteClass;
  carbon_aware?: boolean;
  forecasting?: boolean;
  time_shift?: boolean;
};

export type RequestContext = {
  path: string;
  user_region?: string;
  user_location?: GeoPoint;
  hints?: RequestHints;
};

export type BackendRuntime = {
  latency_ms?: number;
  error_rate?: number;
  in_flight?: number;
  request_share_percent?: number;
  healthy?: boolean;
};

export type PreviousDecision = {
  backend_id: string;
  /** RFC 3339: when traffic last switched to this backend. */
  since: string;
};

export type DecisionInput = {
  config: RoutingConfig;
  request: RequestContext;
  /** RFC 3339 */
  now: string;
  carbon?: { max_age_seconds?: number; signals: CarbonSignal[] };
  runtime?: Record<string, BackendRuntime>;
  previous?: PreviousDecision;
};

export type RejectionKind =
  | 'region-constraint'
  | 'outside-radius'
  | 'candidate-limit'
  | 'health-constraint'
  | 'capacity-constraint'
  | 'latency-constraint'
  | 'carbon-unavailable'
  | 'insufficient-carbon-benefit';

export type LatencySource = 'measured' | 'configured' | 'distance-estimate' | 'default';
export type CarbonStatus = 'fresh' | 'stale' | 'missing' | 'not-requested';
export type CandidateStatus = 'eligible' | 'rejected' | 'selected' | 'fallback';
export type LocationSource = 'request' | 'region-catalog' | 'unknown';

export type ReasonCode =
  | 'score-win'
  | 'lowest-latency'
  | 'hysteresis-sticky-zone'
  | 'deferred-for-greener-window'
  | 'fallback-nearest'
  | 'fallback-lowest-latency'
  | 'no-eligible-backend'
  | 'no-backends';

export type ScoreComponents = Weights;

export type CandidateEvaluation = {
  backend_id: string;
  region: string;
  url?: string;
  distance_km?: number;
  latency_ms: number;
  latency_source: LatencySource;
  error_rate: number;
  carbon: {
    status: CarbonStatus;
    key: string;
    carbon_g_per_kwh?: number;
    forecast_g_per_kwh?: number;
    used_g_per_kwh?: number;
    observed_at?: string;
    age_seconds?: number;
    source?: SignalSource;
  };
  status: CandidateStatus;
  rejections: { kind: RejectionKind; detail: string }[];
  score?: { normalized: ScoreComponents; weighted: ScoreComponents; total: number };
  deferrable: boolean;
};

export type ResolvedAdvanced = {
  weights: Weights | null;
  carbon_aware: boolean;
  route_class: RouteClass;
  max_latency_delta_ms: number | null;
  hard_max_latency_ms: number | null;
  min_carbon_benefit_g_per_kwh: number | null;
  max_error_rate: number | null;
  max_request_share_percent: number | null;
  max_candidates: number | null;
  hysteresis_delta: number;
  min_switch_interval_secs: number;
  forecasting: boolean;
  time_shift: boolean;
  forecast_min_improvement_ratio: number;
  max_defer_seconds: number;
  cross_region_rtt_penalty_ms: number;
};

export type EffectiveConfig = {
  matched_rule: { index: number; path: string } | null;
  policy: Policy;
  policy_source: ValueSource;
  radius_km: number | null;
  radius_source: ValueSource;
  fallback: Fallback;
  fallback_source: ValueSource;
  backends: string[];
  backends_source: ValueSource;
  advanced: ResolvedAdvanced;
  advanced_overrides: string[];
  request_overrides: string[];
};

export type UserView = {
  region?: string;
  location?: GeoPoint;
  location_source: LocationSource;
  radius_applied: boolean;
};

export type DecisionOutput = {
  path: string;
  effective: EffectiveConfig;
  user: UserView;
  needs_carbon: boolean;
  weights: Weights;
  selected_backend_id: string | null;
  selected_region: string | null;
  selected_url: string | null;
  selected_score: number | null;
  selected_carbon_g_per_kwh: number | null;
  selected_latency_ms: number | null;
  fallback_used: boolean;
  reason: { code: ReasonCode; message: string };
  carbon_saved_vs_worst_g_per_kwh: number;
  carbon_saved_vs_worst_percent: number;
  defer_seconds: number;
  candidates: CandidateEvaluation[];
  next_state: PreviousDecision | null;
};

export type CandidatePlan = {
  path: string;
  effective: EffectiveConfig;
  user: UserView;
  needs_carbon: boolean;
  carbon_regions: string[];
  candidates: CandidateEvaluation[];
};

// --- Carbon cache policy (rilot-carbon-policy, via Wasm) -------------------

export type CarbonPolicyRules = {
  max_age_seconds: number;
  /** `0` disables cache reads and always calls the provider. */
  refresh_seconds: number;
};

export type CarbonPlanInput = {
  policy: CarbonPolicyRules;
  /** RFC 3339 */
  now: string;
  regions: string[];
  /** Cached signals in store order; the first entry for a region wins. */
  cached: CarbonSignal[];
};

export type CarbonPlanOutput = {
  serve: CarbonSignal[];
  fetch: string[];
  refresh: string[];
};

export type CarbonMergeInput = {
  policy: CarbonPolicyRules;
  now: string;
  regions: string[];
  serve: CarbonSignal[];
  fetched: CarbonSignal[];
  cached: CarbonSignal[];
};

export type CarbonMergeOutput = {
  signals: CarbonSignal[];
  store_writes: CarbonSignal[];
  stale_served: string[];
};
