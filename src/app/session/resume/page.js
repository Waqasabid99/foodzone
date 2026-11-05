import SessionResume from "@/components/auth/SessionResume";
import { safeRedirect } from "@/lib/redirects";

export const metadata = { title: "One moment — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The half-second between a lapsed access token and the page you asked for.
 *
 * The proxy sends a workspace request here when the access cookie has aged out
 * but the refresh cookie is still in the jar. All this page does is exchange
 * one for the other and carry on, so a cashier who spent a quarter of an hour
 * on the floor sees a flicker instead of a login form.
 *
 * Deliberately outside the dashboard layout: that layout is itself one of the
 * things that would redirect, and a resume page inside it would loop.
 */
export default async function SessionResumePage({ searchParams }) {
  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  return <SessionResume next={safeRedirect(one(params?.next), "/dashboard")} />;
}
