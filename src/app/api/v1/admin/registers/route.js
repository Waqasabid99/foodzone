import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { listSessionsSchema, openSessionSchema } from "@/server/validation/payment.schemas";
import { listSessions, openSession } from "@/server/services/register.service";

export const GET = apiHandler(
  { auth: true, permissions: "cash_registers.read", query: listSessionsSchema, branch: "query" },
  async ({ query, auth }) => ok(await listSessions({ ...query, scope: branchScope(auth, "cash_registers.read") })),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "cash_registers.open",
    body: openSessionSchema,
    branch: "body",
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await openSession({ ...body, actor: auth })),
);
