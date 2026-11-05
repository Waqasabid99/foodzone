"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import HeroBackdrop, { HERO_BODY, HERO_FRAME } from "@/components/home/HeroBackdrop";

/**
 * The scheduled banners, one at a time.
 *
 * **Every slide is in the DOM from the first paint, and the first one is never
 * lazy.** This is the largest contentful paint on the site: a carousel that
 * mounts empty and fills in after hydration measures as a blank rectangle, and
 * one that swaps `src` on a single image re-downloads on every rotation. So
 * all of them render, stacked, and visibility is opacity — the browser gets a
 * real `<img priority>` in the initial HTML either way.
 *
 * **It stops when a person is using it.** Rotation pauses on hover and on
 * focus, and any manual choice stops it for good: a banner that slides away
 * mid-read is the single most complained-about thing about carousels, and
 * somebody who has pressed a dot has told you which one they want.
 *
 * It also respects `prefers-reduced-motion` by not rotating at all. Automatic
 * movement is exactly what that setting is about.
 */
const ROTATE_MS = 6000;

export default function HeroCarousel({ slides }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (slides.length < 2 || held) return undefined;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;

    const timer = setInterval(() => setIndex((current) => (current + 1) % slides.length), ROTATE_MS);
    return () => clearInterval(timer);
  }, [slides.length, held]);

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Offers"
      className={HERO_FRAME}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
    >
      {slides.map((slide, position) => {
        const current = position === index;

        return (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${position + 1} of ${slides.length}`}
            // Hidden from assistive tech as well as from sight: an off-screen
            // slide read aloud is three headlines where there should be one.
            aria-hidden={!current}
            className={`transition-opacity duration-500 ${current ? "opacity-100" : "pointer-events-none absolute inset-0 opacity-0"}`}
          >
            <HeroBackdrop src={slide.imageUrl} priority={position === 0} focalPoint={slide.focalPoint} />

            <div className={HERO_BODY}>
              <h1 className="font-display text-headline-lg-mobile leading-none text-white md:text-display-lg">
                {slide.headline}
              </h1>

              {slide.subtext ? (
                <p className="mt-6 max-w-md text-body-md text-white/85">{slide.subtext}</p>
              ) : null}

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={slide.ctaHref}
                  // Not focusable while it is off-screen, or tabbing walks
                  // through buttons nobody can see.
                  tabIndex={current ? undefined : -1}
                  className="rounded-full bg-primary-container px-8 py-3 font-display text-label-bold text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  {slide.ctaLabel}
                </Link>
                <Link
                  href="/menu"
                  tabIndex={current ? undefined : -1}
                  className="rounded-full border-2 border-white/80 px-8 py-3 font-display text-label-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  View Menu
                </Link>
              </div>
            </div>
          </div>
        );
      })}

      {slides.length > 1 ? (
        <div className="absolute bottom-5 left-6 z-10 flex gap-2 sm:left-10">
          {slides.map((slide, position) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => {
                setIndex(position);
                // Permanently: they have chosen, so stop moving it.
                setHeld(true);
              }}
              aria-label={`Show "${slide.headline}"`}
              aria-current={position === index}
              className={`h-2 rounded-full transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${
                position === index ? "w-6 bg-white" : "w-2 bg-white/50 hover:bg-white/80"
              }`}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
