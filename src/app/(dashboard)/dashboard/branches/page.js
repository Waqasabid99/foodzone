import Link from "next/link";
import { redirect } from "next/navigation";
import { MapPin, Phone, Plus, Store, Truck } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import BranchStatusChip from "@/components/dashboard/BranchStatusChip";
import BranchFilters from "@/components/dashboard/branches/BranchFilters";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { listBranches } from "@/server/services/branch.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Branches — FoodZone",
  robots: { index: false, follow: false },
};

/** Reads the session and live open/closed state, so nothing here may be cached. */
export const dynamic = "force-dynamic";

const PAGE_SIZE = 24;

/**
 * Every outlet this person may see, and whether each one is serving right now.
 *
 * The list is narrowed by `branchScope` rather than by the permission alone.
 * Holding `branches.read` answers "may they read branches?"; it does not answer
 * "which ones?" — and a supervisor granted the permission at one outlet would
 * otherwise open this page onto the whole company.
 */
export default async function BranchesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/branches"));

  const permissions = grantedPermissionKeys(principal);
  // The layout only proved they have *some* page here. This is the one that
  // decides whether it is this page.
  if (!hasPermission(permissions, "branches.read")) redirect("/dashboard");

  const params = await searchParams;
  const q = single(params.q)?.trim() ?? "";
  const status = ["active", "inactive"].includes(single(params.status)) ? single(params.status) : "all";
  const cursor = single(params.cursor) || undefined;

  const { items, nextCursor } = await listBranches({
    ...(q ? { search: q } : {}),
    ...(status === "all" ? {} : { isActive: status === "active" }),
    limit: PAGE_SIZE,
    cursor,
    includeState: true,
    scope: branchScope(principal, "branches.read"),
  });

  const canCreate = hasPermission(permissions, "branches.create");
  const canUpdate = hasPermission(permissions, "branches.update");
  const filtered = Boolean(q) || status !== "all";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Branches"
        description="Your outlets, their addresses, and whether each one is taking orders."
        actions={
          canCreate ? (
            <Link
              href="/dashboard/branches/new"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Plus aria-hidden="true" className="size-4" />
              New branch
            </Link>
          ) : null
        }
      />

      <BranchFilters q={q} status={status} />

      {items.length === 0 ? (
        <Empty filtered={filtered} canCreate={canCreate} />
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {items.map((branch) => (
            <BranchCard key={branch.id} branch={branch} canUpdate={canUpdate} />
          ))}
        </ul>
      )}

      {nextCursor ? (
        <div className="flex justify-center">
          <Link
            href={hrefWith({ q, status, cursor: nextCursor })}
            className="rounded-field bg-surface-container-high px-6 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Show more branches
          </Link>
        </div>
      ) : null}

      {cursor ? (
        <div className="flex justify-center">
          <Link
            href={hrefWith({ q, status })}
            className="text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Back to the first page
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function BranchCard({ branch, canUpdate }) {
  const address = [branch.addressLine1, branch.city, branch.state].filter(Boolean).join(", ");

  return (
    <li className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-headline-md text-on-surface">
            <Link
              href={`/dashboard/branches/${branch.id}`}
              className="hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {branch.name}
            </Link>
          </h2>
          <p className="mt-0.5 font-mono text-label-bold text-on-surface-variant">{branch.code}</p>
        </div>
        <BranchStatusChip openState={branch.openState} />
      </div>

      <dl className="flex flex-col gap-2 text-body-md text-on-surface-variant">
        <Detail icon={MapPin} label="Address">
          {address || "No address recorded"}
        </Detail>
        <Detail icon={Phone} label="Phone">
          {branch.phone ?? "No phone recorded"}
        </Detail>
        <Detail icon={Truck} label="Delivery">
          {branch.deliveryRadiusKm ? `Delivers within ${branch.deliveryRadiusKm} km` : "No delivery"}
        </Detail>
      </dl>

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Link
          href={`/dashboard/branches/${branch.id}`}
          className="rounded-field bg-surface-container px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          View
        </Link>
        {canUpdate ? (
          <Link
            href={`/dashboard/branches/${branch.id}/edit`}
            className="rounded-field px-4 py-2 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Edit
          </Link>
        ) : null}
      </div>
    </li>
  );
}

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-2">
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-on-surface-variant" />
      <dt className="sr-only">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Empty({ filtered, canCreate }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
      <Store aria-hidden="true" className="size-8 text-on-surface-variant" />
      <p className="font-display text-headline-md text-on-surface">
        {filtered ? "No branches match that" : "No branches yet"}
      </p>
      <p className="max-w-md text-body-md text-on-surface-variant">
        {filtered
          ? "Try a different search, or clear the filters to see every outlet."
          : "A branch is the outlet an order is placed at — its address, its hours and its menu. Nothing can be ordered until there is one."}
      </p>
      {filtered ? (
        <Link
          href="/dashboard/branches"
          className="mt-1 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Clear filters
        </Link>
      ) : canCreate ? (
        <Link
          href="/dashboard/branches/new"
          className="mt-2 inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Plus aria-hidden="true" className="size-4" />
          Create the first branch
        </Link>
      ) : null}
    </div>
  );
}

/** A search param arrives as a string or an array; the list only ever means one. */
function single(value) {
  return Array.isArray(value) ? value[0] : value;
}

function hrefWith({ q, status, cursor }) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status && status !== "all") params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/dashboard/branches?${query}` : "/dashboard/branches";
}
