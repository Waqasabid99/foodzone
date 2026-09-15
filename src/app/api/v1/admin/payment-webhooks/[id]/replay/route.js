import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { replayWebhookEvent } from "@/server/services/payment-webhook.service";

/**
 * Replays a stored event — how a failed callback is recovered.
 *
 * The signature is not re-checked: it was verified on arrival, and nothing
 * unverified is ever stored. Permission is the control here instead.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "payment_webhooks.replay",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "payment_webhook.replay", entityType: "PaymentWebhookEvent" },
  },
  async ({ params }) => ok(await replayWebhookEvent(params.id)),
);
