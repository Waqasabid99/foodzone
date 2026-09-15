import { z } from "zod";
import { apiHandler, ok } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { reorderReport } from "@/server/services/stock.service";

const querySchema = z.object({ branchId: cuidSchema });

/** Items at or below their reorder level — the purchasing to-do list. */
export const GET = apiHandler(
  { auth: true, permissions: "stock.read", query: querySchema, branch: "query" },
  async ({ query }) => ok(await reorderReport(query)),
);
