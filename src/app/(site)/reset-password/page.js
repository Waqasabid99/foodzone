import AuthShell, { AuthTopBar } from "@/components/auth/AuthShell";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";

export const metadata = {
  title: "Set a new password — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * No signed-in redirect here, unlike the other auth pages. Someone can land on
 * this page with a code while a stale session is still live — that is exactly
 * the account-recovery case — and bouncing them away would strand them.
 */
export default async function ResetPasswordPage({ searchParams }) {
  const { email } = await searchParams;
  const prefill = Array.isArray(email) ? email[0] : email;

  return (
    <AuthShell
      side="right"
      eyebrow="Account recovery"
      headline={
        <>
          Back to the <span className="text-primary-container">good stuff</span>
        </>
      }
      panel={
        <p className="mt-6 max-w-md text-body-md text-white/85">
          Codes expire after 15 minutes. If yours has run out, ask for another — the old one stops
          working the moment a new one is issued.
        </p>
      }
    >
      <AuthTopBar chip="Secure access" />
      {/* The address comes from the previous step's URL, which is why it stays
          an editable field: a typo there is the likeliest reason no code
          arrived, and it has to be fixable without starting over. */}
      <ResetPasswordForm email={typeof prefill === "string" ? prefill : ""} />
    </AuthShell>
  );
}
