import { apiHandler, branchScope, ok } from "@/lib/api";
import { listPunchesSchema } from "@/server/validation/hr.schemas";
import { listPunches } from "@/server/services/punch.service";

/** Raw and append-only. A correction is a manual punch, never an edit. */
export const GET = apiHandler(
  { auth: true, permissions: "attendance_punches.read", query: listPunchesSchema, branch: "query" },
  async ({ query, auth }) => ok(await listPunches({ ...query, scope: branchScope(auth, "attendance_punches.read") })),
);
