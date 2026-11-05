import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ScanFace } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { deviceHealth } from "@/server/services/attendance-device.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { DEVICE_STATES, silenceLabel } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Attendance terminals — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The fleet of terminals, quietest first.
 *
 * The question worth asking of attendance hardware is not "are they all fine"
 * but "which one stopped" — a device that went quiet three days ago has been
 * losing punches for three days, and nobody finds out until payroll. Health is
 * derived from silence rather than reported, because a box that has fallen off
 * the network cannot tell us it has.
 */
export default async function DevicesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/devices"));
  if (!hasPermission(grantedPermissionKeys(principal), "attendance_devices.read")) redirect("/dashboard");

  const [health, branches] = await Promise.all([
    deviceHealth({ scope: branchScope(principal, "attendance_devices.read") }),
    scopedBranches(principal, "attendance_devices.read"),
  ]);

  const devices = serialize(health.devices);
  const branchName = (id) => branches.find((branch) => branch.id === id)?.name ?? "Another branch";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance terminals"
        description="The boxes on the wall that staff clock in on. Listed quietest first, because the one that stopped is the one losing punches."
        actions={
          can(principal, "attendance_devices.manage") ? (
            <Link href="/dashboard/devices/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              Register one
            </Link>
          ) : null
        }
      />

      {health.total ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tile label="Syncing" value={health.healthy} />
          <Tile label="Gone quiet" value={health.stale} tone={health.stale ? "bg-warning-container text-on-warning-container" : undefined} />
          <Tile label="Never synced" value={health.neverSynced} tone={health.neverSynced ? "bg-error-container text-on-error-container" : undefined} />
        </div>
      ) : null}

      {devices.length ? (
        <ul className="flex flex-col gap-3">
          {devices.map((device) => {
            const state = DEVICE_STATES[device.status] ?? DEVICE_STATES.OFFLINE;
            return (
              <li key={device.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/devices/${device.id}`} className="text-label-bold text-on-surface hover:underline">{device.name}</Link>
                    <Chip tone={state.tone}>{state.label}</Chip>
                    {device.hasEverSynced ? null : <Chip tone="bg-error-container text-on-error-container">Never synced</Chip>}
                  </p>
                  <p className="mt-1 break-all text-body-md text-on-surface-variant">
                    {device.serialNumber}
                    {device.vendor ? ` · ${device.vendor}${device.model ? ` ${device.model}` : ""}` : ""}
                    {branches.length > 1 ? ` · ${branchName(device.branchId)}` : ""}
                  </p>
                </div>
                <p className="text-right text-body-md text-on-surface-variant">
                  <span className="block text-label-bold text-on-surface">{silenceLabel(device.silentMinutes)}</span>
                  {device.punchCount} punches collected
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          icon={ScanFace}
          title="No terminals registered"
          action={can(principal, "attendance_devices.manage") ? { href: "/dashboard/devices/new", label: "Register one" } : null}
        >
          Without a terminal, attendance can only be entered by hand. Registering one issues the key it authenticates
          with.
        </EmptyState>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "bg-surface-container-lowest text-on-surface" }) {
  return (
    <div className={`rounded-card px-5 py-4 ${tone}`}>
      <p className="font-display text-headline-md">{value}</p>
      <p className="text-body-md opacity-90">{label}</p>
    </div>
  );
}
