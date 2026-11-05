"use client";

import { useState } from "react";
import ReviewForm from "@/components/account/ReviewForm";

/**
 * "You ate this — say something?"
 *
 * One form open at a time. Several expanded at once invites somebody to fill
 * in two and submit one, and lose the other.
 */
export default function ReviewPrompts({ orders }) {
  const [open, setOpen] = useState(null);
  if (!orders.length) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-headline-md text-on-surface">Anything to say about these?</h2>
      <ul className="flex flex-col gap-3">
        {orders.map((order) => (
          <li key={order.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
            <p className="font-mono text-label-bold text-on-surface">{order.orderNumber}</p>
            <ul className="flex flex-col gap-2">
              {order.items.map((item) => {
                const key = `${order.id}:${item.id}`;
                return (
                  <li key={item.id} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-body-md text-on-surface">{item.nameSnapshot}</span>
                      {open === key ? null : (
                        <button
                          type="button"
                          onClick={() => setOpen(key)}
                          className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          Review it
                        </button>
                      )}
                    </div>
                    {open === key ? (
                      <ReviewForm order={order} item={item} onDone={() => setOpen(null)} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
