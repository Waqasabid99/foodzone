import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import { Download } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import DeleteSection from "@/components/dashboard/DeleteSection";
import QrCodeForm from "@/components/dashboard/service/QrCodeForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getQrCode, qrAnalytics } from "@/server/services/qr.service";
import { qrTargetOptions, scopedBranches, tableOptions } from "@/server/content/service-admin";
import { QR_TARGETS, qrTargetSummary } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "QR code — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const when = (value) => (value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "never");

/**
 * One code: what it is, where it points, and whether anybody scans it.
 *
 * The scan count is the useful number here and it is phrased as a question
 * about the poster rather than the code — "nobody has ever scanned this" is
 * really "that sticker is in the wrong place", which is something somebody
 * can act on.
 */
export default async function QrCodePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/qr-codes/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "qr_codes.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getQrCode(id));
  if (!raw || !inScope(branchScope(principal, "qr_codes.read"), raw.branchId)) notFound();

  const code = serialize(raw);
  const branchId = code.branchId;
  const canEdit = can(principal, "qr_codes.update", { branchId });

  const [branches, targets, tables, analytics] = await Promise.all([
    scopedBranches(principal, "qr_codes.read"),
    canEdit ? qrTargetOptions(branchId) : { menus: [], categories: [], products: [] },
    canEdit ? tableOptions(principal, branchId) : [],
    can(principal, "qr_codes.view_analytics", { branchId }) ? qrAnalytics({ qrCodeId: id }).catch(() => null) : null,
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={code.label || `Code ${code.code}`}
        description={qrTargetSummary(code)}
        back={{ href: "/dashboard/qr-codes", label: "QR codes" }}
        actions={
          <>
            {code.isActive ? null : <Chip>Switched off</Chip>}
            {can(principal, "qr_codes.print", { branchId }) ? (
              <>
                <a
                  href={`/api/v1/admin/qr-codes/${id}/image?format=svg&markPrinted=true`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Download aria-hidden="true" className="size-4" />
                  SVG for print
                </a>
                <a
                  href={`/api/v1/admin/qr-codes/${id}/image?format=png&size=1024`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  PNG
                </a>
              </>
            ) : null}
          </>
        }
      />

      <Section title="The code">
        <dl className="grid gap-2 text-body-md">
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-on-surface-variant">Short code</dt>
            <dd className="font-mono text-on-surface">{code.code}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-on-surface-variant">Opens</dt>
            <dd className="break-all text-on-surface">{code.url}</dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-on-surface-variant">Scanned</dt>
            <dd className="tabular-nums text-on-surface">
              {code.scanCount ? `${code.scanCount} times, last ${when(code.lastScannedAt)}` : "never"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-3">
            <dt className="text-on-surface-variant">Downloaded for print</dt>
            <dd className="text-on-surface">{when(code.printedAt)}</dd>
          </div>
        </dl>
        {!code.scanCount && code.printedAt ? (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            Printed but never scanned. That usually means the sticker is somewhere nobody looks rather than anything
            wrong with the code.
          </p>
        ) : null}
        {analytics?.daily?.length ? (
          <p className="text-body-md text-on-surface-variant">
            {analytics.daily.reduce((sum, row) => sum + (row.scans ?? 0), 0)} scans in the period reported.
          </p>
        ) : null}
      </Section>

      {canEdit ? (
        <Section title="Where it points" description="Changing this does not change the code, so anything already printed keeps working.">
          <QrCodeForm
            branches={serialize(branches)}
            targets={serialize(targets)}
            tables={serialize(tables)}
            qrCode={code}
          />
        </Section>
      ) : (
        <p className="text-body-md text-on-surface-variant">
          {QR_TARGETS[code.targetType]?.hint}
        </p>
      )}

      {can(principal, "qr_codes.delete", { branchId }) ? (
        <DeleteSection
          title="Delete this code"
          description="Only do this for a code that was never printed. A deleted code stops working immediately, and if it is on a table somewhere that table's QR simply fails — switching it off instead at least leaves a record of what it was."
          endpoint={`/admin/qr-codes/${id}`}
          confirm={`Delete code ${code.code}? Anything printed with it stops working.`}
          redirectTo="/dashboard/qr-codes"
          success="Code deleted."
        />
      ) : null}
    </div>
  );
}
