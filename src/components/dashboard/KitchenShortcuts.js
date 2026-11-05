import Link from "next/link";
import { ChefHat, Flame } from "lucide-react";

/**
 * What a kitchen needs from a home screen, which is almost nothing.
 *
 * Somebody working a pass opens this once, at the start of a shift, with their
 * hands already dirty. The old overview gave them a list of order counts and no
 * way into the board at all — the one screen their whole job happens on was
 * reachable only through the sidebar.
 *
 * So: the board first and large, then how much work is actually up, then a tap
 * straight to each station so a fryer cook never has to open the board and
 * filter it by hand. Everything else an overview normally shows — revenue,
 * best sellers, average order — is not theirs and is not here.
 */
export default function KitchenShortcuts({ branchId, stations = [], summary, late = 0 }) {
  const counts = [
    { label: "Tickets up", value: summary?.activeOrders ?? 0, note: "Orders the kitchen is working" },
    { label: "Waiting", value: summary?.items?.queued ?? 0, note: "Not started yet" },
    { label: "Being made", value: summary?.items?.preparing ?? 0, note: "On now" },
    { label: "Ready to run", value: summary?.items?.ready ?? 0, note: "Waiting to be taken out" },
  ];

  const board = branchId ? `/dashboard/kitchen?branch=${branchId}` : "/dashboard/kitchen";

  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={board}
          className="inline-flex items-center gap-2 rounded-field bg-primary-container px-6 py-3.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChefHat aria-hidden="true" className="size-5" />
          Open the board
        </Link>

        {/* Late is the only number here worth a colour. It is the one that
            means somebody is waiting longer than they were promised. */}
        {late > 0 ? (
          <p className="inline-flex items-center gap-2 rounded-field bg-error-container px-4 py-3 text-label-bold text-on-error-container">
            <Flame aria-hidden="true" className="size-4" />
            {late} {late === 1 ? "order is" : "orders are"} past the time promised
          </p>
        ) : null}
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {counts.map((row) => (
          <div key={row.label} className="rounded-field bg-surface-container px-4 py-3">
            <dt className="text-label-bold uppercase tracking-wide text-on-surface-variant">{row.label}</dt>
            <dd className="font-display text-headline-md tabular-nums text-on-surface">{row.value}</dd>
            <dd className="text-label-bold font-normal text-on-surface-variant">{row.note}</dd>
          </div>
        ))}
      </dl>

      {stations.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-label-bold text-on-surface-variant">Straight to:</span>
          {stations.map((station) => (
            <Link
              key={station.id}
              href={`${board}&station=${station.id}`}
              className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {station.name}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}
