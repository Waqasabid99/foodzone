import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";

/**
 * Finance request schemas.
 *
 * One rule shapes the whole module: **a request never states a balance.** A
 * journal entry says which accounts moved and by how much; whether it balances
 * is checked, never asserted. A bill says what the supplier charged; what is
 * outstanding is derived from the payments against it.
 *
 * Amounts are `Decimal(18,4)` throughout the ledger, so they are checked to
 * four places here rather than being silently rounded by Postgres — a
 * half-paisa that disappears on the way in is an entry that will not balance.
 */

const shortText = z.string().trim().min(1).max(160);
const longText = z.string().trim().max(2000);

export const amountSchema = z
  .number()
  .finite()
  .min(-999_999_999_999)
  .max(999_999_999_999)
  .refine((value) => Number.isInteger(Math.round(value * 10_000)), "Supports at most 4 decimal places");

export const positiveAmountSchema = amountSchema.refine((value) => value > 0, "Must be greater than zero");
export const nonNegativeAmountSchema = amountSchema.refine((value) => value >= 0, "Cannot be negative");

export const accountTypeSchema = z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]);
export const normalBalanceSchema = z.enum(["DEBIT", "CREDIT"]);

// --- chart of accounts ------------------------------------------------------

export const createAccountSchema = z.object({
  code: z.string().trim().regex(/^[0-9A-Za-z._-]{1,20}$/, "Use digits, letters, dots, dashes or underscores"),
  name: shortText,
  type: accountTypeSchema,
  subType: z.string().trim().max(60).nullish(),
  /** Defaulted from the type when omitted, which is nearly always right. */
  normalBalance: normalBalanceSchema.optional(),
  parentId: cuidSchema.nullish(),
  branchId: cuidSchema.nullish(),
  currency: z.string().trim().length(3).optional(),
  description: longText.nullish(),
  isActive: z.boolean().optional(),
});

