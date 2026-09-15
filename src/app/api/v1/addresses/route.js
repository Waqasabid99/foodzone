import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { addressSchema } from "@/server/validation/schemas";
import { createAddress, listAddresses } from "@/server/services/address.service";

export const GET = apiHandler({ auth: true, permissions: "self.manage_addresses" }, async ({ auth }) =>
  ok(await listAddresses({ userId: auth.userId })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.manage_addresses",
    body: addressSchema,
    rateLimit: RateLimits.write,
    audit: { action: "address.create", entityType: "Address" },
  },
  async ({ auth, body }) => created(await createAddress({ userId: auth.userId, data: body })),
);
