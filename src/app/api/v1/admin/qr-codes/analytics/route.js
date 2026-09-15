import { apiHandler, ok } from "@/lib/api";
import { branchAnalyticsQuerySchema } from "@/server/validation/dinein.schemas";
import { branchQrAnalytics } from "@/server/services/qr.service";

/** Which codes at a branch are being used — and which posters nobody scans. */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "qr_codes.view_analytics",
    query: branchAnalyticsQuerySchema,
    branch: "query",
  },
  async ({ query }) => ok(await branchQrAnalytics(query)),
);
