import { apiHandler, noContent, ok, RateLimits } from "@/lib/api";
import { idParamSchema, updateAddressSchema } from "@/server/validation/schemas";
import { deleteAddress, getAddress, updateAddress } from "@/server/services/address.service";

export const GET = apiHandler(
  { auth: true, permissions: "self.manage_addresses", params: idParamSchema },
  async ({ auth, params }) => ok(await getAddress({ userId: auth.userId, addressId: params.id })),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "self.manage_addresses",
    params: idParamSchema,
    body: updateAddressSchema,
    rateLimit: RateLimits.write,
    audit: { action: "address.update", entityType: "Address" },
  },
  async ({ auth, params, body }) => ok(await updateAddress({ userId: auth.userId, addressId: params.id, data: body })),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "self.manage_addresses",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "address.delete", entityType: "Address" },
  },
  async ({ auth, params }) => {
    await deleteAddress({ userId: auth.userId, addressId: params.id });
    return noContent();
  },
);
