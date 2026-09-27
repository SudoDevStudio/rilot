import { useEffect, useMemo, useState } from 'react';
import { ConfigEditor } from './components/ConfigEditor';
import { DecisionPanel, REASON_LABELS } from './components/DecisionPanel';
import { OptionalRange, RangeField, SelectField } from './components/fields';
import { ResearchControls } from './components/ResearchControls';
import { clonePresetState, presets, type PresetGroup } from './model/presets';
import type { PlaygroundState, ViewMode } from './model/ui-types';
import { buildDecisionInput, runDecision } from './rilot/config';
import type { Backend, Fallback, Policy, RoutingConfig } from '@rilot/core-js';
import { loadRilotEngine, type RilotEngine } from './rilot/wasm';

type ThemeMode = 'day' | 'night';

const COMMON_REGIONS = [
  'us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'ca-central-1', 'sa-east-1',
  'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-central-1', 'eu-north-1',
  'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1',
  'us-central1', 'europe-west4', 'eastus', 'westeurope'
];

function readStoredView(): ViewMode {
  try {
    return localStorage.getItem('rilot-playground-view') === 'research' ? 'research' : 'normal';
  } catch {
    return 'normal';
  }
}

function validBackends(config: RoutingConfig): Backend[] {
  return Array.isArray(config.backends)
    ? config.backends.filter((b): b is Backend => !!b && typeof b.id === 'string' && typeof b.region === 'string')
    : [];
}

