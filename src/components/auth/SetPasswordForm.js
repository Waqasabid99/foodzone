"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

/**
 * Choosing a real password to replace the temporary one.
 *
 * The current password is the one that was read out to them, so it is asked
 * for here as well: it proves the person typing is the one it was handed to,
 * and not somebody who sat down at an unlocked screen.
 */
export default function SetPasswordForm({ name }) {
  const router = useRouter();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const set = (patch) => setForm((current) => ({ ...current, ...patch }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const problems = {};
    if (!form.currentPassword) problems.currentPassword = "Enter the temporary password you were given.";
    if (form.newPassword.length < 10) problems.newPassword = "Use at least 10 characters.";
    if (form.newPassword !== form.confirm) problems.confirm = "These two do not match.";
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setPending(true);
    setError(null);
    try {
      await api.post("/auth/password/change", {
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        client: "WEB",
      });
      toast.success("That is your password now.");
      router.push("/dashboard");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be changed.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-headline-lg text-on-surface">Choose your password{name ? `, ${name.split(" ")[0]}` : ""}</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          You are signed in with a temporary password somebody else set up for you. Pick one only you know, and the rest of the system opens up.
        </p>
      </div>

      <FormAlert>{error}</FormAlert>

      <PasswordField
        id="current-password"
        label="Temporary password"
        value={form.currentPassword}
        onChange={(event) => set({ currentPassword: event.target.value })}
        error={errors.currentPassword}
        autoComplete="current-password"
      />
      <PasswordField
        id="new-password"
        label="New password"
        value={form.newPassword}
        onChange={(event) => set({ newPassword: event.target.value })}
        error={errors.newPassword}
        hint="At least 10 characters."
        autoComplete="new-password"
      />
      <PasswordField
        id="confirm-password"
        label="New password again"
        value={form.confirm}
        onChange={(event) => set({ confirm: event.target.value })}
        error={errors.confirm}
        autoComplete="new-password"
      />

      <SubmitButton pending={pending} pendingLabel="Saving…">Save and carry on</SubmitButton>
      <p className="text-body-md text-on-surface-variant">Every other device is signed out when you do this.</p>
    </form>
  );
}
