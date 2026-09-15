import Link from "next/link";
import { Flame, Plus } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import SectionHeading from "@/components/home/SectionHeading";
import { formatMoney } from "@/lib/format";

/**
 * The headline offer, with the next-best items beside it.
 *
 * The saving is stated twice on purpose — the struck-through original next to
 * the new price — because a single discounted number tells a customer nothing
 * about whether it is a deal.
 */
export default function DealOfTheDay({ deal, featured, currency }) {
  if (!deal) return null;

  const saving = deal.compareAtPrice && deal.priceFrom ? deal.compareAtPrice - deal.priceFrom : null;

  return (
    <section>
      <SectionHeading title="Deal of the day" />

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <Link
          href={`/menu/${deal.slug}`}
          className="group relative isolate col-span-1 overflow-hidden rounded-card lg:col-span-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <div className="absolute inset-0 -z-10">
            <FoodImage
              src={deal.imageUrl}
              alt={deal.name}
              sizes="(max-width: 1024px) 100vw, 853px"
              className="size-full transition-transform duration-500 group-hover:scale-105"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />
          </div>

          <div className="flex min-h-64 flex-col justify-end gap-2 p-6">
            {saving ? (
              <span className="w-fit rounded-sm bg-secondary-container px-2 py-1 text-label-bold uppercase text-on-secondary-container">
                Limited time
              </span>
            ) : null}

            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h3 className="font-display text-headline-md text-white">{deal.name}</h3>
                {deal.shortDescription ? (
                  <p className="mt-1 max-w-sm text-body-md text-white/80">{deal.shortDescription}</p>
                ) : null}
              </div>

              <p className="text-right">
                {deal.compareAtPrice ? (
                  <span className="block text-label-bold text-white/70 line-through">
                    {formatMoney(deal.compareAtPrice, currency)}
                  </span>
                ) : null}
                <span className="font-display text-headline-md text-primary-container">
                  {formatMoney(deal.priceFrom, currency)}
                </span>
              </p>
            </div>
          </div>
        </Link>

        <ul className="flex flex-col gap-4">
          {featured.slice(0, 2).map((item) => (
            <li key={item.id} className="flex-1">
              <Link
                href={`/menu/${item.slug}`}
                className="flex h-full flex-col justify-between rounded-card bg-surface-container p-5 transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-display text-headline-md text-on-surface">{item.name}</h3>
                    {item.spiceLevel >= 2 ? (
                      <Flame aria-label="Spicy" className="size-5 shrink-0 text-primary-container" />
                    ) : null}
                  </div>
                  {item.shortDescription ? (
                    <p className="mt-2 text-body-md text-on-surface-variant">{item.shortDescription}</p>
                  ) : null}
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <span className="font-display text-headline-md text-primary">
                    {formatMoney(item.priceFrom, currency)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="grid size-9 place-items-center rounded-full bg-inverse-surface text-inverse-on-surface"
                  >
                    <Plus className="size-4" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
