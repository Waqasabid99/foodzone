import AuthShell, { AuthTopBar } from "@/components/auth/AuthShell";
import AcceptInviteForm from "@/components/auth/AcceptInviteForm";

export const metadata = {
  title: "Accept your invitation — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * Where a staff invitation email lands.
 *
 * The email has always told people to "accept at /invite" and nothing served
 * that address, so every invited member of staff got a 404 — the account was
 * created, the code was valid, and the one page needed to use it did not exist.
 *
 * No signed-in redirect, like the reset page and for the same reason: somebody
 * can open this with a stale session on a shared machine, and bouncing them to
 * the workspace would strand the person actually holding the code.
 */
export default async function InvitePage({ searchParams }) {
  const { email } = await searchParams;
  const prefill = Array.isArray(email) ? email[0] : email;

  return (
    <AuthShell
      side="right"
      eyebrow="Welcome to the team"
      headline={
        <>
          Let&rsquo;s get you <span className="text-primary-container">started</span>
        </>
      }
      panel={
        <p className="mt-6 max-w-md text-body-md text-white/85">
          Your account was created for you. Choose a password and it is yours — nobody else, including
          whoever invited you, ever sees it.
        </p>
      }
    >
      <AuthTopBar chip="Secure access" />
      {/* Prefilled from the link, and still editable: a typo in the address is
          the likeliest reason the code does not match, and it has to be
          fixable without going back to the email. */}
      <AcceptInviteForm email={typeof prefill === "string" ? prefill : ""} />
    </AuthShell>
  );
}
