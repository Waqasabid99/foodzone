import { redirect, notFound } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import StatTile from "@/components/dashboard/StatTile";
import StrikeActions from "@/components/dashboard/creator/StrikeActions";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getCreator, listStrikes } from "@/server/services/creator.service";
import { programLimits } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { chipClass, creatorState, strikeOutlook } from "@/lib/creator";
import { dateLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { ApiError } from "@/lib/api";

export const metadata = { title: "Creator — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One creator, and the things that can be done about them.
 *
 * The list page could only ever report: it showed strike points with no way to
 * see what they were for, and no way to take one back — so the one moderation
 * action in the programme that *undoes* something was the one with no screen.
 *
 * Money is absent unless the reader holds `creator_earnings.read`. A content
 * moderator holds `creators.read` and has no business knowing what somebody
 * earns, which is the same split the programme overview makes.
 */
export default async function CreatorDetailPage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/creators/${id}`));

  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creators.read")) redirect("/dashboard");

  let creator;
  try {
    creator = await getCreator(id);
  } catch (error) {
    if (error instanceof ApiError && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const [strikes, limits] = await Promise.all([listStrikes(id), programLimits()]);
  const state = creatorState(creator);
  const outlook = strikeOutlook({ points: creator.strikePoints, ...limits });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={creator.displayName}
        description={`@${creator.handle} · joined ${dateLabel(creator.joinedAt, timeZone)}${creator.user?.email ? ` · ${creator.user.email}` : ""}`}
        back={{ href: "/dashboard/creators", label: "Creators" }}
      />

      <p className="flex flex-wrap items-center gap-2">
        <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
        <span className="text-body-md text-on-surface-variant">{state.note}</span>
      </p>

      {creator.status === "SUSPENDED" && creator.suspendedUntil ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          Suspended until {dateLabel(creator.suspendedUntil, timeZone)}
          {creator.suspensionReason ? ` — ${creator.suspensionReason}` : ""}.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Videos live" value={creator.approvedVideoCount} note={`${creator.videoCount} filmed in total`} />
        <StatTile label="Views" value={creator.totalViews.toLocaleString()} note={`${creator.totalShares} shares`} />
        <StatTile
          label="Attributed sales"
          value={creator.totalAttributedOrders}
          note="Orders a video of theirs started"
        />
        <StatTile
          label="Strike points"
          value={creator.strikePoints}
          note={outlook.sentence}
        />
      </div>

      <StrikeActions
        creator={serialize(creator)}
        strikes={serialize(strikes)}
        canAdjust={hasPermission(permissions, "creators.adjust_strikes")}
      />
    </div>
  );
}
