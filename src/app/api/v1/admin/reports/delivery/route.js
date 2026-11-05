import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { periodReportSchema } from "@/server/validation/finance.schemas";
import { deliveryReport } from "@/server/services/operational-report.service";

/**
 * Lateness is measured against the promise made to the customer, not against
 * how long the kitchen took — a delivery that was quick but late is still late
 * to the person waiting for it.
 */
export const GET = apiHandler(
  { auth: true, permissions: "reports.view_delivery", query: periodReportSchema, branch: "query" },
  async ({ query, auth }) => ok(await deliveryReport({ ...query, scope: branchScope(auth, "reports.view_delivery") })),
);
