import { redirect } from "next/navigation";
import { Star } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import ReviewPrompts from "@/components/account/ReviewPrompts";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listOwnReviews } from "@/server/services/review.service";
import { reviewableOrders } from "@/server/content/account";
import { getSiteIdentity } from "@/server/content/site";
import { dateLabel } from "@/lib/finance";
import { STAR_LABELS, chipClass, reviewState } from "@/lib/account";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "My reviews — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What this person has said, and what they could still say.
 *
 * The prompt comes first. Nobody opens their account meaning to write a
 * review, so a page that only lists past ones gets used by nobody — the
 * useful half is "you ate this last week, anything to add?".
 *
 * A review's state is shown plainly, including when it was not published.
 * Somebody who wrote something and never saw it appear should be told why
 * rather than left to assume the restaurant deleted it.
 */
export default async function MyReviewsPage() {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/reviews"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.review_own_order")) redirect("/account");

  const [page, prompts] = await Promise.all([
    listOwnReviews({ userId: principal.userId, limit: 50 }),
    reviewableOrders({ userId: principal.userId }),
  ]);

  const reviews = serialize(page.items ?? []);
  const pending = serialize(prompts).filter((order) => order.items.length);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="My reviews" description="What you thought of what you ate." />

      <ReviewPrompts orders={pending} />

      {reviews.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-headline-md text-on-surface">What you have written</h2>
          <ul className="flex flex-col gap-3">
            {reviews.map((review) => {
              const state = reviewState(review);
              return (
                <li key={review.id} className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-label-bold text-on-surface">
                      {review.product?.name ?? `Order ${review.order?.orderNumber ?? ""}`.trim()}
                    </span>
                    <Chip tone={chipClass(state.tone)}>{state.label}</Chip>
                  </p>
                  <p className="text-body-md text-on-surface">
                    {review.rating} out of 5 — {STAR_LABELS[review.rating] ?? ""}
                  </p>
                  {review.comment ? <p className="text-body-md text-on-surface-variant">“{review.comment}”</p> : null}
                  <p className="text-body-md text-on-surface-variant">
                    {dateLabel(review.createdAt, timeZone)}
                    {state.note ? ` · ${state.note}` : ""}
                  </p>
                </li>
              );
            })}
          </ul>
        </section>
      ) : pending.length ? null : (
        <EmptyState icon={Star} title="Nothing yet">
          Once an order arrives you can say what you thought of it.
        </EmptyState>
      )}
    </div>
  );
}