function Toggle<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly [T, string][];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="theme-toggle" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          className={value === option ? 'theme-button is-active' : 'theme-button'}
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          type="button"
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function App() {
  const [state, setState] = useState<PlaygroundState>(() => clonePresetState('checkout'));
  const [activePresetId, setActivePresetId] = useState<string | null>('checkout');
  const [view, setView] = useState<ViewMode>(readStoredView);
  const [theme, setTheme] = useState<ThemeMode>('day');
  const [engine, setEngine] = useState<RilotEngine | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem('rilot-playground-view', view);
    } catch {
      // Storage unavailable (private mode); the view simply isn't remembered.
    }
  }, [view]);

  useEffect(() => {
    loadRilotEngine()
      .then(setEngine)
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  const result = useMemo(() => (engine ? runDecision(engine, buildDecisionInput(state)) : null), [engine, state]);
  const output = result?.ok ? result.value : null;
  const backends = validBackends(state.config);

  const edit = (update: (current: PlaygroundState) => PlaygroundState) => {
    setActivePresetId(null);
    setState(update);
  };
  const setRoot = <K extends keyof RoutingConfig>(key: K, value: RoutingConfig[K]) =>
    edit((current) => {
      const config = { ...current.config };
      if (value === undefined) delete config[key];
      else config[key] = value;
      return { ...current, config };
    });
  const applyPreset = (id: string) => {
    setActivePresetId(id);
    setState(clonePresetState(id));
  };

  const presetGroups: [PresetGroup, string][] =
    view === 'research' ? [['production', 'Production examples'], ['research', 'Research scenarios']] : [['production', 'Examples']];

  return (
    <div className="page-shell">
      <header className="hero">
        <div>
          <div className="hero-toolbar">
            <p className="eyebrow">Rilot Policy Playground</p>
            <div className="toolbar-group">
              <Toggle label="View" value={view} onChange={setView} options={[['normal', 'Normal'], ['research', 'Research / Advanced']]} />
              <Toggle label="Theme" value={theme} onChange={setTheme} options={[['day', 'Day'], ['night', 'Night']]} />
            </div>
          </div>
          <h1>Policy Playground</h1>
          <p className="hero-copy">
            An interactive visualization of <strong>rilot-core</strong>, the same Rust routing engine used by native Rilot and edge
            adapters, running here as WebAssembly{engine ? ` (v${engine.version})` : ''}. Carbon data is simulated; no API keys are
            used.
          </p>
        </div>

        <div className="hero-card winner-card" aria-live="polite">
          <div className="hero-card-label">Decision</div>
          {output ? (
            <>
              <div className="winner-badges">
                <span className="winner-pill winner-step">{REASON_LABELS[output.reason.code] ?? output.reason.code}</span>
                <span className="winner-pill winner-policy">{output.effective.policy}</span>
              </div>
              <div className="hero-card-value">{output.selected_backend_id ?? 'No selection'}</div>
              <div className="hero-card-meta">{output.selected_region ?? '—'}</div>
              <p className="hero-card-reason">{output.reason.message}</p>
            </>
          ) : (
            <p className="hero-card-reason">
              {loadError
                ? `The routing engine could not be loaded: ${loadError}`
                : result && !result.ok
                  ? result.error
                  : 'Loading the rilot-core routing engine…'}
            </p>
          )}
        </div>
      </header>

      <div className="layout-grid">
        <section className="panel controls-panel">
          <div className="section-heading">
            <div>
              <span className="section-chip request-chip">Input</span>
              <h2>Request and config</h2>
            </div>
          </div>

          {presetGroups.map(([group, title]) => (
            <div key={group} className="control-section">
              <h3>{title}</h3>
              <div className="preset-grid">
                {presets
                  .filter((p) => p.group === group)
                  .map((preset) => (
                    <button
                      key={preset.id}
                      className={preset.id === activePresetId ? 'preset-button is-active' : 'preset-button'}
                      onClick={() => applyPreset(preset.id)}
                      type="button"
                    >
                      <strong>{preset.label}</strong>
                      <span>{preset.description}</span>
                      <div className="preset-tooltip" role="note" aria-label={`${preset.label} notes`}>
                        <ul>
                          {preset.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </div>
                    </button>
                  ))}
              </div>
            </div>
          ))}

          <div className="control-section">
            <h3>Request</h3>
            <div className="control-group">
              <label>
                Path
                <input value={state.path} onChange={(e) => edit((c) => ({ ...c, path: e.target.value || '/' }))} />
              </label>
              <label>
                User region
                <input
                  list="rilot-regions"
                  value={state.userRegion}
                  onChange={(e) => edit((c) => ({ ...c, userRegion: e.target.value }))}
                />
                <datalist id="rilot-regions">
                  {Array.from(new Set([...backends.map((b) => b.region), ...COMMON_REGIONS])).map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </label>
            </div>
            <div className="slider-grid">
              <RangeField
                label="Carbon signal age"
                value={state.carbon.signalAgeSeconds}
                onChange={(value) => edit((c) => ({ ...c, carbon: { ...c.carbon, signalAgeSeconds: value } }))}
                min={0}
                max={1200}
                step={10}
                suffix="s"
              />
            </div>
          </div>

          <div className="control-section">
            <h3>Root config</h3>
            <p className="helper-text">Routing rules can override these per path; the decision panel shows what was inherited.</p>
            <div className="control-group">
              <SelectField<Policy>
                label="Policy"
                value={state.config.policy ?? 'balanced'}
                options={['latency', 'balanced', 'carbon']}
                onChange={(value) => setRoot('policy', value)}
              />
              <SelectField<Fallback>
                label="Fallback"
                value={state.config.fallback ?? 'nearest'}
                options={['nearest', 'lowest-latency', 'none']}
                onChange={(value) => setRoot('fallback', value)}
              />
            </div>
            <div className="slider-grid">
              <OptionalRange
                label="Radius"
                offLabel="unlimited"
                value={state.config.radius_km}
                defaultValue={2000}
                onChange={(value) => setRoot('radius_km', value)}
                min={0}
                max={15000}
                step={100}
                suffix="km"
              />
            </div>
            <details className="config-details">
              <summary>Edit the full config as JSON (backends, routing rules, …)</summary>
              <ConfigEditor config={state.config} onChange={(config) => edit((c) => ({ ...c, config }))} />
            </details>
          </div>

          {view === 'research' ? (
            <ResearchControls state={state} backends={backends} currentWeights={output?.weights ?? null} edit={edit} />
          ) : null}
        </section>

        <section className="panel output-panel">
          <div className="section-heading">
            <div>
              <span className="section-chip response-chip">rilot-core</span>
              <h2>Routing decision</h2>
            </div>
          </div>
          {result && !result.ok ? (
            <div className="reason-box reject-box" role="alert">
              <strong>rilot-core rejected this input</strong>
              <p>{result.error}</p>
            </div>
          ) : null}
          {output ? (
            <DecisionPanel
              output={output}
              view={view}
              signals={result?.input.carbon?.signals ?? []}
              signalAgeSeconds={state.carbon.signalAgeSeconds}
              maxAgeSeconds={state.carbon.maxAgeSeconds}
              source={state.carbon.source}
            />
          ) : null}
        </section>
      </div>
    </div>
  );
}

export default App;
