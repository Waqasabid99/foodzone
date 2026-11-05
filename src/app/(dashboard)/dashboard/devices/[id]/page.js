import Link from "next/link";
import { nullIfUnreachable } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import DeviceForm from "@/components/dashboard/people/DeviceForm";
import RotateDeviceKey from "@/components/dashboard/people/DeviceKey";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getDevice } from "@/server/services/attendance-device.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { assertRecordAccess } from "@/server/hr/access";
import { DEVICE_STATES, silenceLabel } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Terminal — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DevicePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/devices/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "attendance_devices.read")) redirect("/dashboard");

  const branchId = await nullIfUnreachable(assertRecordAccess(principal, "device", id, "attendance_devices.read"));
  if (!branchId) notFound();

  const device = serialize(await getDevice(id));
  const canManage = can(principal, "attendance_devices.manage", { branchId });
  const branches = canManage ? await scopedBranches(principal, "attendance_devices.read") : [];
  const state = DEVICE_STATES[device.status] ?? DEVICE_STATES.OFFLINE;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={device.name}
        description={`${device.serialNumber}${device.vendor ? ` · ${device.vendor}${device.model ? ` ${device.model}` : ""}` : ""}`}
        back={{ href: "/dashboard/devices", label: "Terminals" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {device.isActive ? null : <Chip>Retired</Chip>}
          </div>
        }
      />

      <Section title="How it is doing">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="Last heard from">{silenceLabel(device.silentMinutes)}</Detail>
          <Detail label="Punches collected">{device.punchCount}</Detail>
          <Detail label="Branch">{device.branch?.name ?? "—"}</Detail>
          <Detail label="Sync position">{device.lastLogCursor ?? "Nothing yet"}</Detail>
          <Detail label="Address">{device.ipAddress ?? "—"}</Detail>
          <Detail label="Time zone">{device.timezone ?? "—"}</Detail>
        </dl>

        {device.hasEverSynced ? null : (
          <p className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
            This terminal has never checked in. Either the key has not been entered on the box, or it cannot reach the
            server. Nothing it records is arriving here.
          </p>
        )}

        {device.isHealthy || !device.hasEverSynced ? null : (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            Quiet since {silenceLabel(device.silentMinutes)}. It keeps punches in its own buffer and replays them when
            it reconnects, so nothing is lost yet — but nobody finds out about a box left unplugged until payroll.
          </p>
        )}

        <Link href={`/dashboard/attendance/unmatched`} className="w-fit text-label-bold text-primary hover:underline">
          Punches it sent for nobody
        </Link>
      </Section>

      {canManage ? (
        <>
          <DeviceForm device={device} branches={serialize(branches)} />

          <Section title="Its key" description="Stored hashed and never readable. Issue a new one if it has been shared or the box is replaced.">
            <RotateDeviceKey device={device} />
          </Section>

          <Section
            title={device.isActive ? "Retire it" : "Bring it back"}
            description="A retired terminal is refused when it tries to sync. The punches it already sent are kept — they are the record of people turning up."
          >
            <ActionButton
              method="patch"
              endpoint={`/admin/attendance-devices/${id}`}
              body={{ isActive: !device.isActive }}
              tone={device.isActive ? "danger" : "neutral"}
              confirm={device.isActive ? `Retire ${device.name}? It stops being able to send punches.` : null}
              success={device.isActive ? `${device.name} retired.` : `${device.name} is active again.`}
            >
              {device.isActive ? "Retire this terminal" : "Bring it back"}
            </ActionButton>
          </Section>
        </>
      ) : null}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 break-words text-on-surface">{children}</dd>
    </div>
  );
}
