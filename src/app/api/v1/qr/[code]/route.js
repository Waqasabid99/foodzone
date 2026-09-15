import { after } from "next/server";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { qrCodeParamSchema, scanQuerySchema } from "@/server/validation/dinein.schemas";
import { recordScan, resolveQrTarget } from "@/server/services/qr.service";
import { optionalAuth } from "@/lib/api/auth";
import { logger } from "@/lib/logger";

/**
 * What a scanned QR code resolves to. No authentication — this is a stranger
 * with a phone camera, standing at a table.
 *
 * `/m/{code}` is the printed URL; the web page and the app both call this
 * endpoint to find out what to render. Keeping the printed URL free of ids is
 * what lets a sticker outlive the menu it was created for.
 *
 * The scan is recorded in `after()`, so the insert and the counter update run
 * once the response has already been sent. A QR scan is the one read that
 * genuinely has to write — the camera opens a URL and nothing else ever happens
 * — but a hungry customer should not wait for the analytics.
 */
export const GET = apiHandler(
  {
    params: qrCodeParamSchema,
    query: scanQuerySchema,
    rateLimit: RateLimits.public,
    scope: "qr:scan",
  },
  async ({ params, query, request, ipAddress, userAgent }) => {
    const target = await resolveQrTarget(params.code, { includeUnavailable: query.includeUnavailable });

    // Signed in when the app scans, anonymous from a browser. Either is fine;
    // the session id is what makes repeat scans countable without a login.
    const principal = await optionalAuth(request);

    after(async () => {
      try {
        await recordScan({
          qrCodeId: target.qrCodeId,
          sessionId: query.sessionId,
          userId: principal?.userId ?? null,
          ipAddress,
          userAgent,
        });
      } catch (error) {
        // A failed analytics write must never turn into a failed scan; the
        // customer already has their menu.
        logger.warn("failed to record qr scan", { qrCodeId: target.qrCodeId, error: error.message });
      }
    });

    return ok(target);
  },
);
