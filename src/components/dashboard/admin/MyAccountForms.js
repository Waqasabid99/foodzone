"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import { HOME_CHOICES } from "@/lib/home-page";

/** Your own name, phone, and where the workspace opens. */
export function MyProfileForm({ user }) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: user.name ?? "",
    phone: user.phone ?? "",
    homePage: user.homePage ?? "",
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const unchanged =
    form.name.trim() === (user.name ?? "") &&
    form.phone.trim() === (user.phone ?? "") &&
    form.homePage === (user.homePage ?? "");

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || unchanged) return;
    const problems = {};
    if (form.name.trim().length < 2) problems.name = "Enter your name.";
    const phone = form.phone.trim();
    if (phone && (phone.length < 7 || phone.length > 20)) problems.phone = "Enter a valid phone number.";
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setPending(true);
    setError(null);
    try {
      await api.patch("/me", { name: form.name.trim(), phone: phone || null, homePage: form.homePage });
      toast.success("Saved.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="me-name" label="Your name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={errors.name} />
        <Field id="me-phone" label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} error={errors.phone} />
      </div>

      {/* Where the workspace opens. A kitchen display belongs on a screen of
          its own, so a cook is sent to the board by default — but a head chef
          may well want the overview, and nothing written in code can know
          which, so it is theirs to set. */}
      <SelectField
        id="me-home"
        label="Open on"
        value={form.homePage}
        onChange={(event) => setForm({ ...form, homePage: event.target.value })}
        options={HOME_CHOICES.map((choice) => ({ value: choice.value, label: choice.label }))}
        hint={HOME_CHOICES.find((choice) => choice.value === form.homePage)?.hint}
      />
      <button type="submit" disabled={pending || unchanged} className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}

/** Changing your own password. Every other device is signed out when you do. */
export function MyPasswordForm() {
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
    if (!form.currentPassword) problems.currentPassword = "Enter your current password.";
    if (form.newPassword.length < 10) problems.newPassword = "Use at least 10 characters.";
    if (form.newPassword !== form.confirm) problems.confirm = "These two do not match.";
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setPending(true);
    setError(null);
    try {
      await api.post("/auth/password/change", { currentPassword: form.currentPassword, newPassword: form.newPassword, client: "WEB" });
      toast.success("Password changed.");
      setForm({ currentPassword: "", newPassword: "", confirm: "" });
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <FormAlert>{error}</FormAlert>
      <PasswordField id="me-current" label="Current password" value={form.currentPassword} onChange={(event) => set({ currentPassword: event.target.value })} error={errors.currentPassword} autoComplete="current-password" />
      <PasswordField id="me-new" label="New password" value={form.newPassword} onChange={(event) => set({ newPassword: event.target.value })} error={errors.newPassword} hint="At least 10 characters." autoComplete="new-password" />
      <PasswordField id="me-confirm" label="New password again" value={form.confirm} onChange={(event) => set({ confirm: event.target.value })} error={errors.confirm} autoComplete="new-password" />
      <button type="submit" disabled={pending} className="w-fit rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Changing…" : "Change password"}
      </button>
      <p className="text-body-md text-on-surface-variant">Changing it signs out every other device.</p>
    </form>
  );
}
