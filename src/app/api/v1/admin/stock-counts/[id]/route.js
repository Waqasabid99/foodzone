import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getCount } from "@/server/services/stock-count.service";

const querySchema = z.object({ blind: z.stringbool().optional() });

/**
 * One count sheet.
 *
 * `?blind=true` hides the system quantity — how it should be fetched by whoever
 * is doing the counting, for the same reason a cash drawer is counted blind.
 * Someone who can see the expected number will find the expected number.
 */
export const GET = apiHandler(
  { auth: true, permissions: "stock_counts.read", params: idParamSchema, query: querySchema },
  async ({ params, query }) => ok(await getCount(params.id, { blind: query.blind === true })),
);
