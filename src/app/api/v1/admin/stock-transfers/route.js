import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess } from "@/server/inventory/access";
import { createTransferSchema, listTransfersSchema } from "@/server/validation/inventory.schemas";
import { createTransfer, listTransfers } from "@/server/services/stock-transfer.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", query: listTransfersSchema, branch: "query" },
  async ({ query, auth }) => ok(await listTransfers({ ...query, scope: branchScope(auth, "stock_transfers.read") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_transfers.create",
    body: createTransferSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    // Raised by the side that holds the stock. The destination may be any
    // branch — sending to another outlet is the point of a transfer.
    await assertRecordAccess(auth, "location", body.fromLocationId, "stock_transfers.create");
    return created(await createTransfer(body, auth));
  },
);
