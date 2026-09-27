// The routing panel's second tab: a policy per route.
//
// This is an operator control, not a shop feature, which is why it sits in the
// Rilot panel rather than on a shop page — and why it is tinted differently
// from the read-only flow next to it.
//
// A choice is written to the `rilot_policy` cookie. The engine reads that
// cookie, matches its patterns and applies the result as a per-request policy
// hint, so the Cloudflare Worker and native Rilot honour the same value.
import { useMemo } from 'react';
import type { Policy } from '@rilot/core-js';
import { CITIES, POLICIES, POLICY_BLURB, ROUTE_CONTROLS, SHOP_CONFIG, type RouteControl } from '../../rilot/config';
import type { RilotEngine } from '../../rilot/engine';
import type { LiveCarbon } from '../../rilot/live';
import { previewPath, type Preview } from '../../rilot/request';
import { POLICY_COOKIE, clearPolicies, readCookie, readPolicies, setPolicy } from '../../state/cookie';
import { policiesChanged, type ShopState } from '../../state/store';

type Props = {
  engine: RilotEngine | null;
  live: LiveCarbon | null;
  state: ShopState;
};

export function PolicyTab({ engine, live, state }: Props) {
  // Everything below comes from the engine reading the cookie: the policy in
  // force per route, where that route would be served from, and whether the
  // choice is the visitor's or the config's. `state.policyEpoch` changes when
  // a picker writes the cookie.
  const resolved = useMemo(() => {
    const result: Record<string, { policy: Policy | null; source: string; preview: Preview | null }> = {};
    if (!engine) return result;
    const cookie = readCookie();
    const city = CITIES.find((option) => option.id === state.cityId) ?? CITIES[0];
    for (const control of ROUTE_CONTROLS) {
      const hint = engine.cookiePolicy(cookie, control.sample);
      const policy = hint.ok && hint.value ? hint.value : null;
      const effective = engine.resolveConfig(SHOP_CONFIG, control.sample, policy ? { policy } : undefined);
      result[control.path] = {
        policy: effective.ok ? effective.value.policy : null,
        source: effective.ok ? effective.value.policy_source : 'default',
        preview: previewPath(engine, control.sample, {
          config: SHOP_CONFIG,
          city,
          policy,
          signals: live?.signals ?? null,
          utcHour: state.utcHour,
          signalAgeSeconds: 45,
          previous: null
        })
      };
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, live, state.cityId, state.utcHour, state.policyEpoch]);

  const chosen = Object.keys(readPolicies()).length;
  const cookieValue = readCookie();

  const choose = (pattern: string, policy: Policy) => {
    setPolicy(pattern, policy);
    policiesChanged();
  };
  const reset = () => {
    clearPolicies();
    policiesChanged();
  };

  return (
    <div className="policy-tab">
      <p className="policy-intro">
        Decide what matters per part of the shop. Each choice goes into a cookie that this engine, the Cloudflare Worker
        and native Rilot all read the same way.
      </p>

      <dl className="policy-legend">
        {POLICIES.map((policy) => (
          <div key={policy}>
            <dt>{policy}</dt>
            <dd>{POLICY_BLURB[policy]}</dd>
          </div>
        ))}
      </dl>

      <ul className="route-list">
        {ROUTE_CONTROLS.map((control) => (
          <RouteRow
            key={control.path}
            control={control}
            inForce={resolved[control.path]?.policy ?? null}
            source={resolved[control.path]?.source ?? 'default'}
            preview={resolved[control.path]?.preview ?? null}
            onChoose={choose}
          />
        ))}
      </ul>

      <div className="policy-foot">
        <p>
          {chosen === 0
            ? 'Nothing overridden — every route is using the policy from the config.'
            : `${chosen} route${chosen > 1 ? 's' : ''} overridden · ${state.totals.savedMg.toFixed(2)} mg CO₂e avoided so far.`}
        </p>
        {chosen > 0 ? (
          <button className="policy-reset" type="button" onClick={reset}>
            Reset to the config
          </button>
        ) : null}
      </div>

      <p className="cookie-line">
        <span>Your session sends</span>
        <code>
          {POLICY_COOKIE}={cookieValue || '(empty)'}
        </code>
        <small>
          A cookie, not browser storage: it is sent with every request, so a deployment reads this exact value and routes
          by it — using the engine's own parser and the same specificity rules as <code>routing_rules</code>.
        </small>
      </p>
    </div>
  );
}

function RouteRow({
  control,
  inForce,
  source,
  preview,
  onChoose
}: {
  control: RouteControl;
  inForce: Policy | null;
  source: string;
  preview: Preview | null;
  onChoose: (pattern: string, policy: Policy) => void;
}) {
  const locked = Boolean(control.locked);
  const group = `policy${control.path}`;

  return (
    <li className={locked ? 'route is-locked' : 'route'}>
      <div className="route-text">
        <strong>{control.label}</strong>
        <code>{control.path}</code>
        <small>{control.locked ?? control.detail}</small>
        <ServedFrom preview={preview} />
      </div>

      {/* Real radios: the keyboard, labels and focus ring come for free. */}
      <fieldset className="policy-picker" disabled={locked}>
        <legend className="visually-hidden">Policy for {control.path}</legend>
        {POLICIES.map((policy) => (
          <label key={policy} className={inForce === policy ? 'policy-option is-on' : 'policy-option'}>
            <input
              type="radio"
              name={group}
              value={policy}
              checked={inForce === policy}
              disabled={locked}
              onChange={() => onChoose(control.path, policy)}
            />
            <span>{policy}</span>
          </label>
        ))}
      </fieldset>

      <span className="route-source">{locked ? 'locked' : source === 'request' ? 'your cookie' : 'config'}</span>
    </li>
  );
}

/** "now served from dublin · Dublin, IE · 134 g/kWh" under a route. */
function ServedFrom({ preview }: { preview: Preview | null | undefined }) {
  if (!preview?.backendId) return null;
  return (
    <span className="served-from">
      now served from <strong>{preview.backendId}</strong>
      {preview.city ? <span className="dim"> · {preview.city}</span> : null}
      {preview.carbonGPerKwh !== undefined ? <span> · {Math.round(preview.carbonGPerKwh)} g/kWh</span> : null}
    </span>
  );
}
