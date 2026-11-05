"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * A workspace screen that failed to load.
 *
 * Kept inside the shell: the sidebar is how somebody gets to the rest of their
 * job, and replacing the whole workspace because one report threw is a much
 * bigger outage than the one that actually happened.
 *
 * `retry()` re-runs the server read rather than reloading, which is the right
 * recovery for the common cause here — a database read that timed out under
 * load and will answer on the second attempt.
 */
export default function DashboardError({ error, retry }) {
  useEffect(() => {
    console.error("dashboard error", error);
  }, [error]);

  return (
    <div className="flex max-w-xl flex-col gap-4 py-16">
      <TriangleAlert aria-hidden="true" className="size-10 text-error" />

      <h1 className="font-display text-headline-lg text-on-surface">This screen did not load</h1>

      <p className="text-body-lg text-on-surface-variant">
        Something failed at our end. Nothing you were doing has been saved or changed by this.
      </p>

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try again
        </button>
        <Link
          href="/dashboard"
          className="rounded-field bg-surface-container-high px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to the dashboard
        </Link>
      </div>

      {error?.digest ? (
        <p className="text-label-bold font-normal text-on-surface-variant">
          Reference <code className="rounded bg-surface-container-high px-1.5 py-0.5">{error.digest}</code> — quote it
          if you report this.
        </p>
      ) : null}
    </div>
  );
}
