import { Loader2 } from "lucide-react";

/**
 * The primary action on a form.
 *
 * Disabled while in flight, because a double-submitted registration is a
 * duplicate-email error shown to someone who did nothing wrong. The label
 * changes with the state rather than only the icon, so the reason it is
 * unclickable is readable.
 *
 * `disabled` is separate from `pending`: a form can be incomplete without a
 * request being in flight, and those two states should not look alike.
 */
export default function SubmitButton({
  pending,
  children,
  pendingLabel = "Working…",
  icon: Icon = null,
  disabled = false,
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="mt-1 flex w-full items-center justify-center gap-2 rounded-field bg-primary-container px-6 py-3.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-70"
    >
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          {pendingLabel}
        </>
      ) : (
        <>
          {children}
          {Icon ? <Icon aria-hidden="true" className="size-4" /> : null}
        </>
      )}
    </button>
  );
}
