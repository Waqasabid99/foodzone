"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";

/**
 * Something broke on a storefront page.
 *
 * `retry()` rather than a reload, because this is a server-rendered page whose
 * data read failed: re-running the fetch is exactly the right recovery, and a
 * database that timed out once usually answers the second time. A full reload
 * would also throw away the cart drawer and anything else already in memory.
 *
 * `digest` is shown deliberately. It is the only handle on what actually went
 * wrong — the real message never reaches the browser in production, by design
 * — so a customer who reports "it said ZX4K" gives support something to grep
 * the logs for, which beats "it broke" every time.
 *
 * The error boundary does not wrap the layout in its own segment, so the
 * header, the footer and the cart are all still here. This is one panel in a
 * working page, not a replacement for the site.
 */
export default function SiteError({ error, retry }) {
  useEffect(() => {
    // The server logger does not exist in the browser. This is what reaches
    // the console and any client-side reporting the host has attached.
    console.error("storefront error", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-5 px-margin-mobile py-24 text-center md:px-margin-desktop">
      <TriangleAlert aria-hidden="true" className="size-12 text-error" />

      <h1 className="font-display text-headline-lg text-on-surface">That did not load</h1>

      <p className="text-body-lg text-on-surface-variant">
        Something went wrong at our end rather than yours. Nothing has been ordered and nothing has been charged.
      </p>

      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-full bg-primary px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Try again
        </button>
        <Link
          href="/menu"
          className="rounded-full bg-surface-container-high px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to the menu
        </Link>
      </div>

      {error?.digest ? (
        <p className="text-label-bold font-normal text-on-surface-variant">
          If you tell us about this, quote <code className="rounded bg-surface-container-high px-1.5 py-0.5">{error.digest}</code>
        </p>
      ) : null}
    </div>
  );
}
