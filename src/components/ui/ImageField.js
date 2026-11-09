"use client";

import { useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import MediaPicker from "@/components/ui/MediaPicker";
import StoredImage from "@/components/ui/StoredImage";

/**
 * An image picker, backed by the media library.
 *
 * It used to open the file manager directly, which meant every form that
 * wanted a picture uploaded a fresh copy of it — the same logo arrived four
 * times under four names, and the library tab could only watch it happen. The
 * button now opens the library, where choosing a file already there costs one
 * request and no bytes at all; uploading a new one is a button inside it.
 *
 * The field's value is still only ever a finished URL, so no parent form has to
 * know any of this.
 *
 * The preview goes through `StoredImage` rather than `next/image`: in the
 * workspace the source can be any configured storage host, and an unlisted
 * host would throw rather than render. It retries a load that fails, so a
 * blink of bad connection does not leave the field looking empty when it is
 * not.
 */
export default function ImageField({
  id,
  label,
  value,
  onChange,
  ownerType,
  hint = null,
  error = null,
}) {
  const [picking, setPicking] = useState(false);

  const problem = error;

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-label-bold text-on-surface">
        {label}
      </span>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-field bg-surface-container-low">
          {value ? (
            <StoredImage src={value} loading="eager" className="size-full object-cover" />
          ) : (
            <ImagePlus
              aria-hidden="true"
              className="size-7 text-on-surface-variant"
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            id={id}
            onClick={() => setPicking(true)}
            aria-labelledby={`${id}-label ${id}`}
            className="inline-flex items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {value ? "Replace image" : "Choose image"}
          </button>

          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              className="inline-flex items-center gap-2 rounded-field px-4 py-2.5 text-label-bold text-error hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Trash2 aria-hidden="true" className="size-4" />
              Remove
            </button>
          ) : null}
        </div>
      </div>

      {picking ? (
        <MediaPicker
          kind="image"
          ownerType={ownerType}
          onClose={() => setPicking(false)}
          onPick={(url) => {
            onChange(url);
            setPicking(false);
          }}
        />
      ) : null}

      {hint ? (
        <p className="text-label-bold font-normal text-on-surface-variant">
          {hint}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-label-bold text-error">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
