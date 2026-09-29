// The right-hand half of the screen: the decision Rilot made for the page you
// are looking at.
//
// Each page of this shop is a real document at a real URL, and that URL is the
// path Rilot routes. Loading a page therefore *is* the request — the panel
// routes it on mount, then routes anything else the page asks for (adding to
// the cart, paying) through the shared request event.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CITIES, SHOP_CONFIG, type City } from '../../rilot/config';
import { getEngine, type RilotEngine } from '../../rilot/engine';
import { getLiveSignals, isConfigured, type LiveCarbon } from '../../rilot/live';
import { routeRequest, type ShopRequest, type Trace } from '../../rilot/request';
import { readCookie } from '../../state/cookie';
import {
  INITIAL_STATE,
  onRequest,
  readState,
  recordRequest,
  rememberDecision,
  subscribe,
  writeState,
  type PanelTab,
  type ShopState
} from '../../state/store';
import { readPolicies } from '../../state/cookie';
import { FlowPanel } from './FlowPanel';
import { PolicyTab } from './PolicyTab';

type Props = {
  /** The path Rilot routes for this page, e.g. `/products`. */
  path: string;
  label: string;
  method?: 'GET' | 'POST';
  kilobytes: number;
};

export default function RilotPanel({ path, label, method = 'GET', kilobytes }: Props) {
  const [engine, setEngine] = useState<RilotEngine | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<ShopState>(INITIAL_STATE);
  const [ready, setReady] = useState(false);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Null until a configured carbon API has answered; stays null on Pages.
  const [live, setLive] = useState<LiveCarbon | null>(null);
  const [liveChecked, setLiveChecked] = useState(!isConfigured);

  // Read what the previous pages left behind, and keep following it.
  useEffect(() => {
    setState(readState());
    setReady(true);
    return subscribe(setState);
  }, []);

  useEffect(() => {
    getEngine()
      .then(setEngine)
      .catch((cause: unknown) => setLoadError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  // A carbon API is optional. If one is configured we wait for it before
  // routing, so the first decision is not made on simulated numbers.
  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    getLiveSignals().then((result) => {
      if (cancelled) return;
      setLive(result);
      setLiveChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const city = useMemo(
    () => CITIES.find((option) => option.id === state.cityId) ?? CITIES[0],
    [state.cityId]
  );
  // The policy this request carries, read out of the session cookie by the
  // engine — the same call the Cloudflare Worker makes on `Cookie:`.
  // `state.policyEpoch` changes when a picker writes the cookie.
  const policy = useMemo(() => {
    if (!engine) return null;
    const result = engine.cookiePolicy(readCookie(), path, undefined);
    return result.ok ? result.value : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, path, state.policyEpoch]);

  // `send` is rebuilt whenever the world changes; the ref keeps the request
  // listener below pointing at the current one without re-subscribing.
  const send = useCallback(
    (request: ShopRequest, record: boolean) => {
      if (!engine) return;
      const result = routeRequest(engine, request, {
        config: SHOP_CONFIG,
        city,
        policy,
        signals: live?.signals ?? null,
        utcHour: state.utcHour,
        signalAgeSeconds: 45,
        previous: readState().previous[request.path] ?? null
      });
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setError(null);
      setTrace(result);
      if (result.decision.next_state) rememberDecision(request.path, result.decision.next_state);
      if (record) {
        recordRequest({
          path: request.path,
          method: request.method,
          backendId: result.decision.selected_backend_id,
          latencyMs: result.latencyMs,
          savedMg: result.savedMg
        });
      }
    },
    [engine, city, policy, live, state.utcHour]
  );

  const sendRef = useRef(send);
  sendRef.current = send;

  // Route this page. Re-routed, without counting again, when the shopper moves,
  // the grid clock moves, or a route's policy changes.
  const counted = useRef(false);
  useEffect(() => {
    if (!engine || !ready || !liveChecked) return;
    send({ method, path, label, kilobytes }, !counted.current);
    counted.current = true;
  }, [engine, ready, liveChecked, send, method, path, label, kilobytes]);

  // Requests that are not page loads: adding to the cart, paying.
  useEffect(() => onRequest((request) => sendRef.current(request, true)), []);

  return (
    <>
      <header className="rilot-head">
        <div>
          <p className="eyebrow">Live routing</p>
          <h2>
            Rilot <span className="muted">decides where this request goes</span>
          </h2>
        </div>
        <div className="controls">
          <label>
            Shopper in
            <select
              value={city.id}
              onChange={(event) => writeState({ cityId: event.target.value })}
            >
              {CITIES.map((option: City) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="clock">
            Grid clock
            <input
              type="range"
              min={0}
              max={23}
              step={1}
              value={state.utcHour}
              onChange={(event) => writeState({ utcHour: Number(event.target.value) })}
            />
            <span className="clock-value">{String(state.utcHour).padStart(2, '0')}:00 UTC</span>
          </label>
        </div>
      </header>

      <Tabs
        active={state.panelTab}
        overrides={Object.keys(readPolicies()).length}
        onSelect={(panelTab) => writeState({ panelTab })}
      />

      {loadError ? <p className="error">The routing engine could not load: {loadError}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {state.panelTab === 'policy' ? (
        <PolicyTab engine={engine} live={live} state={state} />
      ) : (
        <>
          <FlowPanel trace={trace} city={city} totals={state.totals} live={live} />

          {state.history.length > 1 ? (
            <div className="history">
              <h3>Earlier requests</h3>
              <ul>
                {state.history.slice(1).map((entry) => (
                  <li key={entry.id}>
                    <code>{entry.path}</code>
                    <span>→ {entry.backendId ?? 'none'}</span>
                    <span className="muted">{entry.latencyMs} ms</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      <footer className="rilot-foot">
        Decisions come from <strong>rilot-core</strong> compiled to WebAssembly — the same engine native Rilot runs. The
        shop, the backends and the carbon feed are simulated in your browser.
      </footer>
    </>
  );
}

/** Two views of the same engine: what it just did, and what you want it to do. */
function Tabs({
  active,
  overrides,
  onSelect
}: {
  active: PanelTab;
  overrides: number;
  onSelect: (tab: PanelTab) => void;
}) {
  const tab = (id: PanelTab, label: string, badge?: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={active === id}
      className={`panel-tab is-${id} ${active === id ? 'is-active' : ''}`}
      onClick={() => onSelect(id)}
    >
      {label}
      {badge ? <span className="panel-tab-badge">{badge}</span> : null}
    </button>
  );

  return (
    <div className="panel-tabs" role="tablist" aria-label="Routing panel">
      {tab('flow', 'This request')}
      {tab('policy', 'Policy', overrides)}
    </div>
  );
}
