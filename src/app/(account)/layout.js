import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { ACCOUNT_NAV, visibleNav, navItemCount } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "My account — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * A customer's own area.
 *
 * Shares the workspace chrome with the staff dashboard and nothing else: the
 * navigation is a different tree, because a customer is not a member of staff
 * with fewer permissions. Anyone signed in reaches it, staff included — an
 * employee who orders lunch from their own restaurant is still a customer.
 */
export default async function AccountLayout({ children }) {
  const [viewer, { storeName }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);

  if (!viewer) redirect(loginHref("/account"));
  if (navItemCount(ACCOUNT_NAV, viewer.permissions) === 0) redirect("/");

  return (
    <DashboardShell
      nav={visibleNav(ACCOUNT_NAV, viewer.permissions)}
      user={viewer}
      storeName={storeName}
      homeHref="/account"
    >
      {children}
    </DashboardShell>
  );
}
