import { IconMinus, IconPlus } from './Icons';

/* ============================================================
   Shared form controls.

   Native checkboxes and number spinners are drawn by the OS: they
   ignore the theme, they are tiny hit targets, and they look out of
   place next to everything else. These are the themed replacements.
   ============================================================ */

/** An on/off switch. Still a real checkbox underneath, so it stays keyboard- and label-friendly. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the visible text usually lives in the row label. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={label}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </label>
  );
}

/**
 * A number field with real stepper buttons. Holding a button repeats via
 * the browser's own click behaviour rather than a timer, which keeps it
 * predictable; the value is always clamped to [min, max].
 */
export function NumberField({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  suffix,
  width = 132,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
  /** Unit shown inside the field, e.g. "ms". */
  suffix?: string;
  width?: number;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  const bump = (dir: 1 | -1) => onChange(clamp(value + dir * step));

  return (
    <div className="stepper" style={{ width }}>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => bump(-1)}
        disabled={value <= min}
        aria-label={`Decrease ${label}`}
      >
        <IconMinus size={13} />
      </button>
      <span className="stepper-value">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-label={label}
          onChange={(e) => {
            const n = Number(e.target.value);
            // An empty field parses as 0; leave the value alone rather
            // than snapping it to the minimum while someone is typing.
            if (e.target.value === '' || Number.isNaN(n)) return;
            onChange(clamp(n));
          }}
        />
        {suffix && <em>{suffix}</em>}
      </span>
      <button
        type="button"
        className="stepper-btn"
        onClick={() => bump(1)}
        disabled={value >= max}
        aria-label={`Increase ${label}`}
      >
        <IconPlus size={13} />
      </button>
    </div>
  );
}
