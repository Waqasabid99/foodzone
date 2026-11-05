"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { RotateCcw } from "lucide-react";
import { api } from "@/lib/api-client";
import { loadCart } from "@/hooks/useCart";
import { useSession } from "@/hooks/useSession";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";

/**
 * "Order again", for somebody who has ordered before.
 *
 * The highest-intent thing the home page can show a returning customer: most
 * people who come back want the thing they had last time, and the shortest
 * path to it is one button rather than a search, a product page and a set of
 * choices they already made once.
 *
 * **It replaces the banner rather than sitting beside it.** A hero carrying a
 * campaign *and* a reorder prompt is two first things, which is none. A
 * campaign is for people deciding what to eat; this is for somebody who has
 * already decided.
 *
 * **The server-rendered banner is this component's fallback, passed in as
 * children.** The session resolves in the browser, so the banner is what
 * paints first and this replaces it only once there is a real order to offer.
 * That keeps the largest contentful paint in the initial HTML, which a
 * signed-in-only hero would not — and it avoids stacking one on top of the
 * other, where the two have no reason to be the same height.
 */
export default function HomeHero({ currency = "PKR", timeZone = "UTC", children }) {
  const { status, user } = useSession();
  const router = useRouter();
  const [order, setOrder] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status !== "authenticated" || !user) return undefined;
    let cancelled = false;

    (async () => {
      try {
        /*
         * Two reads, because the list and the detail are different shapes.
         *
         * `/me/orders` returns a summary — no lines, and only `branchId` — so
         * a prompt built from it would say "Order again?" above an empty list
         * of what. The detail carries the items and the branch, which is the
         * entire content of this card.
         */
        const page = await api.get("/me/orders?limit=1");
        const last = page?.items?.[0] ?? null;

        // Only an order that actually completed. Offering to repeat one that
        // was cancelled or refunded is the shop asking for the sale it just
        // failed to make.
        if (!last || !["DELIVERED", "COMPLETED"].includes(last.status)) return;

        const detail = await api.get(`/me/orders/${last.id}`);
        if (!cancelled && detail?.items?.length) setOrder(detail);
      } catch {
        // No prompt rather than an error: this is an upsell, not the page.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, user]);

  // The server-rendered banner, until there is something better to show.
  if (!order) return children;

  const lines = (order.items ?? []).filter((item) => !item.parentItemId);
  const summary = lines
    .slice(0, 3)
    .map((item) => `${item.quantity}× ${item.nameSnapshot}`)
    .join(", ");
  const more = lines.length - 3;

  async function again() {
    if (busy) return;
    setBusy(true);

    try {
      const result = await api.post(`/me/orders/${order.id}/reorder`, {});
      await loadCart({ force: true });

      // The part that cannot be a silent success: a basket rebuilt without the
      // thing somebody actually wanted looks like it worked until it arrives.
      if (result?.unavailable?.length) {
        toast.warning(
          `Added what we could. Not available: ${result.unavailable.map((row) => row.name).join(", ")}.`,
        );
      } else {
        toast.success("Added to your order.");
      }

      router.push("/cart");
    } catch (error) {
      toast.error(error?.message ?? "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="relative isolate overflow-hidden rounded-banner bg-surface-container-low">
      <div className="flex flex-col gap-6 px-6 py-10 sm:px-10 md:py-14 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-label-bold uppercase tracking-widest text-primary">Welcome back</p>

          <h1 className="mt-2 font-display text-headline-lg text-on-surface">Order again?</h1>

          <p className="mt-3 max-w-xl text-body-lg text-on-surface-variant">
            {summary}
            {more > 0 ? ` and ${more} more` : ""}
          </p>

          <p className="mt-1 text-body-md text-on-surface-variant">
            {order.branch?.name ? `${order.branch.name} · ` : ""}
            {dateLabel(order.placedAt, timeZone)}
            {order.grandTotal != null ? ` · ${formatMoney(order.grandTotal, order.currency ?? currency)}` : ""}
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap gap-3">
          <button
            type="button"
            onClick={again}
            disabled={busy}
            className="flex items-center gap-2 rounded-full bg-primary px-8 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary transition-shadow hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            {busy ? "Adding…" : "Order it again"}
          </button>

          <Link
            href="/menu"
            className="rounded-full border-2 border-outline px-8 py-3 font-display text-label-bold uppercase tracking-wide text-on-surface transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Something else
          </Link>
        </div>
      </div>
    </section>
  );
}
