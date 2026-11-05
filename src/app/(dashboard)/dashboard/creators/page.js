import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listCreators } from "@/server/services/creator.service";
import { programOverview } from "@/server/services/creator-dashboard.service";
import { creatorCounts, programLimits } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import { CREATOR_FILTERS, chipClass, creatorState, strikeOutlook } from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Creators — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Everyone in the programme.
 *
 * A creator is a customer who films what they bought, so this list is about
 * people rather than content: how many of their videos got through, what
 * their videos have actually sold, and how close they are to a suspension.
 *
 * Strike points are given a sentence rather than a number. "3 points" means
 * nothing without the thresholds, and the thresholds are configurable — so
 * the row says what the next strike would *do*, which is the thing the person
 * reading it is deciding about.
 */
export default async function CreatorsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/creators"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creators.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const status = CREATOR_FILTERS.some((row) => row.value === one(params.status)) ? one(params.status) : "";
  const search = (one(params.q) ?? "").trim();
  const cursor = one(params.cursor) || undefined;

  const seesMoney = can(principal, "creator_earnings.read");

  const [counts, limits, { currency, timeZone }, overview] = await Promise.all([
    creatorCounts(principal),
    programLimits(),
    getSiteIdentity(),
    programOverview({
      includeMoney: seesMoney,
      scope: branchScope(principal, "creator_earnings.read"),
    }),
  ]);

  const creatorScope = branchScope(principal, "creators.read");
  const page = await listCreators({
    ...(status ? { status } : {}),
    ...(search ? { search } : {}),
    scope: creatorScope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    // A stale cursor should not be a dead screen.
    if (cursor) return listCreators({ scope: creatorScope, limit: PAGE_SIZE });
    throw error;
  });

  const creators = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status, q: search, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/creators?${text}` : "/dashboard/creators";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Creators"
        description="Customers who film what they ordered. A video goes on the product page it was bought from, and the sales it drives pay the creator in store credit."
      />

      {limits.isEnabled ? null : (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          The creator programme is switched off. Existing videos stay where they are, but nobody can join or upload.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Active creators" value={counts.ACTIVE ?? 0} note={`${counts.all ?? 0} in the programme`} />
        <StatTile label="Waiting for review" value={overview.pendingReview ?? 0} note="Videos in the moderation queue" />
        <StatTile
          label="Attributed sales"
          value={seesMoney ? (overview.attributedOrders ?? 0) : "—"}
          note={seesMoney ? "Orders a video is credited with" : "Needs permission to read earnings"}
        />
        <StatTile
          label="Unspent credit"
          value={overview.outstandingCredit != null ? formatMoney(overview.outstandingCredit, currency) : "—"}
          note={
            overview.outstandingCredit != null
              ? "What the programme owes but has not paid out"
              : overview.isBranchScoped
                ? "A wallet is chain-wide; it cannot be split by branch"
                : "Needs permission to read earnings"
          }
        />
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by standing">
        {CREATOR_FILTERS.map((tab) => (
          <Link
            key={tab.label}
            href={href({ status: tab.value, cursor: "" })}
            aria-current={status === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${status === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
            <span className="ml-2 font-normal tabular-nums opacity-80">{counts[tab.value || "all"] ?? 0}</span>
          </Link>
        ))}
      </div>

      <ListFilters
        id="creators"
        hidden={{ status: status || null }}
        fields={[{ type: "search", name: "q", label: "Find", value: search, placeholder: "A handle or a name" }]}
      />

      {creators.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {creators.map((creator) => {
              const state = creatorState(creator);
              const outlook = strikeOutlook({ points: creator.strikePoints, ...limits });

              return (
                <li
                  key={creator.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-label-bold text-on-surface">{creator.displayName}</span>
                      <span className="font-mono text-body-md text-on-surface-variant">@{creator.handle}</span>
                      <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface">
                      {creator.approvedVideoCount} of {creator.videoCount} {creator.videoCount === 1 ? "video" : "videos"} live
                      {creator.totalViews ? ` · ${creator.totalViews.toLocaleString()} views` : ""}
                      {creator.totalAttributedOrders ? ` · ${creator.totalAttributedOrders} attributed ${creator.totalAttributedOrders === 1 ? "sale" : "sales"}` : ""}
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      Joined {dateLabel(creator.joinedAt, timeZone)}
                      {creator.user?.email ? ` · ${creator.user.email}` : ""}
                    </p>
                    {/* The list could only ever report. This is the way to the
                        screen where something can actually be done. */}
                    <Link
                      href={`/dashboard/creators/${creator.id}`}
                      className="mt-1 inline-block text-body-md text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Open
                    </Link>
                    {creator.strikePoints > 0 ? (
                      <p className={`mt-1 text-body-md ${outlook.tone === "bad" ? "text-error" : "text-on-surface-variant"}`}>
                        {creator.strikePoints} strike {creator.strikePoints === 1 ? "point" : "points"}. {outlook.sentence}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    {seesMoney ? (
                      <>
                        <p className="tabular-nums text-body-md text-on-surface">
                          {formatMoney(creator.lifetimeEarned, currency)}
                        </p>
                        <p className="text-label-bold font-normal text-on-surface-variant">earned all time</p>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : (
            null
          )}
        </>
      ) : (
        <EmptyState icon={Sparkles} title={status || search ? "Nobody matches" : "No creators yet"}>
          {status || search
            ? "Try another tab or a wider search."
            : "A customer can join once they have one completed order, from the order page."}
        </EmptyState>
      )}
    </div>
  );
}
