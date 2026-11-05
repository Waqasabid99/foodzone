import { apiHandler, assertCompanyWide, created, RateLimits } from "@/lib/api";
import { createStandardUnits } from "@/server/services/uom.service";

/**
 * Adds the everyday units — g, kg, ml, l, piece, dozen — that are missing.
 *
 * Nothing in inventory can be created without a unit, so a fresh install
 * offers this as its first step. Existing codes are never touched.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "units.manage",
    rateLimit: RateLimits.write,
    audit: { action: "uom.create_standard", entityType: "UnitOfMeasure" },
  },
  async ({ auth }) => {
    assertCompanyWide(auth, "units.manage");
    return created(await createStandardUnits());
  },
);
