import Link from "next/link";
import MenuItemCard from "@/components/menu/MenuItemCard";
import SectionHeading from "@/components/home/SectionHeading";

/**
 * Dishes you can order without leaving the home page.
 *
 * The same card the menu uses, not a home-page lookalike: it adds to the real
 * server cart, which prices the line against the branch's live menu and refuses
 * an item that has been 86'd. A decorative copy would have to grow all of that
 * or quietly send people somewhere else to buy.
 *
 * **Nothing here when the catalog is empty.** Every other section falls back to
 * branded placeholder artwork, and that is right for a banner or a testimonial
 * — but a grid of invented dishes is a shop window of things that cannot be
 * bought, and each one links to a product page that does not exist. An absent
 * section is the honest version of that.
 */
export default function MenuHighlights({ items, currency, title = "Straight off the menu" }) {
  if (!items?.length) return null;

  return (
    <section aria-labelledby="highlights-heading">
      <SectionHeading
        title={title}
        action={
          <Link
            href="/menu"
            className="shrink-0 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            See everything
          </Link>
        }
      />
      <h2 id="highlights-heading" className="sr-only">
        {title}
      </h2>

      <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <MenuItemCard key={item.id} item={item} currency={currency} canChooseBranch />
        ))}
      </div>
    </section>
  );
}
