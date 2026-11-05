"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "react-toastify";
import { ChevronDown, ChevronUp, Heart, Pause, Play, Share2, ShoppingBag, Volume2, VolumeX, X } from "lucide-react";
import { api, ApiClientError } from "@/lib/api-client";
import { loadCart } from "@/hooks/useCart";
import { isBranchRequired, NO_BRANCHES_MESSAGE } from "@/lib/cart-errors";
import { openLocationPicker } from "@/hooks/useLocationPicker";
import { initials } from "@/lib/format";

/**
 * The player, shared by the product page and the browse feed.
 *
 * One component for both because the difference between them is which videos
 * it was handed and which `surface` it reports — not how playback, view
 * counting or adding to the basket behave. Two copies of this would drift on
 * exactly the parts that are hard to get right.
 *
 * **Two layouts, one tree.** On a phone the clip is the screen: black, edge to
 * edge, controls floating over it. From `lg` up it becomes a 9:16 card on the
 * page's own background with the controls beside it, because a portrait clip
 * stretched across a desktop is a sliver of picture between two black margins.
 * Every control is rendered once and restyled, never duplicated behind a
 * breakpoint — a second copy is how the two stop behaving alike.
 *
 * **Only the visible clip plays.** Every video is in the DOM so swiping is
 * instant, but an IntersectionObserver pauses the ones that have scrolled away.
 * Without that, a feed of ten clips is ten videos decoding at once, which on a
 * phone means a hot device and a stalled scroll.
 *
 * **Muted by default, and that is not a style choice.** Browsers refuse to
 * autoplay a clip with sound, and the refusal is silent: the first video simply
 * never starts. Muted autoplay is the only version of this that works, so the
 * control offered is to turn sound *on*.
 */
