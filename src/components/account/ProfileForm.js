"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/**
 * Name, phone, and the password.
 *
 * Two forms rather than one, because they fail differently. Saving a name is
 * a small correction; changing a password signs every other device out, and
 * burying that behind the same button as "fix my name" is how somebody loses
 * a session they wanted.
 *
 * The email address is shown and not editable here on purpose: changing it
 * has to re-verify, which is a flow of its own rather than a field.
 */
export default function ProfileForm({ profile, canEdit }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: profile.name ?? "", phone: profile.phone ?? "" });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const [passwords, setPasswords] = useState({ currentPassword: "", newPassword: "", confirm: "" });
  const [pwPending, setPwPending] = useState(false);
  const [pwError, setPwError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));
  const setPw = (key) => (event) => setPasswords((state) => ({ ...state, [key]: event.target.value }));

  const changed = form.name !== (profile.name ?? "") || form.phone !== (profile.phone ?? "");
  const mismatch = Boolean(passwords.newPassword) && passwords.newPassword !== passwords.confirm;
  const sameAsOld = Boolean(passwords.newPassword) && passwords.newPassword === passwords.currentPassword;

  async function saveProfile(event) {
    event.preventDefault();
    if (pending || !changed) return;
    setPending(true);
    setError(null);
    try {
      // Only what actually changed: the API refuses an empty patch, and
      // sending an unchanged phone would be a no-op write on every save.
      const body = {};
      if (form.name !== (profile.name ?? "")) body.name = form.name.trim();
      if (form.phone !== (profile.phone ?? "")) body.phone = form.phone.trim() || null;
      await api.patch("/me", body);
      toast.success("Saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    if (pwPending || mismatch || sameAsOld || !passwords.currentPassword || !passwords.newPassword) return;
    setPwPending(true);
    setPwError(null);
    try {
      await api.post("/auth/password/change", {
        currentPassword: passwords.currentPassword,
        newPassword: passwords.newPassword,
        client: "WEB",
      });
      toast.success("Password changed. Your other devices have been signed out.");
      setPasswords({ currentPassword: "", newPassword: "", confirm: "" });
      router.refresh();
    } catch (failure) {
      setPwError(failure?.message ?? "That did not work.");
    } finally {
      setPwPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={saveProfile} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">About you</h2>
        <FormAlert>{error}</FormAlert>

        <Field id="profile-name" label="Name" value={form.name} onChange={set("name")} autoComplete="name" disabled={!canEdit} required />
        <Field
          id="profile-phone"
          label="Phone"
          value={form.phone}
          onChange={set("phone")}
          hint="Used when there is a problem with an order."
          autoComplete="tel"
          disabled={!canEdit}
        />

        <div className="flex flex-col gap-1">
          <span className="text-label-bold text-on-surface">Email</span>
          <p className="text-body-md text-on-surface-variant">
            {profile.email}
            {profile.emailVerified ? "" : " — not confirmed yet"}
          </p>
        </div>

        {canEdit ? (
          <button
            type="submit"
            disabled={pending || !changed}
            className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save changes"}
          </button>
        ) : null}
      </form>

      <form onSubmit={changePassword} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">Password</h2>
        <p className="text-body-md text-on-surface-variant">
          Changing this signs you out everywhere else, on purpose — it is what makes changing it useful if somebody
          else has it.
        </p>
        <FormAlert>{pwError}</FormAlert>

        <Field id="pw-current" label="Current password" type="password" value={passwords.currentPassword} onChange={setPw("currentPassword")} autoComplete="current-password" required />
        <Field id="pw-new" label="New password" type="password" value={passwords.newPassword} onChange={setPw("newPassword")} autoComplete="new-password" required />
        <Field
          id="pw-confirm"
          label="New password again"
          type="password"
          value={passwords.confirm}
          onChange={setPw("confirm")}
          error={mismatch ? "These two do not match." : null}
          autoComplete="new-password"
          required
        />

        {sameAsOld ? (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            That is the password you already have.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pwPending || mismatch || sameAsOld || !passwords.currentPassword || !passwords.newPassword}
          className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pwPending ? "Changing…" : "Change password"}
        </button>
      </form>
    </div>
  );
}
