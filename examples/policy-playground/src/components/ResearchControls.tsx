import { DEFAULT_SIM, type BackendSim, type PlaygroundState } from '../model/ui-types';
import { SIGNAL_SOURCES, carbonForRegion } from '../rilot/fixtures';
import type { AdvancedSettings, Backend, RouteClass, SignalSource, Weights } from '@rilot/core-js';
import { OptionalRange, RangeField, SelectField } from './fields';

type Props = {
  state: PlaygroundState;
  backends: Backend[];
  /** Normalized weights the engine used last, to seed a custom override. */
  currentWeights: Weights | null;
  edit: (update: (current: PlaygroundState) => PlaygroundState) => void;
};

export function ResearchControls({ state, backends, currentWeights, edit }: Props) {
  const advanced: AdvancedSettings = state.config.advanced ?? {};
  const setAdvanced = <K extends keyof AdvancedSettings>(key: K, value: AdvancedSettings[K]) =>
    edit((current) => {
      const next: AdvancedSettings = { ...(current.config.advanced ?? {}) };
      if (value === undefined) delete next[key];
      else next[key] = value;
      return { ...current, config: { ...current.config, advanced: next } };
    });
  const setSim = (id: string, patch: Partial<BackendSim>) =>
    edit((current) => ({ ...current, sim: { ...current.sim, [id]: { ...(current.sim[id] ?? DEFAULT_SIM), ...patch } } }));
  const setCarbon = (region: string, value: number | null) =>
    edit((current) => ({ ...current, carbonByRegion: { ...current.carbonByRegion, [region]: value } }));
  const weights = advanced.weights;

  return (
    <>
      <div className="control-section">
        <h3>Research: stability and class</h3>
        <div className="control-group">
          <SelectField<RouteClass>
            label="Route class (root)"
            value={advanced.route_class ?? 'flexible'}
            options={['flexible', 'strict-local', 'background']}
            onChange={(value) => setAdvanced('route_class', value === 'flexible' ? undefined : value)}
          />
          <label>
            Currently active backend
            <select
              value={state.activeBackendId ?? ''}
              onChange={(event) => edit((c) => ({ ...c, activeBackendId: event.target.value || null }))}
            >
              <option value="">none</option>
              {backends.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="slider-grid">
          <RangeField
            label="Hysteresis delta"
            value={advanced.hysteresis_delta ?? 0.05}
            onChange={(value) => setAdvanced('hysteresis_delta', value)}
            min={0}
            max={0.5}
            step={0.01}
            decimals={2}
          />
        </div>
      </div>

      <div className="control-section">
        <h3>Research: weights</h3>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={weights !== undefined}
            onChange={(event) =>
              setAdvanced(
                'weights',
                event.target.checked && currentWeights
                  ? {
                      carbon: Math.round(currentWeights.carbon * 100),
                      latency: Math.round(currentWeights.latency * 100),
                      reliability: Math.round(currentWeights.reliability * 100),
                      cost: Math.round(currentWeights.cost * 100)
                    }
                  : undefined
              )
            }
          />
          <span>Override the policy's preset weights (ignored by the latency policy)</span>
        </label>
        {weights ? (
          <div className="slider-grid">
            {(['carbon', 'latency', 'reliability', 'cost'] as const).map((key) => (
              <RangeField
                key={key}
                label={`${key[0].toUpperCase()}${key.slice(1)} weight`}
                value={weights[key] ?? 0}
                onChange={(value) => setAdvanced('weights', { ...weights, [key]: value })}
                min={0}
                max={100}
                step={1}
              />
            ))}
          </div>
        ) : null}
      </div>

      <div className="control-section">
        <h3>Research: guardrails</h3>
        <div className="slider-grid">
          <OptionalRange
            label="Max latency delta"
            offLabel="off"
            value={advanced.max_latency_delta_ms}
            defaultValue={45}
            onChange={(value) => setAdvanced('max_latency_delta_ms', value)}
            min={0}
            max={300}
            step={1}
            suffix="ms"
          />
          <OptionalRange
            label="Hard max latency"
            offLabel="off"
            value={advanced.hard_max_latency_ms}
            defaultValue={110}
            onChange={(value) => setAdvanced('hard_max_latency_ms', value)}
            min={0}
            max={500}
            step={1}
            suffix="ms"
          />
          <OptionalRange
            label="Min carbon benefit"
            offLabel="off"
            value={advanced.min_carbon_benefit_g_per_kwh}
            defaultValue={15}
            onChange={(value) => setAdvanced('min_carbon_benefit_g_per_kwh', value)}
            min={0}
            max={300}
            step={1}
            suffix="gCO2/kWh"
          />
          <OptionalRange
            label="Max error rate"
            offLabel="off"
            value={advanced.max_error_rate === undefined ? undefined : advanced.max_error_rate * 100}
            defaultValue={5}
            onChange={(value) => setAdvanced('max_error_rate', value === undefined ? undefined : value / 100)}
            min={0}
            max={100}
            step={0.5}
            suffix="%"
            decimals={1}
          />
        </div>
      </div>

      <div className="control-section">
        <h3>Research: carbon signals</h3>
        <div className="control-group">
          <SelectField<SignalSource>
            label="Signal came from"
            value={state.carbon.source}
            options={SIGNAL_SOURCES.map((s) => s.value)}
            onChange={(value) => edit((c) => ({ ...c, carbon: { ...c.carbon, source: value } }))}
          />
        </div>
        <div className="slider-grid">
          <RangeField
            label="Max age"
            value={state.carbon.maxAgeSeconds}
            onChange={(value) => edit((c) => ({ ...c, carbon: { ...c.carbon, maxAgeSeconds: value } }))}
            min={30}
            max={1200}
            step={30}
            suffix="s"
          />
        </div>
      </div>

      <div className="control-section">
        <h3>Research: simulated backend inputs</h3>
        <p className="helper-text">
          Carbon is per region (backends in one region share a signal). Leave latency empty to let rilot-core estimate it from
          distance.
        </p>
        <div className="table-scroll">
          <table className="sim-table">
            <thead>
              <tr>
                <th>Backend</th>
                <th>Region carbon</th>
                <th>Latency (ms)</th>
                <th>Errors (%)</th>
                <th>Healthy</th>
              </tr>
            </thead>
            <tbody>
              {backends.map((b) => {
                const sim = state.sim[b.id] ?? DEFAULT_SIM;
                const region = b.carbon_region ?? b.region;
                const carbon = carbonForRegion(region, state.carbonByRegion);
                return (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.id}</strong>
                      <small> {region}</small>
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`${region} carbon`}
                        placeholder="none"
                        value={carbon ?? ''}
                        onChange={(e) => setCarbon(region, e.target.value === '' ? null : Number(e.target.value))}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        aria-label={`${b.id} latency`}
                        placeholder="auto"
                        value={sim.latencyMs ?? ''}
                        onChange={(e) => setSim(b.id, { latencyMs: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        aria-label={`${b.id} error rate`}
                        value={sim.errorRatePercent}
                        onChange={(e) => setSim(b.id, { errorRatePercent: Number(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${b.id} healthy`}
                        checked={sim.healthy}
                        onChange={(e) => setSim(b.id, { healthy: e.target.checked })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
