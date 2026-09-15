"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

export default function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await api.post("/auth/password/forgot", { email: email.trim() });

      // The endpoint reports success whether or not the address has an account,
      // so that this form cannot be used to enumerate customers. The next
      // screen is worded to match — it says a code was sent *if* the address is
      // registered, rather than confirming that it is.
      router.push(`/reset-password?email=${encodeURIComponent(email.trim())}`);
    } catch (error) {
      const { fieldErrors: fields, formError: message } = toFormErrors(error, { fields: ["email"] });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-headline-lg text-on-surface">Forgot your password?</h1>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Enter the email address on your account and we&apos;ll send you a code to set a new password.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <Field
          id="forgot-email"
          label="Email Address"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          icon={Mail}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={fieldErrors.email}
          disabled={pending}
        />

        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send reset code
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Remembered it?{" "}
        <Link
          href="/login"
          className="font-display text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Log in
        </Link>
      </p>
    </>
  );
}
