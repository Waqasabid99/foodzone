import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { issueHandoverCode } from "@/server/services/delivery.service";

/**
 * Issues the customer's handover code.
 *
 * Only the hash is stored, exactly like a password — a code sitting in plain
 * text is a code any staff member can read off a screen and pass to a driver
 * who never went to the door. It is therefore returned **once**, here, and
 * cannot be read back afterwards.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "deliveries.update_status",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "delivery.issue_handover_code", entityType: "Delivery" },
  },
  async ({ params }) => ok(await issueHandoverCode({ deliveryId: params.id })),
);
