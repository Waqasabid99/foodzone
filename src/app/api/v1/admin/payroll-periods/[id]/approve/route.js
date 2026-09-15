import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { approvePayroll } from "@/server/services/payroll.service";

/**
 * The commitment: locks the attendance the payslips were built from and posts
 * the wage bill to the ledger.
 *
 * Locking here rather than at generation is deliberate — freezing attendance
 * before anybody has agreed the numbers would block the very corrections
 * generation exists to pick up.
 */
export const POST = apiHandler(
  { auth: true, permissions: "payroll.approve", params: idParamSchema, rateLimit: RateLimits.write },
  async ({ params, auth }) => ok(await approvePayroll(params.id, auth)),
);
