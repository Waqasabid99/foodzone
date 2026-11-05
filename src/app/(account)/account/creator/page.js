import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import StatTile from "@/components/dashboard/StatTile";
import Chip from "@/components/dashboard/inventory/Chip";
import JoinCreator from "@/components/account/JoinCreator";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { creatorEligibility, currentTerms } from "@/server/services/creator.service";
import { creatorDashboard } from "@/server/services/creator-dashboard.service";
import { formatMoney } from "@/lib/format";
import { dateLabel } from "@/lib/finance";
import { chipClass, creatorState, earningState, holdProgress, disqualificationHint, videoState } from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "Creator studio — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The creator's own view of the programme.
 *
 * Three questions, in the order a creator actually asks them: how much have I
 * got, what are my videos doing, and is anything stuck.
 *
 * Earnings that paid nothing are shown rather than hidden. A `NOT_QUALIFIED`
 * row means their video genuinely drove a sale that missed the rule — which
 * is the single most important thing to tell somebody who is deciding whether
 * this is worth their time. Hiding it looks like the programme is broken.
 */
export default async function CreatorStudioPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/creator"));
  const permissions = grantedPermissionKeys(principal);
  // Either: a creator reads their studio, a customer reads the invitation.
  const canSeeStudio =
    hasPermission(permissions, "self.view_creator_dashboard") || hasPermission(permissions, "self.become_creator");
  if (!canSeeStudio) redirect("/account");

  const eligibility = await creatorEligibility(principal.userId);

  // Not a creator yet: either invite them in, or say plainly why not.
  if (!eligibility.creator) {
    const terms = eligibility.eligible ? await currentTerms().catch(() => null) : null;

    return (
      <div className="flex max-w-3xl flex-col gap-6">
        <PageHeader
          title="Creator studio"
          description="Film what you order, and earn credit when your video sells it."
        />

        {eligibility.eligible ? (
          <JoinCreator terms={serialize(terms)} />
        ) : (
          <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
            {eligibility.reason === "PROGRAM_CLOSED"
              ? "The creator programme is not taking new people at the moment."
              : "You can join once you have had one order delivered. Order something first — the programme is about food you actually bought."}
          </p>
        )}
      </div>
    );
  }

  const data = serialize(await creatorDashboard({ userId: principal.userId }));
  const { creator, wallet, videos, earnings } = data;
  const money = (value) => formatMoney(value, wallet.currency);
  const standing = creatorState(creator);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={creator.displayName}
        description={`@${creator.handle} · joined ${dateLabel(creator.joinedAt, timeZone)}`}
        actions={
          hasPermission(permissions, "self.manage_own_videos") ? (
            <Link
              href="/account/creator/videos"
              className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              My videos
            </Link>
          ) : null
        }
      />

      {creator.status !== "ACTIVE" ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          <span className="font-semibold">{standing.label}.</span> {standing.note}
          {creator.suspendedUntil ? ` Until ${dateLabel(creator.suspendedUntil, timeZone)}.` : ""}
        </p>
      ) : null}

      {wallet.isLocked ? (
        <p className="rounded-card bg-error-container px-5 py-4 text-body-md text-on-error-container">
          Your credit is frozen while something is looked into. Nothing has been taken away.
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Credit to spend" value={money(wallet.balance)} note="Use it at checkout" />
        <StatTile
          label="On the way"
          value={money(wallet.pendingBalance)}
          note={`Clears ${earnings.holdDays} days after each order`}
        />
        <StatTile label="Videos live" value={videos.live} note={`${videos.total} uploaded in total`} />
        <StatTile label="Earned all time" value={money(wallet.lifetimeEarned)} note={`${creator.totalViews.toLocaleString()} views`} />
      </div>

      {videos.awaitingReview || videos.needsAttention ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          {videos.awaitingReview ? `${videos.awaitingReview} waiting to be reviewed. ` : ""}
          {videos.needsAttention ? `${videos.needsAttention} need something from you — ` : ""}
          {videos.needsAttention ? (
            <Link href="/account/creator/videos" className="underline">
              take a look
            </Link>
          ) : null}
          {videos.needsAttention ? "." : ""}
        </p>
      ) : null}

      {earnings.recent?.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">What your videos have earned</h2>
          <ul className="flex flex-col gap-3">
            {earnings.recent.map((earning) => {
              const state = earningState(earning);
              const hold = holdProgress(earning, now);
              return (
                <li key={earning.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-label-bold text-on-surface">
                        {earning.video?.caption || "Your video"}
                      </span>
                      <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {earning.status === "NOT_QUALIFIED"
                        ? disqualificationHint(earning.disqualifiedReason)
                        : `From order ${earning.order?.orderNumber ?? ""}`.trim()}
                    </p>
                    {hold ? <p className="text-body-md text-on-surface-variant">{hold.sentence}</p> : null}
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">
                    {earning.status === "NOT_QUALIFIED" ? "—" : money(earning.amount)}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Nothing earned yet. A video starts earning once somebody adds the item to their basket from it and the order
          goes through.
        </p>
      )}

      {videos.recent?.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">Your videos</h2>
          <ul className="flex flex-col gap-3">
            {videos.recent.slice(0, 6).map((video) => {
              const state = videoState(video);
              return (
                <li key={video.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-label-bold text-on-surface">{video.product?.name ?? "A product"}</span>
                      <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {video.viewCount.toLocaleString()} views · {video.addToCartCount} added to basket ·{" "}
                      {video.attributedOrderCount} {video.attributedOrderCount === 1 ? "sale" : "sales"}
                    </p>
                  </div>
                  <p className="tabular-nums text-body-md text-on-surface">{money(video.earnedTotal)}</p>
                </li>
              );
            })}
          </ul>
          <Link href="/account/creator/videos" className="w-fit text-body-md text-on-surface-variant underline">
            All my videos
          </Link>
        </section>
      ) : (
        <div className="rounded-card bg-surface-container-low px-5 py-4">
          <p className="flex items-center gap-2 text-body-md text-on-surface">
            <Sparkles aria-hidden="true" className="size-4" />
            Nothing filmed yet.
          </p>
          <Link href="/account/creator/videos" className="mt-1 inline-block text-body-md text-on-surface-variant underline">
            Film something you ordered
          </Link>
        </div>
      )}
    </div>
  );
}
