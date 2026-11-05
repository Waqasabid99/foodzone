import Link from "next/link";
import { redirect } from "next/navigation";
import { Video } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import VideoModeration from "@/components/dashboard/creator/VideoModeration";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listVideos } from "@/server/services/creator-video.service";
import { productNames, programLimits, videoCounts, videoOrderBranches, branchNames } from "@/server/content/creator-admin";
import { getSiteIdentity } from "@/server/content/site";
import { dateLabel } from "@/lib/finance";
import {
  REJECTION_REASONS,
  VIDEO_FILTERS,
  attemptsLeft,
  chipClass,
  conversionRate,
  durationLabel,
  videoState,
} from "@/lib/creator";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Creator videos — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/** The All videos tab's value in the URL, since an empty one cannot survive it. */
const ALL = "all";

/**
 * The moderation queue, and everything that has been through it.
 *
 * Ordered oldest-submission-first on the waiting tab, because a queue sorted
 * newest-first quietly abandons whoever is at the back of it.
 *
 * Two things are on every row that a plain content list would leave out: how
 * many attempts the creator has left, because rejecting is not a reversible
 * act once they run out; and how many viewers have reported it, because a
 * video with three complaints against it should not be sitting in the same
 * undifferentiated list as one with none.
 */
export default async function CreatorVideosPage({ searchParams }) {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/creator-videos"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "creator_videos.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  /*
   * "all" travels in the URL as the word, not as an empty string.
   *
   * This screen is the one list whose default is a real filter rather than
   * everything, and `href()` below drops falsy values — so the All videos tab
   * linked to a URL with no `status` at all, which read back as "nothing was
   * asked for" and fell through to the default. The tab showed a count it
   * could never display: clicking it returned you to an empty review queue.
   */
  const asked = one(params.status);
  const status = asked === ALL ? "" : VIDEO_FILTERS.some((row) => row.value === asked) ? asked : "PENDING_REVIEW";
  const cursor = one(params.cursor) || undefined;

  const videoScope = branchScope(principal, "creator_videos.read");
  const [counts, limits] = await Promise.all([videoCounts(principal), programLimits()]);

  const page = await listVideos({
    ...(status ? { status } : {}),
    scope: videoScope,
    limit: PAGE_SIZE,
    cursor,
  }).catch((error) => {
    if (cursor) return listVideos({ ...(status ? { status } : {}), scope: videoScope, limit: PAGE_SIZE });
    throw error;
  });

  const videos = serialize(page.items);
  const [products, orders] = await Promise.all([
    productNames(videos.map((video) => video.productId)),
    videoOrderBranches(videos.map((video) => video.id)),
  ]);
  // The video's own branch now, not the order's: they are the same outlet by
  // construction, and the video carries it without a second lookup.
  const branches = await branchNames(videos.map((video) => video.branchId));

  // Publishing reaches as far as the product does, so it is decided per
  // video rather than once for the screen: a branch manager may publish a
  // video of their own outlet's product, but not one of a product on the
  // whole chain's catalogue. The server enforces it either way; working it
  // out here stops somebody filling in a form that will be refused.
  const chainWide = holdsCompanyWide(principal, "creator_videos.publish") || principal.isSuperAdmin;
  const can = {
    publish: hasPermission(permissions, "creator_videos.publish"),
    reject: hasPermission(permissions, "creator_videos.reject"),
    takedown: hasPermission(permissions, "creator_videos.takedown"),
  };

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { status: status || ALL, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/creator-videos?${text}` : "/dashboard/creator-videos";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Creator videos"
        description={`Customers film what they bought. Between ${limits.minVideoSeconds} and ${limits.maxVideoSeconds} seconds, filmed against one order line, and approved before anybody sees it.`}
      />

      {limits.autoApproveVideos ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          Automatic approval is on, so videos go live without passing through this queue. What is listed here is a
          record rather than a decision.
        </p>
      ) : null}

      {can.publish && !chainWide ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          Your permission to publish is pinned to a branch, so you can approve videos of your own outlet&apos;s
          products. A video of an item on the whole chain&apos;s catalogue goes live at every outlet and needs a
          company-wide role — you can still send those back and take live ones down.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {VIDEO_FILTERS.map((tab) => (
          <Link
            key={tab.label}
            href={href({ status: tab.value || ALL, cursor: "" })}
            aria-current={status === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${status === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
            <span className="ml-2 font-normal tabular-nums opacity-80">{counts[tab.value || "all"] ?? 0}</span>
          </Link>
        ))}
      </div>

      {videos.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {videos.map((video) => {
              const state = videoState(video);
              const left = attemptsLeft({ ...video, maxUploadAttempts: limits.maxUploadAttempts });
              const order = orders[video.id];
              const conversion = conversionRate(video);

              return (
                <li key={video.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-label-bold text-on-surface">
                          {products[video.productId] ?? "A product that no longer exists"}
                        </span>
                        <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                      </p>
                      <p className="mt-1 text-body-md text-on-surface-variant">
                        {durationLabel(video.durationSeconds)}
                        {order?.orderNumber ? ` · from order ${order.orderNumber}` : ""}
                        {video.branchId && branches[video.branchId] ? ` at ${branches[video.branchId]}` : ""}
                        {video.submittedAt ? ` · submitted ${dateLabel(video.submittedAt, timeZone)}` : ""}
                      </p>
                      {video.caption ? <p className="mt-1 text-body-md text-on-surface">“{video.caption}”</p> : null}

                      {video.status === "APPROVED" ? (
                        <p className="mt-1 text-body-md text-on-surface-variant">
                          {video.viewCount.toLocaleString()} views · {video.addToCartCount} added to cart
                          {conversion != null ? ` (${conversion.toFixed(1)}%)` : ""} ·{" "}
                          {video.attributedOrderCount} {video.attributedOrderCount === 1 ? "sale" : "sales"}
                        </p>
                      ) : null}

                      {video.lastRejectionReason ? (
                        <p className="mt-1 text-body-md text-on-surface-variant">
                          Last sent back: {REJECTION_REASONS[video.lastRejectionReason]?.label ?? video.lastRejectionReason}
                          {video.lastRejectionNote ? ` — ${video.lastRejectionNote}` : ""}
                        </p>
                      ) : null}

                      <p className={`mt-1 text-body-md ${left <= 1 ? "text-error" : "text-on-surface-variant"}`}>
                        {video.isLocked
                          ? "Out of attempts. This order line can never be filmed again."
                          : `${left} of ${limits.maxUploadAttempts} attempts left.`}
                      </p>
                    </div>

                    {/*
                      * The clip itself, not a still of it.
                      *
                      * Approving asks whether the video shows the item and
                      * whether it is good enough for a product page. Both are
                      * unanswerable from a thumbnail, and this screen used to
                      * show nothing else — a moderator ticking those boxes was
                      * being asked to vouch for something they had not seen.
                      *
                      * `preload="metadata"` so a queue of twenty does not pull
                      * twenty videos down before anybody presses play.
                      */}
                    {video.videoUrl ? (
                      <video
                        src={video.videoUrl}
                        poster={video.thumbnailUrl ?? undefined}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-56 w-40 shrink-0 rounded-field bg-surface-container-highest object-cover"
                      />
                    ) : video.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={video.thumbnailUrl}
                        alt=""
                        className="h-28 w-20 shrink-0 rounded-field object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <p className="shrink-0 rounded-field bg-surface-container-high px-4 py-3 text-body-md text-on-surface-variant">
                        No file attached
                      </p>
                    )}
                  </div>

                  <VideoModeration
                    video={video}
                    branchName={video.branchId ? branches[video.branchId] : null}
                    maxUploadAttempts={limits.maxUploadAttempts}
                    can={can}
                  />
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
          ) : null}
        </>
      ) : (
        <EmptyState icon={Video} title={status === "PENDING_REVIEW" ? "Nothing waiting" : "Nothing here"}>
          {status === "PENDING_REVIEW"
            ? "The queue is empty. Anything submitted will appear here oldest first."
            : "No videos in this state."}
        </EmptyState>
      )}
    </div>
  );
}
