/**
 * How a banner's artwork meets the band it has to fill.
 *
 * The hero is roughly twice as wide as it is high; photography mostly is not.
 * `object-cover` scales the picture until both sides are covered and cuts the
 * overflow, so something is nearly always lost. This works out how much, and
 * along which axis, so the dashboard can say it plainly instead of letting
 * somebody find out from the live home page.
 *
 * Plain arithmetic in its own module rather than inside the field component:
 * it is the part worth testing, and a test cannot import a client component
 * with JSX in it.
 */

/**
 * The band's shape on a desktop screen, near enough.
 *
 * Measured, not assumed: the hero is as tall as its padding makes it — about
 * 593 by 1240 on a 1440-wide screen. A phone is much squarer and crops far
 * less, so this is the worst case, which is the one worth warning about.
 */
export const HERO_BAND_RATIO = 2.1;

/** Below this a crop has stopped being a crop and become a detail shot. */
export const TIGHT_CROP = 60;

export function cropReport(width, height, band = HERO_BAND_RATIO) {
  if (!width || !height) return null;

  const ratio = width / height;
  // Taller than the band in proportion: the sides fill first, so the cut is
  // top and bottom — the case a focal point can do something about.
  if (ratio < band) return { axis: "vertical", visible: Math.round((ratio / band) * 100) };
  if (ratio > band) return { axis: "horizontal", visible: Math.round((band / ratio) * 100) };
  return { axis: null, visible: 100 };
}
