import { apiHandler, created, RateLimits } from "@/lib/api";
import { confirmUploadSchema } from "@/server/validation/schemas";
import { confirmUpload } from "@/server/services/media.service";

/**
 * Step 3: verifies the object really landed, at a size within the limit, and
 * records it. Safe to retry — confirming an already-recorded upload returns the
 * existing asset rather than failing.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "media.upload",
    body: confirmUploadSchema,
    rateLimit: RateLimits.upload,
    scope: "media:confirm-upload",
  },
  async ({ auth, body }) => created(await confirmUpload({ principal: auth, ticket: body.ticket })),
);
