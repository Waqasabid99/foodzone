"use client";

import { useState } from "react";
import ImageField from "@/components/ui/ImageField";
import { cropReport, HERO_BAND_RATIO, TIGHT_CROP } from "@/lib/hero-crop";

/**
 * A banner's artwork, shown at the shape it will actually be seen in.
 *
 * The upload field on its own shows a small square thumbnail, which is the one
 * shape the hero never uses. A photograph that looks fine there can reach the
 * home page as a cropped sliver, and the only way anybody finds out is by
 * looking at the live site. So the preview here is the band: same proportions,
 * same crop, same scrim over it.
 *
 * **Something is always cropped.** The band is roughly two to one and
 * photography rarely is, so this does not pretend otherwise — it says how much
 * of the picture survives and lets the editor choose which edge is kept.
 */

const FOCUS = {
  TOP: { label: "Top", className: "object-top" },
  CENTER: { label: "Centre", className: "object-center" },
  BOTTOM: { label: "Bottom", className: "object-bottom" },
};

export default function ArtworkField({
  idPrefix,
  value,
  focalPoint,
  onChange,
  onFocalPointChange,
}) {
  const [size, setSize] = useState(null);
  const crop = size ? cropReport(size.width, size.height) : null;

  // Below this it stops being a crop and starts being a detail shot: a 2:3
  // portrait leaves a third of itself, which nobody intends.
  const tight = crop && crop.visible < TIGHT_CROP;

  // Top and bottom only mean something when the cut is top and bottom. A photo
  // wider than the band is trimmed at the sides, where this choice does
  // nothing, so offering it there would be a control that quietly ignores you.
  const choosable = !crop || crop.axis === "vertical";

  return (
    <div className="flex flex-col gap-4">
      <ImageField
        id={`${idPrefix}-image`}
        label="Artwork"
        ownerType="HeroSlide"
        value={value}
        onChange={(url) => {
          setSize(null);
          onChange(url);
        }}
        hint="Optional. Wide rather than tall — about twice as wide as it is high is the shape that fits."
      />

      {value ? (
        <div className="flex flex-col gap-2">
          <span className="text-label-bold text-on-surface">
            On the home page
          </span>

          <div
            className="relative isolate w-full max-w-md overflow-hidden rounded-field bg-surface-container-high"
            style={{ aspectRatio: HERO_BAND_RATIO }}
          >
            {/* A plain img: in the workspace the file can be on any configured
                storage host, and an unlisted host would throw in next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={value}
              alt=""
              onLoad={(event) =>
                setSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              className={`size-full object-cover ${(FOCUS[focalPoint] ?? FOCUS.CENTER).className}`}
            />
            {/* The storefront's scrim, so the preview is not more readable than
                the real thing. */}
            <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-black/20" />
            <p className="absolute inset-x-0 top-0 px-4 py-3 font-display text-label-bold uppercase tracking-wide text-white/90">
              Your headline sits here
            </p>
          </div>

          {choosable ? (
            <fieldset className="flex flex-wrap items-center gap-2">
              <legend className="sr-only">
                Which part of the artwork to keep
              </legend>
              <span className="text-label-bold font-normal text-on-surface-variant">
                Keep the
              </span>
              {Object.entries(FOCUS).map(([key, option]) => {
                const chosen = (focalPoint ?? "CENTER") === key;
                return (
                  <label
                    key={key}
                    className={`cursor-pointer rounded-field px-4 py-2 text-label-bold focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring ${
                      chosen
                        ? "bg-primary-container text-on-primary-container"
                        : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
                    }`}
                  >
                    <input
                      type="radio"
                      name={`${idPrefix}-focal`}
                      value={key}
                      checked={chosen}
                      onChange={() => onFocalPointChange(key)}
                      className="sr-only"
                    />
                    {option.label}
                  </label>
                );
              })}
            </fieldset>
          ) : null}

          {crop ? (
            <p
              className={`text-label-bold font-normal ${tight ? "text-error" : "text-on-surface-variant"}`}
              role={tight ? "alert" : undefined}
            >
              {crop.axis === null
                ? "This fits the banner exactly — nothing is cropped."
                : `${size.width}×${size.height}. About ${crop.visible}% of it shows — ${
                    crop.axis === "vertical"
                      ? "the banner is wider than this photo, so it is cut top and bottom"
                      : "this photo is wider than the banner, so it is trimmed at the sides"
                  }.${tight ? " Something closer to twice as wide as it is high would show far more of the food." : ""}`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
