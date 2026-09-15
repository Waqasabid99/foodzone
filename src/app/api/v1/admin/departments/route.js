import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createDepartmentSchema } from "@/server/validation/hr.schemas";
import { createDepartment, listDepartments } from "@/server/services/employee.service";

const querySchema = z.object({ isActive: z.stringbool().optional() });

export const GET = apiHandler(
  { auth: true, permissions: "departments.read", query: querySchema },
  async ({ query }) => ok(await listDepartments(query)),
);

export const POST = apiHandler(
  { auth: true, permissions: "departments.manage", body: createDepartmentSchema, rateLimit: RateLimits.write },
  async ({ body, auth }) => created(await createDepartment(body, auth)),
);
