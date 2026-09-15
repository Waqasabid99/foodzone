import Stars from "@/components/ui/Stars";
import { formatRating, initials } from "@/lib/format";

/**
 * Customer reviews.
 *
 * "Verified buyer" is claimed on every one of these because it is structurally
 * true rather than aspirational: `submitReview` only accepts a review against
 * an order the reviewer actually placed, so an unverified review cannot exist
 * in this table. If that ever stops being true, this label has to go with it.
 */
export default function ProductReviews({ reviews, productName }) {
  const { items, summary } = reviews;

  return (
    <section aria-labelledby="reviews-heading" className="rounded-card bg-surface-container-lowest p-6 md:p-8">
      <p className="text-label-bold uppercase tracking-widest text-primary">Real heat lovers</p>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-4">
        <h2 id="reviews-heading" className="font-display text-headline-md text-on-surface">
          Customer reviews
        </h2>

        {summary.count > 0 ? (
          <p className="flex items-center gap-2">
            <Stars rating={summary.average} />
            <span className="font-display text-label-bold text-on-surface">
              {formatRating(summary.average)} out of 5
            </span>
            <span className="text-label-bold font-normal text-on-surface-variant">
              · {summary.count} {summary.count === 1 ? "review" : "reviews"}
            </span>
          </p>
        ) : null}
      </div>

      {items.length === 0 ? (
        <p className="mt-6 text-body-md text-on-surface-variant">
          No reviews yet for {productName}. Reviews can be left after an order arrives.
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {items.map((review) => (
            <li key={review.id}>
              <figure className="flex h-full flex-col rounded-card bg-surface-container-low p-5">
                <Stars rating={review.rating} />

                {review.comment ? (
                  <blockquote className="mt-3 flex-1 text-body-md text-on-surface">
                    &ldquo;{review.comment}&rdquo;
                  </blockquote>
                ) : null}

                <figcaption className="mt-4 flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid size-8 shrink-0 place-items-center rounded-full bg-primary-container font-display text-label-bold text-on-primary-container"
                  >
                    {initials(review.user?.name) || "?"}
                  </span>
                  <span>
                    <span className="block text-label-bold text-on-surface">
                      {review.user?.name ?? "A customer"}
                    </span>
                    <span className="block text-label-bold font-normal text-on-surface-variant">
                      Verified buyer
                    </span>
                  </span>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
      )}

      {/* No "write a review" button. Reviewing is gated on having ordered the
          item, so the control belongs on the order, not here, where it would
          send most visitors to a permission error. */}
    </section>
  );
}
