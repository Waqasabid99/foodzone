import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createGoodsReceiptSchema, listGoodsReceiptsSchema } from "@/server/validation/inventory.schemas";
import { createGoodsReceipt, listGoodsReceipts } from "@/server/services/goods-receipt.service";
import { branchScope } from "@/lib/api/permissions";
import { assertRecordAccess } from "@/server/purchasing/access";

export const GET = apiHandler(
  { auth: true, permissions: "goods_receipts.read", query: listGoodsReceiptsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listGoodsReceipts({ ...query, scope: branchScope(auth, "goods_receipts.read") })),
);

/**
 * Records a delivery as a draft. Nothing moves until it is posted.
 *
 * Over-receipt against a purchase order is refused: a delivery larger than the
 * order is either a supplier error or a keying error, and accepting it silently
 * creates a payable nobody approved.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "goods_receipts.create",
    body: createGoodsReceiptSchema,
    rateLimit: RateLimits.write,
    audit: { action: "goods_receipt.create", entityType: "GoodsReceipt", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body, auth }) => {
    // The branch comes from the location the stock lands in, so the caller's
    // right to receive there is checked against that rather than a body field.
    await assertRecordAccess(auth, "stockLocation", body.locationId, "goods_receipts.create");
    return created(await createGoodsReceipt(body, auth));
  },
);
