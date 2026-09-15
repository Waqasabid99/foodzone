"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { ArrowRight, Loader2, Tag, X } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { applyCoupon, removeCoupon } from "@/hooks/useCart";

/**
 * The totals panel.
 *
 * Every figure here comes from the server's pricing engine — subtotal,
 * discounts, fees, tax, rounding. Nothing is recomputed in the browser, so what
 * the basket says is what checkout will charge, including the rounding
 * adjustment that only the server can decide.
 *
 * Rows for fees that are zero are hidden rather than shown as "PKR 0". A line
 * of zeroes reads as a charge that might appear later; its absence reads as no
 * charge, which is what it is.
 */
export default function CartSummary({ cart, currency, canCheckout, blockedReason }) {
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);

  const totals = cart.totals ?? {};
  const shortfall = cart.minimumOrderAmount ? cart.minimumOrderAmount - (totals.subtotal ?? 0) : 0;

  async function submitCoupon(event) {
    event.preventDefault();
    if (pending || !code.trim()) return;

    setPending(true);
    try {
      await applyCoupon(code.trim());
      setCode("");
      toast.success("Code applied.");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPending(false);
    }
  }

  async function drop() {
    setPending(true);
    try {
      await removeCoupon();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-6 lg:sticky lg:top-24">
      <h2 className="font-display text-headline-md text-on-surface">Order summary</h2>

      {cart.couponCode ? (
        <p className="flex items-center justify-between gap-2 rounded-field bg-success-container px-4 py-3 text-label-bold text-on-success-container">
          <span className="flex items-center gap-2">
            <Tag aria-hidden="true" className="size-4" />
            {cart.couponCode}
          </span>
          <button
            type="button"
            onClick={drop}
            disabled={pending}
            aria-label={`Remove code ${cart.couponCode}`}
            className="grid size-6 place-items-center rounded-full hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </p>
      ) : (
        <form onSubmit={submitCoupon} className="flex gap-2">
          <label htmlFor="coupon" className="sr-only">
            Promo code
          </label>
          <input
            id="coupon"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Promo code"
            className="min-w-0 flex-1 rounded-field bg-surface-container-low px-4 py-2.5 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
          <button
            type="submit"
            disabled={pending || !code.trim()}
            className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50"
          >
            {pending ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : "Apply"}
          </button>
        </form>
      )}

      {/* Offers the server refused, with its reason. Silently dropping a code
          someone typed leaves them thinking the site is broken. */}
      {cart.rejectedDiscounts?.length ? (
        <ul className="text-label-bold font-normal text-on-surface-variant">
          {cart.rejectedDiscounts.map((rejected, index) => (
            <li key={`${rejected.code ?? rejected.label ?? "offer"}-${index}`}>
              {rejected.label ?? rejected.code}: {rejected.reason ?? "not eligible"}
            </li>
          ))}
        </ul>
      ) : null}

      <dl className="flex flex-col gap-2 text-body-md">
        <Row label="Subtotal" value={formatMoney(totals.subtotal, currency)} />

        {cart.discounts?.map((discount, index) => (
          <Row
            key={`${discount.code ?? discount.label}-${index}`}
            label={discount.label ?? discount.code ?? "Discount"}
            value={`− ${formatMoney(discount.amount, currency)}`}
            tone="success"
          />
        ))}

        {totals.deliveryFee ? <Row label="Delivery" value={formatMoney(totals.deliveryFee, currency)} /> : null}
        {totals.packagingFee ? <Row label="Packaging" value={formatMoney(totals.packagingFee, currency)} /> : null}
        {totals.serviceCharge ? <Row label="Service charge" value={formatMoney(totals.serviceCharge, currency)} /> : null}

        {/* Where menu prices already include tax, the tax is stated as
            "included" rather than added on — adding it would double-count, and
            omitting it entirely hides a figure receipts have to show. */}
        {totals.taxTotal ? (
          <Row
            label={totals.pricesIncludeTax ? "Tax (included)" : "Tax"}
            value={formatMoney(totals.taxTotal, currency)}
            muted={totals.pricesIncludeTax}
          />
        ) : null}

        {totals.roundOff ? <Row label="Rounding" value={formatMoney(totals.roundOff, currency)} /> : null}

        <div className="mt-2 flex items-baseline justify-between border-t border-outline-variant pt-3">
          <dt className="font-display text-label-bold uppercase text-on-surface">Total</dt>
          <dd className="font-display text-headline-md text-primary">
            {formatMoney(totals.grandTotal, currency)}
          </dd>
        </div>
      </dl>

      {shortfall > 0 ? (
        <p className="rounded-field bg-warning-container px-4 py-3 text-label-bold text-on-warning-container">
          Add {formatMoney(shortfall, currency)} more to reach the{" "}
          {formatMoney(cart.minimumOrderAmount, currency)} minimum order.
        </p>
      ) : null}

      {canCheckout ? (
        <Link
          href="/checkout"
          className="flex items-center justify-center gap-2 rounded-full bg-primary-container px-6 py-4 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Proceed to checkout
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : (
        <p className="rounded-full bg-surface-container-high px-6 py-4 text-center text-label-bold text-on-surface-variant">
          {blockedReason}
        </p>
      )}

      <Link
        href="/menu"
        className="text-center text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Add more items
      </Link>
    </aside>
  );
}

function Row({ label, value, tone, muted = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "text-on-surface-variant" : "text-on-surface-variant"}>{label}</dt>
      <dd className={tone === "success" ? "text-success" : "text-on-surface"}>{value}</dd>
    </div>
  );
}
