"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

/**
 * The two notes on an order, which are for two different people.
 *
 * The kitchen note is an instruction — "no onions, allergy" — and the customer
 * note is what the customer said. They are kept apart because a cook scanning
 * a ticket must not have to read past "please ring the bell twice" to find the
 * allergy.
 */
export default function OrderNotes({ order, canEdit }) {
  const router = useRouter();
  const [kitchenNote, setKitchen] = useState(order.kitchenNote ?? "");
  const [customerNote, setCustomer] = useState(order.customerNote ?? "");
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const dirty = kitchenNote !== (order.kitchenNote ?? "") || customerNote !== (order.customerNote ?? "");

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || !dirty) return;
    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/orders/${order.id}/notes`, {
        kitchenNote: kitchenNote.trim() || null,
        customerNote: customerNote.trim() || null,
      });
      toast.success("Notes saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "They could not be saved.");
    } finally {
      setPending(false);
    }
  }

  if (!canEdit) {
    return order.kitchenNote || order.customerNote ? (
      <ul className="flex flex-col gap-2 text-body-md text-on-surface">
        {order.kitchenNote ? <li><span className="text-on-surface-variant">For the kitchen: </span>{order.kitchenNote}</li> : null}
        {order.customerNote ? <li><span className="text-on-surface-variant">From the customer: </span>{order.customerNote}</li> : null}
      </ul>
    ) : (
      <p className="text-body-md text-on-surface-variant">No notes on this order.</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <TextAreaField
        id="order-kitchen-note"
        label="For the kitchen"
        rows={2}
        value={kitchenNote}
        onChange={(event) => setKitchen(event.target.value)}
        placeholder="No onions — allergy. Extra napkins."
      />
      <TextAreaField
        id="order-customer-note"
        label="From the customer"
        rows={2}
        value={customerNote}
        onChange={(event) => setCustomer(event.target.value)}
        placeholder="Ring the bell twice, the gate is round the back"
      />
      <button
        type="submit"
        disabled={pending || !dirty}
        className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Saving…" : "Save notes"}
      </button>
    </form>
  );
}
