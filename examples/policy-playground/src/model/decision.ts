export type RequestClass = 'interactive' | 'standard' | 'background';
export type GeoPolicy = 'local-only' | 'prefer-local' | 'global';

export type Candidate = {
  id: string;
  label: string;
  region: string;
  enabled: boolean;
  latencyMs: number;
  carbonIntensity: number;
  reliabilityRisk: number;
  cost: number;
};

export type PolicyWeights = {
  carbon: number;
  latency: number;
  reliability: number;
  cost: number;
};

export type Guardrails = {
  maxLatencyDeltaMs: number;
  hardMaxLatencyMs: number;
  minCarbonBenefit: number;
  hysteresisThreshold: number;
  failSafeToLocal: boolean;
};

export type DecisionInput = {
  requestClass: RequestClass;
  userRegion: string;
  activeRegion: string | null;
  geoPolicy: GeoPolicy;
  weights: PolicyWeights;
  guardrails: Guardrails;
  candidates: Candidate[];
};

export type DecisionCandidate = Candidate & {
  isLocalBaseline: boolean;
  latencyDeltaVsLocal: number;
  carbonBenefitVsLocal: number;
  rejectionReasons: string[];
  accepted: boolean;
  normalized: {
    carbon: number;
    latency: number;
    reliability: number;
    cost: number;
  };
  weighted: {
    carbon: number;
    latency: number;
    reliability: number;
    cost: number;
  };
  totalScore: number;
  status: 'accepted' | 'rejected' | 'fallback' | 'selected' | 'sticky-selected';
};

export type DecisionResult = {
  localBaselineId: string | null;
  localBaselineLabel: string | null;
  selectedCandidateId: string | null;
  selectedLabel: string | null;
  selectedRegion: string | null;
  selectedReason: string;
  finalStep: 'scored' | 'hysteresis' | 'fallback-local' | 'no-selection';
  normalizedWeights: PolicyWeights;
  candidates: DecisionCandidate[];
};

function statusForStep(step: DecisionResult['finalStep']): DecisionCandidate['status'] {
  if (step === 'hysteresis') {
    return 'sticky-selected';
  }
  if (step === 'fallback-local') {
    return 'fallback';
  }
  return 'selected';
}

function clampNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeWeights(weights: PolicyWeights): PolicyWeights {
  const carbon = Math.max(0, clampNumber(weights.carbon));
  const latency = Math.max(0, clampNumber(weights.latency));
  const reliability = Math.max(0, clampNumber(weights.reliability));
  const cost = Math.max(0, clampNumber(weights.cost));
  const sum = carbon + latency + reliability + cost;

  if (sum <= 0) {
    return { carbon: 0.25, latency: 0.25, reliability: 0.25, cost: 0.25 };
  }

  return {
    carbon: carbon / sum,
    latency: latency / sum,
    reliability: reliability / sum,
    cost: cost / sum
  };
}

function minMaxNormalize(values: number[], value: number): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 0;
  }
  return (value - min) / (max - min);
}

function findLocalBaseline(candidates: Candidate[], userRegion: string): Candidate | null {
  const enabled = candidates.filter((candidate) => candidate.enabled);
  if (enabled.length === 0) {
    return null;
  }

  const localMatches = enabled.filter((candidate) => candidate.region === userRegion);
  if (localMatches.length > 0) {
    return [...localMatches].sort((a, b) => a.latencyMs - b.latencyMs || a.label.localeCompare(b.label))[0];
  }

  return [...enabled].sort((a, b) => a.latencyMs - b.latencyMs || a.label.localeCompare(b.label))[0];
}

function buildRejectionReasons(
  candidate: Candidate,
  baseline: Candidate | null,
  input: DecisionInput
): string[] {
  const reasons: string[] = [];
  if (!candidate.enabled) {
    reasons.push('Candidate disabled');
    return reasons;
  }

  if (candidate.latencyMs < 0 || candidate.carbonIntensity < 0 || candidate.reliabilityRisk < 0 || candidate.cost < 0) {
    reasons.push('Candidate has invalid negative metrics');
  }

  if (baseline && input.geoPolicy === 'local-only' && candidate.region !== baseline.region) {
    reasons.push(`Geo policy keeps traffic pinned to ${baseline.region}`);
  }

  if (
    baseline &&
    input.geoPolicy === 'prefer-local' &&
    candidate.id !== baseline.id &&
    candidate.region !== baseline.region &&
    candidate.latencyMs >= baseline.latencyMs &&
    candidate.carbonIntensity >= baseline.carbonIntensity
  ) {
    reasons.push('Prefer-local keeps traffic in the local region because this remote option is neither faster nor cleaner');
  }

  if (baseline) {
    const latencyDelta = candidate.latencyMs - baseline.latencyMs;
    const carbonBenefit = baseline.carbonIntensity - candidate.carbonIntensity;
    if (latencyDelta > input.guardrails.maxLatencyDeltaMs) {
      reasons.push(`Latency delta ${latencyDelta.toFixed(1)} ms exceeds max delta ${input.guardrails.maxLatencyDeltaMs.toFixed(1)} ms`);
    }
    if (candidate.id !== baseline.id && carbonBenefit < input.guardrails.minCarbonBenefit) {
      reasons.push(
        `Carbon benefit ${carbonBenefit.toFixed(1)} gCO2/kWh is below minimum ${input.guardrails.minCarbonBenefit.toFixed(1)} gCO2/kWh`
      );
    }
  }

  if (candidate.latencyMs > input.guardrails.hardMaxLatencyMs) {
    reasons.push(`Latency ${candidate.latencyMs.toFixed(1)} ms exceeds hard max ${input.guardrails.hardMaxLatencyMs.toFixed(1)} ms`);
  }

  return reasons;
}

