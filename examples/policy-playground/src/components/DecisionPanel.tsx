import type { ViewMode } from '../model/ui-types';
import { providerName } from '../rilot/fixtures';
import type {
  CandidateEvaluation,
  CarbonSignal,
  DecisionOutput,
  LatencySource,
  SignalSource,
  ValueSource
} from '@rilot/core-js';

export const REJECTION_LABELS: Record<string, string> = {
  'region-constraint': 'region constraint',
  'outside-radius': 'outside radius',
  'candidate-limit': 'candidate limit',
  'health-constraint': 'health constraint',
  'capacity-constraint': 'capacity constraint',
  'latency-constraint': 'latency constraint',
  'carbon-unavailable': 'carbon unavailable',
  'insufficient-carbon-benefit': 'insufficient carbon benefit'
};

export const REASON_LABELS: Record<string, string> = {
  'score-win': 'Weighted winner',
  'lowest-latency': 'Lowest latency',
  'hysteresis-sticky-zone': 'Sticky winner',
  'deferred-for-greener-window': 'Deferred for greener window',
  'fallback-nearest': 'Fallback: nearest',
  'fallback-lowest-latency': 'Fallback: lowest latency',
  'no-eligible-backend': 'No selection',
  'no-backends': 'No backends'
};

const SOURCE_TEXT: Record<SignalSource, string> = {
  live: 'live provider',
  'local-cache': 'local cache',
  'last-known-good': 'KV last-known-good',
  mock: 'mock provider',
  json: 'JSON provider'
};

const LATENCY_TEXT: Record<LatencySource, string> = {
  measured: 'measured',
  configured: 'configured RTT',
  'distance-estimate': 'estimated from distance',
  default: 'default'
};

function inherited(source: ValueSource): string {
  switch (source) {
    case 'rule':
      return '';
    case 'root':
      return 'inherited from root';
    case 'request':
      return 'request override';
    default:
      return 'default';
  }
}

/** A hysteresis win is displayed as "sticky-selected". */
export function displayStatus(candidate: CandidateEvaluation, output: DecisionOutput): string {
  if (candidate.status === 'selected' && output.reason.code === 'hysteresis-sticky-zone') return 'sticky-selected';
  return candidate.status;
}

export function eligibilityText(candidate: CandidateEvaluation): string {
  if (candidate.status === 'fallback') return 'fallback candidate';
  if (candidate.rejections.length === 0) return 'eligible';
  return candidate.rejections.map((r) => REJECTION_LABELS[r.kind] ?? r.kind).join(', ');
}

function carbonValue(c: CandidateEvaluation): number | undefined {
  return c.carbon.used_g_per_kwh ?? c.carbon.carbon_g_per_kwh;
}

function carbonText(c: CandidateEvaluation): string {
  const value = carbonValue(c);
  if (value !== undefined) return `${Math.round(value)} gCO2/kWh`;
  return c.carbon.status === 'not-requested' ? 'not needed' : 'unavailable';
}

const km = (value: number | null | undefined) => (value === null || value === undefined ? 'unlimited' : `${Math.round(value)} km`);

function orderCandidates(output: DecisionOutput): CandidateEvaluation[] {
  const rank = (c: CandidateEvaluation) => (c.status === 'selected' || c.status === 'fallback' ? 0 : c.status === 'eligible' ? 1 : 2);
  return [...output.candidates].sort(
    (a, b) => rank(a) - rank(b) || (a.score?.total ?? Infinity) - (b.score?.total ?? Infinity) || a.latency_ms - b.latency_ms
  );
}

