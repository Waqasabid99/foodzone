import { z } from "zod";

/**
 * A path on this site, not a URL.
 *
 * The hero is the most prominent link in the shop, and an admin — or anyone
 * who gets hold of an admin session — setting it to an arbitrary address turns
 * the front window into a phishing link that carries the shop's own branding
 * and domain. Scheme-relative `//evil.test` is refused for the same reason: a
 * browser reads it as a different host, while it looks like a path.
 */
const internalPath = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine((value) => value.startsWith("/") && !value.startsWith("//"), {
    message: "Link to a page on this site, starting with /",
  });

const slideShape = {
  headline: z.string().trim().min(1).max(120),
  subtext: z.string().trim().max(300).nullish(),
  imageUrl: z.url().max(2000).nullish(),
  /*
   * Which edge of the artwork survives the crop.
   *
   * An enum rather than a free CSS value: this string lands in a class name on
   * the most-visited page of the site, and the set of answers that make sense
   * is three.
   */
  focalPoint: z.enum(["TOP", "CENTER", "BOTTOM"]).optional(),
  ctaHref: internalPath,
  ctaLabel: z.string().trim().min(1).max(40),
  sortOrder: z.number().int().min(0).max(9999).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
};

/** A window that closes before it opens shows nothing, silently. */
const windowIsSane = (value) =>
  !value.startsAt || !value.endsAt || new Date(value.endsAt) > new Date(value.startsAt);

export const createHeroSlideSchema = z
  .object(slideShape)
  .refine(windowIsSane, { message: "The end has to come after the start", path: ["endsAt"] });

export const updateHeroSlideSchema = z
  .object({
    headline: slideShape.headline.optional(),
    subtext: slideShape.subtext,
    imageUrl: slideShape.imageUrl,
    focalPoint: slideShape.focalPoint,
    ctaHref: internalPath.optional(),
    ctaLabel: slideShape.ctaLabel.optional(),
    sortOrder: slideShape.sortOrder,
    isActive: slideShape.isActive,
    startsAt: slideShape.startsAt,
    endsAt: slideShape.endsAt,
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change" })
  .refine(windowIsSane, { message: "The end has to come after the start", path: ["endsAt"] });
