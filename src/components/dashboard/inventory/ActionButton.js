"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";

const TONES = {
  primary: "bg-primary-container text-on-primary-container hover:shadow-e2",
  neutral: "bg-surface-container-high text-on-surface hover:bg-surface-container-highest",
  danger: "border border-error text-error hover:bg-error-container",
};

/**
 * One server action behind a button: confirm, call, say what happened.
 *
 * A refusal is shown beside the button rather than as a toast, because it is
 * the explanation ("someone else just approved this") and a toast disappears
 * while it is being read.
 */
export default function ActionButton({
  method = "post",
  endpoint,
  body = undefined,
  confirm = null,
  success,
  tone = "neutral",
  redirectTo = null,
  children,
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);

  async function run() {
    if (pending) return;
    if (confirm && !window.confirm(confirm)) return;
    setPending(true);
    setMessage(null);
    try {
      await (method === "delete" ? api.delete(endpoint) : api[method](endpoint, body));
      if (success) toast.success(success);
      if (redirectTo) router.push(redirectTo);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That did not work. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className={`w-fit rounded-field px-5 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${TONES[tone]}`}
      >
        {pending ? "Working…" : children}
      </button>
      {message ? (
        <p role="alert" className="max-w-md rounded-field bg-error-container px-3 py-2 text-body-md text-on-error-container">{message}</p>
      ) : null}
    </div>
  );
}
