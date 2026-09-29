import type { RoutingConfig } from '@rilot/core-js';
import { DEFAULT_SIM, type BackendSim, type PlaygroundState } from './ui-types';

export type PresetGroup = 'production' | 'research';

export type PlaygroundPreset = {
  id: string;
  group: PresetGroup;
  label: string;
  description: string;
  notes: string[];
  state: PlaygroundState;
};

/** A normal Rilot config: root defaults plus routing rules that override them. */
export const PRODUCTION_CONFIG: RoutingConfig = {
  backends: [
    { id: 'east', region: 'us-east-1', url: 'https://east.example.com' },
    { id: 'ohio', region: 'us-east-2', url: 'https://ohio.example.com' },
    { id: 'west', region: 'us-west-2', url: 'https://west.example.com' },
    { id: 'stockholm', region: 'eu-north-1', url: 'https://stockholm.example.com' }
  ],
  policy: 'balanced',
  radius_km: 2000,
  fallback: 'nearest',
  routing_rules: [
    { path: '/checkout/*', policy: 'latency', radius_km: 800 },
    { path: '/reports/*', policy: 'carbon', radius_km: 5000 }
  ]
};

const productionState = (path: string): PlaygroundState => ({
  path,
  userRegion: 'us-east-1',
  activeBackendId: null,
  config: structuredClone(PRODUCTION_CONFIG),
  carbonByRegion: {},
  carbon: { signalAgeSeconds: 72, maxAgeSeconds: 300, source: 'live' },
  sim: {}
});

// Research scenarios: four generic regions with measured latency and advanced knobs.
const RESEARCH_BACKENDS = ['us-east', 'us-west', 'eu-central', 'ap-south'];

function researchState(
  advanced: NonNullable<RoutingConfig['advanced']>,
  options: {
    path?: string;
    policy?: RoutingConfig['policy'];
    sim?: Record<string, Partial<BackendSim>>;
    carbon?: Record<string, number>;
  } = {}
): PlaygroundState {
  const baseSim: Record<string, BackendSim> = {
    'us-east': { ...DEFAULT_SIM, latencyMs: 28, errorRatePercent: 0.8 },
    'us-west': { ...DEFAULT_SIM, latencyMs: 58, errorRatePercent: 1.1 },
    'eu-central': { ...DEFAULT_SIM, latencyMs: 96, errorRatePercent: 1.4 },
    'ap-south': { ...DEFAULT_SIM, latencyMs: 142, errorRatePercent: 1.9 }
  };
  for (const [id, patch] of Object.entries(options.sim ?? {})) baseSim[id] = { ...baseSim[id], ...patch };
  const costs: Record<string, number> = { 'us-east': 0.22, 'us-west': 0.28, 'eu-central': 0.35, 'ap-south': 0.18 };
  return {
    path: options.path ?? '/',
    userRegion: 'us-east',
    activeBackendId: 'us-east',
    config: {
      backends: RESEARCH_BACKENDS.map((id) => ({ id, region: id, cost: costs[id] })),
      policy: options.policy ?? 'balanced',
      fallback: 'nearest',
      advanced
    },
    carbonByRegion: { 'us-east': 320, 'us-west': 150, 'eu-central': 92, 'ap-south': 210, ...options.carbon },
    carbon: { signalAgeSeconds: 72, maxAgeSeconds: 300, source: 'mock' },
    sim: baseSim
  };
}

