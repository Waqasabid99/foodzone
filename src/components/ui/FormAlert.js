import { AlertCircle, CheckCircle2 } from "lucide-react";

/**
 * A form-level message: the failures with no single field to blame.
 *
 * `role="alert"` so it is announced when it appears — someone who submitted
 * with the keyboard and is not looking at the top of the form still hears that
 * the password was wrong, rather than waiting on a page that seems to have done
 * nothing.
 */
export default function FormAlert({ tone = "error", children }) {
  if (!children) return null;

  const isError = tone === "error";
  const Icon = isError ? AlertCircle : CheckCircle2;

  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-field px-4 py-3 text-body-md ${
        isError
          ? "bg-error-container text-on-error-container"
          : "bg-success-container text-on-success-container"
      }`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
