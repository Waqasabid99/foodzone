import { redirect } from "next/navigation";
import { Cake, Gift, Lock } from "lucide-react";
import AuthShell, { AuthTopBar, AuthPerks } from "@/components/auth/AuthShell";
import RegisterForm from "@/components/auth/RegisterForm";
import { getViewer } from "@/server/auth/viewer";
import { safeRedirect } from "@/lib/redirects";

export const metadata = {
  title: "Create your account — FoodZone",
  description: "Join the Bold Club for secret menu items, birthday rewards, and fast checkout.",
  robots: { index: false, follow: false },
};

const PERKS = [
  { id: "fries", icon: Gift, title: "Free fries", body: "On your very first order." },
  { id: "secret", icon: Lock, title: "Secret menu", body: "Monthly underground drops." },
  { id: "birthday", icon: Cake, title: "Birthday feast", body: "A free burger on your special day." },
];

export default async function RegisterPage({ searchParams }) {
  const { next } = await searchParams;
  const destination = safeRedirect(Array.isArray(next) ? next[0] : next);

  if (await getViewer()) redirect(destination);

  return (
    <AuthShell
      side="right"
      eyebrow="Smash. Sizzle. Crave."
      headline={
        <>
          Unleash the <span className="text-primary-container">bold flavor</span>
        </>
      }
      panel={
        <>
          <p className="mt-6 max-w-md text-body-md text-white/85">
            High-energy smashed patties, flame-grilled goodness, and audacious flavor profiles
            crafted fresh daily.
          </p>
          <AuthPerks items={PERKS} />
        </>
      }
    >
      <AuthTopBar chip="VIP membership" />
      <RegisterForm next={destination} />
    </AuthShell>
  );
}
