import { describedBy } from "@/lib/form-errors";

/**
 * A labelled text input.
 *
 * Every field gets a real `<label>` rather than a placeholder standing in for
 * one: a placeholder disappears the moment you type, which leaves anyone who is
 * interrupted mid-form — or using a screen reader, or zoomed in far enough that
 * only one field is on screen — with an unlabelled box. The placeholder is kept
 * for the example value it shows, which is what it is good at.
 *
 * Errors are announced as well as shown. `aria-invalid` marks the field and
 * `aria-describedby` points at the message, so a screen reader reads the
 * problem when focus lands rather than leaving the user to hunt for red text.
 */
export default function Field({
  id,
  label,
  type = "text",
  value,
  onChange,
  error = null,
  hint = null,
  icon: Icon = null,
  trailing = null,
  labelAction = null,
  ...inputProps
}) {
  const errorId = error ? `${id}-error` : null;
  const hintId = hint ? `${id}-hint` : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-label-bold text-on-surface">
          {label}
        </label>
        {labelAction}
      </div>

      <div className="relative">
        <input
          id={id}
          type={type}
          value={value}
          onChange={onChange}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={describedBy(errorId, hintId)}
          className={`w-full rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${
            Icon || trailing ? "pr-12" : ""
          } ${
            // `outline`, not `outline-variant`: a form field is a UI component,
            // so WCAG 1.4.11 wants 3:1 against whatever it sits on. This clears
            // 4:1 in both themes. It used to be transparent, which made a field
            // on a panel of the same fill — the cashier's "Handed over" box —
            // literally invisible until you clicked it.
            error ? "border border-error" : "border border-outline"
          }`}
          {...inputProps}
        />

        {trailing ??
          (Icon ? (
            <Icon
              aria-hidden="true"
              className="pointer-events-none absolute right-4 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant"
            />
          ) : null)}
      </div>

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