export function DecisionPanel({
  output,
  view,
  signals,
  signalAgeSeconds,
  maxAgeSeconds,
  source
}: {
  output: DecisionOutput;
  view: ViewMode;
  signals: CarbonSignal[];
  signalAgeSeconds: number;
  maxAgeSeconds: number;
  source: SignalSource;
}) {
  const eff = output.effective;
  const candidates = orderCandidates(output);
  const selected = output.candidates.find((c) => c.backend_id === output.selected_backend_id) ?? null;

  return (
    <>
      <div className="response-banner">
        <div>
          <span>Selected backend</span>
          <strong>{selected ? `${selected.backend_id} (${selected.region})` : 'none'}</strong>
        </div>
        <p>
          <span className="winner-pill winner-step">{REASON_LABELS[output.reason.code] ?? output.reason.code}</span>{' '}
          {output.reason.message}
        </p>
      </div>

      <div className="info-grid">
        <section className="info-block">
          <h3>Effective rule</h3>
          <dl className="kv">
            <dt>Matched</dt>
            <dd>{eff.matched_rule ? <code>{eff.matched_rule.path}</code> : 'no rule (root config)'}</dd>
            <dt>Policy</dt>
            <dd>
              {eff.policy} <small>{inherited(eff.policy_source)}</small>
            </dd>
            <dt>Radius</dt>
            <dd>
              {km(eff.radius_km)} <small>{inherited(eff.radius_source)}</small>
              {eff.radius_km !== null && !output.user.radius_applied ? <small> · not applied (user location unknown)</small> : null}
            </dd>
            <dt>Fallback</dt>
            <dd>
              {eff.fallback} <small>{inherited(eff.fallback_source)}</small>
            </dd>
            <dt>Backends</dt>
            <dd>
              {eff.backends.join(', ') || 'none'} <small>{inherited(eff.backends_source)}</small>
            </dd>
            {eff.advanced_overrides.length > 0 ? (
              <>
                <dt>Rule overrides</dt>
                <dd>{eff.advanced_overrides.join(', ')}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="info-block">
          <h3>Carbon</h3>
          <dl className="kv">
            <dt>Provider</dt>
            <dd>{providerName(source)}</dd>
            <dt>Signal source</dt>
            <dd>{SOURCE_TEXT[source]}</dd>
            <dt>Signal age</dt>
            <dd>
              {signalAgeSeconds} s <small>(max {maxAgeSeconds} s)</small>
            </dd>
            <dt>Needed</dt>
            <dd>{output.needs_carbon ? 'yes, the policy weights carbon' : 'no, lookup skipped for this policy'}</dd>
            {output.needs_carbon ? (
              <>
                <dt>Saved vs worst</dt>
                <dd>
                  {output.carbon_saved_vs_worst_g_per_kwh.toFixed(0)} gCO2/kWh{' '}
                  <small>({output.carbon_saved_vs_worst_percent.toFixed(1)}%)</small>
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      </div>

      <section className="info-block">
        <h3>Candidates</h3>
        <div className="table-scroll">
          <table className="candidate-table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Distance</th>
                <th>Latency</th>
                <th>Carbon</th>
                {view === 'research' ? <th>Score</th> : null}
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const status = displayStatus(c, output);
                return (
                  <tr key={c.backend_id} className={`row-${status}`}>
                    <td>
                      <strong>{c.backend_id}</strong>
                      <small className="cell-sub">{c.region}</small>
                    </td>
                    <td>{c.distance_km !== undefined ? km(c.distance_km) : 'unknown'}</td>
                    <td title={LATENCY_TEXT[c.latency_source]}>
                      {c.latency_ms.toFixed(0)} ms
                      {view === 'research' ? <small> {LATENCY_TEXT[c.latency_source]}</small> : null}
                    </td>
                    <td>
                      {carbonText(c)}
                      {view === 'research' && c.carbon.age_seconds !== undefined ? (
                        <small>
                          {' '}
                          {c.carbon.status} · {c.carbon.age_seconds}s
                        </small>
                      ) : null}
                    </td>
                    {view === 'research' ? <td>{c.score ? c.score.total.toFixed(3) : '—'}</td> : null}
                    <td>
                      <span className={`status-pill status-pill-${status}`}>
                        {status === 'rejected' ? eligibilityText(c) : status === 'eligible' ? 'eligible' : status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <ul className="reason-list">
          {candidates
            .filter((c) => c.rejections.length > 0)
            .map((c) => (
              <li key={c.backend_id}>
                <strong>{c.backend_id}</strong>
                {c.status === 'fallback' ? ' (chosen by fallback)' : ''}:{' '}
                {c.rejections.map((r) => `${REJECTION_LABELS[r.kind] ?? r.kind}: ${r.detail}`).join('; ')}
              </li>
            ))}
        </ul>
      </section>

      {view === 'research' ? <ResearchDetails output={output} selected={selected} signals={signals} /> : null}
    </>
  );
}

function ResearchDetails({
  output,
  selected,
  signals
}: {
  output: DecisionOutput;
  selected: CandidateEvaluation | null;
  signals: CarbonSignal[];
}) {
  const w = output.weights;
  return (
    <>
      <section className="info-block">
        <h3>Score breakdown{selected ? `: ${selected.backend_id}` : ''}</h3>
        <p className="helper-text">
          Weights used: carbon {w.carbon.toFixed(2)} · latency {w.latency.toFixed(2)} · reliability {w.reliability.toFixed(2)} ·
          cost {w.cost.toFixed(2)}. Each metric is divided by the maximum among eligible candidates; lower totals win.
        </p>
        {selected?.score ? (
          <div className="metric-grid">
            {(['carbon', 'latency', 'reliability', 'cost'] as const).map((key) => (
              <article key={key} className="metric-card">
                <span>{key}</span>
                <strong>{selected.score!.weighted[key].toFixed(3)}</strong>
                <small>normalized {selected.score!.normalized[key].toFixed(3)}</small>
              </article>
            ))}
            <article className="metric-card total-score-box">
              <span>Total</span>
              <strong>{selected.score.total.toFixed(3)}</strong>
            </article>
          </div>
        ) : (
          <p className="helper-text">
            {selected ? 'Chosen by the fallback strategy, so it has no score.' : 'No backend selected.'}
          </p>
        )}
      </section>

      <section className="info-block">
        <h3>Decision trace</h3>
        <ol className="trace-list">
          <li>
            Path <code>{output.path}</code> resolved to{' '}
            {output.effective.matched_rule ? <code>{output.effective.matched_rule.path}</code> : 'the root config'} (route class{' '}
            {output.effective.advanced.route_class}).
          </li>
          <li>
            User location: {output.user.location_source === 'unknown' ? 'unknown' : `${output.user.region ?? 'coordinates'} (${output.user.location_source})`}.
          </li>
          <li>
            {output.candidates.filter((c) => c.rejections.length === 0).length} of {output.candidates.length} candidates passed
            radius, health, capacity, latency and carbon checks.
          </li>
          <li>{output.reason.message}</li>
          {output.defer_seconds > 0 ? <li>The request may wait up to {output.defer_seconds}s for a greener window.</li> : null}
        </ol>
      </section>

      <details className="info-block">
        <summary>Carbon signals sent to rilot-core (normalized JSON)</summary>
        <pre className="code-block">{JSON.stringify({ signals }, null, 2)}</pre>
      </details>
    </>
  );
}
