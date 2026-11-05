"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * Issues a temporary password for someone who cannot get at their email.
 *
 * Shown once, right here, and never again: it is not stored in readable form
 * and it is not emailed, because an email that carries a password turns a
 * mailbox into a way into the account. Issuing one signs the person out
 * everywhere and leaves their account able to do nothing until they choose a
 * password of their own.
 */
export default function TemporaryPassword({ user }) {
  const router = useRouter();
  const [password, setPassword] = useState(null);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  async function issue() {
    if (pending) return;
    if (!window.confirm(`Give ${user.name} a temporary password? They will be signed out everywhere and must choose a new password to carry on.`)) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.post(`/admin/users/${user.id}/password`);
      setPassword(result.password);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "A password could not be set.");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (password) {
    return (
      <div className="flex flex-col gap-3 rounded-field bg-warning-container p-4 text-on-warning-container">
        <p className="text-label-bold">Read this out to {user.name} now — it is not shown again.</p>
        <p className="select-all break-all font-mono text-headline-md" aria-label="Temporary password">{password}</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={copy} className="rounded-field bg-surface-container-lowest px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={() => setPassword(null)} className="text-label-bold underline">Done</button>
        </div>
        <p className="text-body-md">They will be asked to choose their own password as soon as they sign in. Until they do, their account cannot do anything else.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={issue}
        disabled={pending}
        className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <KeyRound aria-hidden="true" className="size-4" />
        {pending ? "Setting…" : "Set a temporary password"}
      </button>
      {error ? <p className="text-label-bold text-error">{error}</p> : null}
      <p className="text-body-md text-on-surface-variant">
        For staff with no email they can reach. Everyone else should use the invitation or the forgotten-password link, so nobody but they ever knows their password.
      </p>
    </div>
  );
}
