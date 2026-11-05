"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import SectionHeading from "@/components/home/SectionHeading";
import VideoGrid from "@/components/videos/VideoGrid";
import { useSelectedBranchId } from "@/hooks/useSelectedBranch";

/**
 * Real customer clips, filmed at the outlet this visitor has chosen.
 *
 * What stood here was a placeholder: an Instagram grid fed by a hardcoded
 * `PLACEHOLDER_SOCIAL` list of branded artwork, flagged `isPlaceholder: true`
 * and waiting on a Graph API token that never arrived. It showed four tiles
 * that were not posts, by nobody, linking nowhere. There is a real feed of
 * short videos now, so this shows that instead.
 *
 * **Loaded in the browser, deliberately.** The home page is statically
 * rendered and cached for five minutes — the whole site layout is written to
 * keep it that way, and its own comment says so. Which videos to show depends
 * on the branch cookie, and reading a cookie on the server would make the home
 * page dynamic for every visitor to save one fetch for some of them. So the
 * page stays static and this one section fills itself in.
 *
 * Renders nothing at all until it has something real: no skeleton, because a
 * section that reserves space and then collapses pushes the page around under
 * somebody who is already reading it.
 */
export default function CustomerShorts() {
  const branchId = useSelectedBranchId();
  const [videos, setVideos] = useState([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // No branch chosen is a question the feed answers for a
        // single-restaurant install and declines for a chain, which is
        // exactly the behaviour wanted here.
        const page = await api.get(`/creator-videos?limit=8${branchId ? `&branchId=${branchId}` : ""}`);
        if (!cancelled) setVideos(page?.items ?? []);
      } catch {
        // The home page is not the place to report that a marketing section
        // could not load. It simply is not there.
        if (!cancelled) setVideos([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [branchId]);

  if (!videos.length) return null;

  return (
    <section>
      <SectionHeading
        title="Filmed by customers"
        action={
          <Link
            href="/videos"
            className="inline-flex items-center gap-1 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            See them all
          </Link>
        }
      />

      <div className="mt-6">
        {/* `HOME` so the programme's own reporting can tell a sale that
            started here from one that started in the feed. */}
        <VideoGrid videos={videos} surface="HOME" emptyMessage="" />
      </div>
    </section>
  );
}
