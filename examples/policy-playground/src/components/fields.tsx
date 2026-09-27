import type { CSSProperties } from 'react';

export type RangeFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  decimals?: number;
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function RangeField({ label, value, onChange, min, max, step, suffix, decimals = 0 }: RangeFieldProps) {
  const normalized = clamp(value, min, max);
  const progress = max === min ? 0 : ((normalized - min) / (max - min)) * 100;
  const style = { ['--range-progress' as string]: `${progress}%` } as CSSProperties;
  return (
    <div className="range-control">
      <div className="range-header">
        <span className="range-title">
          {label}: <strong>{`${value.toFixed(decimals)}${suffix ? ` ${suffix}` : ''}`}</strong>
        </span>
      </div>
      <div className="range-input-row">
        <input
          className="range-slider"
          type="range"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={normalized}
          style={style}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <input
          className="number-input"
          type="number"
          aria-label={`${label} value`}
          min={min}
          max={max}
          step={step}
          value={normalized}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(clamp(next, min, max));
          }}
        />
      </div>
    </div>
  );
}

/** A numeric setting that can be switched off (`undefined`). */
export function OptionalRange(
  props: Omit<RangeFieldProps, 'value' | 'onChange'> & {
    value: number | undefined;
    defaultValue: number;
    offLabel: string;
    onChange: (value: number | undefined) => void;
  }
) {
  const { value, defaultValue, offLabel, onChange, ...rest } = props;
  return (
    <div className="optional-range">
      <label className="checkbox-row compact">
        <input
          type="checkbox"
          checked={value !== undefined}
          onChange={(event) => onChange(event.target.checked ? defaultValue : undefined)}
        />
        <span>
          {rest.label}
          {value === undefined ? ` (${offLabel})` : ''}
        </span>
      </label>
      {value !== undefined ? <RangeField {...rest} value={value} onChange={onChange} /> : null}
    </div>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
