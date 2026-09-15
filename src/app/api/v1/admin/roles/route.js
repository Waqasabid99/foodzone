import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { createRoleSchema } from "@/server/validation/schemas";
import { createRole, listRoles } from "@/server/services/role.service";

const listQuerySchema = z.object({
  includeSystem: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .default("true"),
});

export const GET = apiHandler(
  { auth: true, permissions: "roles.read", query: listQuerySchema },
  async ({ query }) => ok(await listRoles(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "roles.create",
    body: createRoleSchema,
    rateLimit: RateLimits.write,
    audit: { action: "role.create", entityType: "Role" },
  },
  async ({ auth, body }) => created(await createRole(body, auth)),
);
