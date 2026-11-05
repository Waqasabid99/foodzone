import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { createQrSchema, qrQuerySchema } from "@/server/validation/dinein.schemas";
import { createQrCode, listQrCodes } from "@/server/services/qr.service";
import { branchScope } from "@/lib/api/permissions";

export const GET = apiHandler(
  { auth: true, permissions: "qr_codes.read", query: qrQuerySchema, branch: "query" },
  async ({ query, auth }) => {
    const { items, nextCursor, limit } = await listQrCodes({ ...query, scope: branchScope(auth, "qr_codes.read") });
    return paginated(items, { nextCursor, limit });
  },
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "qr_codes.create",
    body: createQrSchema,
    branch: "body",
    rateLimit: RateLimits.write,
    audit: { action: "qr_code.create", entityType: "QrCode", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ auth, body }) => created(await createQrCode(body, auth)),
);
