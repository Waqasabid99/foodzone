import Link from "next/link";
import { SearchX } from "lucide-react";

export const metadata = { title: "Not found — FoodZone", robots: { index: false, follow: false } };

/**
 * A record that is not there, inside the workspace.
 *
 * Its own file so the sidebar survives. Staff reach these by following a link
 * from a list, and the usual cause is a record somebody else deleted or one
 * that belongs to a branch this person does not cover — out-of-scope reads are
 * deliberately 404 rather than 403, because a 403 confirms the id exists.
 *
 * So it does not say "this does not exist", which would be a lie in the second
 * case. It says what is true either way.
 */
export default function DashboardNotFound() {
  return (
    <div className="flex max-w-xl flex-col gap-4 py-16">
      <SearchX aria-hidden="true" className="size-10 text-on-surface-variant" />

      <h1 className="font-display text-headline-lg text-on-surface">Not here</h1>

      <p className="text-body-lg text-on-surface-variant">
        This record either does not exist or is not one you can open. If somebody sent you the link, they may be
        working at a branch you do not cover.
      </p>

      <Link
        href="/dashboard"
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Back to the dashboard
      </Link>
    </div>
  );
}
