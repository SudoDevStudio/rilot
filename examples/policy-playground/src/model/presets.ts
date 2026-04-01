import type { Candidate, DecisionInput } from './decision';

export type PlaygroundPreset = {
  id: string;
  label: string;
  description: string;
  notes: string[];
  state: DecisionInput;
};

function makeCandidates(): Candidate[] {
  return [
    {
      id: 'us-east',
      label: 'US East',
      region: 'us-east',
      enabled: true,
      latencyMs: 28,
      carbonIntensity: 320,
      reliabilityRisk: 0.8,
      cost: 0.22
    },
    {
      id: 'us-west',
      label: 'US West',
      region: 'us-west',
      enabled: true,
      latencyMs: 58,
      carbonIntensity: 150,
      reliabilityRisk: 1.1,
      cost: 0.28
    },
    {
      id: 'eu-central',
      label: 'EU Central',
      region: 'eu-central',
      enabled: true,
      latencyMs: 96,
      carbonIntensity: 92,
      reliabilityRisk: 1.4,
      cost: 0.35
    },
    {
      id: 'ap-south',
      label: 'AP South',
      region: 'ap-south',
      enabled: true,
      latencyMs: 142,
      carbonIntensity: 210,
      reliabilityRisk: 1.9,
      cost: 0.18
    }
  ];
}

export const presets: PlaygroundPreset[] = [
  {
    id: 'local-pinned-interactive',
    label: 'Local pinned interactive',
    description: 'Interactive traffic stays local even when a cleaner remote region exists.',
    notes: [
      'Use this when user-facing latency matters more than carbon optimization.',
      'Geo policy is local-only, so remote regions are rejected before scoring.',
      'Good for checkout, auth, or any path where locality should dominate.'
    ],
    state: {
      requestClass: 'interactive',
      userRegion: 'us-east',
      activeRegion: 'us-east',
      geoPolicy: 'local-only',
      weights: { carbon: 20, latency: 55, reliability: 20, cost: 5 },
      guardrails: {
        maxLatencyDeltaMs: 0,
        hardMaxLatencyMs: 80,
        minCarbonBenefit: 0,
        hysteresisThreshold: 0.03,
        failSafeToLocal: true
      },
      candidates: makeCandidates()
    }
  },
  {
    id: 'balanced-routing',
    label: 'Balanced routing',
    description: 'A moderate trade-off between carbon, latency, reliability, and cost.',
    notes: [
      'This is the middle-ground preset, not a strict local pin and not an aggressive carbon chase.',
      'Prefer-local keeps traffic nearby unless a remote option is meaningfully cleaner or better.',
      'Useful when you want a realistic default trade-off for mixed workloads.'
    ],
    state: {
      requestClass: 'standard',
      userRegion: 'us-east',
      activeRegion: 'us-east',
      geoPolicy: 'prefer-local',
      weights: { carbon: 40, latency: 35, reliability: 15, cost: 10 },
      guardrails: {
        maxLatencyDeltaMs: 45,
        hardMaxLatencyMs: 110,
        minCarbonBenefit: 15,
        hysteresisThreshold: 0.02,
        failSafeToLocal: true
      },
      candidates: makeCandidates()
    }
  },
  {
    id: 'carbon-first-background',
    label: 'Carbon-first background',
    description: 'Background work tolerates more latency to reach cleaner regions.',
    notes: [
      'This preset is meant for batch jobs or asynchronous work, not interactive paths.',
      'Higher carbon weight and looser latency guardrails make cleaner remote regions more competitive.',
      'It helps demonstrate when extra latency is acceptable in exchange for lower carbon intensity.'
    ],
    state: {
      requestClass: 'background',
      userRegion: 'us-east',
      activeRegion: 'us-east',
      geoPolicy: 'global',
      weights: { carbon: 70, latency: 15, reliability: 10, cost: 5 },
      guardrails: {
        maxLatencyDeltaMs: 120,
        hardMaxLatencyMs: 180,
        minCarbonBenefit: 40,
        hysteresisThreshold: 0.01,
        failSafeToLocal: true
      },
      candidates: makeCandidates()
    }
  },
  {
    id: 'cleaner-but-rejected',
    label: 'Cleaner but rejected',
    description: 'A cleaner remote region exists but misses the latency guardrails.',
    notes: [
      'This scenario exists to show that cleaner does not automatically mean selected.',
      'The remote region improves carbon, but it fails the configured latency constraints.',
      'Use it to explain why guardrails can intentionally block greener options.'
    ],
    state: {
      requestClass: 'interactive',
      userRegion: 'us-east',
      activeRegion: 'us-east',
      geoPolicy: 'prefer-local',
      weights: { carbon: 65, latency: 20, reliability: 10, cost: 5 },
      guardrails: {
        maxLatencyDeltaMs: 20,
        hardMaxLatencyMs: 70,
        minCarbonBenefit: 30,
        hysteresisThreshold: 0.02,
        failSafeToLocal: true
      },
      candidates: makeCandidates()
    }
  },
  {
    id: 'hysteresis-prevents-flapping',
    label: 'Hysteresis prevents flapping',
    description: 'A slightly better remote score is not enough to switch away from the active region.',
    notes: [
      'This preset demonstrates stability logic rather than raw scoring alone.',
      'A remote region becomes slightly better, but the improvement is too small to justify a switch.',
      'Useful for explaining why routing systems avoid constant oscillation between close candidates.'
    ],
    state: {
      requestClass: 'standard',
      userRegion: 'us-east',
      activeRegion: 'us-east',
      geoPolicy: 'global',
      weights: { carbon: 50, latency: 30, reliability: 15, cost: 5 },
      guardrails: {
        maxLatencyDeltaMs: 60,
        hardMaxLatencyMs: 120,
        minCarbonBenefit: 10,
        hysteresisThreshold: 0.09,
        failSafeToLocal: true
      },
      candidates: makeCandidates().map((candidate) =>
        candidate.id === 'us-east'
          ? { ...candidate, carbonIntensity: 260 }
          : candidate.id === 'us-west'
            ? { ...candidate, latencyMs: 34, carbonIntensity: 220 }
            : candidate
      )
    }
  }
];

export function clonePresetState(id: string): DecisionInput {
  const preset = presets.find((entry) => entry.id === id) ?? presets[0];
  return JSON.parse(JSON.stringify(preset.state)) as DecisionInput;
}
