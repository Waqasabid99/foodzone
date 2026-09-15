import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createTransferSchema, listTransfersSchema } from "@/server/validation/inventory.schemas";
import { createTransfer, listTransfers } from "@/server/services/stock-transfer.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_transfers.read", query: listTransfersSchema, branch: "query" },
  async ({ query }) => ok(await listTransfers(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "stock_transfers.create",
    body: createTransferSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createTransfer(body, auth)),
);
