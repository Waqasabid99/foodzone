import { apiHandler, created, RateLimits } from "@/lib/api";
import { requestUploadSchema } from "@/server/validation/schemas";
import { requestUpload } from "@/server/services/media.service";

/**
 * Step 1 of an upload: returns a signed target plus the compression the client
 * must apply first. The response shape is provider-agnostic — `upload.method`,
 * `upload.url`, and either `upload.fields` (multipart POST) or `upload.headers`
 * (PUT) — so one client implementation works across Cloudinary, S3/R2 and local.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "media.upload",
    body: requestUploadSchema,
    rateLimit: RateLimits.upload,
    scope: "media:request-upload",
  },
  async ({ auth, body }) => created(await requestUpload({ principal: auth, ...body })),
);
