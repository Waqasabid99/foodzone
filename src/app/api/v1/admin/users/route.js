import { apiHandler, created, paginated, RateLimits } from "@/lib/api";
import { createUserSchema, listUsersQuerySchema } from "@/server/validation/schemas";
import { createUser, listUsers } from "@/server/services/user.service";

export const GET = apiHandler(
  { auth: true, permissions: "users.read", query: listUsersQuerySchema },
  async ({ query }) => {
    const { items, nextCursor, limit } = await listUsers(query);
    return paginated(items, { nextCursor, limit });
  },
);

/** Creates a staff account and emails the invitation. No password is set here. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "users.create",
    body: createUserSchema,
    rateLimit: RateLimits.write,
    audit: { action: "user.create", entityType: "User" },
  },
  async ({ auth, body }) => created(await createUser(body, auth)),
);
