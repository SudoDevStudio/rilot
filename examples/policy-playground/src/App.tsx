import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  computeDecision,
  type Candidate,
  type DecisionCandidate,
  type DecisionInput,
  type GeoPolicy,
  type RequestClass
} from './model/decision';
import { clonePresetState, presets } from './model/presets';

type ThemeMode = 'day' | 'night';

type RangeFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  inputStep?: number;
  suffix?: string;
  decimals?: number;
};

function clampToRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueRegions(candidates: Candidate[], currentRegion: string | null): string[] {
  const set = new Set(candidates.map((candidate) => candidate.region));
  if (currentRegion) {
    set.add(currentRegion);
  }
  return Array.from(set);
}

function describeFinalStep(step: string): string {
  switch (step) {
    case 'scored':
      return 'Weighted winner';
    case 'hysteresis':
      return 'Sticky winner';
    case 'fallback-local':
      return 'Fail-safe local';
    default:
      return 'No selection';
  }
}

function candidatePriority(candidate: DecisionCandidate): number {
  if (candidate.status === 'selected' || candidate.status === 'sticky-selected' || candidate.status === 'fallback') {
    return 0;
  }
  if (candidate.status === 'accepted') {
    return 1;
  }
  return 2;
}

function RangeField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  inputStep,
  suffix,
  decimals = 0
}: RangeFieldProps) {
  const display = `${value.toFixed(decimals)}${suffix ? ` ${suffix}` : ''}`;
  const normalizedValue = clampToRange(value, min, max);
  const progress = max === min ? 0 : ((normalizedValue - min) / (max - min)) * 100;
  const rangeStyle = {
    ['--range-progress' as string]: `${progress}%`
  } as CSSProperties;

  return (
    <div className="range-control">
      <div className="range-header">
        <span className="range-title">
          {label}: <strong>{display}</strong>
        </span>
      </div>
      <div className="range-input-row">
        <input
          className="range-slider"
          type="range"
          min={min}
          max={max}
          step={step}
          value={normalizedValue}
          style={rangeStyle}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="number-input"
          type="number"
          min={min}
          max={max}
          step={inputStep ?? step}
          value={normalizedValue}
          onChange={(event) => {
            const nextValue = Number(event.target.value);
            if (Number.isFinite(nextValue)) {
              onChange(clampToRange(nextValue, min, max));
            }
          }}
        />
      </div>
    </div>
  );
}

