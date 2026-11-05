import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { publicMenuQuerySchema } from "@/server/validation/catalog.schemas";
import { getBranchMenu, getOrderMenu } from "@/server/services/menu.service";

/**
 * The storefront read model: the menu this branch is serving right now, on the
 * requested channel, grouped into sections with sizes collapsed onto one card.
 *
 * `id` accepts a branch id or its code, matching `/branches/{id}`. Staff can
 * preview another moment with `?at=` and see sold-out items with
 * `?includeUnavailable=true`. `?orderType=` asks for the menu a delivery,
 * pickup or dine-in order is priced from — the same answer the cart uses.
 */
export const GET = apiHandler(
  {
    params: idParamSchema,
    query: publicMenuQuerySchema,
    rateLimit: RateLimits.public,
    scope: "catalog:branch-menu",
  },
  async ({ params, query }) =>
    ok(
      query.orderType && !query.type && !query.menu
        ? await getOrderMenu({
            branchIdOrCode: params.id,
            orderType: query.orderType,
            at: query.at ?? new Date(),
            includeUnavailable: query.includeUnavailable,
          })
        : await getBranchMenu({
            branchIdOrCode: params.id,
            type: query.type ?? null,
            menuSlug: query.menu ?? null,
            at: query.at ?? new Date(),
            includeUnavailable: query.includeUnavailable,
          }),
    ),
);
