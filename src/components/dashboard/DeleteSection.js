"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * A "delete this" block for a record whose refusal explains itself.
 *
 * The server refuses a delete while something still depends on the record, and
 * says what. That message is the useful part, so it is shown in place rather
 * than as a toast that disappears while it is being read.
 */
export default function DeleteSection({ title, description, endpoint, confirm, redirectTo, success }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);

  async function handle() {
    if (!window.confirm(confirm)) return;
    setPending(true);
    setMessage(null);
    try {
      await api.delete(endpoint);
      toast.success(success);
      router.push(redirectTo);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "It could not be deleted.");
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-card border border-outline-variant p-5 sm:p-6">
      <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
      <p className="text-body-md text-on-surface-variant">{description}</p>
      {message ? (
        <p role="alert" className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
          {message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        className="inline-flex w-fit items-center gap-2 rounded-field border border-error px-4 py-2.5 text-label-bold text-error hover:bg-error-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        <Trash2 aria-hidden="true" className="size-4" />
        {pending ? "Deleting…" : title}
      </button>
    </section>
  );
}
