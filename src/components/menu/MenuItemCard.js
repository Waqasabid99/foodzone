"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { Check, Loader2, Plus } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import { formatMoney } from "@/lib/format";
import { addCartItem } from "@/hooks/useCart";
import { openLocationPicker } from "@/hooks/useLocationPicker";
import { isBranchRequired, NO_BRANCHES_MESSAGE } from "@/lib/cart-errors";

const DIETARY_LABELS = {
  VEG: "Veg",
  VEGAN: "Vegan",
  HALAL: "Halal",
  GLUTEN_FREE: "Gluten free",
};

/**
 * One item on the menu.
 *
 * The Add button writes to the real server cart rather than to a local list.
 * That matters more than it looks: the server prices the line against the
 * branch's live menu, refuses an item that has been 86'd, and applies modifier
 * and combo rules — so a line that lands in the basket is one that will survive
 * checkout. A client-side cart can only find that out at the last step.
 *
 * Items with more than one size do not add straight from here. Picking a size
 * on behalf of the customer is the sort of helpfulness that ends in the wrong
 * thing arriving, so those link through to the product page instead.
 */
export default function MenuItemCard({
  item,
  currency,
  branchId,
  canChooseBranch = false,
  orderingAvailable = true,
  size = "md",
}) {
  const [pending, setPending] = useState(false);
  const [added, setAdded] = useState(false);

  const large = size === "lg";
  const multipleSizes = item.variants.length > 1;
  const variant = item.variants[0] ?? null;
  const soldOut = !item.available;

  // With no outlet configured there is nothing to order from, and an Add button
  // that can only ever fail is a worse answer than no Add button: the menu is
  // still worth reading, so the item stays and only the promise goes.
  const orderable = orderingAvailable;

  async function handleAdd() {
    if (pending || soldOut) return;
    setPending(true);

    try {
      await addCartItem({
        productId: item.id,
        variantId: variant?.variantId ?? null,
        quantity: 1,
        branchId,
      });

      setAdded(true);
      toast.success(`${item.name} added to your order.`);
      // Back to "Add" shortly: the tick confirms this press, it is not a state
      // the button stays in.
      setTimeout(() => setAdded(false), 1600);
    } catch (error) {
      // "Choose a branch" is a question, so ask it rather than reporting it.
      if (isBranchRequired(error)) {
        if (canChooseBranch) {
          openLocationPicker();
          toast.info("Choose a location to order from.");
        } else {
          toast.error(NO_BRANCHES_MESSAGE);
        }
      } else {
        toast.error(error.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-card bg-surface-container-lowest shadow-e1 transition-shadow hover:shadow-e2 ${
        soldOut ? "opacity-70" : ""
      }`}
    >
      <div className={`relative ${large ? "aspect-4/3" : "aspect-square"} w-full overflow-hidden`}>
        <FoodImage
          src={item.imageUrl}
          alt={item.name}
          sizes={large ? "(max-width: 1024px) 100vw, 640px" : "(max-width: 640px) 50vw, 320px"}
          className="size-full transition-transform duration-300 group-hover:scale-105"
        />

        <div className="absolute inset-x-2 top-2 flex flex-wrap gap-1">
          {item.isRecommended ? <Badge tone="primary">Chef&apos;s pick</Badge> : null}
          {item.dietary?.slice(0, 1).map((code) => (
            <Badge key={code} tone="success">
              {DIETARY_LABELS[code] ?? code}
            </Badge>
          ))}
          {soldOut ? <Badge tone="muted">Sold out</Badge> : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-1 p-4">
        <h3 className={`font-display ${large ? "text-headline-md" : "text-label-bold"} text-on-surface`}>
          <Link
            href={`/menu/${item.slug}`}
            className="hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {item.name}
          </Link>
        </h3>

        {item.shortDescription ? (
          <p className="line-clamp-2 text-body-md text-on-surface-variant">{item.shortDescription}</p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-2 pt-3">
          <p className="flex flex-col">
            <span className="font-display text-label-bold text-primary">
              {multipleSizes ? "From " : ""}
              {formatMoney(item.priceFrom, currency)}
            </span>
            {item.compareAtPrice && item.compareAtPrice > item.priceFrom ? (
              <span className="text-label-bold font-normal text-on-surface-variant line-through">
                {formatMoney(item.compareAtPrice, currency)}
              </span>
            ) : null}
          </p>

          {!orderable ? (
            <Link
              href={`/menu/${item.slug}`}
              className="rounded-full bg-surface-container-high px-4 py-2 text-label-bold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              View
            </Link>
          ) : multipleSizes ? (
            <Link
              href={`/menu/${item.slug}`}
              className="rounded-full bg-surface-container-high px-4 py-2 text-label-bold text-on-surface transition-colors hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Choose size
            </Link>
          ) : (
            <button
              type="button"
              onClick={handleAdd}
              disabled={pending || soldOut}
              aria-label={soldOut ? `${item.name} is sold out` : `Add ${item.name} to your order`}
              className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : added ? (
                <Check aria-hidden="true" className="size-4" />
              ) : (
                <Plus aria-hidden="true" className="size-4" />
              )}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function Badge({ tone, children }) {
  const tones = {
    primary: "bg-primary-container text-on-primary-container",
    success: "bg-success-container text-on-success-container",
    muted: "bg-inverse-surface text-inverse-on-surface",
  };

  return <span className={`rounded-full px-2 py-0.5 text-label-bold ${tones[tone]}`}>{children}</span>;
}
