"use client";

import { Wallet } from "lucide-react";
import { formatMoney } from "@/lib/format";

/**
 * Spending creator store credit on this order.
 *
 * Shown only when there is credit that can actually go against *this* bill.
 * Three limits decide that — the balance, the program's minimum redemption and
 * its per-order percentage cap — and the server works out the smallest. This
 * control never computes a ceiling of its own: it offers the figure the server
 * quoted and sends that figure back, so the amount the customer agreed to is
 * the amount checked at checkout.
 *
 * A toggle rather than an amount box. Credit is the restaurant's own money
 * coming back to a customer who earned it, and nobody holding it wants to
 * spend a careful fraction — they want it off the bill. Anyone who does want
 * to keep some simply leaves it unapplied.
 *
 * When the cap bites — credit in the wallet exceeds what this order may take —
 * that is said plainly. A customer with 500 who can only use 300 and is told
 * nothing concludes the balance is wrong.
 */
export default function StoreCreditPicker({ available, redeemable, maxPercent, orderTotal = 0, currency, applied, onChange }) {
  if (!(redeemable > 0)) return null;

  /*
   * Why the whole balance is not on offer, which is not always the same
   * reason. A balance bigger than the bill is limited by the bill; a balance
   * bigger than the cap allows is limited by the cap. Naming a percentage
   * that is not actually binding — "up to 100%" on a 690 bill against 2,110
   * of credit — explains nothing and sounds like a restriction that is not
   * there.
   */
  const capped = available > redeemable;
  const coversBill = orderTotal > 0 && redeemable >= orderTotal;

  return (
    <fieldset className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-6">
      <legend className="text-label-bold text-on-surface">Store credit</legend>

      <p className="flex items-center gap-2 text-body-md text-on-surface-variant">
        <Wallet aria-hidden="true" className="size-4" />
        You have {formatMoney(available, currency)} in credit.
      </p>

      <button
        type="button"
        onClick={() => onChange(!applied)}
        aria-pressed={applied}
        className={`self-start rounded-full px-5 py-2.5 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
          applied
            ? "bg-primary-container text-on-primary-container"
            : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
        }`}
      >
        {applied ? "Applied" : "Use"} {formatMoney(redeemable, currency)}
      </button>

      {capped ? (
        <p className="text-label-bold text-on-surface-variant">
          {coversBill
            ? "That covers this order in full. The rest stays in your wallet."
            : maxPercent
              ? `Up to ${maxPercent}% of an order can be paid with credit, so the rest stays in your wallet.`
              : "The rest stays in your wallet for another order."}
        </p>
      ) : null}
    </fieldset>
  );
}
