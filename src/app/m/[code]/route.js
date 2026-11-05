import { NextResponse } from "next/server";
import { after } from "next/server";
import { BRANCH_COOKIE } from "@/lib/branch";
import { ORDER_TYPE_COOKIE } from "@/lib/order-type";
import { TABLE_COOKIE, TABLE_COOKIE_MAX_AGE } from "@/lib/table-context";
import { isProduction } from "@/lib/env";
import { logger } from "@/lib/logger";
import { recordScan, resolveQrTarget } from "@/server/services/qr.service";

/**
 * Where a scanned QR code actually lands.
 *
 * This is the printed URL — the thing on the sticker — so it is a redirect
 * rather than a page. Somebody is standing at a table holding a phone: the
 * fastest correct thing is to work out where they should be, remember which
 * outlet they are in, and send them there.
 *
 * Keeping it free of ids is the whole design. `/m/Q5GHBECC` can outlive the
 * menu it was created for, because what it resolves to is looked up every
 * time.
 *
 * The scan is recorded in `after()`, so the insert and the counter update
 * happen once the redirect has already been sent. A QR scan is the one read
 * that genuinely has to write, but a hungry customer should not wait for
 * analytics — and a failed analytics write must never become a failed scan.
 */
export async function GET(request, { params }) {
  const { code } = await params;
  const origin = request.nextUrl.origin;

  const target = await resolveQrTarget(code).catch(() => null);

  // An unknown, switched-off or deleted code is not an error page. The sticker
  // may be a year old and the person reading it just wants food, so they get
  // the menu with a word about why they are not where they expected.
  if (!target) {
    return NextResponse.redirect(new URL("/menu?scan=unknown", origin), { status: 307 });
  }

  // A custom code points off-platform by design — a feedback form, a social
  // profile. The create form restricts these to http(s), so nothing here can
  // send a customer's phone to another scheme.
  if (target.targetType === "CUSTOM_URL" && target.redirectUrl) {
    const response = NextResponse.redirect(target.redirectUrl, { status: 307 });
    recordAfter(target, request);
    return response;
  }

  const destination = new URL(landingPath(target), origin);
  if (target.targetUnavailable) destination.searchParams.set("scan", "moved");

  const response = NextResponse.redirect(destination, { status: 307 });
  const base = { secure: isProduction(), sameSite: "lax", path: "/" };

  // The branch is remembered the way choosing it by hand would be: the menu,
  // the product pages and the basket all read this cookie, and a scan is a
  // statement about which outlet the customer is standing in.
  if (target.branch?.id) {
    response.cookies.set(BRANCH_COOKIE, target.branch.id, { ...base, maxAge: 60 * 60 * 24 * 365 });
  }

  if (target.table?.id) {
    // A table code says where they are sitting, so the order can arrive tagged
    // to the table rather than being carried to a counter.
    response.cookies.set(TABLE_COOKIE, target.table.id, { ...base, maxAge: TABLE_COOKIE_MAX_AGE });
    response.cookies.set(ORDER_TYPE_COOKIE, "DINE_IN", { ...base, maxAge: TABLE_COOKIE_MAX_AGE });
  } else {
    // A menu or category sticker is not a seat. Clearing any table left over
    // from an earlier visit stops tonight's delivery arriving labelled
    // "table 4" from last week.
    response.cookies.set(TABLE_COOKIE, "", { ...base, maxAge: 0 });
  }

  recordAfter(target, request);
  return response;
}

/** Where the code sends somebody, once it is known to be valid. */
function landingPath(target) {
  if (target.targetType === "PRODUCT" && target.product?.slug) return `/menu/${target.product.slug}`;
  if (target.targetType === "CATEGORY" && target.category?.name) {
    return `/menu?category=${encodeURIComponent(target.category.name)}`;
  }
  return "/menu";
}

function recordAfter(target, request) {
  after(async () => {
    try {
      await recordScan({
        qrCodeId: target.qrCodeId,
        sessionId: null,
        userId: null,
        ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        userAgent: request.headers.get("user-agent") ?? null,
      });
    } catch (error) {
      logger.warn("failed to record qr scan", { code: target.code, error: error.message });
    }
  });
}