export const presets: PlaygroundPreset[] = [
  {
    id: 'checkout',
    group: 'production',
    label: 'Checkout',
    description: '/checkout/pay: latency policy, 800 km radius.',
    notes: [
      'Latency-sensitive user request.',
      'The /checkout/* rule overrides policy and radius; fallback and backends are inherited from the root.',
      'The latency policy needs no carbon data, so no carbon lookup happens.'
    ],
    state: productionState('/checkout/pay')
  },
  {
    id: 'recommendations',
    group: 'production',
    label: 'Recommendations',
    description: '/recommendations/user/123: balanced, 2000 km radius.',
    notes: [
      'Moderate carbon/latency trade-off.',
      'No routing rule matches, so the root config applies: balanced policy, 2000 km radius.',
      'Cleaner regions outside the radius are rejected with a visible reason.'
    ],
    state: productionState('/recommendations/user/123')
  },
  {
    id: 'reports',
    group: 'production',
    label: 'Reports',
    description: '/reports/monthly: carbon policy, 5000 km radius.',
    notes: [
      'Carbon-sensitive, flexible workload.',
      'The /reports/* rule widens the radius, so a cleaner cross-country region can win.',
      'Stockholm is even cleaner but still outside 5000 km.'
    ],
    state: productionState('/reports/monthly')
  },
  {
    id: 'local-pinned-interactive',
    group: 'research',
    label: 'Local pinned interactive',
    description: 'Interactive traffic stays local even when a cleaner remote region exists.',
    notes: [
      'Use this when user-facing latency matters more than carbon optimization.',
      'The strict-local route class rejects backends outside the user region before scoring.',
      'Good for checkout, auth, or any path where locality should dominate.'
    ],
    state: researchState({
      route_class: 'strict-local',
      weights: { carbon: 20, latency: 55, reliability: 20, cost: 5 },
      hard_max_latency_ms: 80,
      hysteresis_delta: 0.03
    })
  },
  {
    id: 'balanced-routing',
    group: 'research',
    label: 'Balanced routing',
    description: 'A moderate trade-off between carbon, latency, reliability, and cost.',
    notes: [
      'This is the middle-ground preset, not a strict local pin and not an aggressive carbon chase.',
      'Latency guardrails keep far regions out; a minimum carbon benefit keeps marginal moves out.',
      'Useful when you want a realistic default trade-off for mixed workloads.'
    ],
    state: researchState({
      weights: { carbon: 40, latency: 35, reliability: 15, cost: 10 },
      max_latency_delta_ms: 45,
      hard_max_latency_ms: 110,
      min_carbon_benefit_g_per_kwh: 15,
      hysteresis_delta: 0.02
    })
  },
  {
    id: 'carbon-first-background',
    group: 'research',
    label: 'Carbon-first background',
    description: 'Background work tolerates more latency to reach cleaner regions.',
    notes: [
      'This preset is meant for batch jobs or asynchronous work, not interactive paths.',
      'Higher carbon weight and looser latency guardrails make cleaner remote regions more competitive.',
      'It helps demonstrate when extra latency is acceptable in exchange for lower carbon intensity.'
    ],
    state: researchState(
      {
        route_class: 'background',
        weights: { carbon: 70, latency: 15, reliability: 10, cost: 5 },
        max_latency_delta_ms: 120,
        hard_max_latency_ms: 180,
        min_carbon_benefit_g_per_kwh: 40,
        hysteresis_delta: 0.01
      },
      { policy: 'carbon' }
    )
  },
  {
    id: 'cleaner-but-rejected',
    group: 'research',
    label: 'Cleaner but rejected',
    description: 'A cleaner remote region exists but misses the latency guardrails.',
    notes: [
      'This scenario exists to show that cleaner does not automatically mean selected.',
      'The remote region improves carbon, but it fails the configured latency constraints.',
      'Use it to explain why guardrails can intentionally block greener options.'
    ],
    state: researchState({
      weights: { carbon: 65, latency: 20, reliability: 10, cost: 5 },
      max_latency_delta_ms: 20,
      hard_max_latency_ms: 70,
      min_carbon_benefit_g_per_kwh: 30,
      hysteresis_delta: 0.02
    })
  },
  {
    id: 'hysteresis-prevents-flapping',
    group: 'research',
    label: 'Hysteresis prevents flapping',
    description: 'A slightly better remote score is not enough to switch away from the active backend.',
    notes: [
      'This preset demonstrates stability logic rather than raw scoring alone.',
      'A remote region becomes slightly better, but the improvement is too small to justify a switch.',
      'Useful for explaining why routing systems avoid constant oscillation between close candidates.'
    ],
    state: researchState(
      {
        weights: { carbon: 50, latency: 30, reliability: 15, cost: 5 },
        max_latency_delta_ms: 60,
        hard_max_latency_ms: 120,
        min_carbon_benefit_g_per_kwh: 10,
        hysteresis_delta: 0.09
      },
      { sim: { 'us-west': { latencyMs: 34 } }, carbon: { 'us-east': 260, 'us-west': 200 } }
    )
  }
];

export function clonePresetState(id: string): PlaygroundState {
  const preset = presets.find((entry) => entry.id === id) ?? presets[0];
  return structuredClone(preset.state);
}
