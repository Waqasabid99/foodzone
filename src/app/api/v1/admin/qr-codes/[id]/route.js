import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateQrSchema } from "@/server/validation/dinein.schemas";
import { assertQrAccess, deleteQrCode, getQrCode, updateQrCode } from "@/server/services/qr.service";

export const GET = apiHandler(
  { auth: true, permissions: "qr_codes.read", params: idParamSchema },
  async ({ auth, params }) => {
    await assertQrAccess(auth, params.id, "qr_codes.read");
    return ok(await getQrCode(params.id));
  },
);

/**
 * Repointing a printed code. The `code` itself is not editable — it is on a
 * sticker already stuck to a table.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "qr_codes.update",
    params: idParamSchema,
    body: updateQrSchema,
    rateLimit: RateLimits.write,
    audit: { action: "qr_code.update", entityType: "QrCode" },
  },
  async ({ auth, params, body }) => {
    await assertQrAccess(auth, params.id, "qr_codes.update");
    return ok(await updateQrCode(params.id, body));
  },
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "qr_codes.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "qr_code.delete", entityType: "QrCode" },
  },
  async ({ auth, params }) => {
    await assertQrAccess(auth, params.id, "qr_codes.delete");
    return ok(await deleteQrCode(params.id));
  },
);
