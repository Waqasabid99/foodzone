"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { uploadImage } from "@/lib/image-upload";
import FormAlert from "@/components/ui/FormAlert";

const sizeLabel = (bytes) => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
const when = (date) => new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * The library: what has been uploaded, and what is still using it.
 *
 * A file in use cannot be deleted — the server refuses and names what to
 * detach first, because an image removed from under a live menu breaks on the
 * storefront, where nobody who could fix it is looking.
 */
export default function MediaLibrary({ assets, canDelete, currentUserId }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [usage, setUsage] = useState({ id: null, rows: null, loading: false });

  async function upload(event) {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (!files.length) return;
    setBusy(true);
    setError(null);
    let done = 0;
    for (const file of files) {
      try {
        await uploadImage(file, { ownerType: "library" });
        done += 1;
      } catch (failure) {
        setError(`${file.name}: ${failure?.message ?? "could not be uploaded."}`);
      }
    }
    setBusy(false);
    if (done) {
      toast.success(done === 1 ? "Uploaded." : `${done} files uploaded.`);
      router.refresh();
    }
  }

  async function showUsage(asset) {
    setSelected(asset);
    setUsage({ id: asset.id, rows: null, loading: true });
    try {
      const detail = await api.get(`/media/${asset.id}?usage=1`);
      setUsage({ id: asset.id, rows: detail.usedBy ?? [], loading: false });
    } catch {
      setUsage({ id: asset.id, rows: [], loading: false });
    }
  }

  async function remove(asset) {
    if (!window.confirm("Delete this file? It cannot be undone.")) return;
    try {
      await api.delete(`/media/${asset.id}`);
      toast.success("Deleted.");
      setSelected(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "It could not be deleted.");
      // The refusal names what is using it, so show that next to the file.
      showUsage(asset);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <ImagePlus aria-hidden="true" className="size-4" />}
          {busy ? "Uploading…" : "Upload images"}
          <input type="file" accept="image/*" multiple onChange={upload} disabled={busy} className="sr-only" />
        </label>
        <p className="text-body-md text-on-surface-variant">Pictures are resized and compressed here in the browser before they are sent.</p>
      </div>

      {assets.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="overflow-hidden rounded-card bg-surface-container-lowest">
              <button type="button" onClick={() => showUsage(asset)} className="block w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                <span className="flex aspect-square items-center justify-center bg-surface-container-low">
                  {asset.mimeType?.startsWith("image/") ? (
                    // Any configured storage host may serve these, and an
                    // unlisted host would make next/image throw.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <span className="p-4 text-center text-body-md text-on-surface-variant">{asset.mimeType}</span>
                  )}
                </span>
                <span className="block p-3 text-body-md">
                  <span className="block truncate text-on-surface">{sizeLabel(asset.sizeBytes)}{asset.width ? ` · ${asset.width}×${asset.height}` : ""}</span>
                  <span className="block text-on-surface-variant">{when(asset.createdAt)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-10 text-center text-body-md text-on-surface-variant">
          Nothing uploaded yet. Images added from a product or a menu appear here too.
        </p>
      )}

      {selected ? (
        <div className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-label-bold text-on-surface">This file</h3>
              <p className="break-all text-body-md text-on-surface-variant">{selected.url}</p>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-label-bold text-on-surface-variant hover:underline">Close</button>
          </div>

          {usage.loading ? (
            <p className="text-body-md text-on-surface-variant">Checking what uses it…</p>
          ) : usage.rows?.length ? (
            <div className="text-body-md">
              <p className="text-on-surface">Used by:</p>
              <ul className="mt-1 list-disc pl-5 text-on-surface-variant">
                {usage.rows.map((row) => (
                  <li key={`${row.kind}-${row.id}`}>{row.kind}: {row.name}</li>
                ))}
              </ul>
              <p className="mt-2 text-on-surface-variant">Replace or remove it there before deleting it.</p>
            </div>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing is using this file.</p>
          )}

          {canDelete || selected.uploadedById === currentUserId ? (
            <button
              type="button"
              onClick={() => remove(selected)}
              disabled={Boolean(usage.rows?.length)}
              className="inline-flex w-fit items-center gap-2 rounded-field border border-error px-5 py-2.5 text-label-bold text-error hover:bg-error-container disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Delete this file
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
