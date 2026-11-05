import { z } from "zod";
import { patchSchema } from "@/server/validation/patch";

/**
 * Request schemas.
 *
 * Validation is the API's outer boundary: anything past it is trusted, so the
 * rules here are strict rather than forgiving. Messages are user-facing and are
 * returned per field in `error.details`.
 */

/** Which client is calling. Accepted in any case; normalised to the enum. */
export const clientSchema = z
  .enum(["WEB", "IOS", "ANDROID", "POS", "KIOSK", "web", "ios", "android", "pos", "kiosk"])
  .transform((value) => value.toUpperCase())
  .default("WEB");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .pipe(z.email("Enter a valid email address"));

/**
 * Length over composition rules: forced symbols and digits push people toward
 * `Password1!`, while length is what actually resists cracking. 10 characters
 * minimum, and the maximum exists because bcrypt silently ignores input past
 * 72 bytes — accepting more would create passwords whose tail does nothing.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be at most 72 characters")
  .refine((value) => value.trim().length > 0, "Password cannot be blank");

export const nameSchema = z.string().trim().min(2, "Name must be at least 2 characters").max(80);

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a valid phone number")
  .max(20)
  .regex(/^[+]?[\d\s()-]+$/, "Enter a valid phone number");

export const otpSchema = z
  .string()
  .trim()
  .regex(/^\d{4,10}$/, "Enter the code from your email");

export const cuidSchema = z.string().min(1).max(64);

// --- auth -----------------------------------------------------------------

export const registerSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
  client: clientSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required").max(72),
  client: clientSchema,
});

export const refreshSchema = z.object({
  // Absent for web callers, which send the token as a cookie instead.
  refreshToken: z.string().min(1).optional(),
  client: clientSchema,
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
  allDevices: z.boolean().default(false),
});

export const verifyEmailSchema = z.object({ code: otpSchema });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: otpSchema,
  password: passwordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Your current password is required").max(72),
    newPassword: passwordSchema,
    client: clientSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "Choose a password you have not used before",
    path: ["newPassword"],
  });

export const acceptInvitationSchema = z.object({
  email: emailSchema,
  code: otpSchema,
  password: passwordSchema,
  client: clientSchema,
});

// --- profile & addresses ---------------------------------------------------

export const updateProfileSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    locale: z.string().trim().min(2).max(10).optional(),
    avatarUrl: z.url("Enter a valid URL").nullable().optional(),
    /** "" clears it back to "decide from what I do here". */
    homePage: z.enum(["overview", "kitchen", ""]).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Nothing to update");

export const addressSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(40).default("Home"),
  recipientName: z.string().trim().min(2).max(80).nullable().optional(),
  phone: phoneSchema,
  line1: z.string().trim().min(4, "Street address is required").max(200),
  line2: z.string().trim().max(200).nullable().optional(),
  landmark: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(1, "City is required").max(80),
  state: z.string().trim().min(1, "State is required").max(80),
  postalCode: z.string().trim().min(3, "Postal code is required").max(12),
  country: z.string().trim().length(2, "Use a 2-letter country code").toUpperCase().default("PK"),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  deliveryNote: z.string().trim().max(300).nullable().optional(),
  isDefault: z.boolean().default(false),
});

export const updateAddressSchema = patchSchema(addressSchema, { message: "Nothing to update" });

// --- user administration ---------------------------------------------------

export const userStatusSchema = z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED", "DEACTIVATED"]);

export const listUsersQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  status: userStatusSchema.optional(),
  roleKey: z.string().trim().min(1).max(60).optional(),
  branchId: cuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const createUserSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema.optional(),
  roleIds: z.array(cuidSchema).min(1, "Assign at least one role").max(10),
  branchId: cuidSchema.nullable().optional(),
});

export const updateUserSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    locale: z.string().trim().min(2).max(10).optional(),
    avatarUrl: z.url().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Nothing to update");

export const setUserStatusSchema = z.object({
  // PENDING_VERIFICATION is not settable by hand: it is a lifecycle state, not
  // an administrative action.
  status: z.enum(["ACTIVE", "SUSPENDED", "DEACTIVATED"]),
  reason: z.string().trim().max(300).optional(),
});

// --- roles & permissions ---------------------------------------------------

export const roleScopeSchema = z.enum(["GLOBAL", "BRANCH"]);

export const createRoleSchema = z.object({
  name: z.string().trim().min(3, "Role name must be at least 3 characters").max(60),
  description: z.string().trim().max(300).nullable().optional(),
  scope: roleScopeSchema.default("BRANCH"),
  level: z.coerce.number().int().min(0).max(1000).optional(),
  permissionKeys: z.array(z.string().min(1)).max(500).default([]),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(3).max(60).optional(),
    description: z.string().trim().max(300).nullable().optional(),
    scope: roleScopeSchema.optional(),
    level: z.coerce.number().int().min(0).max(1000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, "Nothing to update");

export const setRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().min(1)).max(500),
});