export function computeDecision(input: DecisionInput): DecisionResult {
  const baseline = findLocalBaseline(input.candidates, input.userRegion);
  const normalizedWeights = normalizeWeights(input.weights);
  const enabledCandidates = input.candidates.filter((candidate) => candidate.enabled);
  const latencyValues = enabledCandidates.map((candidate) => candidate.latencyMs);
  const carbonValues = enabledCandidates.map((candidate) => candidate.carbonIntensity);
  const reliabilityValues = enabledCandidates.map((candidate) => candidate.reliabilityRisk);
  const costValues = enabledCandidates.map((candidate) => candidate.cost);

  const candidates: DecisionCandidate[] = input.candidates.map((candidate) => {
    const latencyDeltaVsLocal = baseline ? candidate.latencyMs - baseline.latencyMs : 0;
    const carbonBenefitVsLocal = baseline ? baseline.carbonIntensity - candidate.carbonIntensity : 0;
    const normalized = {
      carbon: minMaxNormalize(carbonValues, candidate.carbonIntensity),
      latency: minMaxNormalize(latencyValues, candidate.latencyMs),
      reliability: minMaxNormalize(reliabilityValues, candidate.reliabilityRisk),
      cost: minMaxNormalize(costValues, candidate.cost)
    };
    const weighted = {
      carbon: normalized.carbon * normalizedWeights.carbon,
      latency: normalized.latency * normalizedWeights.latency,
      reliability: normalized.reliability * normalizedWeights.reliability,
      cost: normalized.cost * normalizedWeights.cost
    };
    const rejectionReasons = buildRejectionReasons(candidate, baseline, input);
    return {
      ...candidate,
      isLocalBaseline: baseline?.id === candidate.id,
      latencyDeltaVsLocal,
      carbonBenefitVsLocal,
      rejectionReasons,
      accepted: candidate.enabled && rejectionReasons.length === 0,
      normalized,
      weighted,
      totalScore: weighted.carbon + weighted.latency + weighted.reliability + weighted.cost,
      status: rejectionReasons.length === 0 ? 'accepted' : 'rejected'
    };
  });

  const accepted = candidates
    .filter((candidate) => candidate.accepted)
    .sort((a, b) => a.totalScore - b.totalScore || a.latencyMs - b.latencyMs || a.label.localeCompare(b.label));

  let selected: DecisionCandidate | null = accepted[0] ?? null;
  let selectedReason = selected
    ? 'Lowest weighted score among candidates that passed the guardrails.'
    : 'No candidate passed the configured guardrails.';
  let finalStep: DecisionResult['finalStep'] = selected ? 'scored' : 'no-selection';

  if (selected && input.activeRegion && selected.region !== input.activeRegion) {
    const activeCandidate = accepted.find((candidate) => candidate.region === input.activeRegion);
    if (activeCandidate) {
      const improvement = activeCandidate.totalScore - selected.totalScore;
      if (improvement < input.guardrails.hysteresisThreshold) {
        selected = activeCandidate;
        selectedReason =
          `Hysteresis kept ${activeCandidate.label} active because the score improvement ` +
          `${improvement.toFixed(3)} stayed below the threshold ${input.guardrails.hysteresisThreshold.toFixed(3)}.`;
        finalStep = 'hysteresis';
      }
    }
  }

  if (!selected && input.guardrails.failSafeToLocal && baseline) {
    selected = candidates.find((candidate) => candidate.id === baseline.id) ?? null;
    if (selected) {
      selectedReason = 'No candidate cleared the guardrails, so fail-safe returned traffic to the local baseline.';
      finalStep = 'fallback-local';
    }
  }

  const updatedCandidates = candidates.map((candidate) => {
    if (selected && candidate.id === selected.id) {
      return {
        ...candidate,
        status: statusForStep(finalStep)
      };
    }
    return candidate;
  });

  return {
    localBaselineId: baseline?.id ?? null,
    localBaselineLabel: baseline?.label ?? null,
    selectedCandidateId: selected?.id ?? null,
    selectedLabel: selected?.label ?? null,
    selectedRegion: selected?.region ?? null,
    selectedReason,
    finalStep,
    normalizedWeights,
    candidates: updatedCandidates
  };
}
