import FoodImage from "@/components/ui/FoodImage";

/**
 * The photograph behind the hero, and the scrim that makes words survivable on
 * top of it.
 */
/**
 * Which edge of the artwork the crop holds on to.
 *
 * The band is about two to one and photography is not, so something is always
 * cropped. Written out rather than built from the value because a class name
 * assembled at runtime is a class name the compiler never sees and never ships.
 */
const FOCUS = {
  TOP: "object-top",
  CENTER: "object-center",
  BOTTOM: "object-bottom",
};

export default function HeroBackdrop({ src, priority = false, focalPoint = "CENTER" }) {
  return (
    <div className="absolute inset-0 -z-10">
      <FoodImage
        src={src}
        alt=""
        priority={priority}
        position={FOCUS[focalPoint] ?? FOCUS.CENTER}
        sizes="(max-width: 1280px) 100vw, 1280px"
        className="size-full"
      />
      <div className="absolute inset-0 bg-linear-to-r from-black/85 via-black/60 to-black/20" />
    </div>
  );
}

/** The band itself. Its height is the body's padding — see `HERO_BODY`. */
export const HERO_FRAME = "relative isolate overflow-hidden rounded-banner";

/**
 * The words, and with them the height of the whole band.
 *
 * There is no minimum height here on purpose: the hero is as tall as what it
 * says, which keeps a short banner from floating in a half-empty rectangle. The
 * padding is a nudge above where it started — a little more photograph showing,
 * without turning the front window into a wall the menu hides behind.
 */
export const HERO_BODY = "max-w-xl px-6 py-24 sm:px-10 md:py-32";
