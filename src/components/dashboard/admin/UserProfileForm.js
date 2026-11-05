"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";

/** Name and phone. The email is the account's identity and is not edited here. */
export default function UserProfileForm({ user }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: user.name ?? "", phone: user.phone ?? "" });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);
  const unchanged = form.name.trim() === (user.name ?? "") && form.phone.trim() === (user.phone ?? "");

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || unchanged) return;
    const problems = {};
    if (form.name.trim().length < 2) problems.name = "Enter their name.";
    const phone = form.phone.trim();
    if (phone && (phone.length < 7 || phone.length > 20)) problems.phone = "Enter a valid phone number.";
    setErrors(problems);
    if (Object.keys(problems).length) return;

    setPending(true);
    setError(null);
    try {
      await api.patch(`/admin/users/${user.id}`, { name: form.name.trim(), phone: phone || null });
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
        <Field id="profile-name" label="Full name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} error={errors.name} />
        <Field id="profile-phone" label="Phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} error={errors.phone} hint="Changing it means the number has to be verified again." />
      </div>
      <button type="submit" disabled={pending || unchanged} className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {pending ? "Saving…" : "Save changes"}
      </button>
    </form>
  );
}
