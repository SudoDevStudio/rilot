// Shop state that has to survive a real page navigation.
//
// Every page in this demo is a separate document, so the cart, the shopper's
// city, the grid clock and the request history live in sessionStorage and are
// shared between the islands through one custom event.

import type { PreviousDecision } from '@rilot/core-js';

export type HistoryEntry = {
  id: number;
  path: string;
  method: string;
  backendId: string | null;
  latencyMs: number;
  savedMg: number;
};

export type PanelTab = 'flow' | 'policy';

export type ShopState = {
  cityId: string;
  /** Simulated grid clock, 0–23 UTC. */
  utcHour: number;
  cart: string[];
  /**
   * Bumped whenever the policy cookie changes, so the islands re-read it.
   * The choices themselves live in the cookie (see state/cookie.ts), because
   * that is what a real adapter receives.
   */
  policyEpoch: number;
  /** Which tab of the routing panel is open. */
  panelTab: PanelTab;
  history: HistoryEntry[];
  totals: { requests: number; savedMg: number; latencyMs: number };
  /** Hysteresis state per route, exactly as an adapter would keep it. */
  previous: Record<string, PreviousDecision>;
};

export const INITIAL_STATE: ShopState = {
  cityId: 'new-york',
  utcHour: 13,
  cart: [],
  policyEpoch: 0,
  panelTab: 'flow',
  history: [],
  totals: { requests: 0, savedMg: 0, latencyMs: 0 },
  previous: {}
};

const KEY = 'greencart:state';
const CHANGED = 'rilot:state';
const HISTORY_LIMIT = 8;

/** A request one of the islands wants routed (a click, not a page load). */
export type RequestEvent = {
  method: 'GET' | 'POST';
  path: string;
  label: string;
  kilobytes: number;
};

export const REQUESTED = 'rilot:request';

function canStore(): boolean {
  return typeof window !== 'undefined';
}

export function readState(): ShopState {
  if (!canStore()) return INITIAL_STATE;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return INITIAL_STATE;
    // Merge, so a state written by an older version of the page still loads.
    return { ...INITIAL_STATE, ...(JSON.parse(raw) as Partial<ShopState>) };
  } catch {
    return INITIAL_STATE;
  }
}

export function writeState(patch: Partial<ShopState>): ShopState {
  const next = { ...readState(), ...patch };
  if (canStore()) {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Private mode, or storage full: the page still works, it just forgets.
    }
    window.dispatchEvent(new CustomEvent<ShopState>(CHANGED, { detail: next }));
  }
  return next;
}

/** Calls `listener` on every state change until the returned function is called. */
export function subscribe(listener: (state: ShopState) => void): () => void {
  if (!canStore()) return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<ShopState>).detail);
  window.addEventListener(CHANGED, handler);
  return () => window.removeEventListener(CHANGED, handler);
}

export function recordRequest(entry: Omit<HistoryEntry, 'id'>): void {
  const state = readState();
  const id = (state.history[0]?.id ?? 0) + 1;
  writeState({
    history: [{ id, ...entry }, ...state.history].slice(0, HISTORY_LIMIT),
    totals: {
      requests: state.totals.requests + 1,
      savedMg: state.totals.savedMg + entry.savedMg,
      latencyMs: state.totals.latencyMs + entry.latencyMs
    }
  });
}

export function rememberDecision(path: string, next: PreviousDecision): void {
  writeState({ previous: { ...readState().previous, [path]: next } });
}

export function addToCart(productId: string): void {
  writeState({ cart: [...readState().cart, productId] });
}

export function clearCart(): void {
  writeState({ cart: [] });
}

/** Tells every island that the policy cookie changed. */
export function policiesChanged(): void {
  writeState({ policyEpoch: readState().policyEpoch + 1 });
}

/** Asks the routing panel to route a request that is not a page load. */
export function request(event: RequestEvent): void {
  if (!canStore()) return;
  window.dispatchEvent(new CustomEvent<RequestEvent>(REQUESTED, { detail: event }));
}

export function onRequest(listener: (event: RequestEvent) => void): () => void {
  if (!canStore()) return () => {};
  const handler = (event: Event) => listener((event as CustomEvent<RequestEvent>).detail);
  window.addEventListener(REQUESTED, handler);
  return () => window.removeEventListener(REQUESTED, handler);
}
