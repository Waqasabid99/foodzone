import { apiHandler, paginated } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { auditQuerySchema } from "@/server/validation/schemas";
import { listAuditLogs } from "@/server/services/audit.service";

export const GET = apiHandler(
  { auth: true, permissions: "audit_logs.read", query: auditQuerySchema },
  async ({ query, auth }) => {
    const { items, nextCursor, limit } = await listAuditLogs({ ...query, scope: branchScope(auth, "audit_logs.read") });
    return paginated(items, { nextCursor, limit });
  },
);
