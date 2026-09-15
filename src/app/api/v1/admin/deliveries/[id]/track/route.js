import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { deliveryTrack } from "@/server/services/delivery.service";

/** The sampled breadcrumb trail — evidence for disputes and distance checks. */
export const GET = apiHandler(
  { auth: true, permissions: "drivers.track", params: idParamSchema },
  async ({ params }) => ok(await deliveryTrack({ deliveryId: params.id })),
);
