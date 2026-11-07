import { z } from "zod";
import { emailSchema, nameSchema, passwordSchema } from "@/server/validation/schemas";

/**
 * What a brand-new installation needs before anybody can sign in.
 *
 * Exactly two things: somebody to own it, and one outlet for the work to
 * belong to. Everything else — menus, staff, stock, the fiscal calendar — is
 * either seeded already or created from inside the system afterwards.
 *
 * The defaults are Pakistan's, because that is where this runs. They are
 * defaults and not constants: a client in another country changes them on the
 * form, and the branch's timezone is what every shift, attendance window and
 * opening-hours calculation is read in, so it is worth getting right on day
 * one rather than discovering it through a payroll run.
 */
export const bootstrapSchema = z.object({
  owner: z.object({
    name: nameSchema,
    email: emailSchema,
    password: passwordSchema,
  }),
  branch: z.object({
    // Upper-cased here as it is everywhere else. Setup must not be the one
    // place in the system that creates a lower-case branch code.
    code: z
      .string()
      .trim()
      .min(2)
      .max(20)
      .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
      .transform((value) => value.toUpperCase()),
    name: z.string().trim().min(2).max(80),
    city: z.string().trim().max(80).nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    timezone: z.string().trim().min(1).max(60).default("Asia/Karachi"),
    currency: z.string().trim().length(3).toUpperCase().default("PKR"),
  }),
});
