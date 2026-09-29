// The carbon layer's contract.
//
//   CarbonService  ← the only place freshness/refresh/fallback rules live
//      ├── CarbonProvider   where signals come from
//      └── CarbonStore[]    where they are cached (read-through, write-back)
//
// Adding a new source means implementing CarbonProvider and registering it.
// Providers never cache; stores never fetch.

import type {
  CarbonMergeInput,
  CarbonMergeOutput,
  CarbonPlanInput,
  CarbonPlanOutput,
  CarbonSignal,
  EngineResult,
  SignalSource
} from '../../rilot-js/src/index';

export type { CarbonSignal, SignalSource };

/**
 * The pure carbon policy, reached through WebAssembly
 * (`crates/rilot-carbon-policy`). A loaded `RilotEngine` satisfies this.
 */
export interface CarbonPolicyEngine {
  carbonPlan(input: CarbonPlanInput): EngineResult<CarbonPlanOutput>;
  carbonMerge(input: CarbonMergeInput): EngineResult<CarbonMergeOutput>;
}

export type ProviderContext = {
  /** Current time in milliseconds; injected so behavior is testable. */
  now: number;
  /** Bound on a single provider call. */
  timeoutMs: number;
};

/**
 * Fetches signals for canonical Rilot regions.
 *
 * Implementations own any mapping to their own identifiers (e.g. Electricity
 * Maps zones); those ids must never appear in the returned signals. Return
 * only the regions that resolved — a missing region means "unavailable" and is
 * never an error.
 */
export interface CarbonProvider {
  readonly name: string;
  fetch(regions: string[], ctx: ProviderContext): Promise<CarbonSignal[]>;
}

/** A cache layer. Ordered from fastest to most durable when several are used. */
export interface CarbonStore {
  readonly name: string;
  /** Label applied to signals served from this store (e.g. "local-cache"). */
  readonly servedSource?: SignalSource;
  get(regions: string[]): Promise<Map<string, CarbonSignal>>;
  put(signals: CarbonSignal[], ttlSeconds: number): Promise<void>;
}

export type CachePolicy = {
  /** Signals older than this must not be used for routing. Default 300. */
  maxAgeSeconds: number;
  /**
   * Age at which a cached signal is refreshed in the background while still
   * being served. `0` disables cache reads entirely and always calls the
   * provider (live reload). Default `min(60, maxAge)`.
   */
  refreshSeconds: number;
  /** Bound on one provider call. Default 1500 ms. */
  timeoutMs: number;
  /** TTL for store writes. Default `maxAgeSeconds * 12`. */
  storeTtlSeconds: number;
};

export type CarbonEvent =
  | { type: 'miss'; regions: string[] }
  | { type: 'stale-served'; region: string }
  | { type: 'provider-ok'; provider: string; regions: string[] }
  | { type: 'provider-error'; provider: string; regions: string[]; error: string }
  | { type: 'store-write'; store: string; regions: string[] }
  | { type: 'store-error'; store: string; error: string }
  | { type: 'refresh-scheduled'; regions: string[] }
  | { type: 'policy-error'; error: string };

export type CarbonServiceOptions = {
  /** The Wasm-backed policy; every rule lives there, not here. */
  engine: CarbonPolicyEngine;
  provider?: CarbonProvider | null;
  /** Read in order, written in order. Typically [memory, kv]. */
  stores?: CarbonStore[];
  policy?: Partial<CachePolicy>;
  /** Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Runs work that must not block the response: background refreshes and
   * store writes. The thunk is only started when the host runs it
   * (Workers: `ctx.waitUntil(work())`).
   */
  schedule?: (work: () => Promise<unknown>) => void;
  onEvent?: (event: CarbonEvent) => void;
};

export const DEFAULT_MAX_AGE_SECONDS = 300;
export const DEFAULT_TIMEOUT_MS = 1500;

export function resolvePolicy(policy: Partial<CachePolicy> = {}): CachePolicy {
  const maxAgeSeconds = policy.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;
  return {
    maxAgeSeconds,
    refreshSeconds: policy.refreshSeconds ?? Math.min(60, maxAgeSeconds),
    timeoutMs: policy.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    storeTtlSeconds: policy.storeTtlSeconds ?? Math.max(60, maxAgeSeconds * 12)
  };
}

/** Providers may use this to drop obviously broken rows before returning. */
export function isValidSignal(value: unknown): value is CarbonSignal {
  const signal = value as CarbonSignal;
  return (
    !!signal &&
    typeof signal.region === 'string' &&
    signal.region.length > 0 &&
    typeof signal.carbon_g_per_kwh === 'number' &&
    Number.isFinite(signal.carbon_g_per_kwh) &&
    signal.carbon_g_per_kwh >= 0 &&
    typeof signal.observed_at === 'string' &&
    !Number.isNaN(Date.parse(signal.observed_at))
  );
}
