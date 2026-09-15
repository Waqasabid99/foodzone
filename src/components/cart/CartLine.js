"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { AlertTriangle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import { formatMoney } from "@/lib/format";
import { removeCartItem, updateCartItem } from "@/hooks/useCart";

const MAX_QUANTITY = 99;

/**
 * One line in the basket.
 *
 * Every change goes to the server and the whole repriced cart comes back, so
 * the line never does arithmetic of its own. That matters more here than
 * anywhere else on the site: a quantity change can cross a promotion's
 * threshold, push the basket over a free-delivery minimum, or change the tax —
 * none of which a client-side multiply would notice.
 */
export default function CartLine({ line, currency }) {
  const [pending, setPending] = useState(false);

  // A line the kitchen can no longer serve comes back with `problem` and no
  // price. It is still shown, because silently dropping something a customer
  // chose is worse than telling them it is gone.
  const unavailable = Boolean(line.problem);

  async function change(next) {
    if (pending) return;
    setPending(true);

    try {
      if (next <= 0) {
        await removeCartItem(line.id);
        toast.info(`${line.name} removed.`);
      } else {
        await updateCartItem(line.id, { quantity: next });
      }
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPending(false);
    }
  }

  return (
    <li
      className={`flex gap-4 rounded-card bg-surface-container-lowest p-4 ${
        unavailable ? "opacity-80 ring-1 ring-error" : ""
      }`}
    >
      <div className="relative size-20 shrink-0 overflow-hidden rounded-field sm:size-24">
        <FoodImage src={line.imageUrl} alt="" sizes="96px" className="size-full" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-label-bold text-on-surface">
            {line.slug ? (
              <Link
                href={`/menu/${line.slug}`}
                className="hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {line.name}
              </Link>
            ) : (
              line.name
            )}
          </h3>

          {unavailable ? null : (
            <p className="font-display text-label-bold text-primary">
              {formatMoney(line.lineTotal, currency)}
            </p>
          )}
        </div>

        {line.variantName ? (
          <p className="text-label-bold font-normal text-on-surface-variant">{line.variantName}</p>
        ) : null}

        {/* Grouped by the group they came from, because "Sauces: Ranch" reads
            as a choice and a bare "Ranch" reads as a mystery. */}
        {line.modifiers?.length ? (
          <ul className="text-label-bold font-normal text-on-surface-variant">
            {line.modifiers.map((modifier) => (
              <li key={`${modifier.optionId}-${modifier.groupId}`}>
                {modifier.groupName ? `${modifier.groupName}: ` : ""}
                {modifier.name}
                {modifier.quantity > 1 ? ` ×${modifier.quantity}` : ""}
                {modifier.priceDelta ? ` (+${formatMoney(modifier.priceDelta, currency)})` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {line.notes ? (
          <p className="text-label-bold font-normal italic text-on-surface-variant">“{line.notes}”</p>
        ) : null}

        {unavailable ? (
          <p role="alert" className="mt-1 flex items-center gap-1.5 text-label-bold text-error">
            <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
            {line.problem}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          {unavailable ? (
            <span className="text-label-bold font-normal text-on-surface-variant">
              Remove it to continue
            </span>
          ) : (
            <div className="flex items-center gap-1 rounded-full bg-surface-container-low p-1">
              <button
                type="button"
                onClick={() => change(line.quantity - 1)}
                disabled={pending}
                aria-label={line.quantity <= 1 ? `Remove ${line.name}` : `One less ${line.name}`}
                className="grid size-8 place-items-center rounded-full text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
              >
                {line.quantity <= 1 ? (
                  <Trash2 aria-hidden="true" className="size-3.5" />
                ) : (
                  <Minus aria-hidden="true" className="size-3.5" />
                )}
              </button>

              <span aria-live="polite" className="min-w-8 text-center text-label-bold text-on-surface">
                {pending ? <Loader2 aria-hidden="true" className="mx-auto size-3.5 animate-spin" /> : line.quantity}
              </span>

              <button
                type="button"
                onClick={() => change(line.quantity + 1)}
                disabled={pending || line.quantity >= MAX_QUANTITY}
                aria-label={`One more ${line.name}`}
                className="grid size-8 place-items-center rounded-full text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
              >
                <Plus aria-hidden="true" className="size-3.5" />
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => change(0)}
            disabled={pending}
            className="text-label-bold text-on-surface-variant underline underline-offset-2 transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
          >
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}
