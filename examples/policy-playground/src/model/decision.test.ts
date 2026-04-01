import { describe, expect, it } from 'vitest';
import { computeDecision } from './decision';
import { clonePresetState } from './presets';

describe('computeDecision', () => {
  it('keeps traffic local for the local pinned interactive preset', () => {
    const result = computeDecision(clonePresetState('local-pinned-interactive'));
    expect(result.selectedCandidateId).toBe('us-east');
    expect(result.finalStep).toBe('scored');
  });

  it('chooses a cleaner remote region for the carbon-first background preset', () => {
    const result = computeDecision(clonePresetState('carbon-first-background'));
    expect(result.selectedCandidateId).toBe('eu-central');
    expect(result.finalStep).toBe('scored');
  });

  it('keeps local selected when cleaner regions are rejected by guardrails', () => {
    const result = computeDecision(clonePresetState('cleaner-but-rejected'));
    expect(result.selectedCandidateId).toBe('us-east');
    expect(result.finalStep).toBe('scored');
    const rejectedRemote = result.candidates.find((candidate) => candidate.id === 'us-west');
    expect(rejectedRemote?.accepted).toBe(false);
  });

  it('keeps the active region when hysteresis says improvement is too small', () => {
    const result = computeDecision(clonePresetState('hysteresis-prevents-flapping'));
    expect(result.selectedCandidateId).toBe('us-east');
    expect(result.finalStep).toBe('hysteresis');
  });

  it('falls back to all zones when a region allowlist style setup has no local match and fail-safe is enabled', () => {
    const input = clonePresetState('balanced-routing');
    input.geoPolicy = 'global';
    input.userRegion = 'ca-central';
    input.guardrails.failSafeToLocal = true;
    const result = computeDecision(input);
    expect(result.localBaselineId).toBe('us-east');
    expect(result.selectedCandidateId).toBeTruthy();
  });

  it('falls back to the local baseline when every candidate is rejected and fail-safe is enabled', () => {
    const input = clonePresetState('balanced-routing');
    input.guardrails.hardMaxLatencyMs = 10;
    const result = computeDecision(input);
    expect(result.selectedCandidateId).toBe('us-east');
    expect(result.finalStep).toBe('fallback-local');
  });
});
