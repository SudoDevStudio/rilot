import type { CarbonProvider, CarbonSignal, ProviderContext } from '../types';
import type { FetchLike } from './json';

/** Rilot region → Electricity Maps zone. Provider-internal: never leaves this file. */
export const ELECTRICITYMAPS_ZONES: Record<string, string> = {
  'us-east-1': 'US-MIDA-PJM',
  'us-east-2': 'US-MIDA-PJM',
  'us-west-1': 'US-CAL-CISO',
  'us-west-2': 'US-NW-BPAT',
  'ca-central-1': 'CA-QC',
  'sa-east-1': 'BR-CS',
  'eu-west-1': 'IE',
  'eu-west-2': 'GB',
  'eu-west-3': 'FR',
  'eu-central-1': 'DE',
  'eu-north-1': 'SE-SE3',
  'eu-south-1': 'IT-NO',
  'ap-south-1': 'IN-WE',
  'ap-southeast-1': 'SG',
  'ap-southeast-2': 'AU-NSW',
  'ap-northeast-1': 'JP-TK',
  'ap-northeast-2': 'KR'
};

export type ElectricityMapsOptions = {
  apiKey: string;
  baseUrl?: string;
  tokenHeader?: string;
  /** Overrides for regions missing from the built-in table. */
  zoneMap?: Record<string, string>;
  disableEstimations?: boolean;
  fetchImpl?: FetchLike;
};

export class ElectricityMapsProvider implements CarbonProvider {
  readonly name = 'electricitymap';
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: ElectricityMapsOptions) {
    this.fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike);
  }

  zoneFor(region: string): string {
    return this.options.zoneMap?.[region] ?? ELECTRICITYMAPS_ZONES[region] ?? region;
  }

  async fetch(regions: string[], ctx: ProviderContext): Promise<CarbonSignal[]> {
    const base = (this.options.baseUrl ?? 'https://api.electricitymap.org').replace(/\/$/, '');
    const header = this.options.tokenHeader ?? 'auth-token';
    const results = await Promise.all(
      regions.map(async (region): Promise<CarbonSignal | null> => {
        const zone = this.zoneFor(region);
        const url =
          `${base}/v3/carbon-intensity/latest?zone=${encodeURIComponent(zone)}` +
          `&disableEstimations=${this.options.disableEstimations ? 'true' : 'false'}`;
        try {
          const response = await this.fetchImpl(url, {
            headers: { [header]: this.options.apiKey },
            signal: AbortSignal.timeout(ctx.timeoutMs)
          });
          if (!response.ok) return null;
          const data = (await response.json()) as { carbonIntensity?: number; datetime?: string };
          if (typeof data.carbonIntensity !== 'number' || !Number.isFinite(data.carbonIntensity)) return null;
          const observedAt =
            data.datetime && !Number.isNaN(Date.parse(data.datetime))
              ? new Date(data.datetime).toISOString()
              : new Date(ctx.now).toISOString();
          return {
            region,
            carbon_g_per_kwh: data.carbonIntensity,
            observed_at: observedAt,
            source: 'live' as const
          };
        } catch {
          // One region failing must not fail the batch.
          return null;
        }
      })
    );
    return results.filter((signal): signal is CarbonSignal => signal !== null);
  }
}
