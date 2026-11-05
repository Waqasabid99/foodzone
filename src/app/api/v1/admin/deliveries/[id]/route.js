import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getDelivery } from "@/server/services/delivery.service";
import { assertRecordAccess } from "@/server/delivery/access";

export const GET = apiHandler(
  { auth: true, permissions: "deliveries.read", params: idParamSchema },
  async ({ params, auth }) => {
    await assertRecordAccess(auth, "delivery", params.id, "deliveries.read");
    return ok(await getDelivery(params.id));
  },
);
