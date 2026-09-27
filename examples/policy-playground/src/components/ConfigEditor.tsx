import { useEffect, useState } from 'react';
import type { RoutingConfig } from '@rilot/core-js';

const format = (config: RoutingConfig) => JSON.stringify(config, null, 2);

/**
 * Edits the Rilot routing config as JSON. Valid JSON is applied immediately;
 * the engine reports config validation errors in the decision panel.
 */
export function ConfigEditor({ config, onChange }: { config: RoutingConfig; onChange: (config: RoutingConfig) => void }) {
  const [draft, setDraft] = useState(() => format(config));
  const [parseError, setParseError] = useState<string | null>(null);

  // Follow external edits (form controls, presets) unless the draft already matches.
  useEffect(() => {
    setDraft((current) => {
      try {
        if (JSON.stringify(JSON.parse(current)) === JSON.stringify(config)) return current;
      } catch {
        // An invalid draft is being edited; replace it only on an actual config change.
      }
      return format(config);
    });
    setParseError(null);
  }, [config]);

  return (
    <div className="config-editor">
      <textarea
        aria-label="Routing config JSON"
        spellCheck={false}
        value={draft}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          try {
            const parsed: unknown = JSON.parse(text);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setParseError('The config must be a JSON object.');
              return;
            }
            setParseError(null);
            onChange(parsed as RoutingConfig);
          } catch (error) {
            setParseError(error instanceof Error ? error.message : String(error));
          }
        }}
      />
      {parseError ? <p className="editor-error">JSON not applied: {parseError}</p> : null}
      <p className="helper-text">
        Same format as native Rilot (<code>backends</code>, <code>policy</code>, <code>radius_km</code>,{' '}
        <code>fallback</code>, <code>routing_rules</code>, optional <code>advanced</code>). Unset rule fields inherit from the
        root.
      </p>
    </div>
  );
}
