import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { CATEGORY_KEYS } from "@/server/notifications/categories";
import { listPreferences, savePreferences } from "@/server/notifications/preferences";

/**
 * What this person wants to be told about.
 *
 * Returns every category rather than only the ones they have touched, with
 * `canMuteInApp` saying which switches are real. A screen should never have to
 * infer what is adjustable from a rule it has reimplemented — and a switch
 * that renders but does nothing is the fastest way to make somebody believe
 * the whole feature is broken.
 */
export const GET = apiHandler(
  {
    auth: true,
    permissions: "self.manage_notifications",
    doc: {
      summary: "List my notification preferences",
      tag: "Notifications",
      description:
        "Every category, this person's effective answer, and whether the in-app record may be silenced. " +
        "Transactional categories may have their push switched off but not their record.",
    },
  },
  async ({ auth }) => ok(await listPreferences(auth)),
);

/**
 * Saves a subset.
 *
 * A partial object on purpose: a customer's screen never shows the staff
 * category, and submitting only what it knows about must not wipe the rest.
 * Every key is validated against the registry, so a client cannot invent a
 * category by posting a string.
 */
const bodySchema = z.object({
  /*
   * `partialRecord`, not `record`. In Zod 4 a record with an enum key type is
   * **exhaustive** — every member of the enum becomes required — so `record`
   * here rejected every partial save with "expected object, received
   * undefined" for each category the client had not mentioned, which is the
   * whole point of accepting a subset.
   */
  categories: z
    .partialRecord(
      z.enum(CATEGORY_KEYS),
      z.object({ inApp: z.boolean().optional(), push: z.boolean().optional() }),
    )
    .refine((value) => Object.keys(value).length > 0, { message: "Name at least one category" }),
});

export const PUT = apiHandler(
  {
    auth: true,
    permissions: "self.manage_notifications",
    body: bodySchema,
    rateLimit: RateLimits.write,
    audit: { action: "notification_preferences.update", entityType: "NotificationPreference" },
    doc: {
      summary: "Update my notification preferences",
      tag: "Notifications",
      description:
        "Only the categories named are changed. Switching off the in-app record of a transactional " +
        "category is refused rather than silently ignored.",
    },
  },
  async ({ auth, body }) => ok(await savePreferences({ principal: auth, categories: body.categories })),
);
