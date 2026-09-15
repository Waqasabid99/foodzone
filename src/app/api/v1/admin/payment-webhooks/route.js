import { apiHandler, ok } from "@/lib/api";
import { listWebhookEventsSchema } from "@/server/validation/payment.schemas";
import { listWebhookEvents } from "@/server/services/payment-webhook.service";

export const GET = apiHandler(
  { auth: true, permissions: "payment_webhooks.read", query: listWebhookEventsSchema },
  async ({ query }) => ok(await listWebhookEvents(query)),
);
