"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import VideoViewer from "@/components/videos/VideoViewer";
import { durationLabel } from "@/lib/creator";
import StoredImage from "@/components/ui/StoredImage";

/**
 * A creator's work, as stills.
 *
 * A grid rather than a feed, because the question this page answers is "what
 * has this person made" — which is a browsing question, and browsing twelve
 * clips one swipe at a time is not browsing. Tapping one opens the same viewer
 * the feed uses, starting where they tapped, so watching is identical once
 * they have chosen.
 *
 * Nothing loads until somebody asks for it. Twelve autoplaying clips is twelve
 * videos decoding at once and several megabytes of somebody's data spent
 * before they have decided anything.
 */
export default function VideoGrid({ videos, surface = "CREATOR_PROFILE", emptyMessage }) {
  const [openAt, setOpenAt] = useState(null);

  // The overlay owns the screen while it is up. Restored to whatever it was
  // rather than cleared, so this cannot clobber another component holding the
  // same lock.
  useEffect(() => {
    if (openAt === null) return undefined;

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event) {
      if (event.key === "Escape") setOpenAt(null);
    }
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openAt]);

  if (!videos?.length) {
    return (
      <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
        {emptyMessage}
      </p>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {videos.map((video, index) => (
          <li key={video.id}>
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              className="group relative block aspect-9/16 w-full overflow-hidden rounded-card bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {video.thumbnailUrl ? (
                /* The file lives on whichever storage this install is
                   configured with, so there is no loader that can be trusted
                   to optimise it. */
                <StoredImage
                  src={video.thumbnailUrl}
                  className="size-full object-cover transition-transform group-hover:scale-105"
                />
              ) : (
                /* No poster: the clip's own first frame. `preload="metadata"`
                   fetches enough to paint frame zero and no more. */
                <video
                  src={video.videoUrl}
                  muted
                  playsInline
                  preload="metadata"
                  tabIndex={-1}
                  aria-hidden="true"
                  className="size-full object-cover transition-transform group-hover:scale-105"
                />
              )}

              <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />

              <span className="absolute left-3 top-3 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <Play aria-hidden="true" className="size-4 fill-current" />
              </span>

              <span className="absolute inset-x-3 bottom-3 text-left text-white">
                <span className="block truncate text-label-bold">{video.product?.name ?? "A dish"}</span>

                {/* The outlet, because this page is the one place clips from
                    different branches sit side by side. Somebody looking at a
                    dish they cannot order should be able to see why. */}
                {video.branch?.name ? (
                  <span className="block truncate text-label-bold font-normal opacity-80">
                    {video.branch.name}
                    {video.branch.city ? `, ${video.branch.city}` : ""}
                  </span>
                ) : null}

                {video.durationSeconds ? (
                  <span className="block text-label-bold font-normal opacity-70">
                    {durationLabel(video.durationSeconds)}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {openAt !== null ? (
        <div role="dialog" aria-modal="true" aria-label="Customer videos" className="fixed inset-0 z-100">
          <VideoViewer
            videos={videos}
            surface={surface}
            startIndex={openAt}
            onClose={() => setOpenAt(null)}
            className="h-dvh"
          />
        </div>
      ) : null}
    </>
  );
}
