import SectionHeading from "@/components/home/SectionHeading";
import Stars from "@/components/ui/Stars";
import { initials } from "@/lib/format";

/**
 * Testimonials, drawn from approved reviews.
 *
 * "Verified buyer" is claimed because it is true: a review can only be written
 * against an order the reviewer actually placed, which the ordering service
 * enforces. If that ever stops being true, this label has to go with it.
 */
export default function CustomerLove({ testimonials }) {
  if (!testimonials.length) return null;

  return (
    <section>
      <SectionHeading title="Customer love" />

      <ul className="mt-6 grid gap-4 md:grid-cols-3">
        {testimonials.map((review) => (
          <li key={review.id} className="rounded-card bg-surface-container p-6">
            {/* A quote and its attribution are a figure; `figcaption` outside
                one is invalid, and assistive tech loses the pairing. */}
            <figure className="m-0">
              <Stars rating={review.rating} />

              <blockquote className="mt-4 text-body-md italic text-on-surface">
                &ldquo;{review.comment}&rdquo;
              </blockquote>

              <figcaption className="mt-6 flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="grid size-9 place-items-center rounded-full bg-primary-fixed text-label-bold text-on-primary-fixed"
                >
                  {initials(review.authorName)}
                </span>
                <span>
                  <span className="block text-label-bold text-on-surface">{review.authorName}</span>
                  <span className="block text-label-bold text-on-surface-variant">Verified buyer</span>
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
