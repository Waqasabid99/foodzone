import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { deliveryTrack } from "@/server/services/delivery.service";
import { assertRecordAccess } from "@/server/delivery/access";

/** The sampled breadcrumb trail — evidence for disputes and distance checks. */
export const GET = apiHandler(
  { auth: true, permissions: "drivers.track", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "delivery", params.id, "drivers.track");
    return ok(await deliveryTrack({ deliveryId: params.id }));
  },
);