export const updateAccountSchema = z
  .object({
    code: z.string().trim().regex(/^[0-9A-Za-z._-]{1,20}$/).optional(),
    name: shortText.optional(),
    type: accountTypeSchema.optional(),
    subType: z.string().trim().max(60).nullish(),
    normalBalance: normalBalanceSchema.optional(),
    parentId: cuidSchema.nullish(),
    currency: z.string().trim().length(3).optional(),
    description: longText.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listAccountsSchema = z.object({
  type: accountTypeSchema.optional(),
  isActive: z.stringbool().optional(),
  search: z.string().trim().max(120).optional(),
  branchId: cuidSchema.optional(),
});

export const setAccountActiveSchema = z.object({ isActive: z.boolean() });

export const accountLedgerSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

// --- fiscal calendar --------------------------------------------------------

export const createFiscalYearSchema = z.object({
  name: shortText,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

export const listPeriodsSchema = z.object({
  fiscalYearId: cuidSchema.optional(),
  status: z.enum(["OPEN", "CLOSED", "LOCKED"]).optional(),
});

export const reopenPeriodSchema = z.object({
  /** Required, because reopening a reported period is what an auditor asks about. */
  reason: z.string().trim().min(1).max(500),
});

// --- journal ----------------------------------------------------------------

export const journalLineSchema = z
  .object({
    accountId: cuidSchema.optional(),
    accountCode: z.string().trim().max(20).optional(),
    debit: nonNegativeAmountSchema.optional(),
    credit: nonNegativeAmountSchema.optional(),
    description: z.string().trim().max(500).nullish(),
    branchId: cuidSchema.nullish(),
    departmentId: cuidSchema.nullish(),
    partyType: z.enum(["SUPPLIER", "CUSTOMER", "EMPLOYEE", "DRIVER"]).nullish(),
    partyId: z.string().trim().max(40).nullish(),
    sortOrder: z.number().int().min(0).max(9999).optional(),
  })
  .refine((line) => Boolean(line.accountId) !== Boolean(line.accountCode), "Give exactly one of accountId or accountCode")
  .refine(
    (line) => Boolean(line.debit) !== Boolean(line.credit),
    "A line is a debit or a credit, not both and not neither",
  );

export const createJournalEntrySchema = z.object({
  branchId: cuidSchema.nullish(),
  entryDate: z.coerce.date().optional(),
  memo: longText.nullish(),
  currency: z.string().trim().length(3).optional(),
  /** Post straight away, rather than leaving it for a second pair of eyes. */
  post: z.boolean().optional(),
  lines: z.array(journalLineSchema).min(2).max(200),
});

export const listJournalEntriesSchema = z.object({
  branchId: cuidSchema.optional(),
  source: z
    .enum([
      "ORDER",
      "PAYMENT",
      "REFUND",
      "GOODS_RECEIPT",
      "SUPPLIER_BILL",
      "BILL_PAYMENT",
      "PRODUCTION",
      "STOCK_ADJUSTMENT",
      "WASTAGE",
      "PAYROLL",
      "DRIVER_PAYOUT",
      "EXPENSE",
      "CASH_SESSION",
      "MANUAL",
      "OPENING_BALANCE",
    ])
    .optional(),
  status: z.enum(["DRAFT", "POSTED", "VOID"]).optional(),
  periodId: cuidSchema.optional(),
  accountId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const reverseJournalEntrySchema = z.object({
  reason: z.string().trim().max(500).nullish(),
  /** Defaults to today. Back-dating is refused by the period guard if closed. */
  entryDate: z.coerce.date().nullish(),
});

export const voidJournalEntrySchema = z.object({ reason: z.string().trim().max(500).nullish() });

export const backfillSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

// --- supplier bills ---------------------------------------------------------

export const createSupplierBillSchema = z.object({
  supplierId: cuidSchema,
  branchId: cuidSchema,
  goodsReceiptId: cuidSchema.nullish(),
  supplierInvoiceNumber: z.string().trim().max(60).nullish(),
  billDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  currency: z.string().trim().length(3).optional(),
  subtotal: positiveAmountSchema,
  taxTotal: nonNegativeAmountSchema.optional(),
  /** Checked against subtotal + tax rather than trusted. */
  grandTotal: positiveAmountSchema.optional(),
  notes: longText.nullish(),
});

export const billFromReceiptSchema = z.object({
  supplierInvoiceNumber: z.string().trim().max(60).nullish(),
  billDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  notes: longText.nullish(),
});

export const recordBillPaymentSchema = z.object({
  amount: positiveAmountSchema,
  paidAt: z.coerce.date().optional(),
  accountId: cuidSchema.nullish(),
  method: z.enum(["BANK_TRANSFER", "CASH", "CHEQUE", "CARD", "OTHER"]).optional(),
  reference: z.string().trim().max(120).nullish(),
  notes: longText.nullish(),
});

export const listSupplierBillsSchema = z.object({
  branchId: cuidSchema.optional(),
  supplierId: cuidSchema.optional(),
  status: z
    .enum(["DRAFT", "AWAITING_APPROVAL", "APPROVED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])
    .optional(),
  overdueOnly: z.stringbool().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const cancelBillSchema = z.object({ reason: z.string().trim().max(500).nullish() });

export const ageingSchema = z.object({
  branchId: cuidSchema.optional(),
  supplierId: cuidSchema.optional(),
  asOf: z.coerce.date().optional(),
});

// --- expenses ---------------------------------------------------------------

export const expenseCategorySchema = z.object({
  name: shortText,
  accountId: cuidSchema.nullish(),
  isActive: z.boolean().optional(),
});

export const updateExpenseCategorySchema = expenseCategorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const createExpenseSchema = z.object({
  branchId: cuidSchema,
  categoryId: cuidSchema.nullish(),
  paidFromId: cuidSchema.nullish(),
  payee: z.string().trim().max(160).nullish(),
  description: longText.nullish(),
  amount: positiveAmountSchema,
  /** Part of `amount`, not additional to it. */
  taxAmount: nonNegativeAmountSchema.optional(),
  currency: z.string().trim().length(3).optional(),
  expenseDate: z.coerce.date().optional(),
  receiptUrl: z.url().max(2000).nullish(),
});

export const updateExpenseSchema = z
  .object({
    categoryId: cuidSchema.nullish(),
    paidFromId: cuidSchema.nullish(),
    payee: z.string().trim().max(160).nullish(),
    description: longText.nullish(),
    amount: positiveAmountSchema.optional(),
    taxAmount: nonNegativeAmountSchema.optional(),
    expenseDate: z.coerce.date().optional(),
    receiptUrl: z.url().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listExpensesSchema = z.object({
  branchId: cuidSchema.optional(),
  categoryId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const rejectExpenseSchema = z.object({ reason: z.string().trim().max(500).nullish() });

// --- reports ----------------------------------------------------------------

export const periodReportSchema = z.object({
  branchId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** A balance sheet is cumulative, so it takes a single date, never a range. */
export const asOfReportSchema = z.object({
  branchId: cuidSchema.optional(),
  asOf: z.coerce.date().optional(),
});

export const salesReportSchema = periodReportSchema.extend({
  groupBy: z.enum(["hour", "day", "month"]).optional(),
});

export const productMixSchema = periodReportSchema.extend({
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const inventoryReportSchema = z.object({ branchId: cuidSchema.optional() });

export const expenseSummarySchema = periodReportSchema;
