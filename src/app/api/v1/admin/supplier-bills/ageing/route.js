import { apiHandler, ok } from "@/lib/api";
import { ageingSchema } from "@/server/validation/finance.schemas";
import { payablesAgeing } from "@/server/services/supplier-bill.service";
import { branchScope } from "@/lib/api/permissions";

/**
 * What is owed, to whom, and how late.
 *
 * `asOf` is explicit rather than always "now": an ageing at a month end and one
 * today give different answers for the same invoices, and quoting one as the
 * other is how a supplier gets chased for something not yet due.
 */
export const GET = apiHandler(
  { auth: true, permissions: "supplier_bills.read", query: ageingSchema, branch: "query" },
  async ({ query, auth }) => ok(await payablesAgeing({ ...query, scope: branchScope(auth, "supplier_bills.read") })),
);
