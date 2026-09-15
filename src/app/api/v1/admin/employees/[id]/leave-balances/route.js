import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { balancesQuerySchema } from "@/server/validation/hr.schemas";
import { leaveBalances } from "@/server/services/leave.service";

export const GET = apiHandler(
  { auth: true, permissions: "leave_requests.read", params: idParamSchema, query: balancesQuerySchema },
  async ({ params, query }) => ok(await leaveBalances({ employeeId: params.id, year: query.year })),
);
