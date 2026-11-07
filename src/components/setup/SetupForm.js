"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * The one form that creates an account with nobody signed in.
 *
 * Asks for the setup token first, because it is the thing most likely to be
 * wrong and the thing the person filling this in has to go and find. Burying
 * it under the owner's details means typing a password twice.
 *
 * The password is set by whoever is at the keyboard. That is deliberate: hand
 * this link to the restaurant and they choose their own, so nobody else ever
 * knows it — which is a better position than an installer setting a password
 * and telling them to change it later, because they will not.
 */
export default function SetupForm() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [form, setForm] = useState({
    ownerName: "",
    ownerEmail: "",
    password: "",
    branchCode: "",
    branchName: "",
    branchCity: "",
    timezone: "Asia/Karachi",
    currency: "PKR",
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));

  const incomplete =
    !token.trim() ||
    !form.ownerName.trim() ||
    !form.ownerEmail.trim() ||
    form.password.length < 10 ||
    !form.branchCode.trim() ||
    !form.branchName.trim();

  async function submit(event) {
    event.preventDefault();
    if (pending || incomplete) return;

    setPending(true);
    setError(null);

    try {
      const response = await fetch("/api/v1/setup", {
        method: "POST",
        headers: { "content-type": "application/json", "x-setup-token": token.trim() },
        body: JSON.stringify({
          owner: { name: form.ownerName.trim(), email: form.ownerEmail.trim(), password: form.password },
          branch: {
            code: form.branchCode.trim(),
            name: form.branchName.trim(),
            city: form.branchCity.trim() || null,
            timezone: form.timezone.trim(),
            currency: form.currency.trim(),
          },
        }),
      });

      if (!response.ok) {
        /*
         * A 404 here means one of two things, and the endpoint deliberately
         * will not say which: the token was wrong, or the system is already
         * set up. Both are explained, because the person reading this is
         * almost certainly the operator rather than an intruder, and leaving
         * them with a bare "not found" helps nobody.
         */
        if (response.status === 404) {
          setError(
            "Setup did not run. Either the setup token is wrong, or this installation has already been set up — try signing in.",
          );
          return;
        }

        const body = await response.json().catch(() => null);
        setError(body?.error?.message ?? "Setup failed. Check the details and try again.");
        return;
      }

      // Straight to the sign-in page: the account exists now, and the next
      // thing anybody wants is to be inside it.
      router.push("/login");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check it is running and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 rounded-card bg-surface-container-lowest p-6">
      {error ? <FormAlert>{error}</FormAlert> : null}

      <Field
        id="setup-token"
        label="Setup token"
        type="password"
        value={token}
        onChange={(event) => setToken(event.target.value)}
        hint="The SETUP_TOKEN from this deployment's environment."
        autoComplete="off"
        required
      />

      <fieldset className="flex flex-col gap-4 border-t border-outline-variant pt-5">
        <legend className="text-label-bold text-on-surface">The owner</legend>
        <Field id="owner-name" label="Full name" value={form.ownerName} onChange={set("ownerName")} required />
        <Field id="owner-email" label="Email" type="email" value={form.ownerEmail} onChange={set("ownerEmail")} required />
        <Field
          id="owner-password"
          label="Password"
          type="password"
          value={form.password}
          onChange={set("password")}
          hint="At least 10 characters. Length matters more than symbols."
          autoComplete="new-password"
          required
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4 border-t border-outline-variant pt-5">
        <legend className="text-label-bold text-on-surface">The first branch</legend>
        <Field id="branch-code" label="Branch code" value={form.branchCode} onChange={set("branchCode")} placeholder="FZ-KHI-01" required />
        <Field id="branch-name" label="Branch name" value={form.branchName} onChange={set("branchName")} placeholder="Main Branch" required />
        <Field id="branch-city" label="City" value={form.branchCity} onChange={set("branchCity")} placeholder="Karachi" />
        <div className="grid grid-cols-2 gap-4">
          <Field
            id="branch-timezone"
            label="Timezone"
            value={form.timezone}
            onChange={set("timezone")}
            hint="Shifts, attendance and opening hours are all read in this."
          />
          <Field id="branch-currency" label="Currency" value={form.currency} onChange={set("currency")} maxLength={3} />
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={pending || incomplete}
        className="rounded-button bg-primary px-5 py-3 text-label-bold text-on-primary disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {pending ? "Setting up…" : "Set up this installation"}
      </button>
    </form>
  );
}
