// The shop-facing half of "Our impact": what the three grids are doing now.
//
// Choosing a policy per route is not a shop feature, so it lives in the Rilot
// panel on the right (see PolicyTab) rather than here.
import { useEffect, useMemo, useState } from 'react';
import { REGION_PROFILES, carbonAt } from '../../rilot/carbon';
import { getLiveSignals, isConfigured, type LiveCarbon } from '../../rilot/live';
import { INITIAL_STATE, readState, subscribe, type ShopState } from '../../state/store';

export default function GridNow() {
  const [state, setState] = useState<ShopState>(INITIAL_STATE);
  const [live, setLive] = useState<LiveCarbon | null>(null);

  useEffect(() => {
    setState(readState());
    return subscribe(setState);
  }, []);

  useEffect(() => {
    if (isConfigured) void getLiveSignals().then(setLive);
  }, []);

  const grid = useMemo(
    () =>
      REGION_PROFILES.map((profile) => {
        const fromApi = live?.signals.find((signal) => signal.region === profile.region);
        return {
          label: profile.label,
          region: profile.region,
          intensity: Math.round(fromApi?.carbon_g_per_kwh ?? carbonAt(profile, state.utcHour)),
          // A configured API may not cover every region this shop uses.
          simulated: !fromApi
        };
      }),
    [live, state.utcHour]
  );
  const cleanest = Math.min(...grid.map((row) => row.intensity));
  const dirtiest = Math.max(...grid.map((row) => row.intensity));

  return (
    <>
      <h2 className="section-title">The grid, right now</h2>
      <p className="muted small grid-source">
        {live ? (
          <>
            Live from <code>{live.endpoint}</code>
            {grid.some((row) => row.simulated)
              ? ' — regions it does not cover keep the simulated curve, and a request for one of them is routed as carbon-unavailable.'
              : ''}
          </>
        ) : (
          'Simulated from the grid clock on the right — a daily solar curve, not a real feed.'
        )}
      </p>
      <ul className="grid-list">
        {grid.map((row) => (
          <li key={row.region} className={row.intensity === cleanest ? 'grid-row is-cleanest' : 'grid-row'}>
            <span className="grid-name">
              <strong>{row.label}</strong>
              <small>{row.region}</small>
            </span>
            <span className="grid-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((row.intensity / dirtiest) * 100)}%` }} />
            </span>
            <span className="grid-value">
              {row.intensity} <small>g/kWh</small>
            </span>
            {live && row.simulated ? (
              <span className="grid-tag is-muted" title="The carbon API has no value for this region">
                simulated
              </span>
            ) : row.intensity === cleanest ? (
              <span className="grid-tag">cleanest</span>
            ) : null}
          </li>
        ))}
      </ul>

      <p className="grid-hint">
        Want the catalogue to follow that? Open the <strong>Policy</strong> tab in the routing panel and pick one per
        page. Your choice travels as a cookie, so the edge honours it too.
      </p>
    </>
  );
}
