import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";

/** Invoices as a list. Issuing and voiding stay on the order they belong to. */
export const listInvoicesSchema = z.object({
  branchId: cuidSchema.optional(),
  orderId: cuidSchema.optional(),
  search: z.string().trim().min(1).max(60).optional(),
  /** Omitted shows both; `false` is the usual filter, for the live ones. */
  voided: z.stringbool().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
