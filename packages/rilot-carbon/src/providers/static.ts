import type { CarbonProvider, CarbonSignal, ProviderContext } from '../types';

/** Fixed values per region. Useful for tests, demos, and offline runs. */
export class StaticProvider implements CarbonProvider {
  readonly name = 'static';

  constructor(private readonly values: Record<string, number>) {}

  async fetch(regions: string[], ctx: ProviderContext): Promise<CarbonSignal[]> {
    const observed_at = new Date(ctx.now).toISOString();
    return regions.flatMap((region) => {
      const value = this.values[region];
      return typeof value === 'number' && Number.isFinite(value)
        ? [{ region, carbon_g_per_kwh: value, observed_at, source: 'mock' as const }]
        : [];
    });
  }
}
