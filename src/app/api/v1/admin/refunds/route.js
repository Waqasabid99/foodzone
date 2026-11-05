import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { listRefundsSchema, requestRefundSchema } from "@/server/validation/payment.schemas";
import { listRefunds, requestRefund } from "@/server/services/refund.service";

export const GET = apiHandler(
  { auth: true, permissions: "refunds.read", query: listRefundsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listRefunds({ ...query, scope: branchScope(auth, "refunds.read") })),
);

/**
 * Raises a refund request.
 *
 * Requesting and approving are separate permissions so the person who fields
 * the complaint need not be the person who authorises the money. A restaurant
 * that wants one-step refunds grants one role both.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "refunds.request",
    body: requestRefundSchema,
    rateLimit: RateLimits.write,
    audit: { action: "refund.request", entityType: "Refund", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => created(await requestRefund({ ...body, actor: auth })),
);
