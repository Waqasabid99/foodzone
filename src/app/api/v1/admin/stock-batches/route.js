import { apiHandler, ok } from "@/lib/api";
import { batchQuerySchema } from "@/server/validation/inventory.schemas";
import { listBatches } from "@/server/services/stock.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock_batches.read", query: batchQuerySchema, branch: "query" },
  async ({ query }) => ok(await listBatches(query)),
);
