import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageSquareQuote } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ReviewFilters from "@/components/dashboard/reviews/ReviewFilters";
import ReviewModeration from "@/components/dashboard/reviews/ReviewModeration";
import Stars from "@/components/ui/Stars";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can as canAt, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { scopedBranches } from "@/server/content/branch-scope";
import { listReviews, reviewCounts } from "@/server/services/review.service";
import { REVIEW_STATES, lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = {
  title: "Reviews — FoodZone",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

const TABS = [
  { value: "PENDING", label: "Waiting" },
  { value: "PUBLISHED", label: "Published" },
  { value: "REJECTED", label: "Rejected" },
  { value: "", label: "All" },
];

/**
 * The moderation queue.
 *
 * A review is published only once someone approves it, so this screen is the
 * gate between a customer's words and the product page. It opens on what is
 * waiting, because that is the only state with work in it.
 *
 * Scoped to the reviewer's branches: a review belongs to the outlet whose order
 * it describes, and the manager who cooked the food is who can judge it.
 */
export default async function ReviewsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/reviews"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "reviews.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const status = TABS.some((tab) => tab.value && tab.value === one(params.status)) ? one(params.status) : one(params.status) === "" ? "" : "PENDING";
  const q = one(params.q)?.trim() ?? "";
  const rating = [1, 2, 3, 4, 5].includes(Number(one(params.rating))) ? Number(one(params.rating)) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "reviews.read");
  const branches = await scopedBranches(principal, "reviews.read");
  const branch = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : "";

  const [counts, page] = await Promise.all([
    reviewCounts({ scope }),
    listReviews({
      ...(status ? { status } : {}),
      ...(q ? { search: q } : {}),
      ...(rating ? { rating } : {}),
      ...(branch ? { branchId: branch } : {}),
      scope,
      limit: PAGE_SIZE,
      cursor,
    }),
  ]);

  const reviews = serialize(page.items);
  const filtered = Boolean(q || rating || branch);

  const href = (extra = {}) => {
    const search = new URLSearchParams();
    const values = { status, q, rating: rating || "", branch, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) search.set(key, String(value));
    // "All" is a real choice and has to survive the round trip.
    if (values.status === "") search.set("status", "");
    const query = search.toString();
    return query ? `/dashboard/reviews?${query}` : "/dashboard/reviews";
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Reviews"
        description="What customers said about their orders. Nothing is shown on the website until it is published here."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {TABS.map((tab) => {
          const active = tab.value === status;
          const count = tab.value ? counts[tab.value] : counts.PENDING + counts.PUBLISHED + counts.REJECTED;
          return (
            <Link
              key={tab.label}
              href={href({ status: tab.value, cursor: "" })}
              aria-current={active ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
                active ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"
              }`}
            >
              {tab.label}
              <span className="ml-2 font-normal tabular-nums opacity-80">{count}</span>
            </Link>
          );
        })}
      </div>

      <ReviewFilters q={q} branch={branch} rating={rating ? String(rating) : ""} status={status} branches={branches} />

      {reviews.length ? (
        <ul className="flex flex-col gap-3">
          {reviews.map((review) => {
            const state = REVIEW_STATES[review.status] ?? REVIEW_STATES.PENDING;
            const branchId = review.order?.branchId ?? null;
            const canModerate = branchId
              ? canAt(principal, "reviews.moderate", { branchId })
              : scope.all && !scope.except.length && hasPermission(permissions, "reviews.moderate");

            return (
              <li key={review.id} className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <Stars rating={review.rating} />
                      <span className="text-label-bold text-on-surface">{review.product?.name ?? "The whole order"}</span>
                      <span className={`rounded-full px-2 py-0.5 text-label-bold ${state.tone}`}>{state.label}</span>
                    </p>
                    <p className="text-body-md text-on-surface-variant">
                      {review.user?.name ?? "A customer"}
                      {review.order?.branch ? ` · ${review.order.branch.name}` : " · branch unknown"}
                      {review.order?.orderNumber ? ` · order ${review.order.orderNumber}` : ""}
                      {` · ${lastSeen(review.createdAt).toLowerCase()}`}
                    </p>
                  </div>

                  {canModerate ? (
                    <ReviewModeration review={review} />
                  ) : (
                    <p className="text-label-bold font-normal text-on-surface-variant">Moderated at {review.order?.branch?.name ?? "head office"}</p>
                  )}
                </div>

                {review.comment ? (
                  <p className="whitespace-pre-line rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface">{review.comment}</p>
                ) : (
                  <p className="text-body-md text-on-surface-variant">A rating with no comment.</p>
                )}

                <p className="text-label-bold font-normal text-on-surface-variant">{state.detail}</p>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col items-center gap-3 rounded-card bg-surface-container-lowest px-6 py-16 text-center">
          <MessageSquareQuote aria-hidden="true" className="size-8 text-on-surface-variant" />
          <p className="font-display text-headline-md text-on-surface">
            {status === "PENDING" && !filtered ? "Nothing waiting" : "No reviews match that"}
          </p>
          <p className="max-w-md text-body-md text-on-surface-variant">
            {status === "PENDING" && !filtered
              ? "Every review has been decided. New ones arrive here after a customer's order is delivered."
              : "Try another state, branch or rating."}
          </p>
          {filtered ? (
            <Link href={`/dashboard/reviews?status=${status}`} className="text-label-bold text-primary hover:underline">
              Clear filters
            </Link>
          ) : null}
        </div>
      )}

      {page.nextCursor ? (
        <Link
          href={href({ cursor: page.nextCursor })}
          className="w-fit rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
        >
          Show more
        </Link>
      ) : null}
    </div>
  );
}
