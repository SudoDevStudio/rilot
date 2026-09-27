// Simulated carbon data for the static GitHub Pages playground.
// No provider API is called and no secrets are needed. Values come from a
// bundled fixture in the normalized Rilot JSON-provider format, keyed by
// Rilot region (never by provider zone id).
import fixture from './carbon-fixture.json';
import type { CarbonSignal, SignalSource } from '@rilot/core-js';

/** Fixed simulation clock so every run of the playground is reproducible. */
export const SIMULATED_NOW = '2026-09-18T20:05:00Z';

export const SIGNAL_SOURCES: { value: SignalSource; label: string; provider: string }[] = [
  { value: 'mock', label: 'Mock provider', provider: 'Mock (bundled fixture)' },
  { value: 'json', label: 'JSON provider', provider: 'Generic JSON provider' },
  { value: 'live', label: 'Live provider', provider: 'Electricity Maps (simulated)' },
  { value: 'local-cache', label: 'Local cache', provider: 'Electricity Maps (simulated)' },
  { value: 'last-known-good', label: 'KV last-known-good', provider: 'Electricity Maps (simulated)' }
];

export const FIXTURE_CARBON: Readonly<Record<string, number>> = Object.fromEntries(
  fixture.signals.map((s) => [s.region, s.carbon_g_per_kwh])
);

export function providerName(source: SignalSource): string {
  return SIGNAL_SOURCES.find((s) => s.value === source)?.provider ?? source;
}

function secondsBefore(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) - seconds * 1000).toISOString().replace('.000Z', 'Z');
}

/** Carbon for a region: explicit override, else the bundled fixture, else unavailable. */
export function carbonForRegion(region: string, overrides: Record<string, number | null>): number | null {
  if (region in overrides) return overrides[region];
  return FIXTURE_CARBON[region] ?? null;
}

/** One normalized signal per region that has a value. */
export function simulatedSignals(
  regions: string[],
  overrides: Record<string, number | null>,
  signalAgeSeconds: number,
  source: SignalSource,
  now: string = SIMULATED_NOW
): CarbonSignal[] {
  const observedAt = secondsBefore(now, Math.max(0, signalAgeSeconds));
  return Array.from(new Set(regions)).flatMap((region) => {
    const value = carbonForRegion(region, overrides);
    return value === null || !Number.isFinite(value)
      ? []
      : [{ region, carbon_g_per_kwh: Math.max(0, value), observed_at: observedAt, source }];
  });
}
