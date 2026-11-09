"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Upload, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { uploadImage, uploadFile } from "@/lib/image-upload";
import StoredImage from "@/components/ui/StoredImage";

/**
 * The media library, as a chooser.
 *
 * Every picture in this system was uploaded from whichever form happened to
 * need it, so the same logo arrived four times under four names and the library
 * tab could only watch it happen. Picking comes first here and uploading is the
 * second option, because most of the time the file is already there.
 *
 * **It never re-encodes a file it did not receive.** Choosing an existing asset
 * hands back the URL it already has. Only a new file goes through the upload
 * path, where an image is compressed and a video is sent as-is.
 */

const PAGE_SIZE = 24;

/** `image/` or `video/` — the prefix the list endpoint filters on. */
const KINDS = {
  image: { mime: "image/", accept: "image/jpeg,image/png,image/webp,image/avif", noun: "image" },
  video: { mime: "video/", accept: "video/mp4,video/quicktime,video/webm", noun: "video" },
};

export default function MediaPicker({ kind = "image", ownerType = null, onPick, onClose }) {
  const { mime, accept, noun } = KINDS[kind] ?? KINDS.image;
  const input = useRef(null);
  const panel = useRef(null);

  const [assets, setAssets] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async (after = null) => {
      /*
       * Nothing is set before the first await, deliberately. React now refuses
       * a synchronous setState inside an effect body, and this is called from
       * one — clearing the error up here is exactly that.
       */
      try {
        // Query in the path: this client sends options, not params.
        const query = new URLSearchParams({ mimeType: mime, limit: String(PAGE_SIZE) });
        if (after) query.set("cursor", after);
        const page = await api.get(`/media?${query}`, { withMeta: true });

        // Appended rather than replaced: "show more" must not lose what is
        // already on screen and scrolled past.
        setAssets((current) => (after ? [...current, ...page.data] : page.data));
        setCursor(page.meta?.nextCursor ?? null);
        setError(null);
      } catch (failure) {
        setError(failure?.message ?? "The library could not be loaded.");
      } finally {
        setLoading(false);
      }
    },
    [mime],
  );

  useEffect(() => {
    /*
     * Wrapped rather than called straight, which is not a style choice: React
     * now rejects a synchronous setState in an effect body, and a direct call
     * to a fetcher counts as one. The same shape the rest of this codebase
     * uses for load-on-mount.
     */
    (async () => {
      await load();
    })();
  }, [load]);

  // Escape closes, as it does in every other dialog a person has ever used.
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Focus moves into the dialog so the keyboard is not still driving the page
  // behind it.
  useEffect(() => {
    panel.current?.focus();
  }, []);

  async function handleFile(event) {
    const file = event.target.files?.[0];
    // Cleared so choosing the same file again after a failure still fires.
    event.target.value = "";
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      // An image is re-encoded before it is sent; a video re-encoded in a
      // canvas would be destroyed, so it goes as it is.
      const asset = kind === "video" ? await uploadFile(file, { ownerType }) : await uploadImage(file, { ownerType });
      onPick(asset.url);
    } catch (failure) {
      setError(failure?.message ?? `The ${noun} could not be uploaded.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
      // A click on the backdrop closes; a click inside must not, which is what
      // the target check is for.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-picker-title"
        tabIndex={-1}
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-card bg-surface-container-lowest shadow-e3 focus:outline-none sm:rounded-card"
      >
        <div className="flex items-center justify-between gap-4 border-b border-outline-variant px-5 py-4">
          <h2 id="media-picker-title" className="font-display text-headline-md text-on-surface">
            Choose {kind === "video" ? "a video" : "an image"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 place-items-center rounded-field text-on-surface-variant hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:cursor-wait disabled:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {busy ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Upload aria-hidden="true" className="size-4" />
            )}
            {busy ? "Uploading…" : `Upload a new ${noun}`}
          </button>
          <p className="text-label-bold font-normal text-on-surface-variant">
            Or pick one already here — nothing is uploaded twice.
          </p>

          <input
            ref={input}
            type="file"
            accept={accept}
            aria-label={`Upload a new ${noun}`}
            onChange={handleFile}
            className="sr-only"
            tabIndex={-1}
          />
        </div>

        {error ? (
          <p role="alert" className="mx-5 mb-4 rounded-field bg-error-container px-4 py-3 text-label-bold text-on-error-container">
            {error}
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <p className="py-10 text-center text-body-md text-on-surface-variant">Loading the library…</p>
          ) : assets.length === 0 ? (
            <div className="grid place-items-center gap-2 py-10 text-center">
              <ImagePlus aria-hidden="true" className="size-8 text-on-surface-variant" />
              <p className="text-body-md text-on-surface-variant">
                Nothing here yet. The first {noun} you upload will be.
              </p>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {assets.map((asset) => (
                  <li key={asset.id}>
                    <button
                      type="button"
                      onClick={() => onPick(asset.url)}
                      title={asset.storageKey}
                      className="group block aspect-square w-full overflow-hidden rounded-field bg-surface-container-low focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {kind === "video" ? (
                        <video src={asset.url} muted playsInline preload="metadata" className="size-full object-cover" />
                      ) : (
                        <StoredImage
                          src={asset.url}
                          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                      )}
                    </button>
                  </li>
                ))}
              </ul>

              {cursor ? (
                <button
                  type="button"
                  onClick={() => load(cursor)}
                  className="mt-4 w-full rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Show more
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
