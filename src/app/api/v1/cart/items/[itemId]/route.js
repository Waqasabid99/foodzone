import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { cuidSchema } from "@/server/validation/schemas";
import { updateCartItemSchema } from "@/server/validation/ordering.schemas";
import { getPricedCart, orderChannelFor, removeItem, resolveCart, updateItem } from "@/server/services/cart.service";

const paramsSchema = z.object({ itemId: cuidSchema });

export const PATCH = apiHandler(
  { params: paramsSchema, body: updateCartItemSchema, rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, params, body, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await updateItem({ cart, itemId: params.itemId, ...body });

    return ok(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);

export const DELETE = apiHandler(
  { params: paramsSchema, rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, params, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await removeItem({ cart, itemId: params.itemId });

    return ok(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);
