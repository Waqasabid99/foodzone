"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { KeyRound, Mail } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import Field from "@/components/ui/Field";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import { setSessionUser } from "@/hooks/useSession";
import SubmitButton from "@/components/ui/SubmitButton";

const FIELDS = ["email", "code", "password"];
const MIN_PASSWORD_LENGTH = 10;

export default function ResetPasswordForm({ email: initialEmail = "" }) {
  const router = useRouter();
  const [form, setForm] = useState({
    email: initialEmail,
    code: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    if (form.confirmPassword !== form.password) {
      setFieldErrors({ confirmPassword: "Both passwords must match" });
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await api.post("/auth/password/reset", {
        email: form.email.trim(),
        code: form.code.trim(),
        password: form.password,
      });

      // The reset revokes every session and returns no new one, on purpose:
      // if the account was taken over, the point of the reset is to evict the
      // other party. So this ends at the login form rather than signed in.
      // The reset revoked every session including this browser's, so the
      // header has to stop showing an account that no longer has one.
      setSessionUser(null);

      toast.success("Password updated. Log in with your new password.");
      router.push("/login");
      router.refresh();
    } catch (error) {
      const { fieldErrors: fields, formError: message } = toFormErrors(error, { fields: FIELDS });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-headline-lg text-on-surface">Set a new password</h1>
      <p className="mt-3 text-body-md text-on-surface-variant">
        If that address has an account, a code is on its way. Enter it below with the password
        you&apos;d like to use from now on.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <Field
          id="reset-email"
          label="Email Address"
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="you@example.com"
          icon={Mail}
          value={form.email}
          onChange={update("email")}
          error={fieldErrors.email}
          disabled={pending}
        />

        <Field
          id="reset-code"
          label="Reset code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={Boolean(initialEmail)}
          required
          placeholder="123456"
          icon={KeyRound}
          value={form.code}
          onChange={update("code")}
          error={fieldErrors.code}
          disabled={pending}
        />

        <PasswordField
          id="reset-password"
          label="New password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          placeholder="At least 10 characters"
          hint={`${MIN_PASSWORD_LENGTH} characters minimum. Length beats symbols.`}
          value={form.password}
          onChange={update("password")}
          error={fieldErrors.password}
          disabled={pending}
        />

        <PasswordField
          id="reset-confirm-password"
          label="Confirm new password"
          autoComplete="new-password"
          required
          placeholder="Repeat it"
          value={form.confirmPassword}
          onChange={update("confirmPassword")}
          error={fieldErrors.confirmPassword}
          disabled={pending}
        />

        <SubmitButton pending={pending} pendingLabel="Updating…">
          Update password
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Need another code?{" "}
        <Link
          href="/forgot-password"
          className="font-display text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Send a new one
        </Link>
      </p>
    </>
  );
}
