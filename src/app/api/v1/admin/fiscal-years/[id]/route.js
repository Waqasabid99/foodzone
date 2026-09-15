import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { getFiscalYear } from "@/server/services/fiscal.service";

export const GET = apiHandler(
  { auth: true, permissions: "accounting_periods.read", params: idParamSchema },
  async ({ params }) => ok(await getFiscalYear(params.id)),
);
