import { ApiError, fail, ErrorCode } from "@/lib/api";
import { env } from "@/lib/env";
import { storage } from "@/server/storage";
import { getAssetByStorageKey } from "@/server/services/media.service";
import { logger } from "@/lib/logger";

/**
 * Serves files held by the local driver.
 *
 * Public: these are product photos and receipts referenced by URL from both
 * clients, and adding auth here would break every <img> tag. Object keys are
 * random, so a key is not guessable. Anything genuinely private should not live
 * on the local driver.
 *
 * Written without `apiHandler` because the response is a file, not the JSON
 * envelope. `apiDoc` therefore states for the OpenAPI generator what the
 * options would otherwise have said.
 */
export const apiDoc = {
  GET: {
    doc: {
      summary: "Download a locally stored file",
      description:
        "Serves an uploaded object when `STORAGE_DRIVER=local`. Returns the file itself, not the JSON envelope. " +
        "Public by design: these URLs are referenced from `<img>` tags in both clients, and object keys are random " +
        "rather than guessable. Responds 404 on any other storage driver.",
    },
  },
};

export async function GET(_request, context) {
  try {
    if (env().STORAGE_DRIVER !== "local") throw ApiError.notFound();

    const { key } = await context.params;
    const storageKey = Array.isArray(key) ? key.join("/") : String(key);

    const driver = await storage();
    const stat = await driver.statObject({ storageKey });
    if (!stat.exists) throw ApiError.notFound("File not found");

    const asset = await getAssetByStorageKey(storageKey);
    const body = await driver.readObject({ storageKey });

    return new Response(body, {
      headers: {
        "content-type": asset?.mimeType ?? "application/octet-stream",
        "content-length": String(stat.sizeBytes),
        // Keys are immutable, so the content behind one never changes.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return fail(error.code, error.message);
    logger.error("failed to serve a local file", { error: error.message });
    return fail(ErrorCode.INTERNAL_ERROR, "Something went wrong");
  }
}
