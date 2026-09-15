import { apiHandler, ok } from "@/lib/api";
import { listPeriodsSchema } from "@/server/validation/finance.schemas";
import { listPeriods } from "@/server/services/fiscal.service";

export const GET = apiHandler(
  { auth: true, permissions: "accounting_periods.read", query: listPeriodsSchema },
  async ({ query }) => ok(await listPeriods(query)),
);