export const assignRoleSchema = z.object({
  roleId: cuidSchema,
  branchId: cuidSchema.nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const setOverrideSchema = z.object({
  permissionKey: z.string().min(1).max(120),
  effect: z.enum(["ALLOW", "DENY"]).default("ALLOW"),
  branchId: cuidSchema.nullable().optional(),
  reason: z.string().trim().max(300).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

// --- branches ---------------------------------------------------------------

/** Rejects an unknown IANA zone before it can silently break opening hours. */
const timezoneSchema = z
  .string()
  .trim()
  .min(3)
  .max(60)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Not a valid IANA timezone, e.g. Asia/Karachi");

export const createBranchSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only")
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(2).max(80),
  legalName: z.string().trim().max(120).nullable().optional(),
  taxIdentifier: z.string().trim().max(40).nullable().optional(),
  phone: phoneSchema.nullable().optional(),
  email: emailSchema.nullable().optional(),
  addressLine1: z.string().trim().max(200).nullable().optional(),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  state: z.string().trim().max(80).nullable().optional(),
  country: z.string().trim().length(2).toUpperCase().default("PK"),
  postalCode: z.string().trim().max(12).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  timezone: timezoneSchema.default("Asia/Karachi"),
  currency: z.string().trim().length(3).toUpperCase().default("PKR"),
  deliveryRadiusKm: z.coerce.number().min(0).max(200).nullable().optional(),
  isActive: z.boolean().default(true),
  openedAt: z.coerce.date().nullable().optional(),
});

export const updateBranchSchema = patchSchema(createBranchSchema, { message: "Nothing to update" });

/**
 * A `?flag=true` query parameter, as a real boolean.
 *
 * **`.default("false")` after a transform does not do what it looks like.** The
 * default is the *input* default, so an absent parameter came back as the
 * string `"false"` — which is truthy, so every one of these flags was
 * permanently on. It is why `/me/notifications` only ever returned unread ones
 * and an inbox emptied itself the moment you read it.
 *
 * Optional first, transform second: absent becomes `undefined`, and
 * `undefined === "true"` is `false`, which is a boolean.
 */
const booleanFlag = z
  .enum(["true", "false"])
  .optional()
  .transform((value) => value === "true");

export const branchQuerySchema = z.object({
  search: z.string().trim().min(1).max(100).optional(),
  isActive: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  includeState: booleanFlag,
  channel: z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const branchHoursSchema = z.object({
  hours: z
    .array(
      z.object({
        dayOfWeek: z.coerce.number().int().min(0).max(6),
        opensAt: z.coerce.number().int().min(0).max(1439),
        // Past 1440 expresses a window that runs into the next day.
        closesAt: z.coerce.number().int().min(1).max(2879),
        channel: z.enum(["WEB", "MOBILE_APP", "QR", "POS", "PHONE", "AGGREGATOR"]).nullable().optional(),
      }),
    )
    .max(50),
});

export const closureSchema = z.object({
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  reason: z.string().trim().max(200).nullable().optional(),
});

// --- settings ---------------------------------------------------------------

export const settingsQuerySchema = z.object({ branchId: cuidSchema.optional() });

export const updateSettingsSchema = z.object({
  branchId: cuidSchema.nullable().optional(),
  // Values are validated individually against the registry schema for each key.
  values: z.record(z.string(), z.unknown()),
});

// --- notifications & devices ------------------------------------------------

export const notificationQuerySchema = z.object({
  unreadOnly: booleanFlag,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

export const markReadSchema = z.object({
  // Omit `ids` to mark everything read.
  ids: z.array(cuidSchema).max(200).optional(),
});

export const registerDeviceSchema = z.object({
  pushToken: z.string().trim().min(10).max(200),
  platform: z.enum(["WEB", "IOS", "ANDROID", "POS", "KIOSK"]).default("ANDROID"),
  deviceName: z.string().trim().max(80).nullable().optional(),
  appVersion: z.string().trim().max(20).nullable().optional(),
});

export const sendNotificationSchema = z
  .object({
    userIds: z.array(cuidSchema).max(500).optional(),
    roleKey: z.string().trim().min(1).max(60).optional(),
    branchId: cuidSchema.nullable().optional(),
    type: z.string().trim().min(1).max(60).default("admin.message"),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(500).nullable().optional(),
    data: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .refine((value) => value.userIds?.length || value.roleKey, "Name either userIds or a roleKey");

// --- media -----------------------------------------------------------------

export const requestUploadSchema = z.object({
  mimeType: z.string().trim().min(3).max(120),
  // The client's declared size. Used to sign the target and reject obvious
  // over-limit requests early; the real check happens at confirm.
  sizeBytes: z.coerce.number().int().positive().max(1024 * 1024 * 1024),
  ownerType: z.string().trim().min(1).max(60).nullable().optional(),
  ownerId: cuidSchema.nullable().optional(),
});

export const confirmUploadSchema = z.object({ ticket: z.string().min(20) });

export const attachAssetSchema = z.object({
  ownerType: z.string().trim().min(1).max(60),
  ownerId: cuidSchema,
});

export const mediaQuerySchema = z.object({
  ownerType: z.string().trim().min(1).max(60).optional(),
  ownerId: cuidSchema.optional(),
  mimeType: z.string().trim().min(3).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// --- audit log -------------------------------------------------------------

export const auditQuerySchema = z.object({
  actorId: cuidSchema.optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entityType: z.string().trim().min(1).max(60).optional(),
  entityId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).optional(),
});

// --- orders (placeholder endpoints, rebuilt in Phase 5) ---------------------
//
// Catalog schemas live in `catalog.schemas.js`.

export const createOrderSchema = z.object({
  addressId: z.string().min(1, "Delivery address is required"),
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(99) }))
    .min(1, "Your cart is empty"),
});

export const idParamSchema = z.object({ id: cuidSchema });
