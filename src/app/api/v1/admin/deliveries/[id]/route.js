import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getDelivery } from "@/server/services/delivery.service";

export const GET = apiHandler(
  { auth: true, permissions: "deliveries.read", params: idParamSchema },
  async ({ params }) => ok(await getDelivery(params.id)),
);
