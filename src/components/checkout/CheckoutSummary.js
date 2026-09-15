"use client";

import { Loader2, Lock, Tag } from "lucide-react";
import { formatMoney } from "@/lib/format";

/**
 * The totals, and the button that commits to them.
 *
 * Every figure is the server's. While a re-quote is in flight the previous
 * figures stay on screen, dimmed, rather than collapsing to a spinner: a total
 * that vanishes each time the tip changes makes the page feel broken, and the
 * old number is still the right one until the new one lands.
 *
 * The quote is also a pre-flight check. `POST /checkout/quote` runs the same
 * guards the real checkout does — branch closed, ordering paused, an item sold
 * out since the basket was filled — so a failure here is shown as the reason
 * the order cannot be placed, not hidden as "totals unavailable".
 */
export default function CheckoutSummary({
  totals,
  currency,
  couponCode,
  quoting,
  quoteError,
  blockers,
  pending,
  onPlace,
}) {
  const figures = totals ?? {};
  const blocked = blockers.length > 0 || Boolean(quoteError);

  return (
    <aside className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-6 lg:sticky lg:top-24">
      <h2 className="font-display text-headline-md text-on-surface">Order total</h2>

      {couponCode ? (
        <p className="flex items-center gap-2 rounded-field bg-success-container px-4 py-3 text-label-bold text-on-success-container">
          <Tag aria-hidden="true" className="size-4" />
          {couponCode}
        </p>
      ) : null}

      <dl
        aria-busy={quoting ? "true" : undefined}
        className={`flex flex-col gap-2 text-body-md transition-opacity ${quoting ? "opacity-60" : ""}`}
      >
        <Row label="Subtotal" value={formatMoney(figures.subtotal, currency)} />

        {figures.discounts?.map((discount, index) => (
          <Row
            key={`${discount.code ?? discount.label}-${index}`}
            label={discount.label ?? discount.code ?? "Discount"}
            value={`− ${formatMoney(discount.amount, currency)}`}
            tone="success"
          />
        ))}

        {figures.deliveryFee ? <Row label="Delivery" value={formatMoney(figures.deliveryFee, currency)} /> : null}
        {figures.packagingFee ? <Row label="Packaging" value={formatMoney(figures.packagingFee, currency)} /> : null}
        {figures.serviceCharge ? (
          <Row label="Service charge" value={formatMoney(figures.serviceCharge, currency)} />
        ) : null}

        {figures.taxTotal ? (
          <Row
            label={figures.pricesIncludeTax ? "Tax (included)" : "Tax"}
            value={formatMoney(figures.taxTotal, currency)}
          />
        ) : null}

        {figures.tipAmount ? <Row label="Tip" value={formatMoney(figures.tipAmount, currency)} /> : null}
        {figures.roundOff ? <Row label="Rounding" value={formatMoney(figures.roundOff, currency)} /> : null}

        <div className="mt-2 flex items-baseline justify-between border-t border-outline-variant pt-3">
          <dt className="font-display text-label-bold uppercase text-on-surface">Total</dt>
          <dd className="font-display text-headline-md text-primary">
            {quoting && figures.grandTotal === undefined ? (
              <Loader2 aria-label="Calculating" className="size-5 animate-spin" />
            ) : (
              formatMoney(figures.grandTotal, currency)
            )}
          </dd>
        </div>
      </dl>

      {quoteError ? (
        <p role="alert" className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {quoteError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onPlace}
        disabled={blocked || pending || quoting}
        className="flex items-center justify-center gap-2 rounded-full bg-primary-container px-6 py-4 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Placing your order…
          </>
        ) : (
          <>
            <Lock aria-hidden="true" className="size-4" />
            Place order
          </>
        )}
      </button>

      {/* The first blocker only. A stack of red text above the button reads as
          a broken page; one clear next step reads as an instruction. */}
      {blockers.length ? (
        <p className="text-center text-label-bold text-on-surface-variant">{blockers[0].message}</p>
      ) : null}
    </aside>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className={tone === "success" ? "text-success" : "text-on-surface"}>{value}</dd>
    </div>
  );
}
