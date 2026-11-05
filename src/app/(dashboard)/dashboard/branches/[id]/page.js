import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import { CalendarOff, Clock, Pencil, TriangleAlert } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import BranchHoursEditor from "@/components/dashboard/branches/BranchHoursEditor";
import BranchStatusChip from "@/components/dashboard/BranchStatusChip";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys } from "@/lib/api/permissions";
import { getBranch } from "@/server/services/branch.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";


export async function generateMetadata({ params }) {
  const { id } = await params;
  const branch = await getBranch(id).catch(() => null);

  return {
    title: branch ? `${branch.name} — Branches — FoodZone` : "Branch — FoodZone",
    robots: { index: false, follow: false },
  };
}

/**
 * One branch, as an operator needs to read it.
 *
 * The status chip at the top is the reason this page is worth opening, and
 * everything below it exists to explain that chip: the week's hours say when it
 * should be open, the closures say when it deliberately is not, and "no hours
 * set" is called out as the configuration gap it is rather than left to look
 * like a quiet Tuesday.
 */
export default async function BranchPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/branches/${id}`));

  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "branches.read")) redirect("/dashboard");

  const branch = await nullIfMissing(getBranch(id));
  if (!branch) notFound();

  // A branch-scoped grant makes the *list* shorter; without this it would leave
  // the direct URL open, and a page you can still reach by typing its address
  // is not scoped at all.
  const scope = branchScope(principal, "branches.read");
  if (!scope.all && !scope.ids.includes(branch.id)) notFound();
  if (scope.all && scope.except?.includes(branch.id)) notFound();

  const canUpdate = hasPermission(permissions, "branches.update");
  const canManageHours = hasPermission(permissions, "branches.manage_hours");
  const address = [
    branch.addressLine1,
    branch.addressLine2,
    branch.city,
    branch.state,
    branch.postalCode,
    branch.country,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={branch.name}
        description={`Code ${branch.code}`}
        back={{ href: "/dashboard/branches", label: "Branches" }}
        actions={
          canUpdate ? (
            <Link
              href={`/dashboard/branches/${branch.id}/edit`}
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 font-display text-label-bold uppercase tracking-wide text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit branch
            </Link>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <BranchStatusChip openState={branch.openState} />
        {!branch.isActive ? (
          <p className="text-body-md text-on-surface-variant">
            This branch is hidden from the website and the app.
          </p>
        ) : null}
      </div>

      {branch.openState.reason === "NO_HOURS_SET" ? (
        <p className="flex items-start gap-2 rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <span>
            No opening hours have been set, so this branch never reads as open and customers cannot order
            from it. Set the week&rsquo;s hours to bring it online.
          </span>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        <Panel title="Where it is" definitions>
          <Row label="Address">{address || "Not recorded"}</Row>
          <Row label="Coordinates">
            {branch.latitude && branch.longitude
              ? `${branch.latitude}, ${branch.longitude}`
              : "Not recorded — delivery distance cannot be measured without these"}
          </Row>
          <Row label="Delivery radius">
            {branch.deliveryRadiusKm ? `${branch.deliveryRadiusKm} km` : "Does not deliver"}
          </Row>
        </Panel>

        <Panel title="How to reach it" definitions>
          <Row label="Phone">{branch.phone ?? "Not recorded"}</Row>
          <Row label="Email">{branch.email ?? "Not recorded"}</Row>
          <Row label="Registered name">{branch.legalName ?? "Same as the branch name"}</Row>
          <Row label="Tax identifier">{branch.taxIdentifier ?? "Not recorded"}</Row>
        </Panel>

        <Panel title="Trading" definitions>
          <Row label="Timezone">{branch.timezone}</Row>
          <Row label="Currency">{branch.currency}</Row>
          <Row label="Opened">
            {branch.openedAt
              ? new Date(branch.openedAt).toLocaleDateString("en-US", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "Not recorded"}
          </Row>
          <Row label="Taking orders">{branch.isActive ? "Yes" : "No"}</Row>
        </Panel>

        <Panel
          title="Opening hours"
          icon={Clock}
          note={`Read in ${branch.timezone}. A window that runs past midnight is shown with the next day's closing time.`}
        >
          {/* The editor replaces the read-only list: a panel that states "No
              hours set." and offers no way to set them is how a branch ends up
              trading on an empty schedule. */}
          <BranchHoursEditor
            branchId={branch.id}
            timezone={branch.timezone}
            hours={branch.hours}
            canEdit={canManageHours}
          />

        </Panel>

        <Panel title="Upcoming closures" icon={CalendarOff}>
          {branch.closures.length ? (
            <ul className="flex flex-col gap-3">
              {branch.closures.map((closure) => (
                <li key={closure.id} className="text-body-md">
                  <p className="text-on-surface">
                    {formatRange(closure.startsAt, closure.endsAt)}
                  </p>
                  <p className="text-on-surface-variant">{closure.reason ?? "No reason given"}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              None scheduled. The branch follows its weekly hours.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/** `definitions` wraps the body in a `<dl>`, which is what a panel of `<Row>`s is. */
function Panel({ title, icon: Icon = null, note = null, definitions = false, children }) {
  return (
    <section className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5 sm:p-6">
      <div>
        <h2 className="flex items-center gap-2 font-display text-headline-md text-on-surface">
          {Icon ? <Icon aria-hidden="true" className="size-5 text-on-surface-variant" /> : null}
          {title}
        </h2>
        {note ? <p className="mt-1 text-label-bold font-normal text-on-surface-variant">{note}</p> : null}
      </div>
      {definitions ? <dl className="flex flex-col gap-3">{children}</dl> : children}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-label-bold text-on-surface-variant">{label}</dt>
      <dd className="text-body-md text-on-surface">{children}</dd>
    </div>
  );
}

function formatRange(startsAt, endsAt) {
  const options = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
  return `${new Date(startsAt).toLocaleString("en-US", options)} — ${new Date(endsAt).toLocaleString("en-US", options)}`;
}
