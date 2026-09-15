"use client";

import { useState } from "react";
import FoodImage from "@/components/ui/FoodImage";

/**
 * The product's photography.
 *
 * A gallery only when there is more than one image; a single photo needs no
 * thumbnail strip beneath it, and rendering one row of one thumb reads as a
 * loading state that never finished.
 */
export default function ProductGallery({ name, imageUrl, images = [] }) {
  const all = [
    ...(imageUrl ? [{ id: "primary", url: imageUrl, altText: name }] : []),
    ...images.filter((image) => image.url !== imageUrl),
  ];

  const [activeIndex, setActiveIndex] = useState(0);
  const active = all[activeIndex] ?? null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-4/3 w-full overflow-hidden rounded-card">
        <FoodImage
          src={active?.url ?? null}
          // The photo is the product, so it is described rather than left
          // decorative — `altText` when the uploader wrote one, the product's
          // own name when they did not.
          alt={active?.altText || name}
          priority
          sizes="(max-width: 1024px) 100vw, 560px"
          className="size-full"
        />
      </div>

      {all.length > 1 ? (
        <ul className="grid grid-cols-4 gap-3">
          {all.map((image, index) => (
            <li key={image.id}>
              <button
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-current={index === activeIndex ? "true" : undefined}
                aria-label={`Show image ${index + 1} of ${all.length}`}
                className={`relative aspect-square w-full overflow-hidden rounded-field transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                  index === activeIndex ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100"
                }`}
              >
                <FoodImage src={image.url} alt="" sizes="120px" className="size-full" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
