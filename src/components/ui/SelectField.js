import { describedBy } from "@/lib/form-errors";

/**
 * A labelled `<select>`, matching `Field` in shape, spacing and error wiring.
 *
 * A native select rather than a custom listbox: it is keyboard-operable and
 * screen-reader-correct without any of it being re-implemented, and on a phone
 * it opens the platform picker, which is a far better experience than a div
 * pretending to be one.
 */
export default function SelectField({
  id,
  label,
  value,
  onChange,
  options,
  error = null,
  hint = null,
  ...selectProps
}) {
  const errorId = error ? `${id}-error` : null;
  const hintId = hint ? `${id}-hint` : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-bold text-on-surface">
        {label}
      </label>

      <select
        id={id}
        value={value}
        onChange={onChange}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(errorId, hintId)}
        className={`w-full rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${
          error ? "border border-error" : "border border-outline"
        }`}
        {...selectProps}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>

      {hint ? (
        <p id={hintId} className="text-label-bold font-normal text-on-surface-variant">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-label-bold text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
