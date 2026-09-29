// Host-agnostic binding for rilot-core.wasm.
//
// Responsibilities: marshal JSON in and out of the module and turn failures
// into safe messages. No routing logic lives here — every decision is made by
// rilot-core itself.

import type {
  BackendRuntime,
  Policy,
  CandidatePlan,
  CarbonMergeInput,
  CarbonMergeOutput,
  CarbonPlanInput,
  CarbonPlanOutput,
  DecisionInput,
  DecisionOutput,
  EffectiveConfig,
  RequestContext,
  RequestHints,
  RoutingConfig
} from './types';

export type EngineResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type PlanInput = {
  config: RoutingConfig;
  request: RequestContext;
  runtime?: Record<string, BackendRuntime>;
};

export type RilotEngine = {
  version: string;
  computeDecision(input: DecisionInput): EngineResult<DecisionOutput>;
  plan(input: PlanInput): EngineResult<CandidatePlan>;
  /** The effective config for a path, with per-request hints applied last. */
  resolveConfig(
    config: RoutingConfig,
    path: string,
    hints?: RequestHints
  ): EngineResult<EffectiveConfig>;
  /** Carbon cache policy: what to serve, what to fetch, what to refresh. */
  carbonPlan(input: CarbonPlanInput): EngineResult<CarbonPlanOutput>;
  /** Carbon cache policy: combine cached and freshly fetched signals. */
  carbonMerge(input: CarbonMergeInput): EngineResult<CarbonMergeOutput>;
  /**
   * The per-session policy a cookie asks for on `path`, or `null`.
   *
   * `cookie` is either the cookie's value, or a whole `Cookie:` header when
   * `name` is given. Parsing and pattern matching happen inside the engine, so
   * a cookie behaves exactly like a routing rule of the same shape.
   */
  cookiePolicy(cookie: string, path: string, name?: string): EngineResult<Policy | null>;
};

type Exports = {
  memory: WebAssembly.Memory;
  rilot_alloc(len: number): number;
  rilot_dealloc(ptr: number, len: number): void;
  rilot_compute_decision(ptr: number, len: number): bigint;
  rilot_plan(ptr: number, len: number): bigint;
  rilot_resolve_config(ptr: number, len: number): bigint;
  rilot_carbon_plan(ptr: number, len: number): bigint;
  rilot_carbon_merge(ptr: number, len: number): bigint;
  rilot_cookie_policy(ptr: number, len: number): bigint;
  rilot_version(): bigint;
};

type Envelope<T> = { ok: true; output: T } | { ok: false; error: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readPacked(exports: Exports, packed: bigint): string {
  const value = BigInt.asUintN(64, packed);
  const ptr = Number(value >> 32n);
  const len = Number(value & 0xffffffffn);
  const text = decoder.decode(new Uint8Array(exports.memory.buffer, ptr, len));
  exports.rilot_dealloc(ptr, len);
  return text;
}

/** Wraps an instantiated rilot-core module. */
export function makeEngine(instance: WebAssembly.Instance): RilotEngine {
  const exports = instance.exports as unknown as Exports;
  const call = <T>(
    fn:
      | 'rilot_compute_decision'
      | 'rilot_plan'
      | 'rilot_resolve_config'
      | 'rilot_carbon_plan'
      | 'rilot_carbon_merge'
      | 'rilot_cookie_policy',
    input: unknown
  ): EngineResult<T> => {
    try {
      const bytes = encoder.encode(JSON.stringify(input));
      const ptr = exports.rilot_alloc(bytes.length);
      new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
      const envelope = JSON.parse(readPacked(exports, exports[fn](ptr, bytes.length))) as Envelope<T>;
      return envelope.ok ? { ok: true, value: envelope.output } : { ok: false, error: envelope.error };
    } catch (error) {
      return { ok: false, error: `The routing engine failed unexpectedly: ${String(error)}` };
    }
  };

  const version = JSON.parse(readPacked(exports, exports.rilot_version())) as Envelope<string>;

  return {
    version: version.ok ? version.output : 'unknown',
    computeDecision: (input) => call<DecisionOutput>('rilot_compute_decision', input),
    plan: (input) => call<CandidatePlan>('rilot_plan', input),
    resolveConfig: (config, path, hints) =>
      call<EffectiveConfig>('rilot_resolve_config', { config, path, ...(hints ? { hints } : {}) }),
    carbonPlan: (input) => call<CarbonPlanOutput>('rilot_carbon_plan', input),
    carbonMerge: (input) => call<CarbonMergeOutput>('rilot_carbon_merge', input),
    cookiePolicy: (cookie, path, name) => {
      const result = call<{ policy: Policy | null }>('rilot_cookie_policy', {
        cookie,
        path,
        ...(name ? { name } : {})
      });
      return result.ok ? { ok: true, value: result.value.policy } : result;
    }
  };
}

/**
 * Instantiates rilot-core from module bytes or an already-compiled module.
 * Workers pass a compiled module (they cannot compile Wasm at runtime), while
 * browsers and Node pass bytes; the two return shapes are normalized here.
 */
export async function loadEngine(source: BufferSource | WebAssembly.Module): Promise<RilotEngine> {
  const result = (await WebAssembly.instantiate(source as WebAssembly.Module, {})) as
    | WebAssembly.Instance
    | { instance: WebAssembly.Instance };
  return makeEngine('instance' in result ? result.instance : result);
}
