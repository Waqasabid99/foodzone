import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard/DashboardShell";
import { getWorkspaceViewer } from "@/server/auth/workspace";
import { getSiteIdentity } from "@/server/content/site";
import { DASHBOARD_NAV, ACCOUNT_NAV, visibleNav, navItemCount } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Dashboard — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * The staff workspace.
 *
 * Access is decided by **whether anything in the tree is visible**, not by a
 * single `dashboard.view` permission. That key grants the overview page and its
 * company-wide summary widgets, which a driver has no business seeing — but a
 * driver can read deliveries, and gating the shell on it would lock them out of
 * the job they were hired to do. So the question this layout asks is the one
 * that actually matters: is there a single page here this person may open?
 *
 * The layout is a gate, not *the* gate. Each page checks its own permission,
 * and so does every endpoint behind it; someone typing a URL for a section they
 * cannot see is refused by the page, not merely un-linked here.
 */
export default async function DashboardLayout({ children }) {
  const [viewer, { storeName }] = await Promise.all([getWorkspaceViewer(), getSiteIdentity()]);

  if (!viewer) redirect(loginHref("/dashboard"));

  // A customer has no staff navigation at all, so they are sent to their own
  // area rather than shown an empty workspace and a permission error.
  if (navItemCount(DASHBOARD_NAV, viewer.permissions) === 0) {
    redirect(navItemCount(ACCOUNT_NAV, viewer.permissions) > 0 ? "/account" : "/");
  }

  return (
    <DashboardShell
      nav={visibleNav(DASHBOARD_NAV, viewer.permissions)}
      user={viewer}
      storeName={storeName}
      homeHref="/dashboard"
    >
      {children}
    </DashboardShell>
  );
}