export default function VideoViewer({ videos, surface, startIndex = 0, onClose = null, className = "" }) {
  const router = useRouter();
  const [muted, setMuted] = useState(true);
  const [busy, setBusy] = useState(null);
  const [liked, setLiked] = useState({});
  const [playing, setPlaying] = useState({});
  const containerRef = useRef(null);
  const nodes = useRef(new Map());
  const sections = useRef(new Map());
  // Which clips have already been counted, so re-entering a video on a swipe
  // back does not report a second view for the same watch.
  const counted = useRef(new Set());

  /**
   * Opens on the clip that was tapped.
   *
   * Once, on mount. This is a scroll-snap container, and moving it under the
   * reader's finger afterwards is how a list fights the person using it.
   */
  useEffect(() => {
    sections.current.get(startIndex)?.scrollIntoView({ block: "start", behavior: "instant" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tells the server a clip was watched. Never allowed to break playback. */
  const reportView = useCallback(
    (video, element) => {
      if (counted.current.has(video.id)) return;
      counted.current.add(video.id);

      api
        .post(`/creator-videos/${video.id}/view`, {
          surface,
          watchedSeconds: Math.round(element?.currentTime ?? 0),
          isComplete: Boolean(element?.duration && element.currentTime >= element.duration - 0.5),
        })
        .catch(() => {
          // A view that did not record is a worse analytic, not a worse
          // evening. Allow it to be retried if they come back to the clip.
          counted.current.delete(video.id);
        });
    },
    [surface],
  );

  // Play what is on screen, pause what is not.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const element = entry.target;
          if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
            element.play().catch(() => {
              // Autoplay refused (a clip that is not muted, or a data saver).
              // Nothing to recover: the controls are there to press.
            });
          } else {
            element.pause();
          }
        }
      },
      { threshold: [0, 0.6, 1], root: containerRef.current },
    );

    for (const element of nodes.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [videos]);

  function togglePlay(videoId) {
    const element = nodes.current.get(videoId);
    if (!element) return;
    if (element.paused) element.play().catch(() => {});
    else element.pause();
  }

  /** Steps the feed by one clip, for anyone driving this with a mouse. */
  function step(from, delta) {
    sections.current.get(from + delta)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  async function like(video) {
    // Optimistic: a heart that waits for a round trip feels broken, and the
    // worst case is a count that is one out until the next load.
    setLiked((state) => ({ ...state, [video.id]: !state[video.id] }));
    try {
      await api.post(`/creator-videos/${video.id}/like`, {});
    } catch {
      setLiked((state) => ({ ...state, [video.id]: !state[video.id] }));
    }
  }

  async function share(video) {
    const url = `${window.location.origin}/menu/${video.product?.slug ?? ""}`;
    try {
      // The platform sheet when there is one, the clipboard when there is not.
      if (navigator.share) {
        await navigator.share({ title: video.product?.name ?? "A video", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied.");
      }
      await api.post(`/creator-videos/${video.id}/share`, {}).catch(() => {});
    } catch {
      // A cancelled share sheet throws. That is not an error worth reporting.
    }
  }

  /**
   * Adds the filmed item to the basket, crediting the video.
   *
   * A product that needs choices made — a required modifier group, a combo —
   * cannot be added from here, because the choices genuinely have not been
   * made. Rather than refuse, it hands over to the product page and carries
   * the video id with it, so the credit survives the detour.
   */
  async function addToOrder(video) {
    if (busy) return;
    setBusy(video.id);

    try {
      await api.post("/cart/items", {
        productId: video.productId,
        ...(video.variantId ? { variantId: video.variantId } : {}),
        quantity: 1,
        creatorVideoId: video.id,
        creatorSurface: surface,
      });

      await loadCart({ force: true });
      toast.success(`${video.product?.name ?? "Added"} added to your order.`);
      router.refresh();
    } catch (error) {
      if (isBranchRequired(error)) {
        openLocationPicker();
        toast.info("Choose a location to order from.");
      } else if (needsChoices(error) && video.product?.slug) {
        toast.info("This one needs a few choices first.");
        router.push(`/menu/${video.product.slug}?v=${video.id}`);
      } else {
        toast.error(error?.message ?? NO_BRANCHES_MESSAGE);
      }
    } finally {
      setBusy(null);
    }
  }

  if (!videos.length) return null;

  return (
    <div
      ref={containerRef}
      className={`h-full snap-y snap-mandatory overflow-y-auto overscroll-contain bg-black lg:bg-surface ${className}`}
    >
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="fixed right-4 top-4 z-30 grid size-11 place-items-center rounded-full bg-black/60 text-white backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:bg-surface-container-high lg:text-on-surface"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      ) : null}

      {videos.map((video, index) => (
        <section
          key={video.id}
          ref={(element) => {
            if (element) sections.current.set(index, element);
            else sections.current.delete(index);
          }}
          className="relative flex h-full snap-start items-center justify-center gap-3 lg:gap-6 lg:py-6"
          aria-label={video.caption || video.product?.name || "A customer video"}
        >
          {/*
           * A 9:16 card once there is room for one.
           *
           * These are filmed on a phone held upright. Pinning the aspect ratio
           * and letting height drive the width gives the clip the same shape
           * on every screen, and gives the controls somewhere to sit that is
           * not on top of the food.
           */}
          <div className="relative h-full w-full overflow-hidden bg-black lg:aspect-9/16 lg:h-full lg:w-auto lg:rounded-card lg:shadow-e2">
            {/* A customer's phone clip has no caption track; the written
                caption sits over the video instead. */}
            <video
              ref={(element) => {
                if (element) nodes.current.set(video.id, element);
                else nodes.current.delete(video.id);
              }}
              src={video.videoUrl}
              poster={video.thumbnailUrl ?? undefined}
              muted={muted}
              loop
              playsInline
              preload={index === startIndex ? "auto" : "none"}
              onPlay={() => setPlaying((state) => ({ ...state, [video.id]: true }))}
              onPause={() => setPlaying((state) => ({ ...state, [video.id]: false }))}
              onTimeUpdate={(event) => {
                // Two seconds is the server's own floor for a view, so there is
                // no point reporting one before it would be counted.
                if (event.currentTarget.currentTime >= 2) reportView(video, event.currentTarget);
              }}
              onClick={() => togglePlay(video.id)}
              /* `contain`, not `cover`: the card is 9:16 but nothing guarantees
                 the clip is. Filling the card would silently crop whatever was
                 filmed in another shape, and a video of a burger with the
                 burger cut off is worse than one with bars. */
              className="h-full w-full object-contain"
            />

            {/* Transport, where a player's transport belongs. Over the clip in
                both layouts, because these two act on the picture itself. */}
            <div className="absolute left-3 top-3 flex items-center gap-2">
              <Pill
                label={playing[video.id] ? "Pause" : "Play"}
                onClick={() => togglePlay(video.id)}
              >
                {playing[video.id] ? (
                  <Pause aria-hidden="true" className="size-5 fill-current" />
                ) : (
                  <Play aria-hidden="true" className="size-5 fill-current" />
                )}
              </Pill>

              <Pill label={muted ? "Turn sound on" : "Turn sound off"} onClick={() => setMuted((on) => !on)}>
                {muted ? (
                  <VolumeX aria-hidden="true" className="size-5" />
                ) : (
                  <Volume2 aria-hidden="true" className="size-5" />
                )}
              </Pill>
            </div>

            {/* A gradient rather than a panel: the text has to stay legible over
                whatever was filmed, without hiding a third of the clip. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-4 pb-5 pt-24">
              <div className="pointer-events-auto min-w-0 text-white">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <span
                    aria-hidden="true"
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-white/20 font-display text-label-bold backdrop-blur"
                  >
                    {initials(video.creator?.displayName || video.creator?.handle || "?")}
                  </span>

                  {/* The way to the rest of their work. A handle that is not
                      a link is the one dead end in a feed built on people. */}
                  {video.creator?.handle ? (
                    <Link
                      href={`/creators/${video.creator.handle}`}
                      className="text-label-bold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      @{video.creator.handle}
                    </Link>
                  ) : (
                    <span className="text-label-bold">@someone</span>
                  )}

                  {/* The commercial point of the whole feature, so it sits
                      where the eye already is rather than in the icon rail. */}
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => addToOrder(video)}
                    className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 font-display text-label-bold uppercase tracking-wide text-on-primary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                  >
                    <ShoppingBag aria-hidden="true" className="size-4" />
                    {busy === video.id ? "Adding…" : "Add to order"}
                  </button>
                </div>

                {video.caption ? <p className="mt-3 text-body-md">{video.caption}</p> : null}

                {video.product?.slug ? (
                  <Link
                    href={`/menu/${video.product.slug}?v=${video.id}`}
                    className="mt-1 inline-block text-body-md underline underline-offset-4"
                  >
                    {video.product.name}
                  </Link>
                ) : null}
              </div>
            </div>
          </div>

          {/* Over the clip while that is the whole screen, beside it once the
              card has edges. One element, restyled. */}
          <div className="absolute bottom-28 right-3 z-10 flex flex-col items-center gap-4 lg:static lg:bottom-auto lg:right-auto lg:self-end lg:pb-10">
            <Action
              label={liked[video.id] ? "Undo like" : "Like"}
              caption={(video.likeCount ?? 0) + (liked[video.id] ? 1 : 0)}
              onClick={() => like(video)}
            >
              <Heart aria-hidden="true" className={`size-6 ${liked[video.id] ? "fill-current" : ""}`} />
            </Action>

            <Action label="Share" caption={video.shareCount || "Share"} onClick={() => share(video)}>
              <Share2 aria-hidden="true" className="size-6" />
            </Action>
          </div>

          {/*
           * Step buttons, desktop only.
           *
           * A phone swipes and a trackpad scrolls, but a mouse has no gesture
           * for "next" in a snap feed — without these, the only way on is to
           * find the scrollbar. Disabled rather than hidden at the ends, so
           * the column does not jump as it is used.
           */}
          <div className="hidden lg:flex lg:flex-col lg:gap-3 lg:self-center">
            <Pill label="Previous video" onClick={() => step(index, -1)} disabled={index === 0} tone="surface">
              <ChevronUp aria-hidden="true" className="size-5" />
            </Pill>
            <Pill
              label="Next video"
              onClick={() => step(index, 1)}
              disabled={index === videos.length - 1}
              tone="surface"
            >
              <ChevronDown aria-hidden="true" className="size-5" />
            </Pill>
          </div>
        </section>
      ))}
    </div>
  );
}

