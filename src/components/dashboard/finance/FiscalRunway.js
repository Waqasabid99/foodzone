import Link from "next/link";
import { CalendarClock, TriangleAlert } from "lucide-react";

/**
 * Says so, before the financial year runs out — and after, if nobody acted.
 *
 * Deliberately on the overview and not only on the periods page. Opening a
 * year is a once-a-year action with no symptom anywhere until it is overdue:
 * orders, payments and stock all carry on working, and the only thing that
 * stops is the ledger, which nobody opens to check it is being written to.
 *
 * It carries a link rather than a button. The work is a decision — a business
 * may want a short transition year, or to move its year end — so this hands
 * over to the form that offers a suggestion and lets every field be changed,
 * and never creates anything on its own.
 *
 * Shown only to people who hold the grant to open a year. A cashier cannot
 * act on this and should not be given a red banner mid-shift.
 */
export default function FiscalRunway({ notice, href = "/dashboard/periods" }) {
  // `href={null}` on the periods page itself, where the form to do it is the
  // next thing on the screen and a link back to the page you are on is noise.
  if (!notice || notice.level === "ok") return null;

  const Icon = notice.serious ? TriangleAlert : CalendarClock;

  return (
    <section
      role="status"
      className={`flex items-start gap-3 rounded-card px-5 py-4 ${
        notice.serious ? "bg-error-container text-on-error-container" : "bg-warning-container text-on-warning-container"
      }`}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0">
        <p className="text-label-bold">{notice.title}</p>
        <p className="mt-1 text-body-md">{notice.body}</p>
        {href ? (
          <Link
            href={href}
            className="mt-2 inline-block text-label-bold underline hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open the fiscal calendar
          </Link>
        ) : null}
      </div>
    </section>
  );
}
