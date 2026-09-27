import { useEffect, useState } from 'react';
import type { CandidateEvaluation } from '@rilot/core-js';
import { BACKENDS, type City } from '../../rilot/config';
import type { Trace } from '../../rilot/request';

const REASON_TEXT: Record<string, string> = {
  'score-win': 'best weighted score',
  'lowest-latency': 'closest healthy backend',
  'hysteresis-sticky-zone': 'kept the current backend',
  'deferred-for-greener-window': 'waiting for a greener window',
  'fallback-nearest': 'fallback: nearest backend',
  'fallback-lowest-latency': 'fallback: fastest backend',
  'no-eligible-backend': 'nothing could serve this',
  'no-backends': 'no backends configured'
};

const REJECTION_TEXT: Record<string, string> = {
  'outside-radius': 'too far',
  'carbon-unavailable': 'no carbon data',
  'latency-constraint': 'too slow',
  'health-constraint': 'unhealthy',
  'capacity-constraint': 'at capacity',
  'region-constraint': 'wrong region',
  'candidate-limit': 'not considered',
  'insufficient-carbon-benefit': 'not cleaner enough'
};

const STEP_COUNT = 5;

export function FlowPanel({
  trace,
  city,
  totals,
  live
}: {
  trace: Trace | null;
  city: City;
  totals: Totals;
  /** Set when a real carbon API answered, so the panel can say so. */
  live?: { endpoint: string } | null;
}) {
  const revealed = useReveal(trace?.id ?? 0);

  if (!trace) {
    return (
      <div className="flow-empty">
        <p>Click around the shop. Every request is routed here, live.</p>
      </div>
    );
  }

  const { decision } = trace;
  const eff = decision.effective;
  const selected = decision.candidates.find((c) => c.backend_id === decision.selected_backend_id) ?? null;
  const step = (n: number) => (revealed >= n ? 'flow-step is-in' : 'flow-step');

  return (
    <div className="flow">
      <ol className="flow-steps">
        <li className={step(1)}>
          <Marker n={1} />
          <div>
            <h3>Request</h3>
            <p className="flow-headline">
              <span className="method">{trace.request.method}</span> <code>{trace.request.path}</code>
            </p>
            <p className="muted">
              {trace.request.label} · shopper in {city.label}
            </p>
          </div>
        </li>

        <li className={step(2)}>
          <Marker n={2} />
          <div>
            <h3>Rule</h3>
            <p className="flow-headline">
              {eff.matched_rule ? <code>{eff.matched_rule.path}</code> : <span className="muted">no rule → root config</span>}
            </p>
            <div className="chips">
              <Chip label="policy" value={eff.policy} source={eff.policy_source} />
              <Chip
                label="radius"
                value={eff.radius_km === null ? 'unlimited' : `${eff.radius_km} km`}
                source={eff.radius_source}
              />
              <Chip label="fallback" value={eff.fallback} source={eff.fallback_source} />
            </div>
          </div>
        </li>

        <li className={step(3)}>
          <Marker n={3} />
          <div>
            <h3>Carbon</h3>
            {decision.needs_carbon ? (
              <>
                <p className="flow-headline">Asked for {trace.signals.length} region(s)</p>
                <p className="muted small">
                  {live ? (
                    <>
                      live from <code>{live.endpoint}</code>
                    </>
                  ) : (
                    'simulated in your browser from the grid clock'
                  )}
                </p>
                <ul className="signal-list">
                  {trace.signals.map((signal) => (
                    <li key={signal.region}>
                      <code>{signal.region}</code>
                      <span className="intensity">{Math.round(signal.carbon_g_per_kwh)} g</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="flow-headline muted">
                Skipped — the <strong>{eff.policy}</strong> policy does not use carbon.
              </p>
            )}
          </div>
        </li>

        <li className={step(4)}>
          <Marker n={4} />
          <div>
            <h3>Candidates</h3>
            <p className="legend">
              <span>latency</span>
              <span>carbon</span>
              <span>distance</span>
            </p>
            <ul className="candidate-list">
              {[...decision.candidates]
                .sort((a, b) => rank(a, decision.selected_backend_id) - rank(b, decision.selected_backend_id))
                .map((candidate) => (
                  <Candidate
                    key={candidate.backend_id}
                    candidate={candidate}
                    isSelected={candidate.backend_id === decision.selected_backend_id}
                  />
                ))}
            </ul>
          </div>
        </li>

        <li className={`${step(5)} flow-decision`}>
          <Marker n={5} done />
          <div>
            <h3>Decision</h3>
            {selected ? (
              <>
                <p className="flow-headline">
                  → <strong>{selected.backend_id}</strong>{' '}
                  <span className="muted">{BACKENDS[selected.backend_id]?.city}</span>
                </p>
                <p className="reason">{REASON_TEXT[decision.reason.code] ?? decision.reason.code}</p>
                {decision.fallback_used ? (
                  <p className="muted small">No backend passed every check, so the configured fallback picked one.</p>
                ) : null}
                <div className="result-row">
                  <span>
                    <strong>{trace.latencyMs} ms</strong> round trip
                  </span>
                  {selected.carbon.used_g_per_kwh !== undefined ? (
                    <span>
                      <strong>{Math.round(selected.carbon.used_g_per_kwh)} g/kWh</strong> grid
                    </span>
                  ) : null}
                  {trace.savedMg > 0 ? (
                    <span className="saved">−{trace.savedMg.toFixed(3)} mg CO₂e vs worst</span>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="reason">{decision.reason.message}</p>
            )}
          </div>
        </li>
      </ol>

      <div className="totals">
        <div>
          <span>Requests</span>
          <strong>{totals.requests}</strong>
        </div>
        <div>
          <span>CO₂e avoided</span>
          <strong>{totals.savedMg.toFixed(2)} mg</strong>
        </div>
        <div>
          <span>Avg. latency</span>
          <strong>{totals.requests ? Math.round(totals.latencyMs / totals.requests) : 0} ms</strong>
        </div>
      </div>
    </div>
  );
}

export type Totals = { requests: number; savedMg: number; latencyMs: number };

function rank(candidate: CandidateEvaluation, selectedId: string | null): number {
  if (candidate.backend_id === selectedId) return 0;
  return candidate.rejections.length === 0 ? 1 : 2;
}

function Candidate({ candidate, isSelected }: { candidate: CandidateEvaluation; isSelected: boolean }) {
  const rejection = candidate.rejections[0];
  const state = isSelected ? 'selected' : rejection ? 'rejected' : 'eligible';
  const carbon = candidate.carbon.used_g_per_kwh;
  return (
    <li className={`candidate is-${state}`}>
      <span className="candidate-name">
        <strong>{candidate.backend_id}</strong>
        <small>{BACKENDS[candidate.backend_id]?.city}</small>
      </span>
      <span className="candidate-stats">
        <span>{Math.round(candidate.latency_ms)} ms</span>
        <span>{carbon === undefined ? '—' : `${Math.round(carbon)} g`}</span>
        {candidate.distance_km !== undefined ? <span>{Math.round(candidate.distance_km)} km</span> : null}
      </span>
      <span className={`candidate-verdict is-${state}`}>
        {isSelected ? 'selected' : rejection ? (REJECTION_TEXT[rejection.kind] ?? rejection.kind) : 'eligible'}
      </span>
    </li>
  );
}

const SOURCE_TEXT: Record<string, string> = {
  rule: 'from rule',
  root: 'inherited',
  default: 'default',
  request: 'from your session'
};

function Chip({ label, value, source }: { label: string; value: string; source: string }) {
  const highlight = source === 'rule' || source === 'request';
  return (
    <span className={`chip ${highlight ? 'chip-rule' : ''}`}>
      {label}: <strong>{value}</strong>
      <small>{SOURCE_TEXT[source] ?? source}</small>
    </span>
  );
}

function Marker({ n, done }: { n: number; done?: boolean }) {
  return <span className={done ? 'marker is-done' : 'marker'}>{done ? '✓' : n}</span>;
}

/** Reveals the steps one at a time whenever a new request arrives. */
function useReveal(traceId: number): number {
  const [revealed, setRevealed] = useState(STEP_COUNT);

  useEffect(() => {
    if (!traceId) return;
    setRevealed(0);
    const timers = Array.from({ length: STEP_COUNT }, (_, index) =>
      setTimeout(() => setRevealed(index + 1), 90 * (index + 1))
    );
    return () => timers.forEach(clearTimeout);
  }, [traceId]);

  return revealed;
}
