import { redirect } from "next/navigation";
import AuthShell, { AuthTopBar } from "@/components/auth/AuthShell";
import SetPasswordForm from "@/components/auth/SetPasswordForm";
import { getAuthContext } from "@/lib/api/auth";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Choose your password — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where someone lands while an administrator's temporary password is still in
 * force. It sits outside the workspace on purpose: the workspace sends them
 * here, and a page inside it would send them here again for ever.
 */
export default async function SetPasswordPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/set-password"));
  // Nothing owed: this page has no business existing for them.
  if (!principal.mustChangePassword) redirect("/dashboard");

  return (
    <AuthShell
      side="left"
      eyebrow="One more step"
      headline={
        <>
          Make it <span className="text-primary-container">yours</span>
        </>
      }
      panel={
        <p className="mt-6 max-w-md text-body-md text-white/85">
          A temporary password is one somebody else has seen. Until you replace it, your account can do nothing else.
        </p>
      }
    >
      <AuthTopBar chip="Secure access" />
      <SetPasswordForm name={principal.name} />
    </AuthShell>
  );
}
