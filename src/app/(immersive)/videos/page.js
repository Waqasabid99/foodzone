import { cookies } from "next/headers";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import VideoViewer from "@/components/videos/VideoViewer";
import { getPublicBranches } from "@/server/content/branches";
import { feedVideos } from "@/server/content/creator-videos";
import { serialize } from "@/lib/api/serialize";
import { BRANCH_COOKIE, resolveBranch } from "@/lib/branch";

export const metadata = {
  title: "Customer videos — FoodZone",
  description: "Short clips of our food, filmed by the people who ordered it.",
};

/**
 * The browse feed.
 *
 * Dynamic, because which clips exist depends entirely on which outlet the
 * visitor has chosen — a cached feed would be the wrong branch's for everybody
 * after the first.
 *
 * A visitor who has not chosen an outlet is asked to, rather than shown an
 * arbitrary branch's videos or a blank screen. `resolveBranch` settles a
 * single-restaurant installation on its own, so that question is only ever put
 * to somebody who genuinely has a choice to make.
 */
export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const [branches, cookieStore] = await Promise.all([getPublicBranches(), cookies()]);
  const branch = resolveBranch(branches, cookieStore.get(BRANCH_COOKIE)?.value ?? null);
  const videos = branch ? serialize(await feedVideos({ branchId: branch.id, limit: 20 })) : [];

  if (!branch) {
    return (
      <Empty title="Which branch?">
        Videos are filmed at a particular branch, by people who ordered there.{" "}
        <Link href="/menu" className="underline underline-offset-4">
          Pick a location
        </Link>{" "}
        and they will show up here.
      </Empty>
    );
  }

  if (!videos.length) {
    return (
      <Empty title="Nothing filmed yet">
        No customer has filmed anything at {branch.name} yet. When somebody does, their clips appear here.{" "}
        <Link href="/menu" className="underline underline-offset-4">
          Browse the menu
        </Link>
        .
      </Empty>
    );
  }

  // Exactly one viewport tall, below the header: this is a feed of portrait
  // phone clips, and a page that scrolls behind it fights the swipe. The
  // viewer brings its own background — black while the clip is the whole
  // screen, the page's own surface once it is a card on it.
  return (
    <div className="fixed inset-0 top-16">
      <VideoViewer videos={videos} surface="VIDEO_FEED" className="h-full" />
    </div>
  );
}

function Empty({ title, children }) {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <Clapperboard aria-hidden="true" className="size-10 text-primary" />
      <h1 className="font-display text-headline-md text-on-surface">{title}</h1>
      <p className="text-body-md text-on-surface-variant">{children}</p>
    </div>
  );
}
