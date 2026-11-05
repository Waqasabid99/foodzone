import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import SettingsForm from "@/components/dashboard/admin/SettingsForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { describeSettings } from "@/server/services/setting.service";
import { listBranches } from "@/server/services/branch.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Settings — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The groups, in the order someone setting the system up works through them. */
const GROUPS = [
  { prefix: "store", title: "Your restaurant", description: "Name, contact details and social links. These appear on the website." },
  { prefix: "ordering", title: "Ordering", description: "What customers may order, the fees on it, and how long it takes." },
  { prefix: "pricing", title: "Discounts", description: "The ceiling on what staff can give away by hand." },
  { prefix: "payments", title: "Payments", description: "How customers may pay, and what must be paid up front." },
  { prefix: "delivery", title: "Delivery", description: "What a driver must do to complete a delivery, and what they earn." },
  { prefix: "payroll", title: "Payroll", description: "Who has to sign a pay run off before the money is released." },
  { prefix: "notifications", title: "Notifications", description: "What the system tells customers, and what it may not send without asking." },
  { prefix: "maintenance", title: "Maintenance mode", description: "Takes the website out of service with a message. Staff screens keep working." },
];

/**
 * Settings resolve in three layers: a branch's own value, the company value,
 * then the default the system ships with. A branch only stores what it
 * genuinely overrides, which is why most of them read "same as company".
 */
export default async function SettingsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/settings"));
  if (!hasPermission(grantedPermissionKeys(principal), "settings.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branchPage = await listBranches({ limit: 100 });
  const branches = branchPage.items ?? branchPage;
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";

  const described = serialize(await describeSettings({ branchId: branchId || null }));
  const canEdit = can(principal, "settings.update", branchId ? { branchId } : undefined);
  const branch = branches.find((row) => row.id === branchId) ?? null;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Settings"
        description={
          branch
            ? `What ${branch.name} does differently. Anything not set here follows the company-wide value.`
            : "How the whole company works. A branch can differ on the things marked as overridable."
        }
      />

      {branches.length > 1 ? (
        <nav aria-label="Which settings" className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/settings"
            aria-current={branchId ? undefined : "page"}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${branchId ? "bg-surface-container-lowest text-on-surface hover:bg-surface-container" : "bg-secondary-container text-on-secondary-container"}`}
          >
            Company-wide
          </Link>
          {branches.map((row) => (
            <Link
              key={row.id}
              href={`/dashboard/settings?branch=${row.id}`}
              aria-current={branchId === row.id ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${branchId === row.id ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {row.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {GROUPS.map((group) => {
        const settings = described.settings.filter((setting) => setting.key.startsWith(`${group.prefix}.`));
        if (!settings.length) return null;
        // At a branch, only what a branch may actually differ on is worth showing.
        const shown = branchId ? settings.filter((setting) => setting.branchOverridable) : settings;
        if (!shown.length) return null;
        return (
          <Section key={group.prefix} title={group.title} description={group.description}>
            <SettingsForm group={group.title} settings={shown} branchId={branchId || null} canEdit={canEdit} />
          </Section>
        );
      })}

      {branchId ? (
        <p className="text-body-md text-on-surface-variant">
          Only settings a branch may differ on are shown here. Everything else is set <Link href="/dashboard/settings" className="text-primary hover:underline">company-wide</Link>.
        </p>
      ) : null}
    </div>
  );
}
