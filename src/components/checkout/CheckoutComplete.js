"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";

/**
 * Confirms a payment after the gateway hands the customer back.
 *
 * The rule this component exists to enforce: **the redirect is not the
 * result.** The gateway appends its own parameters to the return URL, but
 * anybody can type that URL, and a customer who closes the tab at the wrong
 * moment never visits it at all. The money is only real once the signed
 * webhook has been received and applied.
 *
 * So this polls our own record of the order rather than reading anything out
 * of the query string. Until the callback lands it says the payment is being
 * confirmed — which is the truth, and is also what the customer would want to
 * be told if their bank had taken the money and we had not heard yet.
 *
 * Polling stops on a settled state, and gives up after a bounded number of
 * tries so a page left open overnight is not asking forever. Giving up says
 * "we are still waiting", never "it failed": the webhook may still arrive, and
 * telling someone their payment failed when it has not is the worse error.
 */
const ATTEMPTS = 20;
const INTERVAL_MS = 3000;

export default function CheckoutComplete({ orderId, cancelled }) {
  const [state, setState] = useState(orderId ? "CHECKING" : "UNKNOWN");
  const [order, setOrder] = useState(null);
  const tries = useRef(0);

  useEffect(() => {
    if (!orderId) return undefined;

    let live = true;
    let timer = null;

    async function look() {
      if (!live) return;
      tries.current += 1;

      try {
        const found = await api.get(`/checkout/payment-status?order=${encodeURIComponent(orderId)}`);
        if (!live) return;
        setOrder(found);

        if (found?.paymentState === "PAID") return setState("PAID");
        if (found?.paymentState === "PARTIALLY_PAID") return setState("PARTIAL");
      } catch {
        // A lookup that fails is not an answer about the payment. Keep asking.
      }

      if (!live) return;
      if (tries.current >= ATTEMPTS) return setState("STILL_WAITING");
      timer = setTimeout(look, INTERVAL_MS);
    }

    look();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [orderId]);

  const reference = order?.reference ?? null;

  if (!orderId) {
    return (
      <Shell title="We could not tell which order this was">
        <p>If you have just paid, your order is safe. Check it under your orders, or ask the branch.</p>
        <Actions />
      </Shell>
    );
  }

  if (cancelled && state !== "PAID") {
    return (
      <Shell title="Payment cancelled">
        <p>
          Your order {reference ? <strong>{reference}</strong> : null} is still placed and unpaid. You can pay at the
          counter, or on delivery.
        </p>
        <Actions reference={reference} />
      </Shell>
    );
  }

  if (state === "PAID") {
    return (
      <Shell title="Payment received">
        <p>
          Thank you. Order {reference ? <strong>{reference}</strong> : null} is paid and on its way to the kitchen.
        </p>
        <Actions reference={reference} />
      </Shell>
    );
  }

  if (state === "PARTIAL") {
    return (
      <Shell title="Part of your payment came through">
        <p>
          Order {reference ? <strong>{reference}</strong> : null} is partly paid. The balance can be settled at the
          counter.
        </p>
        <Actions reference={reference} />
      </Shell>
    );
  }

  if (state === "STILL_WAITING") {
    return (
      <Shell title="Still confirming your payment">
        <p>
          Your order {reference ? <strong>{reference}</strong> : null} is placed. If your bank has taken the money it
          will show here shortly — nothing is lost, and you will not be charged twice.
        </p>
        <Actions reference={reference} />
      </Shell>
    );
  }

  return (
    <Shell title="Confirming your payment">
      <p>
        One moment. Your order {reference ? <strong>{reference}</strong> : null} is placed and we are waiting for your
        bank to confirm.
      </p>
      <p className="text-on-surface-variant">Please do not close this page or pay again.</p>
    </Shell>
  );
}

function Shell({ title, children }) {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 text-center">
      <h1 className="font-display text-headline-md text-on-surface">{title}</h1>
      <div className="flex flex-col gap-2 text-body-lg text-on-surface">{children}</div>
    </div>
  );
}

function Actions({ reference = null }) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-3">
      <Link
        href={reference ? `/orders?reference=${encodeURIComponent(reference)}` : "/orders"}
        className="rounded-full bg-primary px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        See your order
      </Link>
      <Link
        href="/menu"
        className="rounded-full bg-surface-container-high px-6 py-3 font-display text-label-bold uppercase tracking-wide text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Back to the menu
      </Link>
    </div>
  );
}
