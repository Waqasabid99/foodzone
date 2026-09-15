import { apiHandler, ok, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { storeLocalUpload } from "@/server/services/media.service";
import { uploadPolicies } from "@/server/storage/policy";
import { verifyUploadTicket } from "@/lib/api/tokens";

/**
 * The local driver's upload endpoint.
 *
 * Unauthenticated by design: the signed ticket in the path *is* the
 * authorisation, exactly as a presigned S3 URL is. It names the storage key, so
 * a caller cannot redirect the write anywhere else, and it expires.
 *
 * Only reachable when STORAGE_DRIVER=local; the other drivers accept bytes
 * directly and never route them through here.
 */
export const PUT = apiHandler({ rateLimit: { limit: 30, windowMs: 60_000 }, scope: "media:local-upload" }, async ({ request, params }) => {
  if (env().STORAGE_DRIVER !== "local") throw ApiError.notFound();

  const ticket = decodeURIComponent(params.ticket ?? "");
  const claims = verifyUploadTicket(ticket);
  if (!claims) throw ApiError.validation("That upload ticket is invalid or has expired");

  // Reject on the declared length before reading the body, so an oversized
  // upload does not have to be buffered first.
  const declared = Number(request.headers.get("content-length") ?? 0);
  const maxBytes = uploadPolicies()[claims.kind].maxBytes;
  if (declared > maxBytes) throw ApiError.tooLarge("The uploaded file exceeds the size limit");

  const buffer = Buffer.from(await request.arrayBuffer());
  return ok(await storeLocalUpload({ ticket, buffer }));
});
