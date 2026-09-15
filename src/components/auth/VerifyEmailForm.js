"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowRight, RotateCw } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import { safeRedirect } from "@/lib/redirects";
import { loadSession, logoutSession } from "@/hooks/useSession";
import OtpInput from "@/components/ui/OtpInput";
import FormAlert from "@/components/ui/FormAlert";
import SubmitButton from "@/components/ui/SubmitButton";

/** mm:ss, the shape a countdown is read in. */
function formatCountdown(seconds) {
  const mins = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secs = String(seconds % 60).padStart(2, "0");
  return `${mins}:${secs}`;
}

export default function VerifyEmailForm({
  next = "/",
  email = null,
  codeLength = 6,
  cooldownSeconds = 60,
  resendAvailableInSeconds = 0,
  supportEmail = null,
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  const [resending, setResending] = useState(false);
  const [changing, setChanging] = useState(false);

  // Seeded from the server, which knows when the last code was actually issued
  // — see `verificationState`. A timer started at the full cooldown on mount
  // would hide a resend that is already allowed.
  const [secondsLeft, setSecondsLeft] = useState(resendAvailableInSeconds);
  const liveRegionRef = useRef(null);

  useEffect(() => {
    if (secondsLeft <= 0) return undefined;
    const timer = setInterval(() => setSecondsLeft((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const complete = code.length === codeLength;
  const canResend = secondsLeft <= 0 && !resending;

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || !complete) return;

    setPending(true);
    setFieldErrors({});
    setFormError(null);

    try {
      await api.post("/auth/email/verify", { code });

      // Re-read rather than patch the cached copy: verifying lifts the account
      // out of PENDING_VERIFICATION as well as setting the flag, and the server
      // is the one that knows what it now looks like.
      await loadSession({ force: true });

      toast.success("Email verified. You're all set.");
      router.push(safeRedirect(next));
      router.refresh();
    } catch (error) {
      const { fieldErrors: fields, formError: message } = toFormErrors(error, { fields: ["code"] });
      setFieldErrors(fields);
      setFormError(message);
      // Clear the boxes on a bad code. Leaving six wrong digits in place means
      // the next attempt starts by deleting them one at a time.
      setCode("");
      setPending(false);
    }
  }

  async function handleResend() {
    if (!canResend) return;
    setResending(true);
    setFormError(null);

    try {
      const result = await api.post("/auth/email/verify/resend");
      setSecondsLeft(result.cooldownSeconds ?? cooldownSeconds);
      setCode("");
      // Announced rather than toasted: focus is inside the form, and this is
      // the answer to something the user just did here.
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = `A new code is on its way. It expires in ${result.expiresInMinutes} minutes.`;
      }
    } catch (error) {
      // Resends are throttled per user as well as rate limited, so "too soon"
      // is an ordinary answer rather than a fault — it belongs in the form.
      setFormError(error.message);
      const retryAfter = Number(error.details?.retryAfterSeconds);
      if (Number.isFinite(retryAfter) && retryAfter > 0) setSecondsLeft(Math.ceil(retryAfter));
    } finally {
      setResending(false);
    }
  }

  /**
   * "Wrong address" recovery.
   *
   * There is no change-email endpoint — `updateProfile` accepts name, phone,
   * locale and avatar, and deliberately not the address an account is
   * identified by. So the honest recovery from a typo is to sign out and
   * register again, and the button says exactly that rather than implying an
   * edit that cannot happen.
   */
  async function handleChangeEmail() {
    if (changing) return;
    setChanging(true);
    await logoutSession();
    router.push("/register");
    router.refresh();
  }

  return (
    <>
      <p className="mb-4 inline-flex items-center gap-2 rounded-full bg-primary-container px-3 py-1 text-label-bold uppercase text-on-primary-container">
        Security verification
      </p>

      <h1 className="font-display text-headline-lg text-on-surface">Verify your email</h1>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-body-md text-on-surface-variant">
        We sent a {codeLength}-digit verification code to
        {email ? (
          <span className="rounded-full bg-surface-container px-3 py-1 text-on-surface">{email}</span>
        ) : (
          <span>your inbox</span>
        )}
      </p>

      <button
        type="button"
        onClick={handleChangeEmail}
        disabled={changing}
        className="mt-1 text-label-bold text-primary underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
      >
        {changing ? "Signing out…" : "Wrong address? Sign out and register again"}
      </button>

      <form onSubmit={handleSubmit} noValidate className="mt-8 flex flex-col gap-5">
        <FormAlert>{formError}</FormAlert>

        <OtpInput
          label={`Enter ${codeLength}-digit verification code`}
          value={code}
          onChange={setCode}
          length={codeLength}
          error={fieldErrors.code}
          disabled={pending}
          autoFocus
        />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
          <span className="flex items-center gap-2 text-body-md text-on-surface-variant">
            <RotateCw aria-hidden="true" className="size-4" />
            {secondsLeft > 0 ? (
              <>
                Resend code in{" "}
                <span className="font-display tabular-nums text-on-surface">
                  {formatCountdown(secondsLeft)}
                </span>
              </>
            ) : (
              "Didn't get the code?"
            )}
          </span>

          <button
            type="button"
            onClick={handleResend}
            disabled={!canResend}
            className="font-display text-label-bold uppercase text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-on-surface-variant disabled:no-underline"
          >
            {resending ? "Sending…" : "Resend code"}
          </button>
        </div>

        {/* The submit stays disabled until the code is complete. The server
            counts failed attempts and locks the code after five, so letting a
            half-typed code be submitted would spend one of them for nothing. */}
        <SubmitButton pending={pending} pendingLabel="Verifying…" icon={ArrowRight} disabled={!complete}>
          Verify &amp; proceed
        </SubmitButton>
      </form>

      <p ref={liveRegionRef} role="status" aria-live="polite" className="mt-3 text-label-bold font-normal text-on-surface-variant" />

      {supportEmail ? (
        <p className="mt-4 text-center text-label-bold font-normal text-on-surface-variant">
          Having trouble?{" "}
          <a
            href={`mailto:${supportEmail}?subject=${encodeURIComponent("Help verifying my email")}`}
            className="text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Contact support
          </a>
        </p>
      ) : null}
    </>
  );
}
