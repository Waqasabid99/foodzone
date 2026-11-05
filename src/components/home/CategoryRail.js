import Link from "next/link";
import FoodImage from "@/components/ui/FoodImage";
import SectionHeading from "@/components/home/SectionHeading";

/**
 * What the shop sells, in one row.
 *
 * The first question a hungry visitor asks is not "what is on offer" but "do
 * you do pizza" — so this sits directly under the banner, above the deal. It is
 * navigation wearing the menu's photography rather than a list of links.
 *
 * Horizontally scrollable on a phone and a grid from `sm` up. A scroller is
 * right where there is no room for eight tiles and wrong where there is: on a
 * desktop it hides half the categories behind a gesture nobody makes with a
 * mouse.
 */
export default function CategoryRail({ categories, isPlaceholder = false }) {
  if (!categories?.length) return null;

  return (
    <section aria-labelledby="categories-heading">
      <SectionHeading
        title="What are you after?"
        action={
          <Link
            href="/menu"
            className="shrink-0 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Full menu
          </Link>
        }
      />
      <h2 id="categories-heading" className="sr-only">
        Browse by category
      </h2>

      <ul
        className="mt-6 -mx-margin-mobile flex snap-x snap-mandatory gap-4 overflow-x-auto px-margin-mobile pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5"
      >
        {categories.map((category) => (
          <li key={category.id} className="w-36 shrink-0 snap-start sm:w-auto">
            <Link
              /*
               * A placeholder category is artwork, not a filter: the catalog is
               * empty, so `?category=sides` would land on a menu page that
               * honestly reports nothing. The whole menu is the honest answer.
               */
              href={isPlaceholder ? "/menu" : `/menu?category=${encodeURIComponent(category.slug)}`}
              className="group block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <div className="relative isolate aspect-square overflow-hidden rounded-card bg-surface-container">
                <FoodImage
                  src={category.imageUrl}
                  alt=""
                  sizes="(max-width: 640px) 144px, (max-width: 1024px) 33vw, 240px"
                  className="size-full transition-transform duration-300 group-hover:scale-105"
                />
                {/* Enough of a floor to hold the name, no more: these tiles are
                    mostly photograph and the words are short. */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />

                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="font-display text-label-bold uppercase leading-tight text-white">{category.name}</p>
                  {category.productCount ? (
                    <p className="text-label-bold font-normal text-white/70">
                      {category.productCount} {category.productCount === 1 ? "dish" : "dishes"}
                    </p>
                  ) : null}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
