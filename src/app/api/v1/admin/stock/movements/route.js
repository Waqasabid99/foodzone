import { apiHandler, ok } from "@/lib/api";
import { movementQuerySchema } from "@/server/validation/inventory.schemas";
import { listMovements } from "@/server/services/stock.service";

/** The append-only ledger — the truth every cached level is derived from. */
export const GET = apiHandler(
  { auth: true, permissions: "stock_movements.read", query: movementQuerySchema, branch: "query" },
  async ({ query }) => ok(await listMovements(query)),
);
