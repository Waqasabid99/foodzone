"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Mail, User, Zap } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { safeRedirect } from "@/lib/redirects";
import { setSessionUser } from "@/hooks/useSession";
import Field from "@/components/ui/Field";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import SocialSignIn from "@/components/auth/SocialSignIn";

const FIELDS = ["name", "email", "password"];

/** Mirrors `passwordSchema` on the server, so the rule is stated before it is enforced. */
const MIN_PASSWORD_LENGTH = 10;

export default function RegisterForm({ next = "/" }) {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [accepted, setAccepted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  /**
   * The checks the server cannot make.
   *
   * Everything else is left to the API on purpose — duplicating `passwordSchema`
   * here would mean two rules to keep in step, and the one that matters is the
   * server's. These two are different: the confirmation field never leaves the
   * browser, and the consent checkbox is a UI gate, so neither has a
   * server-side counterpart to defer to.
   */
  function localErrors() {
    const errors = {};

    if (form.confirmPassword !== form.password) {
      errors.confirmPassword = "Both passwords must match";
    }
    if (!accepted) {
      errors.terms = "Please accept the terms to continue";
    }

    return errors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    const local = localErrors();
    if (Object.keys(local).length) {
      setFieldErrors(local);
      setFormError(null);
      return;
    }

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const session = await api.post("/auth/register", {
        name: form.name,
        email: form.email,
        password: form.password,
        client: "web",
      });

      // Registration signs you in, so the header should say so immediately.
      setSessionUser(session.user);

      toast.success("Account created. Check your email for a verification code.");

      // Registration issues a session but the account starts unverified, and an
      // unverified account cannot check out. Sending them straight to the code
      // entry — rather than to the menu — puts the one remaining step in front
      // of them while the email is still arriving.
      router.push(`/verify-email?next=${encodeURIComponent(safeRedirect(next))}`);
      router.refresh();
    } catch (error) {
      const { fieldErrors: fields, formError: message } = toFormErrors(error, {
        fields: FIELDS,
        conflictField: "email",
      });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
    }
  }

  return (
    <>
      <h1 className="font-display text-headline-lg uppercase text-on-surface">
        Join the <span className="text-primary">Bold Club</span>
      </h1>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Create an account to unlock secret menu items, birthday rewards, and fast checkout.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <Field
          id="register-name"
          label="Full Name"
          autoComplete="name"
          autoFocus
          required
          placeholder="e.g. Marcus Vance"
          icon={User}
          value={form.name}
          onChange={update("name")}
          error={fieldErrors.name}
          disabled={pending}
        />

        <Field
          id="register-email"
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

        <div className="grid gap-5 sm:grid-cols-2">
          <PasswordField
            id="register-password"
            label="Password"
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
            id="register-confirm-password"
            label="Confirm Password"
            autoComplete="new-password"
            required
            placeholder="Repeat it"
            value={form.confirmPassword}
            onChange={update("confirmPassword")}
            error={fieldErrors.confirmPassword}
            disabled={pending}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-3">
            <input
              id="register-terms"
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              disabled={pending}
              aria-invalid={fieldErrors.terms ? "true" : undefined}
              aria-describedby={fieldErrors.terms ? "register-terms-error" : undefined}
              className="mt-1 size-4 shrink-0 accent-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <label htmlFor="register-terms" className="text-body-md text-on-surface-variant">
              I agree to the{" "}
              <Link href="/terms" className="text-primary hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" className="text-primary hover:underline">
                Privacy Policy
              </Link>
              .
            </label>
          </div>

          {fieldErrors.terms ? (
            <p id="register-terms-error" className="text-label-bold text-error">
              {fieldErrors.terms}
            </p>
          ) : null}

          {/* The design pairs consent to the terms with consent to marketing in
              one checkbox. They are kept apart: bundling them means nobody can
              accept the terms without also opting into email, which is not
              consent in any regime that asks for it — and there is no
              subscriber store to record the answer in yet either. */}
        </div>

        <SubmitButton pending={pending} pendingLabel="Creating account…" icon={Zap}>
          Create account
        </SubmitButton>
      </form>

      <div className="mt-6">
        <SocialSignIn label="Or sign up with" divider="above" />
      </div>

      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Already have an account?{" "}
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
