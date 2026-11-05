"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Joining the creator programme.
 *
 * Accepting the terms is a real checkbox rather than fine print under the
 * button, because the acceptance is recorded against the version they saw and
 * is the thing that would be produced if a payout were ever disputed. A
 * tick-box somebody actually ticked is worth something; a line of text under
 * a button is not.
 *
 * The handle is optional — the server picks one from the display name. Asking
 * for it up front turns "join" into a naming decision, and the first thing a
 * creator wants to do is film something.
 */
export default function JoinCreator({ terms }) {
  const router = useRouter();
  const [form, setForm] = useState({ displayName: "", handle: "", bio: "" });
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));

  async function join(event) {
    event.preventDefault();
    if (pending || !accepted || !form.displayName.trim()) return;
    setPending(true);
    setError(null);
    try {
      await api.post("/me/creator", {
        displayName: form.displayName.trim(),
        ...(form.handle.trim() ? { handle: form.handle.trim() } : {}),
        ...(form.bio.trim() ? { bio: form.bio.trim() } : {}),
        acceptTerms: true,
      });
      toast.success("You are in. Film something you ordered.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={join} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <h2 className="font-display text-headline-md text-on-surface">Join the creator programme</h2>
      <FormAlert>{error}</FormAlert>

      <p className="text-body-md text-on-surface-variant">
        Film the food you ordered, and when your video sells something you earn store credit to spend here.
      </p>

      <Field
        id="creator-name"
        label="Name to show on your videos"
        value={form.displayName}
        onChange={set("displayName")}
        autoComplete="nickname"
        required
      />
      <Field
        id="creator-handle"
        label="Handle"
        value={form.handle}
        onChange={set("handle")}
        hint="Optional — we will make one from your name if you leave it."
        autoComplete="off"
      />
      <Field
        id="creator-bio"
        label="A line about you"
        value={form.bio}
        onChange={set("bio")}
        maxLength={500}
        hint="Optional."
        autoComplete="off"
      />

      <label className="flex items-start gap-2 text-body-md text-on-surface">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(event) => setAccepted(event.target.checked)}
          className="mt-1 size-4 accent-primary"
        />
        <span>
          I accept the creator terms
          {terms?.version ? ` (${terms.version})` : ""}.
          {terms?.documentUrl ? (
            <>
              {" "}
              <a href={terms.documentUrl} className="underline" target="_blank" rel="noreferrer">
                Read them
              </a>
              .
            </>
          ) : null}
        </span>
      </label>

      <button
        type="submit"
        disabled={pending || !accepted || !form.displayName.trim()}
        className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Joining…" : "Join"}
      </button>
    </form>
  );
}
