import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setAsideSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { recallTicket, setAsideTicket } from "@/server/services/kds.service";

/**
 * Takes a stuck ticket off the kitchen's board, or puts it back.
 *
 * The sale is untouched either way — this moves a ticket between two views,
 * nothing more. Cancelling the order is a separate decision with a separate
 * permission, which is the whole point of the split: a kitchen should be able
 * to clear its screen without being able to void somebody's money.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "kds.set_aside",
    params: idParamSchema,
    body: setAsideSchema,
    rateLimit: RateLimits.write,
    scope: "kds",
    // Audited in the service rather than here: that entry carries the reason,
    // and two rows for one action makes the log harder to read, not safer.
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "kds.set_aside");
    return ok(await setAsideTicket({ orderId: params.id, reason: body.reason, actorId: auth.userId }));
  },
);

/**
 * Recall. Held by the kitchen as well as the till: the commonest reason to
 * recall is that somebody set the wrong ticket aside ten seconds ago, and
 * making them find a manager for that is how a safety valve stops being used.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: ["kds.set_aside", "orders.update_status"],
    anyPermission: true,
    params: idParamSchema,
    rateLimit: RateLimits.write,
    scope: "kds",
  },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.read");
    return ok(await recallTicket({ orderId: params.id, actorId: auth.userId }));
  },
);