function App() {
  const [state, setState] = useState<DecisionInput>(() => clonePresetState(presets[0].id));
  const [activePresetId, setActivePresetId] = useState(presets[0].id);
  const [theme, setTheme] = useState<ThemeMode>('day');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const result = useMemo(() => computeDecision(state), [state]);
  const regions = uniqueRegions(state.candidates, state.activeRegion);
  const chosen = result.candidates.find((candidate) => candidate.id === result.selectedCandidateId) ?? null;
  const localBaseline = result.candidates.find((candidate) => candidate.id === result.localBaselineId) ?? null;
  const acceptedCount = result.candidates.filter((candidate) => candidate.accepted).length;
  const rejectedCount = result.candidates.length - acceptedCount;
  const activePresetLabel = presets.find((preset) => preset.id === activePresetId)?.label ?? 'Custom state';

  const displayedCandidates = useMemo(
    () =>
      [...result.candidates].sort(
        (a, b) => candidatePriority(a) - candidatePriority(b) || a.totalScore - b.totalScore || a.label.localeCompare(b.label)
      ),
    [result.candidates]
  );
  const latencyMax = Math.max(...result.candidates.map((candidate) => candidate.latencyMs), 1);
  const carbonMax = Math.max(...result.candidates.map((candidate) => candidate.carbonIntensity), 1);
  const scoreMax = Math.max(...result.candidates.map((candidate) => candidate.totalScore), 0.001);

  const updateState = <K extends keyof DecisionInput>(key: K, value: DecisionInput[K]) => {
    setState((current) => ({ ...current, [key]: value }));
  };

  const applyPreset = (presetId: string) => {
    setActivePresetId(presetId);
    setState(clonePresetState(presetId));
  };

  const updateWeights = (key: keyof DecisionInput['weights'], value: number) => {
    setState((current) => ({
      ...current,
      weights: { ...current.weights, [key]: value }
    }));
  };

  const updateGuardrail = (key: keyof DecisionInput['guardrails'], value: number | boolean) => {
    setState((current) => ({
      ...current,
      guardrails: { ...current.guardrails, [key]: value }
    }));
  };

  const updateCandidate = (id: string, patch: Partial<Candidate>) => {
    setState((current) => ({
      ...current,
      candidates: current.candidates.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate))
    }));
  };

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <div className="hero-toolbar">
            <p className="eyebrow">Rilot Research Companion</p>
            <div className="theme-toggle" aria-label="Theme toggle">
              <button
                className={theme === 'day' ? 'theme-button is-active' : 'theme-button'}
                onClick={() => setTheme('day')}
                type="button"
              >
                Day
              </button>
              <button
                className={theme === 'night' ? 'theme-button is-active' : 'theme-button'}
                onClick={() => setTheme('night')}
                type="button"
              >
                Night
              </button>
            </div>
          </div>
          <h1>Policy Playground</h1>
          <p className="hero-copy">
            This simulator recomputes the routing choice on every input change so you can inspect exactly what got
            accepted, what got rejected, and why a region ultimately won.
          </p>

          <div className="trace-strip">
            <article className="trace-card">
              <span>Local baseline</span>
              <strong>{result.localBaselineLabel ?? 'None'}</strong>
            </article>
            <article className="trace-card">
              <span>Active region</span>
              <strong>{state.activeRegion ?? 'none'}</strong>
            </article>
            <article className="trace-card">
              <span>Accepted candidates</span>
              <strong>{acceptedCount}</strong>
            </article>
            <article className="trace-card">
              <span>Rejected candidates</span>
              <strong>{rejectedCount}</strong>
            </article>
          </div>
        </div>

        <div className="hero-card winner-card">
          <div className="hero-card-label">Current outcome</div>
          <div className="winner-badges">
            <span className="winner-pill winner-step">{describeFinalStep(result.finalStep)}</span>
            <span className="winner-pill winner-policy">{state.geoPolicy}</span>
          </div>
          <div className="hero-card-value">{result.selectedLabel ?? 'No selection'}</div>
          <div className="hero-card-meta">{result.selectedRegion ?? 'No region selected'}</div>
          <p className="hero-card-reason">{result.selectedReason}</p>

          <div className="winner-stats">
            <div>
              <span>Request class</span>
              <strong>{state.requestClass}</strong>
            </div>
            <div>
              <span>User region</span>
              <strong>{state.userRegion}</strong>
            </div>
            <div>
              <span>Active preset</span>
              <strong>{presets.find((preset) => preset.id === activePresetId)?.label ?? 'Custom state'}</strong>
            </div>
          </div>
        </div>
      </header>

      <div className="layout-grid">
        <section className="panel controls-panel">
          <div className="section-heading">
            <div>
              <span className="section-chip request-chip">Request</span>
              <h2>1. Request setup</h2>
              <p className="panel-copy">
                This is what you send into the simulator: the request context, the policy stance, and the guardrails that limit what routing is allowed to do.
              </p>
            </div>
          </div>

          <div className="summary-grid request-summary-grid">
            <article className="summary-card request-summary-card">
              <span>Request class</span>
              <strong>{state.requestClass}</strong>
            </article>
            <article className="summary-card request-summary-card">
              <span>User region</span>
              <strong>{state.userRegion}</strong>
            </article>
            <article className="summary-card request-summary-card">
              <span>Active region</span>
              <strong>{state.activeRegion ?? 'none'}</strong>
            </article>
            <article className="summary-card request-summary-card">
              <span>Preset</span>
              <strong>{activePresetLabel}</strong>
            </article>
          </div>

          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                key={preset.id}
                className={preset.id === activePresetId ? 'preset-button is-active' : 'preset-button'}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
                <span className="preset-hover-hint">Hover for detailed notes</span>
                <div className="preset-tooltip" role="note" aria-label={`${preset.label} notes`}>
                  <strong>Detailed notes</strong>
                  <ul>
                    {preset.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
              </button>
            ))}
          </div>

          <div className="control-section">
            <h3>Context</h3>
            <div className="control-group">
              <label>
                Request class
                <select value={state.requestClass} onChange={(event) => updateState('requestClass', event.target.value as RequestClass)}>
                  <option value="interactive">interactive</option>
                  <option value="standard">standard</option>
                  <option value="background">background</option>
                </select>
              </label>
              <label>
                User region
                <select value={state.userRegion} onChange={(event) => updateState('userRegion', event.target.value)}>
                  {regions.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Current active region
                <select value={state.activeRegion ?? ''} onChange={(event) => updateState('activeRegion', event.target.value || null)}>
                  <option value="">none</option>
                  {regions.map((region) => (
                    <option key={region} value={region}>
                      {region}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Geo policy
                <select value={state.geoPolicy} onChange={(event) => updateState('geoPolicy', event.target.value as GeoPolicy)}>
                  <option value="local-only">local-only</option>
                  <option value="prefer-local">prefer-local</option>
                  <option value="global">global</option>
                </select>
              </label>
            </div>
          </div>

          <div className="control-section">
            <h3>Policy weights</h3>
            <p className="helper-text">
              Weights are relative. You can type exact numbers here, and the simulator will normalize them before scoring.
            </p>
            <div className="slider-grid">
              {([
                ['carbon', 'Carbon weight'],
                ['latency', 'Latency weight'],
                ['reliability', 'Reliability weight'],
                ['cost', 'Cost weight']
              ] as const).map(([key, label]) => (
                <RangeField
                  key={key}
                  label={label}
                  value={state.weights[key]}
                  onChange={(value) => updateWeights(key, value)}
                  min={0}
                  max={250}
                  step={1}
                />
              ))}
            </div>
          </div>

          <div className="control-section">
            <h3>Guardrails</h3>
            <p className="helper-text">Drag for quick exploration or type an exact value when you want a sharper before/after comparison.</p>
            <div className="slider-grid">
              <RangeField
                label="Max latency delta"
                value={state.guardrails.maxLatencyDeltaMs}
                onChange={(value) => updateGuardrail('maxLatencyDeltaMs', value)}
                min={0}
                max={300}
                step={1}
                suffix="ms"
              />
              <RangeField
                label="Hard max latency"
                value={state.guardrails.hardMaxLatencyMs}
                onChange={(value) => updateGuardrail('hardMaxLatencyMs', value)}
                min={20}
                max={500}
                step={1}
                suffix="ms"
              />
              <RangeField
                label="Min carbon benefit"
                value={state.guardrails.minCarbonBenefit}
                onChange={(value) => updateGuardrail('minCarbonBenefit', value)}
                min={0}
                max={300}
                step={1}
                suffix="gCO2/kWh"
              />
              <RangeField
                label="Hysteresis threshold"
                value={state.guardrails.hysteresisThreshold}
                onChange={(value) => updateGuardrail('hysteresisThreshold', value)}
                min={0}
                max={0.5}
                step={0.01}
                inputStep={0.01}
                decimals={2}
              />
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={state.guardrails.failSafeToLocal}
                  onChange={(event) => updateGuardrail('failSafeToLocal', event.target.checked)}
                />
                <span>Fail-safe to local baseline</span>
              </label>
            </div>
          </div>
        </section>

        <section className="panel output-panel">
          <div className="section-heading">
            <div>
              <span className="section-chip response-chip">Response</span>
              <h2>2. Routing response</h2>
              <p className="panel-copy">
                This is what the decision engine returns from those same inputs: who won, who got rejected, and whether the result came from scoring, hysteresis, or fail-safe behavior.
              </p>
            </div>
          </div>

          <div className="response-banner">
            <div>
              <span>Current routing answer</span>
              <strong>{chosen ? `${chosen.label} (${chosen.region})` : 'No region selected'}</strong>
            </div>
            <p>
              {chosen
                ? `${chosen.label} is serving the request right now.`
                : 'No candidate cleared the current rules, so nothing is selected.'}
            </p>
          </div>

          <div className="candidate-visual-panel">
            <div className="section-heading compact-heading">
              <div>
                <h3>Live candidate comparison</h3>
                <p className="panel-copy">
                  Change any number on the left and these bars update immediately so you can see who is faster, cleaner, and lower-scoring.
                </p>
              </div>
            </div>

            <div className="candidate-visual-list">
              {displayedCandidates.map((candidate) => {
                const latencyWidth = `${(candidate.latencyMs / latencyMax) * 100}%`;
                const carbonWidth = `${(candidate.carbonIntensity / carbonMax) * 100}%`;
                const scoreWidth = `${(candidate.totalScore / scoreMax) * 100}%`;

                return (
                  <article key={`visual-${candidate.id}`} className={`candidate-visual-card status-${candidate.status}`}>
                    <div className="candidate-visual-head">
                      <div>
                        <strong>{candidate.label}</strong>
                        <span>
                          {candidate.region}
                          {candidate.isLocalBaseline ? ' · local baseline' : ''}
                        </span>
                      </div>
                      <span className={`status-pill status-pill-${candidate.status}`}>{candidate.status}</span>
                    </div>

                    <div className="visual-metric-stack">
                      <div className="visual-metric-row">
                        <span>Latency</span>
                        <div className="visual-bar-track">
                          <div className="visual-bar-fill visual-latency" style={{ width: latencyWidth }} />
                        </div>
                        <strong>{candidate.latencyMs.toFixed(1)} ms</strong>
                      </div>
                      <div className="visual-metric-row">
                        <span>Carbon</span>
                        <div className="visual-bar-track">
                          <div className="visual-bar-fill visual-carbon" style={{ width: carbonWidth }} />
                        </div>
                        <strong>{candidate.carbonIntensity.toFixed(1)} gCO2/kWh</strong>
                      </div>
                      <div className="visual-metric-row">
                        <span>Score</span>
                        <div className="visual-bar-track">
                          <div className="visual-bar-fill visual-score" style={{ width: scoreWidth }} />
                        </div>
                        <strong>{candidate.totalScore.toFixed(3)}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <div className="summary-grid">
            <article className="summary-card">
              <span>Local baseline</span>
              <strong>{result.localBaselineLabel ?? 'None'}</strong>
            </article>
            <article className="summary-card">
              <span>Selected region</span>
              <strong>{result.selectedRegion ?? 'None'}</strong>
            </article>
            <article className="summary-card">
              <span>Final step</span>
              <strong>{describeFinalStep(result.finalStep)}</strong>
            </article>
            <article className="summary-card">
              <span>Normalized weights</span>
              <strong>
                C {result.normalizedWeights.carbon.toFixed(2)} / L {result.normalizedWeights.latency.toFixed(2)} / R{' '}
                {result.normalizedWeights.reliability.toFixed(2)} / $ {result.normalizedWeights.cost.toFixed(2)}
              </strong>
            </article>
          </div>

          <div className="decision-trace">
            <h3>Decision trace</h3>
            <ol>
              <li>Local baseline: {localBaseline ? `${localBaseline.label} at ${localBaseline.latencyMs.toFixed(1)} ms` : 'no local baseline found'}.</li>
              <li>{acceptedCount} candidate(s) stayed inside the current geo policy and guardrails.</li>
              <li>{rejectedCount} candidate(s) were filtered out before final scoring.</li>
              <li>{result.selectedReason}</li>
            </ol>
          </div>

          {chosen ? (
            <div className="chosen-breakdown">
              <div className="chosen-header">
                <div>
                  <h3>Chosen candidate score breakdown</h3>
                  <p>{chosen.label} is currently carrying the response for this request setup.</p>
                </div>
                <span className={`status-pill status-pill-${chosen.status}`}>{chosen.status}</span>
              </div>

              <div className="metric-grid">
                <article className="metric-card">
                  <span>Carbon</span>
                  <strong>{chosen.carbonIntensity.toFixed(1)} gCO2/kWh</strong>
                  <small>
                    Weighted {chosen.weighted.carbon.toFixed(3)} from normalized {chosen.normalized.carbon.toFixed(3)}
                  </small>
                </article>
                <article className="metric-card">
                  <span>Latency</span>
                  <strong>{chosen.latencyMs.toFixed(1)} ms</strong>
                  <small>
                    Weighted {chosen.weighted.latency.toFixed(3)} from normalized {chosen.normalized.latency.toFixed(3)}
                  </small>
                </article>
                <article className="metric-card">
                  <span>Reliability risk</span>
                  <strong>{chosen.reliabilityRisk.toFixed(1)}</strong>
                  <small>
                    Weighted {chosen.weighted.reliability.toFixed(3)} from normalized {chosen.normalized.reliability.toFixed(3)}
                  </small>
                </article>
                <article className="metric-card">
                  <span>Cost</span>
                  <strong>{chosen.cost.toFixed(2)}</strong>
                  <small>
                    Weighted {chosen.weighted.cost.toFixed(3)} from normalized {chosen.normalized.cost.toFixed(3)}
                  </small>
                </article>
              </div>

              <div className="total-score-box">
                <span>Total score</span>
                <strong>{chosen.totalScore.toFixed(3)}</strong>
              </div>
            </div>
          ) : (
            <div className="chosen-breakdown empty-state">No candidate is selected under the current inputs.</div>
          )}
        </section>
      </div>

      <section className="panel candidates-panel">
        <div className="panel-header">
          <div>
            <span className="section-chip audit-chip">Candidates</span>
            <h2>3. Candidate details</h2>
            <p className="panel-copy">
              The selected candidate stays at the top, followed by other valid options and then rejected ones with exact reasons.
            </p>
          </div>
        </div>

        <div className="candidate-grid">
          {displayedCandidates.map((candidate) => (
            <article key={candidate.id} className={`candidate-card status-${candidate.status}`}>
              <div className="candidate-topline">
                <div>
                  <input
                    className="candidate-label-input"
                    value={candidate.label}
                    onChange={(event) => updateCandidate(candidate.id, { label: event.target.value })}
                  />
                  <div className="candidate-meta">
                    {candidate.region}
                    {candidate.isLocalBaseline ? ' · local baseline' : ''}
                    {state.activeRegion === candidate.region ? ' · active region' : ''}
                  </div>
                </div>
                <span className={`status-pill status-pill-${candidate.status}`}>{candidate.status}</span>
              </div>

              <div className="candidate-editor-grid">
                <label>
                  Region
                  <input value={candidate.region} onChange={(event) => updateCandidate(candidate.id, { region: event.target.value })} />
                </label>
                <label>
                  Latency (ms)
                  <input
                    type="number"
                    value={candidate.latencyMs}
                    onChange={(event) => updateCandidate(candidate.id, { latencyMs: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Carbon (gCO2/kWh)
                  <input
                    type="number"
                    value={candidate.carbonIntensity}
                    onChange={(event) => updateCandidate(candidate.id, { carbonIntensity: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Reliability risk
                  <input
                    type="number"
                    step="0.1"
                    value={candidate.reliabilityRisk}
                    onChange={(event) => updateCandidate(candidate.id, { reliabilityRisk: Number(event.target.value) })}
                  />
                </label>
                <label>
                  Cost
                  <input
                    type="number"
                    step="0.01"
                    value={candidate.cost}
                    onChange={(event) => updateCandidate(candidate.id, { cost: Number(event.target.value) })}
                  />
                </label>
                <label className="checkbox-row compact">
                  <input
                    type="checkbox"
                    checked={candidate.enabled}
                    onChange={(event) => updateCandidate(candidate.id, { enabled: event.target.checked })}
                  />
                  <span>Enabled</span>
                </label>
              </div>

              <div className="candidate-kpis">
                <div>
                  <span>Latency delta</span>
                  <strong>{candidate.latencyDeltaVsLocal.toFixed(1)} ms</strong>
                </div>
                <div>
                  <span>Carbon benefit</span>
                  <strong>{candidate.carbonBenefitVsLocal.toFixed(1)} gCO2/kWh</strong>
                </div>
                <div>
                  <span>Total score</span>
                  <strong>{candidate.totalScore.toFixed(3)}</strong>
                </div>
              </div>

              {candidate.id === result.selectedCandidateId ? (
                <div className="reason-box chosen-box">
                  <strong>Selected now</strong>
                  <ul>
                    <li>{result.selectedReason}</li>
                    <li>Carbon contribution: {candidate.weighted.carbon.toFixed(3)}</li>
                    <li>Latency contribution: {candidate.weighted.latency.toFixed(3)}</li>
                    <li>Reliability contribution: {candidate.weighted.reliability.toFixed(3)}</li>
                    <li>Cost contribution: {candidate.weighted.cost.toFixed(3)}</li>
                  </ul>
                </div>
              ) : candidate.rejectionReasons.length > 0 ? (
                <div className="reason-box reject-box">
                  <strong>Rejected because</strong>
                  <ul>
                    {candidate.rejectionReasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div className="reason-box accept-box">
                  <strong>Accepted but not selected</strong>
                  <p>This candidate passed all filters, but another option finished with a lower weighted score.</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default App;
