import { redirect } from "next/navigation";
import { Clock, Lock, ShieldCheck, Sparkles, Utensils, Zap } from "lucide-react";
import AuthShell, { AuthTopBar, AuthPerks, AuthAssurances } from "@/components/auth/AuthShell";
import VerifyEmailForm from "@/components/auth/VerifyEmailForm";
import { getViewerAccount } from "@/server/auth/viewer";
import { verificationState } from "@/server/auth/verification";
import { getSettings } from "@/server/services/setting.service";
import { safeRedirect } from "@/lib/redirects";

export const metadata = {
  title: "Verify your email — FoodZone",
  robots: { index: false, follow: false },
};

const PERKS = [
  {
    id: "unlock",
    icon: Zap,
    title: "Instant unlock",
    body: "Order status updates and express checkout.",
  },
  {
    id: "secret",
    icon: Utensils,
    title: "Secret menu access",
    body: "Members-only monthly smash burger specials.",
  },
  {
    id: "spam",
    icon: ShieldCheck,
    title: "Spam-free promise",
    body: "Deals, receipts and order notifications only.",
  },
];

/**
 * The step registration starts and nothing else finished.
 *
 * Registration issues a real session but leaves the account
 * PENDING_VERIFICATION, and `requireVerifiedEmail` blocks checkout until the
 * code is entered. Without this page the verification email would arrive with
 * nowhere to take it, and the block would first be discovered at the end of a
 * checkout.
 */
export default async function VerifyEmailPage({ searchParams }) {
  const { next } = await searchParams;
  const destination = safeRedirect(Array.isArray(next) ? next[0] : next);

  const account = await getViewerAccount();
  // Verifying is an authenticated action — the code is checked against the
  // signed-in user, not against whoever types an address. No `?next` is
  // attached: the login form already routes an unverified account back here on
  // its own, so the round trip needs no help.
  if (!account) redirect("/login");
  if (account.emailVerified) redirect(destination);

  // Both reads are settled independently. A settings lookup that fails should
  // cost the support link, not the page someone is trying to verify on.
  const [stateResult, settingsResult] = await Promise.allSettled([
    verificationState(account.userId),
    getSettings({ publicOnly: true }),
  ]);

  const state =
    stateResult.status === "fulfilled"
      ? stateResult.value
      : { codeLength: 6, ttlMinutes: 15, cooldownSeconds: 60, resendAvailableInSeconds: 0 };

  const settings = settingsResult.status === "fulfilled" ? settingsResult.value : {};
  const supportEmail = settings["store.support_email"] || null;

  const ASSURANCES = [
    {
      id: "hashed",
      icon: Lock,
      title: "Stored hashed",
      body: "The code is never kept in readable form.",
    },
    {
      id: "expiry",
      icon: Clock,
      title: "Auto-expiring code",
      // Read from OTP_TTL_MINUTES rather than written into the copy, so the
      // claim on screen cannot drift from the setting that enforces it.
      body: `Valid for ${state.ttlMinutes} minutes, then dead.`,
    },
    {
      id: "instant",
      icon: Sparkles,
      title: "Instant activation",
      body: "Your account goes live the moment it matches.",
    },
  ];

  return (
    <AuthShell
      side="left"
      eyebrow="Bold security shield"
      headline={
        <>
          One step from <span className="text-primary-container">bold flavor</span>
        </>
      }
      panel={
        <>
          <p className="mt-6 max-w-md text-body-md text-white/85">
            We take flavor seriously, and your account security even more so. Verify your email to
            lock in your personalized deals.
          </p>
          <AuthPerks items={PERKS} layout="stack" />
          <p className="mt-10 flex flex-wrap items-center justify-between gap-2 text-label-bold uppercase tracking-widest text-white/60">
            <span>Official verification channel</span>
            <span>{settings["store.name"] || "FoodZone"}</span>
          </p>
        </>
      }
    >
      <AuthTopBar chip="Step 2 of 2" backHref="/login" backLabel="Back to login" />

      <VerifyEmailForm
        next={destination}
        email={account.email}
        codeLength={state.codeLength}
        cooldownSeconds={state.cooldownSeconds}
        resendAvailableInSeconds={state.resendAvailableInSeconds}
        supportEmail={supportEmail}
      />

      <AuthAssurances items={ASSURANCES} />
    </AuthShell>
  );
}
