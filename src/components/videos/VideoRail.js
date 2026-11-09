"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import VideoViewer from "@/components/videos/VideoViewer";
import { durationLabel } from "@/lib/creator";
import StoredImage from "@/components/ui/StoredImage";

/**
 * Customer videos on a product page.
 *
 * A rail of stills rather than players. Six autoplaying clips above the fold
 * would push the price and the order form off the screen and cost a visitor on
 * mobile data several megabytes before they have decided anything — so nothing
 * loads until somebody asks for it, and then it opens full screen where a
 * portrait phone clip actually fits.
 *
 * The section is absent rather than empty when there is nothing: "no videos
 * yet" on a product page is a note about our business, not about the food.
 */
export default function VideoRail({ videos, productName }) {
  const [openAt, setOpenAt] = useState(null);

  // The overlay owns the screen while it is up, so the page behind it must not
  // scroll under it. Restored to whatever it was rather than cleared, so this
  // cannot clobber another component holding the same lock.
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

  if (!videos?.length) return null;

  return (
    <section aria-labelledby="videos-heading" className="rounded-card bg-surface-container-lowest p-6 md:p-8">
      <p className="text-label-bold uppercase tracking-widest text-primary">Straight from the table</p>

      <h2 id="videos-heading" className="mt-2 font-display text-headline-md text-on-surface">
        Filmed by customers
      </h2>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Real clips of {productName}, filmed by people who ordered it from this branch.
      </p>

      <ul className="mt-6 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
        {videos.map((video, index) => (
          <li key={video.id} className="snap-start">
            <button
              type="button"
              onClick={() => setOpenAt(index)}
              className="group relative block h-64 w-40 shrink-0 overflow-hidden rounded-card bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
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
                /*
                 * No poster: show the clip's own first frame.
                 *
                 * `preload="metadata"` fetches enough to paint frame zero and
                 * no more, so a rail of six costs six headers rather than six
                 * videos. Videos uploaded before posters were captured have no
                 * thumbnail at all, and a wall of grey boxes reads as broken.
                 */
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

              <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />

              <span className="absolute left-3 top-3 grid size-9 place-items-center rounded-full bg-black/55 text-white backdrop-blur">
                <Play aria-hidden="true" className="size-4 fill-current" />
              </span>

              <span className="absolute inset-x-3 bottom-3 text-left text-white">
                <span className="block text-label-bold">@{video.creator?.handle ?? "someone"}</span>
                {video.durationSeconds ? (
                  <span className="block text-label-bold font-normal opacity-80">
                    {durationLabel(video.durationSeconds)}
                  </span>
                ) : null}
              </span>

              <span className="sr-only">
                Play {video.caption || `a clip by ${video.creator?.handle ?? "a customer"}`}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {openAt !== null ? (
        <div role="dialog" aria-modal="true" aria-label="Customer videos" className="fixed inset-0 z-100 bg-black">
          <VideoViewer
            videos={videos}
            surface="PRODUCT_PAGE"
            startIndex={openAt}
            onClose={() => setOpenAt(null)}
            className="h-dvh"
          />
        </div>
      ) : null}
    </section>
  );
}
