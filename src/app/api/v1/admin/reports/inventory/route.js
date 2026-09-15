import { apiHandler, ok } from "@/lib/api";
import { inventoryReportSchema } from "@/server/validation/finance.schemas";
import { inventoryReport } from "@/server/services/operational-report.service";

/**
 * What is on hand and what it is worth, valued at average cost — the same
 * method the stock ledger uses, so this total and the Inventory account on the
 * balance sheet can be compared without an argument about method.
 */
export const GET = apiHandler(
  { auth: true, permissions: "reports.view_inventory", query: inventoryReportSchema, branch: "query" },
  async ({ query }) => ok(await inventoryReport(query)),
);
