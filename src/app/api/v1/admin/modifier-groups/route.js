import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createModifierGroupSchema } from "@/server/validation/catalog.schemas";
import { createModifierGroup, listModifierGroups } from "@/server/services/modifier.service";

const querySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  isActive: z.stringbool().optional(),
});

export const GET = apiHandler(
  { auth: true, permissions: "modifiers.read", query: querySchema },
  async ({ query }) => ok(await listModifierGroups(query)),
);

export const POST = apiHandler(
  {
    auth: true,
    permissions: "modifiers.create",
    body: createModifierGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_group.create", entityType: "ModifierGroup", entityId: ({ result }) => result?.id ?? null },
  },
  async ({ body }) => created(await createModifierGroup(body)),
);
