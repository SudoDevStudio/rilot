// Simulated grid carbon for the three backend regions.
//
// Real Rilot asks a carbon provider (Electricity Maps, a JSON feed, ...). This
// demo runs entirely in the browser, so the numbers follow a simple daily
// curve instead: solar pulls the grid clean around local midday.

import type { CarbonSignal } from '@rilot/core-js';

type RegionProfile = {
  region: string;
  label: string;
  /** Average intensity over the day, gCO2/kWh. */
  base: number;
  /** How much solar/wind moves it. */
  swing: number;
  /** Local time offset, so "midday" happens at different UTC hours. */
  utcOffset: number;
};

export const REGION_PROFILES: RegionProfile[] = [
  { region: 'us-east-1', label: 'Virginia', base: 350, swing: 90, utcOffset: -4 },
  { region: 'us-west-2', label: 'Oregon', base: 150, swing: 110, utcOffset: -7 },
  { region: 'eu-west-1', label: 'Dublin', base: 260, swing: 130, utcOffset: 1 }
];

/** Carbon intensity for one region at a given UTC hour (0–24). */
export function carbonAt(profile: RegionProfile, utcHour: number): number {
  const localHour = (utcHour + profile.utcOffset + 24) % 24;
  // Cleanest at 13:00 local, dirtiest at 01:00 local.
  const solar = Math.cos(((localHour - 13) / 24) * 2 * Math.PI);
  return Math.max(20, Math.round(profile.base - profile.swing * solar));
}

/** Builds the normalized signals Rilot consumes, as a provider would return them. */
export function signalsAt(utcHour: number, now: Date, ageSeconds: number): CarbonSignal[] {
  const observedAt = new Date(now.getTime() - ageSeconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return REGION_PROFILES.map((profile) => ({
    region: profile.region,
    carbon_g_per_kwh: carbonAt(profile, utcHour),
    observed_at: observedAt,
    source: 'live' as const
  }));
}
