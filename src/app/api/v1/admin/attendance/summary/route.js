import { apiHandler, ok } from "@/lib/api";
import { attendanceSummarySchema } from "@/server/validation/hr.schemas";
import { attendanceSummary } from "@/server/services/attendance.service";

/** The month as payroll will read it, per employee. */
export const GET = apiHandler(
  { auth: true, permissions: "attendance.read", query: attendanceSummarySchema, branch: "query" },
  async ({ query }) => ok(await attendanceSummary(query)),
);
