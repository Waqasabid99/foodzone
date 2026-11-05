import Link from "next/link";
import { Bike, ChefHat, CircleCheck, Clock, PackageCheck, Receipt } from "lucide-react";

/**
 * What the kitchen and the counter are working on right now.
 *
 * Counts rather than a chart: six small integers that a manager reads one at a
 * time to decide where to stand. Plotting them would ask for a comparison
 * nobody is making — "are there more preparing than ready?" is not a question,
 * "are eleven orders stuck in pending?" is.
 *
 * These are order *states*, so they use the reserved status colours rather than
 * the chart hue — and each ships with an icon and a written label, never colour
 * alone.
 */
const STAGES = [
  { key: "pending", label: "Awaiting confirmation", icon: Clock, tone: "warning" },
  { key: "confirmed", label: "Confirmed", icon: CircleCheck, tone: "neutral" },
  { key: "preparing", label: "In the kitchen", icon: ChefHat, tone: "neutral" },
  { key: "ready", label: "Ready", icon: PackageCheck, tone: "good" },
  { key: "outForDelivery", label: "Out for delivery", icon: Bike, tone: "neutral" },
  { key: "awaitingCloseOut", label: "Delivered, not closed", icon: Receipt, tone: "neutral" },
];

const TONES = {
  good: "text-success",
  warning: "text-warning",
  neutral: "text-on-surface-variant",
};

export default function LiveQueue({ queue }) {
  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-headline-md text-on-surface">On the pass</h2>
        <Link
          href="/dashboard/orders"
          className="text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          All orders
        </Link>
      </div>

      <p className="text-body-md text-on-surface-variant">
        <span className="font-display text-headline-lg text-on-surface tabular-nums">{queue.total}</span>{" "}
        {queue.total === 1 ? "order is" : "orders are"} still being worked on.
      </p>

      <dl className="flex flex-col gap-2">
        {STAGES.map((stage) => {
          const Icon = stage.icon;
          const count = queue[stage.key] ?? 0;

          return (
            <div key={stage.key} className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2 text-body-md text-on-surface-variant">
                <Icon aria-hidden="true" className={`size-4 shrink-0 ${TONES[stage.tone]}`} />
                {stage.label}
              </dt>
              <dd
                className={`text-label-bold tabular-nums ${count > 0 ? "text-on-surface" : "text-on-surface-variant"}`}
              >
                {count}
              </dd>
            </div>
          );
        })}
      </dl>

      {queue.awaitingCloseOut > 0 ? (
        // Worth naming, because it is the one number here that is a back-office
        // backlog rather than kitchen work — and it is what makes an accounting
        // sales report lag behind the day it is reporting on.
        <p className="rounded-field bg-surface-container-low px-4 py-3 text-label-bold font-normal text-on-surface-variant">
          {queue.awaitingCloseOut} delivered {queue.awaitingCloseOut === 1 ? "order has" : "orders have"} not
          been closed out. They count as sales here, but not in the accounting reports until they are.
        </p>
      ) : null}
    </section>
  );
}
