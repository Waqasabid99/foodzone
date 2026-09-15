import { apiHandler, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { qrImageQuerySchema } from "@/server/validation/dinein.schemas";
import { assertQrAccess, renderQrAsset } from "@/server/services/qr.service";

/**
 * The printable asset. Returns the image itself, not the envelope — this URL is
 * meant to be opened, saved and dropped into a print layout.
 *
 * SVG by default: a sticker is printed, and vector stays sharp at any size.
 */
export const GET = apiHandler(
  { auth: true, permissions: "qr_codes.print", params: idParamSchema, query: qrImageQuerySchema, rateLimit: RateLimits.read },
  async ({ auth, params, query }) => {
    await assertQrAccess(auth, params.id, "qr_codes.print");

    const asset = await renderQrAsset({
      id: params.id,
      format: query.format,
      size: query.size,
      markPrinted: query.markPrinted,
    });

    return new Response(asset.body, {
      headers: {
        "content-type": asset.contentType,
        "content-disposition": `inline; filename="${asset.filename}"`,
        // The code never changes, so the render never changes.
        "cache-control": "private, max-age=3600",
        "x-qr-url": asset.url,
      },
    });
  },
);
