import { apiHandler, branchScope, ok } from "@/lib/api";
import { stockQuerySchema } from "@/server/validation/inventory.schemas";
import { stockOnHand } from "@/server/services/stock.service";

export const GET = apiHandler(
  { auth: true, permissions: "stock.read", query: stockQuerySchema, branch: "query" },
  async ({ query, auth }) => ok(await stockOnHand({ ...query, scope: branchScope(auth, "stock.read") })),
);
