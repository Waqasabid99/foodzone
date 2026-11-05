import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { listInvoicesSchema } from "@/server/validation/invoice-admin.schemas";
import { listInvoices } from "@/server/services/invoice-admin.service";

/**
 * Which invoices went out, and which were voided.
 *
 * The rest of the invoice API hangs off an order, which is right for issuing
 * one and no use at all for finding one. Read-only: issuing and voiding stay
 * on the order, because both are things done to an order rather than to a
 * list.
 */
export const GET = apiHandler(
  { auth: true, permissions: "invoices.read", query: listInvoicesSchema, branch: "query" },
  async ({ query, auth }) => ok(await listInvoices({ ...query, scope: branchScope(auth, "invoices.read") })),
);
