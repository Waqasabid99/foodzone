import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, QrCode } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listQrCodes } from "@/server/services/qr.service";
import { actionableBranches, scopedBranches } from "@/server/content/service-admin";
import { QR_TARGETS, qrTargetSummary } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "QR codes — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * Codes that live on physical objects.
 *
 * The short code is never editable, because it is on a sticker somewhere.
 * What it points at is, which is the entire reason for putting a redirect in
 * the middle: the poster stays on the wall and the campaign behind it moves.
 */
export default async function QrCodesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/qr-codes"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "qr_codes.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const [branches, creatable] = await Promise.all([
    scopedBranches(principal, "qr_codes.read"),
    actionableBranches(principal, "qr_codes.create"),
  ]);
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";
  const targetType = QR_TARGETS[one(params.target)] ? one(params.target) : "";
  const cursor = one(params.cursor) || undefined;

  const page = await listQrCodes({
    ...(branch ? { branchId: branch } : {}),
    ...(targetType ? { targetType } : {}),
    scope: branchScope(principal, "qr_codes.read"),
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listQrCodes({ scope: branchScope(principal, "qr_codes.read"), limit: PAGE_SIZE });
    throw error;
  });
  const codes = serialize(page.items);
  const branchName = Object.fromEntries(branches.map((row) => [row.id, row.name]));
  const neverPrinted = codes.filter((code) => !code.printedAt).length;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="QR codes"
        description="What a customer's phone opens when they scan a table talker, a poster or a window sticker."
        actions={
          creatable.length ? (
            <Link
              href="/dashboard/qr-codes/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New code
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="qr-codes"
        fields={[
          ...(branches.length > 1
            ? [
                {
                  type: "select",
                  name: "branch",
                  label: "Branch",
                  value: branch,
                  options: [{ value: "", label: "All branches" }, ...branches.map((row) => ({ value: row.id, label: row.name }))],
                },
              ]
            : []),
          {
            type: "select",
            name: "target",
            label: "Points at",
            value: targetType,
            options: [{ value: "", label: "Anything" }, ...Object.entries(QR_TARGETS).map(([value, row]) => ({ value, label: row.label }))],
          },
        ]}
      />

      {codes.length ? (
        <>
          {neverPrinted ? (
            <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
              {neverPrinted} of these have never been downloaded for printing, so they are probably not on anything yet.
            </p>
          ) : null}

          <ul className="grid gap-3 md:grid-cols-2">
            {codes.map((code) => (
              <li key={code.id} className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/qr-codes/${code.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                    {code.code}
                  </Link>
                  {code.isActive ? null : <Chip>Switched off</Chip>}
                  {code.printedAt ? null : <Chip>Not printed</Chip>}
                </p>
                <p className="text-body-md text-on-surface">{code.label || QR_TARGETS[code.targetType]?.label}</p>
                <p className="text-body-md text-on-surface-variant">
                  {qrTargetSummary(code)}
                  {branches.length > 1 ? ` · ${branchName[code.branchId] ?? "Another branch"}` : ""}
                  {code.scanCount ? ` · ${code.scanCount} scans` : " · never scanned"}
                </p>
              </li>
            ))}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href="/dashboard/qr-codes" className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link
                  href={`/dashboard/qr-codes?cursor=${page.nextCursor}${branch ? `&branch=${branch}` : ""}${targetType ? `&target=${targetType}` : ""}`}
                  className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
                >
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={QrCode} title="No codes yet" action={creatable.length ? { href: "/dashboard/qr-codes/new", label: "Make one" } : null}>
          A code is a short link you can print. Point it at the menu, or at one table so that whoever scans it is
          already seated.
        </EmptyState>
      )}
    </div>
  );
}
