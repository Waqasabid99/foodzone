import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { assertInternalRequest } from "@/lib/api/internal";
import { runCreatorRollup } from "@/server/jobs";

const querySchema = z.object({
  date: z.coerce.date().optional(),
  retentionDays: z.coerce.number().int().min(7).max(3650).optional(),
});

/**
 * Folds yesterday's engagement into per-day rows the dashboard charts read.
 *
 * Yesterday, not today: rolling up a day still in progress produces a number
 * that changes every time somebody looks at it.
 */
async function handler({ request, query }) {
  assertInternalRequest(request);
  return ok(await runCreatorRollup(query));
}

export const GET = apiHandler({ query: querySchema }, handler);
export const POST = apiHandler({ query: querySchema }, handler);
