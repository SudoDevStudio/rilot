// Editable playground state. The routing config is a real Rilot config (the
// same format native Rilot loads); everything else simulates the runtime
// inputs an adapter would normally supply. See src/rilot/config.ts.
import type { RoutingConfig, SignalSource } from '@rilot/core-js';

export type ViewMode = 'normal' | 'research';

/** Simulated runtime observations for one backend. */
export type BackendSim = {
  /** Measured latency; `null` lets rilot-core estimate it from distance. */
  latencyMs: number | null;
  /** Recent error rate in percent (0–100). */
  errorRatePercent: number;
  healthy: boolean;
};

export type CarbonSettings = {
  /** Age of the simulated signals, in seconds. */
  signalAgeSeconds: number;
  maxAgeSeconds: number;
  /** Where the simulated signals claim to come from (display only). */
  source: SignalSource;
};

export type PlaygroundState = {
  path: string;
  /** Canonical region of the user (e.g. `us-east-1`). */
  userRegion: string;
  /** Backend currently serving this route (hysteresis input). */
  activeBackendId: string | null;
  config: RoutingConfig;
  /** Simulated carbon intensity per Rilot region; overrides the bundled fixture. */
  carbonByRegion: Record<string, number | null>;
  carbon: CarbonSettings;
  /** Per backend id; missing entries use defaults. */
  sim: Record<string, BackendSim>;
};

export const DEFAULT_SIM: BackendSim = { latencyMs: null, errorRatePercent: 0, healthy: true };
