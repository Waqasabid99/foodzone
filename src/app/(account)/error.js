"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * One of a customer's own screens failed to load.
 *
 * The line that matters here is the second paragraph. Somebody whose orders
 * page just threw an error does not want an apology, they want to know whether
 * their order is still coming and whether they have been charged twice. The
 * answer is no on both counts — a read failing cannot change an order — and
 * saying so is the whole job of this page.
 *
 * `retry()` re-runs the server read rather than reloading, which is the right
 * recovery for the common cause: a read that timed out and will answer on the
 * second attempt.
 */
export default function AccountError({ error, retry }) {
  useEffect(() => {
    console.error("account error", error);
  }, [error]);

  return (
    <div className="flex max-w-xl flex-col gap-4 py-16">
      <TriangleAlert aria-hidden="true" className="size-10 text-error" />

      <h1 className="font-display text-headline-lg text-on-surface">This did not load</h1>

      <p className="text-body-lg text-on-surface-variant">
        Something went wrong at our end. Any order you have placed is unaffected — this is a page that failed to
        read, not an order that failed to go through, and nothing has been charged because of it.
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
          href="/account"
          className="rounded-field bg-surface-container-high px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to my account
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
