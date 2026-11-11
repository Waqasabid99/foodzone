import { describedBy } from "@/lib/form-errors";

/** A labelled `<textarea>`, wired exactly like `Field`. */
export default function TextAreaField({ id, label, value, onChange, error = null, hint = null, rows = 4, ...props }) {
  const errorId = error ? `${id}-error` : null;
  const hintId = hint ? `${id}-hint` : null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-label-bold text-on-surface">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        value={value}
        onChange={onChange}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={describedBy(errorId, hintId)}
        className={`w-full resize-y rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring ${
          error ? "border border-error" : "border border-outline"
        }`}
        {...props}
      />
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
