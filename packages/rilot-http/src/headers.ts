// The `x-rilot-*` headers that explain a decision on a forwarded response.
//
// They are opt-in (a deployment sets RILOT_EXPOSE_RESEARCH_HEADERS) because
// they describe internal state: which backends exist, how clean their grids
// are and why each was rejected.

import type { CandidateEvaluation, DecisionOutput } from '../../rilot-js/src/index';

export function researchHeaders(decision: DecisionOutput, selected: CandidateEvaluation | null): Record<string, string> {
  const carbonOf = (c: CandidateEvaluation) => c.carbon.used_g_per_kwh ?? c.carbon.carbon_g_per_kwh;
  const byCarbon = [...decision.candidates].sort(
    (a, b) => (carbonOf(a) ?? Infinity) - (carbonOf(b) ?? Infinity)
  );
  const snapshot = (list: CandidateEvaluation[]) =>
    list.map((c) => `${c.backend_id}:${carbonOf(c)?.toFixed(3) ?? 'na'}`).join(';');
  const headers: Record<string, string> = {
    'x-rilot-selected-zone': selected?.backend_id ?? 'none',
    'x-rilot-decision-reason': decision.reason.code,
    'x-rilot-zone-carbon-intensity-g-per-kwh': snapshot(byCarbon),
    'x-rilot-eligible-zone-carbon-intensity-g-per-kwh': snapshot(byCarbon.filter((c) => c.rejections.length === 0)),
    'x-rilot-zone-filter-reasons': byCarbon
      .map((c) => `${c.backend_id}:${c.rejections[0]?.kind ?? 'eligible'}`)
      .join(';'),
    'x-rilot-carbon-saved-vs-worst': decision.carbon_saved_vs_worst_g_per_kwh.toFixed(3),
    'x-rilot-carbon-saved-vs-worst-percent': decision.carbon_saved_vs_worst_percent.toFixed(2)
  };
  const carbon = selected ? carbonOf(selected) : undefined;
  if (carbon !== undefined) headers['x-rilot-selected-carbon-intensity'] = carbon.toFixed(3);
  if (selected?.carbon.source) headers['x-rilot-carbon-source'] = selected.carbon.source;
  if (selected?.carbon.age_seconds !== undefined) {
    headers['x-rilot-carbon-age-seconds'] = String(selected.carbon.age_seconds);
  }
  if (decision.defer_seconds > 0) headers['x-rilot-defer-seconds'] = String(decision.defer_seconds);
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => value !== ''));
}
