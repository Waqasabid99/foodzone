import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import NotificationInbox from "@/components/dashboard/admin/NotificationInbox";
import NotificationComposer from "@/components/dashboard/admin/NotificationComposer";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listNotifications, unreadCount } from "@/server/services/notification.service";
import { listRoles } from "@/server/services/role.service";
import { listBranches } from "@/server/services/branch.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Notifications — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** Your own messages, and — for anyone who may send them — a way to write one. */
export default async function NotificationsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/notifications"));
  if (!hasPermission(grantedPermissionKeys(principal), "notifications.read")) redirect("/dashboard");

  const canSend = can(principal, "notifications.send");
  const [page, unread, roles, branchPage] = await Promise.all([
    listNotifications({ userId: principal.userId, limit: 30 }),
    unreadCount({ userId: principal.userId }),
    canSend ? listRoles() : [],
    canSend ? listBranches({ limit: 100 }) : { items: [] },
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Notifications" description="What the system has told you, newest first." />

      {canSend ? (
        <Section title="Send a message" description="Reaches everyone holding a role — in the app and, where it is set up, as a push notification.">
          <NotificationComposer roles={serialize(roles)} branches={serialize(branchPage.items ?? branchPage)} />
        </Section>
      ) : null}

      <Section title="Your messages">
        <NotificationInbox notifications={serialize(page.items)} unread={unread} />
      </Section>
    </div>
  );
}
