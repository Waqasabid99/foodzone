import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
import { listAuditActions } from "@/server/services/audit.service";

/** Distinct action names, for the filter dropdown. */
export const GET = apiHandler({ auth: true, permissions: "audit_logs.read" }, async ({ auth }) =>
  ok(await listAuditActions({ scope: branchScope(auth, "audit_logs.read") })),
);
