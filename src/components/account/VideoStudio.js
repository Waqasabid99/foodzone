"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import { uploadFile } from "@/lib/image-upload";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { REJECTION_REASONS, attemptsLeft, chipClass, durationLabel, videoState } from "@/lib/creator";

/**
 * Filming, uploading and submitting.
 *
 * The upload is three calls, in this order, because the file never passes
 * through our API: ask for a ticket, send the bytes to where the ticket
 * points, then confirm. Doing it any other way means a large video going
 * through a serverless function.
 *
 * **Duration is read in the browser before anything is sent.** The programme
 * has a minimum and a maximum, and the server rejects a video outside them —
 * after the whole file has uploaded. Checking first costs one metadata read
 * and saves somebody waiting out an upload that was never going to be
 * accepted.
 *
 * **Attempts are shown on every row.** A rejection costs one of a small
 * number, and the last one locks that order line for ever. Somebody
 * re-uploading for the fourth time should know that before they do.
 */
export default function VideoStudio({ videos, filmable, limits }) {
  const router = useRouter();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [caption, setCaption] = useState({});

  async function run(key, work, success) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await work();
      if (success) toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Grabs a still from the clip to use as its poster.
   *
   * Done here because the browser already has the file decoded, and the
   * alternative is a video pipeline on the server for one JPEG. Without it
   * nothing ever sets `thumbnailUrl` — the column exists and the API accepts
   * it, but no caller filled it, so every clip on the storefront was a grey
   * box with a handle on it.
   *
   * One second in rather than frame zero: a lot of phone clips open on a blur
   * or a lens still adjusting, and the first frame is the worst one to pick.
   * Best effort throughout — a missing poster is a plainer rail, not a failed
   * upload, so every failure path resolves null.
   */
  function posterOf(file, seconds) {
    return new Promise((resolve) => {
      const element = document.createElement("video");
      element.preload = "metadata";
      element.muted = true;
      element.playsInline = true;

      const done = (value) => {
        URL.revokeObjectURL(element.src);
        resolve(value);
      };

      element.onloadeddata = () => {
        element.currentTime = Math.min(1, Math.max(0, (seconds || 1) / 2));
      };

      element.onseeked = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = element.videoWidth;
          canvas.height = element.videoHeight;
          if (!canvas.width || !canvas.height) return done(null);

          canvas.getContext("2d").drawImage(element, 0, 0, canvas.width, canvas.height);
          canvas.toBlob(
            (blob) => done(blob ? new File([blob], "poster.jpg", { type: "image/jpeg" }) : null),
            "image/jpeg",
            0.8,
          );
        } catch {
          // A cross-origin or DRM-protected source taints the canvas.
          done(null);
        }
      };

      element.onerror = () => done(null);
      element.src = URL.createObjectURL(file);
    });
  }

  /** Reads how long the clip is without uploading it. */
  function durationOf(file) {
    return new Promise((resolve, reject) => {
      const element = document.createElement("video");
      element.preload = "metadata";
      element.onloadedmetadata = () => {
        URL.revokeObjectURL(element.src);
        resolve(Number.isFinite(element.duration) ? Math.round(element.duration) : null);
      };
      element.onerror = () => {
        URL.revokeObjectURL(element.src);
        reject(new Error("That file does not look like a video we can read."));
      };
      element.src = URL.createObjectURL(file);
    });
  }

  async function upload(videoId, file) {
    if (!file) return;
    if (!limits.allowedMimeTypes.includes(file.type)) {
      setError(`That file type is not accepted. Use ${limits.allowedMimeTypes.join(" or ")}.`);
      return;
    }
    if (file.size > limits.maxVideoSizeBytes) {
      setError(`That file is too big — the limit is ${Math.round(limits.maxVideoSizeBytes / 1024 / 1024)}MB.`);
      return;
    }

    const seconds = await durationOf(file).catch((failure) => {
      setError(failure.message);
      return null;
    });
    if (seconds == null) return;

    if (seconds < limits.minVideoSeconds || seconds > limits.maxVideoSeconds) {
      setError(
        `That clip is ${seconds} seconds. It needs to be between ${limits.minVideoSeconds} and ${limits.maxVideoSeconds}.`,
      );
      return;
    }

    await run(
      `upload:${videoId}`,
      async () => {
        // The same ticket / bytes / confirm flow images use — a presigned
        // target may be a PUT or a form POST, and that belongs in one place.
        const media = await uploadFile(file, { ownerType: "CreatorVideo", ownerId: videoId });

        // After the clip itself, and never allowed to fail it: the video is
        // the submission, the poster is a nicety.
        const poster = await posterOf(file, seconds).catch(() => null);
        const posterMedia = poster
          ? await uploadFile(poster, { ownerType: "CreatorVideo", ownerId: videoId }).catch(() => null)
          : null;

        await api.put(`/me/creator/videos/${videoId}/asset`, {
          videoUrl: media.url,
          storageKey: media.storageKey,
          ...(posterMedia?.url ? { thumbnailUrl: posterMedia.url } : {}),
          durationSeconds: seconds,
          sizeBytes: file.size,
          mimeType: file.type,
        });
      },
      "Uploaded. Send it for review when you are happy with it.",
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <FormAlert>{error}</FormAlert>

      {filmable.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">Things you could film</h2>
          <p className="text-body-md text-on-surface-variant">
            Between {limits.minVideoSeconds} and {limits.maxVideoSeconds} seconds, of the food you actually ordered.
          </p>
          <ul className="flex flex-col gap-3">
            {filmable.map((item) => (
              <li key={item.id} className="flex flex-wrap items-end justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="text-label-bold text-on-surface">{item.nameSnapshot}</p>
                  <p className="mt-1 text-body-md text-on-surface-variant">
                    {item.order?.orderNumber ? `From order ${item.order.orderNumber}` : ""}
                  </p>
                  <Field
                    id={`caption-${item.id}`}
                    label="Caption"
                    value={caption[item.id] ?? ""}
                    onChange={(event) => setCaption((state) => ({ ...state, [item.id]: event.target.value }))}
                    hint="Optional — what you want people to read under it."
                    autoComplete="off"
                  />
                </div>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() =>
                    run(
                      `create:${item.id}`,
                      () =>
                        api.post("/me/creator/videos", {
                          orderItemId: item.id,
                          ...(caption[item.id]?.trim() ? { caption: caption[item.id].trim() } : {}),
                        }),
                      "Started. Now add the clip.",
                    )
                  }
                  className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Start a video
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        /*
         * Said, not hidden. Filming always starts from an order line, so with
         * nothing to film there is no upload control anywhere on the page —
         * and a creator looking at a page with no way to add a video has no
         * way to tell whether the window shut or the feature is broken.
         */
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">Things you could film</h2>
          <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
            Nothing to film at the moment. A video is always of something you ordered, so one appears here once an
            order arrives — and you have {limits.submissionWindowDays} days from then to film it.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-headline-md text-on-surface">My videos</h2>
        {videos.length ? (
          <ul className="flex flex-col gap-3">
            {videos.map((video) => {
              const state = videoState(video);
              const left = attemptsLeft({ ...video, maxUploadAttempts: limits.maxUploadAttempts });
              // ARCHIVED in both: a withdrawn video was a dead end on this
              // screen — no upload, no submit, no withdraw — while the server
              // was willing to take it back the whole time. The order line
              // behind it can never be filmed again, so a withdrawal with no
              // way back threw the clip and the line away together.
              const canUpload = !video.isLocked && ["DRAFT", "REJECTED", "ARCHIVED"].includes(video.status);
              const canSubmit = ["DRAFT", "ARCHIVED"].includes(video.status) && Boolean(video.videoUrl);

              return (
                <li key={video.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-label-bold text-on-surface">{video.product?.name ?? "A product"}</span>
                        <span className={`rounded-full px-2.5 py-1 text-label-bold ${chipClass(state.tone)}`}>
                          {state.label}
                        </span>
                      </p>
                      <p className="mt-1 text-body-md text-on-surface-variant">{state.note}</p>
                      {video.durationSeconds ? (
                        <p className="text-body-md text-on-surface-variant">{durationLabel(video.durationSeconds)}</p>
                      ) : null}
                      {video.status === "APPROVED" ? (
                        <p className="mt-1 text-body-md text-on-surface-variant">
                          {video.viewCount?.toLocaleString() ?? 0} views · {video.addToCartCount ?? 0} added to basket
                        </p>
                      ) : null}
                      {video.lastRejectionReason ? (
                        <p className="mt-1 text-body-md text-on-surface">
                          Sent back: {REJECTION_REASONS[video.lastRejectionReason]?.label ?? video.lastRejectionReason}
                          {video.lastRejectionNote ? ` — ${video.lastRejectionNote}` : ""}
                        </p>
                      ) : null}
                      {video.isLocked ? (
                        <p className="mt-1 text-body-md text-error">
                          Out of attempts. This item cannot be filmed again.
                        </p>
                      ) : canUpload ? (
                        <p className={`mt-1 text-body-md ${left <= 1 ? "text-error" : "text-on-surface-variant"}`}>
                          {left} {left === 1 ? "try" : "tries"} left.
                        </p>
                      ) : null}
                    </div>
                    {video.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={video.thumbnailUrl} alt="" className="h-28 w-20 shrink-0 rounded-field object-cover" loading="lazy" />
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {canUpload ? (
                      /*
                       * Primary until there is a file. With no clip attached
                       * this is the only thing worth doing, and it used to sit
                       * in the same grey as "Withdraw it" — two identical
                       * buttons, one of which throws the order line away.
                       */
                      <label
                        className={`cursor-pointer rounded-field px-5 py-2.5 text-label-bold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
                          video.videoUrl
                            ? "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
                            : "bg-primary-container text-on-primary-container hover:shadow-e2"
                        }`}
                      >
                        {busy === `upload:${video.id}` ? "Uploading…" : video.videoUrl ? "Replace the clip" : "Choose a video file"}
                        <input
                          type="file"
                          accept={limits.allowedMimeTypes.join(",")}
                          className="sr-only"
                          disabled={busy !== null}
                          onChange={(event) => upload(video.id, event.target.files?.[0])}
                        />
                      </label>
                    ) : null}

                    {canSubmit ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`submit:${video.id}`, () => api.post(`/me/creator/videos/${video.id}/submit`, {}), "Sent for review.")
                        }
                        className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60"
                      >
                        Send for review
                      </button>
                    ) : null}

                    {["DRAFT", "REJECTED", "APPROVED"].includes(video.status) ? (
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() =>
                          run(`archive:${video.id}`, () => api.post(`/me/creator/videos/${video.id}/archive`, {}), "Taken down.")
                        }
                        className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60"
                      >
                        Withdraw it
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
            Nothing filmed yet.
          </p>
        )}
      </section>
    </div>
  );
}
