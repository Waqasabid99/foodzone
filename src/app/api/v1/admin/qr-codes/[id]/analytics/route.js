import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { analyticsQuerySchema } from "@/server/validation/dinein.schemas";
import { assertQrAccess, qrAnalytics } from "@/server/services/qr.service";

export const GET = apiHandler(
  { auth: true, permissions: "qr_codes.view_analytics", params: idParamSchema, query: analyticsQuerySchema },
  async ({ auth, params, query }) => {
    await assertQrAccess(auth, params.id, "qr_codes.view_analytics");
    return ok(await qrAnalytics({ qrCodeId: params.id, from: query.from, to: query.to }));
  },
);
