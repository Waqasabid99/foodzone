import AuthShell, { AuthTopBar } from "@/components/auth/AuthShell";
import ForgotPasswordForm from "@/components/auth/ForgotPasswordForm";

export const metadata = {
  title: "Forgot your password — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * Open to everyone, signed in or not. A live session is no evidence that you
 * remember your password — a browser that stayed logged in for a month is the
 * ordinary way to forget it — so there is nobody to turn away here.
 */
export default function ForgotPasswordPage() {
  return (
    <AuthShell
      side="left"
      eyebrow="Account recovery"
      headline={
        <>
          Locked out? <span className="text-primary-container">Let&apos;s fix that</span>
        </>
      }
      panel={
        <p className="mt-6 max-w-md text-body-md text-white/85">
          Resetting your password signs out every device on the account — so if someone else got in,
          this is what gets them out.
        </p>
      }
    >
      <AuthTopBar chip="Secure access" />
      <ForgotPasswordForm />
    </AuthShell>
  );
}
