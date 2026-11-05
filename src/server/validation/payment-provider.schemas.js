import { z } from "zod";

/**
 * Validation for the gateway-setup endpoints.
 *
 * The credential *values* are deliberately not validated here: each gateway
 * declares its own fields, and only the provider registry knows what Safepay
 * wants versus what JazzCash wants. This schema checks the envelope — a branch,
 * a provider, a plausible bag of strings — and the service validates the
 * contents against the declaration. Duplicating the rules here would mean two
 * places to update when a gateway changes.
 */

const branchId = z.string().trim().min(1).max(64);
const providerName = z.string().trim().min(2).max(40);

export const providerListQuerySchema = z.object({ branchId });

export const providerParamsSchema = z.object({ branchId, provider: providerName });

export const saveProviderSchema = z.object({
  /**
   * A field left out means "leave it as it is", and an explicit null clears it.
   * The form cannot display a secret, so it renders an empty box over one that
   * is already set — if blank meant "clear", saving an unrelated change on that
   * screen would silently break a live gateway.
   */
  credentials: z.record(z.string().min(1).max(64), z.union([z.string().max(2000), z.null()])).optional(),
  mode: z.enum(["SANDBOX", "LIVE"]).optional(),
  isEnabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  /**
   * What this branch calls the gateway at checkout. Empty means "use the
   * provider's own name", which is why an empty string is allowed here and
   * normalised to null by the service rather than rejected.
   */
  displayName: z.string().trim().max(40).optional(),
});
