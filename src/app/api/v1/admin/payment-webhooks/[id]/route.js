import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getWebhookEvent } from "@/server/services/payment-webhook.service";

export const GET = apiHandler(
  { auth: true, permissions: "payment_webhooks.read", params: idParamSchema },
  async ({ params }) => ok(await getWebhookEvent(params.id)),
);
