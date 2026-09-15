import { apiHandler, ok } from "@/lib/api";
import { listPunchesSchema } from "@/server/validation/hr.schemas";
import { unmatchedPunches } from "@/server/services/punch.service";

/**
 * Punches for a biometric id nobody is enrolled to.
 *
 * The queue HR has to work: every row is somebody whose attendance is being
 * recorded and not counted. Kept rather than dropped, because discarding them
 * loses real attendance nobody can recover.
 */
export const GET = apiHandler(
  { auth: true, permissions: "attendance_punches.read", query: listPunchesSchema, branch: "query" },
  async ({ query }) => ok(await unmatchedPunches(query)),
);
