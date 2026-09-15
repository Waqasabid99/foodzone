import { apiHandler, ok } from "@/lib/api";
import { listAttendanceSchema } from "@/server/validation/hr.schemas";
import { listAttendance } from "@/server/services/attendance.service";

export const GET = apiHandler(
  { auth: true, permissions: "attendance.read", query: listAttendanceSchema, branch: "query" },
  async ({ query }) => ok(await listAttendance(query)),
);
