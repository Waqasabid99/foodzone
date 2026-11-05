import { z } from "zod";
import { nameSchema, phoneSchema } from "@/server/validation/schemas";
import { patchSchema } from "@/server/validation/patch";

/**
 * Customers: the people who order, whether or not they registered.
 *
 * Guests are addressed by the comparable form of their phone number — digits
 * only — because that is the only identifier a guest order leaves behind.
 */

export const customerQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  kind: z.enum(["ACCOUNT", "GUEST"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const customerExportQuerySchema = customerQuerySchema.omit({ limit: true, offset: true });

/**
 * What a staff member may change.
 *
 * Not the email address: it is how someone signs in and how a password reset
 * reaches them, so moving it is a verification flow rather than a text box.
 */
export const updateCustomerSchema = patchSchema(
  z.object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullish(),
    locale: z.string().trim().min(2).max(10).optional(),
  }),
);

export const customerStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().max(500).optional(),
});

export const guestParamSchema = z.object({ key: z.string().trim().regex(/^\d{4,10}$/, "Not a phone number") });
