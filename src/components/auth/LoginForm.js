"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowRight, Mail } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { signInDestination } from "@/lib/redirects";
import { setSessionUser } from "@/hooks/useSession";
import Field from "@/components/ui/Field";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import SocialSignIn from "@/components/auth/SocialSignIn";

const FIELDS = ["email", "password"];

export default function LoginForm({ next = "/" }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "" });
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      const session = await api.post("/auth/login", { ...form, client: "web" });

      // Hand the new session straight to the header. It resolves the session in
      // the browser and caches the answer for the page load, so without this it
      // would go on showing "Log in" to someone who just logged in.
      setSessionUser(session.user);

      toast.success(`Welcome back, ${session.user.name}.`);

      // Customers who have not verified go and verify; staff go to work. The
      // rule lives in one place because the login page, the register page and
      // the workspace layout all have to agree on who is staff.
      const destination = signInDestination(session.user, next);

      router.push(destination);
      // The layout above this page was server-rendered for a guest and is kept
      // across the navigation, so the new cookie only reaches it on a refresh.
      router.refresh();
    } catch (error) {
      const { fieldErrors: fields, formError: message } = toFormErrors(error, { fields: FIELDS });
      setFieldErrors(fields);
      setFormError(message);
      setPending(false);
      return;
    }

    // Left pending on success: the navigation is still in flight, and a button
    // that springs back to "Log in" reads as a login that failed silently.
  }

  return (
    <>
      <h1 className="font-display text-headline-lg text-on-surface">
        Log in to <span className="text-primary">FoodZone</span>
      </h1>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Enter your credentials to access your rewards, reorder favorites, and track live deliveries.
      </p>

      <div className="mt-8">
        <SocialSignIn />
      </div>

      <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <Field
          id="login-email"
          label="Email Address"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@example.com"
          icon={Mail}
          value={form.email}
          onChange={update("email")}
          error={fieldErrors.email}
          disabled={pending}
        />

        <PasswordField
          id="login-password"
          label="Password"
          autoComplete="current-password"
          required
          placeholder="Your password"
          value={form.password}
          onChange={update("password")}
          error={fieldErrors.password}
          disabled={pending}
          labelAction={
            <Link
              href="/forgot-password"
              className="text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Forgot password?
            </Link>
          }
        />

        {/* The design has a "remember me for 30 days" checkbox. Sessions
            already last 30 days on every device — the refresh token's TTL — and
            there is no shorter mode to opt out of, so a checkbox here would be
            a control that changes nothing. Stating the behaviour is the honest
            version of the same reassurance. */}
        <p className="text-label-bold font-normal text-on-surface-variant">
          You&apos;ll stay signed in on this device for 30 days.
        </p>

        <SubmitButton pending={pending} pendingLabel="Logging in…" icon={ArrowRight}>
          Log in
        </SubmitButton>
      </form>

      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Don&apos;t have an account?{" "}
        <Link
          href="/register"
          className="font-display text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Sign up
        </Link>
      </p>
    </>
  );
}
