"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Ban, CircleCheck } from "lucide-react";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * Suspending and restoring an account.
 *
 * Both consequences are stated before the click, because they land on a person:
 * suspending signs them out everywhere and emails them, restoring lets them
 * straight back in.
 */
export default function CustomerActions({ customer }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);
  const suspended = customer.status === "SUSPENDED";

  async function change(status) {
    const question = suspended
      ? `Let ${customer.name} sign in and order again?`
      : `Suspend ${customer.name}? They are signed out everywhere and cannot order until you restore them. They are told by email.`;
    if (!window.confirm(question)) return;

    setPending(true);
    setMessage(null);
    try {
      await api.put(`/admin/customers/${customer.id}/status`, { status });
      toast.success(status === "SUSPENDED" ? `${customer.name} suspended.` : `${customer.name} restored.`);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      title={suspended ? "Restore access" : "Suspend access"}
      description={
        suspended
          ? "They cannot sign in or order at the moment."
          : "Blocks ordering and signing in without deleting anything. Their orders and reviews stay as they are."
      }
    >
      <FormAlert>{message}</FormAlert>
      <button
        type="button"
        onClick={() => change(suspended ? "ACTIVE" : "SUSPENDED")}
        disabled={pending}
        className={`inline-flex w-fit items-center gap-2 rounded-field px-5 py-3 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
          suspended ? "bg-primary-container text-on-primary-container" : "border border-error text-error hover:bg-error-container"
        }`}
      >
        {suspended ? <CircleCheck aria-hidden="true" className="size-4" /> : <Ban aria-hidden="true" className="size-4" />}
        {pending ? "Saving…" : suspended ? "Restore access" : "Suspend access"}
      </button>
    </Section>
  );
}
