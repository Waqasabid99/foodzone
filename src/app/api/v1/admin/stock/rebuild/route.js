import { z } from "zod";
import { apiHandler, assertCompanyWide, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { rebuildLevels } from "@/server/services/stock.service";
import { assertRecordAccess } from "@/server/inventory/access";

const bodySchema = z
  .object({ itemId: cuidSchema.optional(), locationId: cuidSchema.optional() })
  .optional()
  .default({});

/**
 * Replays the ledger and rewrites the cached levels.
 *
 * The safety net under the whole module, and the thing that makes "the ledger
 * is the truth" testable rather than a slogan. It reports what it corrected: a
 * non-empty `drift` means something wrote around `postMovement`, which is a bug
 * worth chasing rather than a number worth fixing quietly.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_adjustments.approve",
    body: bodySchema,
    rateLimit: RateLimits.write,
    audit: { action: "stock.rebuild_levels", entityType: "StockLevel" },
  },
  async ({ body, auth }) => {
    // One location is that branch's business; the whole ledger is the company's.
    if (body?.locationId) await assertRecordAccess(auth, "location", body.locationId, "stock_adjustments.approve");
    else assertCompanyWide(auth, "stock_adjustments.approve");
    return ok(await rebuildLevels(body ?? {}));
  },
);
