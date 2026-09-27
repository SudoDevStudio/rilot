import { useEffect, useState } from 'react';
import { readState, subscribe, type HistoryEntry } from '../../state/store';

/** The shop's own footer line: which backend served the page you are on. */
export default function ServedBy() {
  const [latest, setLatest] = useState<HistoryEntry | null>(null);

  useEffect(() => {
    setLatest(readState().history[0] ?? null);
    return subscribe((state) => setLatest(state.history[0] ?? null));
  }, []);

  if (!latest?.backendId) return <span>routing…</span>;
  return (
    <span>
      served by <strong>{latest.backendId}</strong> · {latest.latencyMs} ms
    </span>
  );
}
