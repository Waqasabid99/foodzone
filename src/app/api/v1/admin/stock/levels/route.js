import { apiHandler, ok } from "@/lib/api";
import { stockQuerySchema } from "@/server/validation/inventory.schemas";
import { stockOnHand } from "@/server/services/stock.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock.read", query: stockQuerySchema, branch: "query" },
  async ({ query }) => ok(await stockOnHand(query)),
);
