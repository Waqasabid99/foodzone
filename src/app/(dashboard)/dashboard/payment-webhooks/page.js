import Link from "next/link";
import { redirect } from "next/navigation";
import { Webhook } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import WebhookReplay from "@/components/dashboard/payments/WebhookReplay";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listWebhookEvents } from "@/server/services/payment-webhook.service";
import { timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payment callbacks — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

/**
 * What the payment providers have told us, and what we did about it.
 *
 * Company-wide rather than branch-scoped: a callback arrives from a provider
 * against a payment, not against an outlet, and a webhook that failed is a
 * problem for whoever runs payments regardless of which branch took the order.
 *
 * Defaults to FAILED, which is the only tab anybody opens this page for. A
 * callback that worked needs nobody's attention; one that did not means a
 * customer has been charged for an order still sitting there unpaid, and the
 * whole reason this screen exists is to put the replay button within reach of
 * the person fielding that phone call.
 */
const FILTERS = [
  { value: "FAILED", label: "Failed" },
  { value: "RECEIVED", label: "Received" },
  { value: "PROCESSED", label: "Processed" },
  { value: "IGNORED", label: "Ignored" },
  { value: "all", label: "All" },
];

const TONES = {
  FAILED: "bg-error-container text-on-error-container",
  RECEIVED: "bg-warning-container text-on-warning-container",
  PROCESSED: "bg-success-container text-on-success-container",
  IGNORED: "bg-surface-container-high text-on-surface-variant",
};

export default async function PaymentWebhooksPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/payment-webhooks"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "payment_webhooks.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const asked = one(params.status);
  const status = FILTERS.some((row) => row.value === asked) ? asked : "FAILED";
  const cursor = one(params.cursor) || undefined;

  const page = await listWebhookEvents({
    ...(status === "all" ? {} : { status }),
    limit: PAGE_SIZE,
    cursor,
  });
  const events = serialize(page.items);

  const canReplay = hasPermission(permissions, "payment_webhooks.replay");

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ status, ...extra })) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/payment-webhooks?${text}` : "/dashboard/payment-webhooks";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Payment callbacks"
        description="What the payment providers sent us. A failed callback usually means a customer has paid for an order that still looks unpaid — replaying it runs the same message through again."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by state">
        {FILTERS.map((tab) => (
          <Link
            key={tab.value}
            href={href({ status: tab.value, cursor: "" })}
            aria-current={status === tab.value ? "page" : undefined}
            className={`rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${status === tab.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {events.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {events.map((event) => (
              <li key={event.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="text-label-bold text-on-surface">{event.eventType}</span>
                    <Chip tone={TONES[event.status] ?? TONES.IGNORED}>{event.status}</Chip>
                  </p>

                  <p className="mt-1 text-body-md text-on-surface-variant">
                    {event.provider} · {timeLabel(event.createdAt)}
                    {event.attempts ? ` · ${event.attempts} ${event.attempts === 1 ? "attempt" : "attempts"}` : ""}
                  </p>

                  {/* The provider's own id, because that is what they will ask
                      for when somebody has to go and look at their end. */}
                  <p className="mt-1 break-all text-label-bold font-normal text-on-surface-variant">{event.eventId}</p>

                  {event.error ? <p className="mt-2 break-words text-body-md text-error">{event.error}</p> : null}
                </div>

                {canReplay && event.status !== "PROCESSED" ? <WebhookReplay event={event} /> : null}
              </li>
            ))}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? (
                <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Newest
                </Link>
              ) : null}
              {page.nextCursor ? (
                <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
                  Older
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Webhook} title={status === "FAILED" ? "Nothing has failed" : "Nothing here"}>
          {status === "FAILED"
            ? "Every callback the providers have sent was handled. This is the state you want this page in."
            : "No callbacks in this state."}
        </EmptyState>
      )}
    </div>
  );
}
