import { TriangleAlert } from "lucide-react";

/**
 * Says so, on the first screen, when the background queue has stopped.
 *
 * Deliberately at the top of the overview rather than on a page of its own.
 * A stalled queue is not something anybody goes looking for — it has no
 * symptom on any screen, because every screen reads the orders and the
 * payments, which are fine. The books and the stock are the things quietly
 * drifting, and nobody opens the ledger to check whether it is being written
 * to.
 *
 * Shown only to people who could act on it. A cashier cannot restart a worker
 * and should not be handed a red banner about one in the middle of a shift.
 */
export default function QueueHealth({ health }) {
  if (!health || health.level === "ok") return null;

  const serious = health.level === "stalled";

  return (
    <section
      role="status"
      className={`flex items-start gap-3 rounded-card px-5 py-4 ${
        serious ? "bg-error-container text-on-error-container" : "bg-warning-container text-on-warning-container"
      }`}
    >
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-label-bold">{health.title}</p>
        <p className="mt-1 text-body-md">{health.body}</p>
      </div>
    </section>
  );
}