/** A round control. Dark over the picture, a surface chip beside it. */
function Pill({ label, onClick, disabled = false, tone = "overlay", children }) {
  const skin =
    tone === "surface"
      ? "bg-surface-container-high text-on-surface hover:bg-surface-container-highest focus-visible:outline-ring"
      : "bg-black/55 text-white backdrop-blur hover:bg-black/70 focus-visible:outline-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`grid size-11 place-items-center rounded-full transition-colors disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 ${skin}`}
    >
      {children}
    </button>
  );
}

/**
 * An icon with its number underneath.
 *
 * White over the picture on a phone, a surface chip on the page beside the
 * card — the same control either way, because the background behind it is what
 * changed, not what it does.
 */
function Action({ label, caption = null, onClick, children }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="grid size-12 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:bg-surface-container-high lg:text-on-surface lg:backdrop-blur-none lg:hover:bg-surface-container-highest lg:focus-visible:outline-ring"
      >
        {children}
      </button>
      {caption != null ? (
        <span className="text-label-bold tabular-nums text-white lg:text-on-surface-variant">{caption}</span>
      ) : null}
    </div>
  );
}

/** A refusal that means "choices are missing", not "this cannot be bought". */
function needsChoices(error) {
  if (!(error instanceof ApiClientError)) return false;
  const details = error.details ?? {};
  return Boolean(details.modifiers || details.comboSelections);
}
