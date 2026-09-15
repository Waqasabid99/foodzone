import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { setDefaultAddress } from "@/server/services/address.service";

/** Exactly one address is the default; this is the only way to move it. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.manage_addresses",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "address.set_default", entityType: "Address" },
  },
  async ({ auth, params }) => ok(await setDefaultAddress({ userId: auth.userId, addressId: params.id })),
);
