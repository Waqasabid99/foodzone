import { apiHandler, paginated } from "@/lib/api";
import { auditQuerySchema } from "@/server/validation/schemas";
import { listAuditLogs } from "@/server/services/audit.service";

export const GET = apiHandler(
  { auth: true, permissions: "audit_logs.read", query: auditQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listAuditLogs(query);
    return paginated(items, { nextCursor, limit });
  },
);
