"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { canCancel, needsAction } from "@/lib/account";

const METHODS = [
  { value: "CARD", label: "Card" },
  { value: "UPI", label: "UPI" },
  { value: "NET_BANKING", label: "Net banking" },
  { value: "WALLET", label: "Wallet" },
];

/**
 * The two things a customer can still do to their own order.
 *
 * **Paying** is offered only while something is actually owed. Cash on
 * delivery is deliberately not in the list: the restaurant marks that
 * received, and letting a customer select it here would be marking their own
 * order paid for nothing.
 *
 * **Cancelling** is offered only before the kitchen has started. The server
 * decides for certain; this just avoids showing a button whose only possible
 * outcome is a refusal the person cannot act on. Asking for a reason is not
 * bureaucracy — it is the only signal the restaurant gets about why orders
 * fall over, and it is one short box.
 */
export default function OrderActions({ order }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [method, setMethod] = useState("CARD");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const outstanding = needsAction(order);
  const cancellable = canCancel(order);
  if (!outstanding && !cancellable) return null;

  async function pay() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.post(`/me/orders/${order.id}/pay`, {
        method,
        returnUrl: `${window.location.origin}/account/orders/${order.id}`,
      });
      // A gateway that needs the customer to finish somewhere else sends back
      // where to go; one that settled immediately does not.
      if (result?.clientAction?.url) {
        window.location.href = result.clientAction.url;
        return;
      }
      toast.success("Payment received.");
      setMode(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  async function cancel() {
    if (pending || !reason.trim()) return;
    setPending(true);
    setError(null);
    try {
      await api.post(`/me/orders/${order.id}/cancel`, { reason: reason.trim() });
      toast.success("Order cancelled.");
      setMode(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FormAlert>{error}</FormAlert>

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {outstanding ? (
            <button
              type="button"
              onClick={() => setMode("pay")}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Pay now
            </button>
          ) : null}
          {cancellable ? (
            <button
              type="button"
              onClick={() => setMode("cancel")}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Cancel this order
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "pay" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <SelectField
            id={`pay-method-${order.id}`}
            label="How would you like to pay?"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            options={METHODS}
            hint="Paying cash on delivery? Nothing to do here — pay the rider."
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={pay}
              disabled={pending}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60"
            >
              {pending ? "Taking payment…" : "Continue"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {mode === "cancel" ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-low p-4">
          <p className="text-body-md text-on-surface">
            Once the kitchen starts cooking this cannot be undone here — you would need to ring the restaurant.
          </p>
          <Field
            id={`cancel-reason-${order.id}`}
            label="What went wrong?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            hint="One line is plenty. It is the only way the restaurant finds out."
            autoComplete="off"
            required
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending || !reason.trim()}
              className="rounded-field bg-error-container px-5 py-2.5 text-label-bold text-on-error-container hover:shadow-e2 disabled:opacity-60"
            >
              {pending ? "Cancelling…" : "Cancel the order"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Keep it
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
