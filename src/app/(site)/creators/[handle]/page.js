import { notFound } from "next/navigation";
import VideoGrid from "@/components/videos/VideoGrid";
import { creatorProfile } from "@/server/content/creator-videos";
import { getSiteIdentity } from "@/server/content/site";
import { serialize } from "@/lib/api/serialize";
import { initials } from "@/lib/format";
import { dateLabel } from "@/lib/finance";

export const dynamic = "force-dynamic";

/**
 * A creator's public page.
 *
 * Everything they have had approved, across every outlet they have filmed at —
 * the one surface in the programme that deliberately crosses branches, because
 * it is about a person rather than a branch's shelf. Each clip names the outlet
 * it came from, so a dish from another city explains itself instead of looking
 * like a bug.
 *
 * A suspended or banned creator is a plain 404 rather than a page saying so.
 * The storefront is not where a moderation outcome gets published, and "this
 * account is suspended" on a public page is a punishment nobody decided to
 * hand out.
 */
export async function generateMetadata({ params }) {
  const { handle } = await params;
  const profile = await creatorProfile(handle);
  if (!profile) return { title: "Creator not found — FoodZone" };

  return {
    title: `${profile.creator.displayName} (@${profile.creator.handle}) — FoodZone`,
    description: profile.creator.bio || `Clips filmed by @${profile.creator.handle}.`,
  };
}

export default async function CreatorProfilePage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { handle } = await params;
  const profile = await creatorProfile(handle);
  if (!profile) notFound();

  const { creator, videos } = serialize(profile);

  return (
    <div className="mx-auto max-w-page px-margin-mobile py-10 md:px-margin-desktop md:py-12">
      <header className="flex flex-wrap items-center gap-5">
        {creator.avatarUrl ? (
          /* Stored on whichever storage this install is configured with, so
             there is no loader that can be trusted to optimise it. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={creator.avatarUrl}
            alt=""
            className="size-20 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-20 shrink-0 place-items-center rounded-full bg-primary-container font-display text-headline-md text-on-primary-container"
          >
            {initials(creator.displayName || creator.handle)}
          </span>
        )}

        <div className="min-w-0">
          <h1 className="font-display text-headline-lg text-on-surface">{creator.displayName}</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">@{creator.handle}</p>

          {/* Counts come off the creator's own row rather than the page's
              slice of it: `videos` is capped at 48, and a profile that said
              "48 videos" to somebody with 200 would be quietly wrong. */}
          <p className="mt-2 text-body-md text-on-surface-variant">
            {creator.approvedVideoCount} {creator.approvedVideoCount === 1 ? "video" : "videos"} ·{" "}
            {creator.totalViews.toLocaleString()} {creator.totalViews === 1 ? "view" : "views"} · filming since{" "}
            {dateLabel(creator.joinedAt, timeZone)}
          </p>
        </div>
      </header>

      {creator.bio ? <p className="mt-6 max-w-2xl text-body-lg text-on-surface-variant">{creator.bio}</p> : null}

      <section aria-labelledby="clips-heading" className="mt-10">
        <h2 id="clips-heading" className="font-display text-headline-md text-on-surface">
          Everything they have filmed
        </h2>

        <div className="mt-5">
          <VideoGrid
            videos={videos}
            surface="CREATOR_PROFILE"
            emptyMessage={`@${creator.handle} has not had anything approved yet.`}
          />
        </div>
      </section>
    </div>
  );
}
