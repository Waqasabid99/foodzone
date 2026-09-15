import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ApiError, assertBranchAccess } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { itemStatusSchema } from "@/server/validation/ordering.schemas";
import { setItemStatus } from "@/server/services/kds.service";

const paramsSchema = z.object({ itemId: cuidSchema });

/**
 * Marks one line preparing, ready, served or cancelled.
 *
 * Advancing the last outstanding line advances the order too — nobody in a
 * kitchen should have to remember to tap the ticket *and* the order.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "kds.update_item_status",
    params: paramsSchema,
    body: itemStatusSchema,
    rateLimit: RateLimits.write,
    scope: "kds",
  },
  async ({ auth, params, body }) => {
    // The item only carries its order, so the branch it belongs to has to be
    // read before the permission can be measured against it.
    const item = await prisma.orderItem.findUnique({
      where: { id: params.itemId },
      select: { order: { select: { branchId: true } } },
    });
    if (!item) throw ApiError.notFound("Order item not found");
    assertBranchAccess(auth, item.order.branchId, "kds.update_item_status");

    return ok(
      await setItemStatus({
        itemId: params.itemId,
        status: body.status,
        reason: body.reason ?? null,
        actorId: auth.userId,
      }),
    );
  },
);
