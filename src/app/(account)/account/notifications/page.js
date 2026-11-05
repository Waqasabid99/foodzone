import { redirect } from "next/navigation";
import { Bell } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import NotificationList from "@/components/account/NotificationList";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listNotifications } from "@/server/services/notification.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "Notifications — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function MyNotificationsPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/notifications"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.manage_notifications")) redirect("/account");

  const page = await listNotifications({ userId: principal.userId, limit: 50 });
  const notifications = serialize(page.items ?? []);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Notifications" description="Updates about your orders and anything else we have sent you." />

      {notifications.length ? (
        <NotificationList notifications={notifications} timeZone={timeZone} />
      ) : (
        <EmptyState icon={Bell} title="Nothing here">
          Order updates will appear here.
        </EmptyState>
      )}
    </div>
  );
}
