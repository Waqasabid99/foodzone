"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { KeyRound, Mail } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import Field from "@/components/ui/Field";
import PasswordField from "@/components/ui/PasswordField";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";
import { setSessionUser } from "@/hooks/useSession";
import { workspaceLinks } from "@/lib/dashboard-nav";

const FIELDS = ["email", "code", "password"];
const MIN_PASSWORD_LENGTH = 10;

/**
 * Accepting a staff invitation: the address it was sent to, the code in the
 * email, and the password they will use from now on.
 *
 * **It signs them in rather than sending them to the login form.** Unlike a
 * password reset — which revokes every session precisely because the point is
 * to evict whoever took the account over — this is a brand new account whose
 * owner has just proved control of the address by reading the code. Making
 * them type the password they set ten seconds ago is ceremony, not security,
 * and the endpoint already returns a session.
 *
 * Where they land is worked out from the permissions the session comes back
 * with, not assumed. A cashier is not an administrator: sending everybody to
 * `/dashboard` would drop somebody on the first page they are allowed to open
 * only by luck, so this asks the same navigation the workspace itself uses
 * which page that is.
 */
export default function AcceptInviteForm({ email: initialEmail = "" }) {
  const router = useRouter();
  const [form, setForm] = useState({ email: initialEmail, code: "", password: "", confirmPassword: "" });
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
      const session = await api.post("/auth/invitations/accept", {
        email: form.email.trim(),
        code: form.code.trim(),
        password: form.password,
      });

      setSessionUser(session.user ?? null);
      toast.success("Welcome aboard. Your account is ready.");

      // The first workspace page this person can actually open, or the
      // storefront if they have no workspace access at all.
      const workspace = workspaceLinks(session.user?.permissions ?? []).find((link) =>
        link.href.startsWith("/dashboard"),
      );
      router.push(workspace?.href ?? "/");
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
      <h1 className="font-display text-headline-lg text-on-surface">Accept your invitation</h1>
      <p className="mt-3 text-body-md text-on-surface-variant">
        Enter the code from your invitation email and choose a password. That is the whole setup —
        your account is active as soon as this is done.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <Field
          id="invite-email"
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
          id="invite-code"
          label="Invitation code"
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
          id="invite-password"
          label="Choose a password"
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
          id="invite-confirm-password"
          label="Confirm password"
          autoComplete="new-password"
          required
          placeholder="Repeat it"
          value={form.confirmPassword}
          onChange={update("confirmPassword")}
          error={fieldErrors.confirmPassword}
          disabled={pending}
        />

        <SubmitButton pending={pending} pendingLabel="Setting up…">
          Activate my account
        </SubmitButton>
      </form>

      {/* No "send me another" link: an invitation is reissued by whoever sent
          it, from the Users screen. Offering a self-service resend here would
          be a button that cannot work. */}
      <p className="mt-6 text-center text-body-md text-on-surface-variant">
        Code expired? Ask whoever invited you to send another.
      </p>
    </>
  );
}
