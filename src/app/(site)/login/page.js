import { redirect } from "next/navigation";
import { Clock, ShieldCheck, Trophy } from "lucide-react";
import AuthShell, { AuthTopBar, AuthPerks } from "@/components/auth/AuthShell";
import LoginForm from "@/components/auth/LoginForm";
import { getViewer } from "@/server/auth/viewer";
import { safeRedirect } from "@/lib/redirects";

export const metadata = {
  title: "Log in — FoodZone",
  description: "Sign in to track orders, reorder favorites, and claim your rewards.",
  // Nothing here is worth indexing, and a login form in search results is a
  // well-known phishing lure: the top hit for "<brand> login" ought to be the
  // brand's own page, not a copy of it.
  robots: { index: false, follow: false },
};

const PERKS = [
  { id: "reorder", icon: Clock, title: "Instant reorder", body: "Your last order, one tap away." },
  { id: "rewards", icon: Trophy, title: "Bold rewards", body: "Points on every order you place." },
  { id: "secure", icon: ShieldCheck, title: "Encrypted", body: "Your session is never stored in the page." },
];

export default async function LoginPage({ searchParams }) {
  const { next } = await searchParams;
  const destination = safeRedirect(Array.isArray(next) ? next[0] : next);

  // Reading the session cookie makes this route dynamic, which is correct: a
  // cached login page would be served to someone who is already signed in.
  if (await getViewer()) redirect(destination);

  return (
    <AuthShell
      side="left"
      eyebrow="The bold member experience"
      headline={
        <>
          Craving <span className="text-primary-container">unmatched</span> flavor?
        </>
      }
      panel={
        <>
          <p className="mt-6 max-w-md text-body-md text-white/85">
            Welcome back to the club. Sign in to unlock secret menu items, skip the rush, and claim
            your sizzle perks.
          </p>
          <AuthPerks items={PERKS} />
        </>
      }
    >
      <AuthTopBar chip="Secure access" />
      <LoginForm next={destination} />
    </AuthShell>
  );
}
