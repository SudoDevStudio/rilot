// Optional: real carbon data from a Rilot deployment's carbon API.
//
// Set PUBLIC_CARBON_API at build time and the demo stops simulating:
//
//   PUBLIC_CARBON_API=https://rilot.example.workers.dev/__rilot/carbon npm run build
//
// That endpoint is read-only, sends CORS headers, and serves whatever the
// shared carbon layer has cached (memory → KV → provider), so no API key is
// ever exposed to the page. With nothing configured — as on GitHub Pages — the
// demo keeps its own daily solar curve and this module does nothing.

import type { CarbonSignal } from '@rilot/core-js';

const ENDPOINT = (import.meta.env.PUBLIC_CARBON_API as string | undefined)?.trim() ?? '';

/** How long a fetched snapshot is reused before asking again. */
const TTL_MS = 60_000;

export type LiveCarbon = {
  signals: CarbonSignal[];
  /** Where it came from, for the note in the flow panel. */
  endpoint: string;
  fetchedAt: number;
};

export const isConfigured = ENDPOINT !== '';

let cached: LiveCarbon | null = null;
let inFlight: Promise<LiveCarbon | null> | null = null;

type ApiResponse = {
  signals?: (CarbonSignal & { age_seconds?: number | null; stale?: boolean })[];
};

/**
 * The live signals, or `null` when no API is configured or it cannot be
 * reached. A failure is never fatal: the caller falls back to the simulation,
 * which is the same thing Rilot itself does with a stale cache.
 */
export async function getLiveSignals(): Promise<LiveCarbon | null> {
  if (!isConfigured) return null;
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached;
  inFlight ??= load().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function load(): Promise<LiveCarbon | null> {
  try {
    const response = await fetch(ENDPOINT, { headers: { accept: 'application/json' } });
    if (!response.ok) return null;
    const body = (await response.json()) as ApiResponse;
    const signals = (body.signals ?? [])
      .filter((signal) => typeof signal.region === 'string' && Number.isFinite(signal.carbon_g_per_kwh))
      // The API's own extras are not part of the engine's input.
      .map(({ region, carbon_g_per_kwh, observed_at, forecast_g_per_kwh, source }) => ({
        region,
        carbon_g_per_kwh,
        observed_at,
        ...(forecast_g_per_kwh !== undefined ? { forecast_g_per_kwh } : {}),
        ...(source ? { source } : {})
      }));
    if (signals.length === 0) return null;
    cached = { signals, endpoint: ENDPOINT, fetchedAt: Date.now() };
    return cached;
  } catch {
    return null;
  }
}
