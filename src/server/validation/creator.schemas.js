import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";
import { nonNegativeAmountSchema, positiveAmountSchema } from "@/server/validation/finance.schemas";

/**
 * Creator program request schemas.
 *
 * The rule the rest of the system runs on holds here too: **a request never
 * states a derived figure.** A creator uploads a video and a viewer presses
 * add-to-cart; what that earns is resolved server-side from the rules. Nothing
 * a client sends names an amount, a status, or an attribution.
 */

const shortText = z.string().trim().min(1).max(160);
const longText = z.string().trim().max(8000);
const sessionId = z.string().trim().min(8).max(120);

export const creatorStatusSchema = z.enum(["PENDING", "ACTIVE", "SUSPENDED", "BANNED"]);
export const videoStatusSchema = z.enum([
  "DRAFT",
  "PROCESSING",
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "LOCKED",
  "TAKEN_DOWN",
  "ARCHIVED",
]);
export const rejectionReasonSchema = z.enum([
  "ORDER_NOT_VERIFIED",
  "PRODUCT_MISMATCH",
  "DURATION_OUT_OF_RANGE",
  "POOR_VIDEO_QUALITY",
  "POOR_AUDIO_QUALITY",
  "INAPPROPRIATE_CONTENT",
  "THIRD_PARTY_CONTENT",
  "PERSONAL_INFO_VISIBLE",
  "DUPLICATE_SUBMISSION",
  "BRANDING_VIOLATION",
  "OTHER",
]);
export const surfaceSchema = z.enum(["PRODUCT_PAGE", "VIDEO_FEED", "SHARE_LINK", "SEARCH", "HOME", "QR_MENU"]);
export const shareChannelSchema = z.enum([
  "WHATSAPP",
  "INSTAGRAM",
  "FACEBOOK",
  "X",
  "TELEGRAM",
  "SNAPCHAT",
  "YOUTUBE",
  "COPY_LINK",
  "NATIVE_SHEET",
  "OTHER",
]);
export const strikeReasonSchema = z.enum([
  "MISLEADING_CONTENT",
  "INAPPROPRIATE_CONTENT",
  "THIRD_PARTY_CONTENT",
  "FAKE_ORDER",
  "ATTRIBUTION_ABUSE",
  "REPEATED_REJECTIONS",
  "OTHER",
]);
export const reportReasonSchema = z.enum(["INAPPROPRIATE", "MISLEADING", "SPAM", "NOT_THE_PRODUCT", "COPYRIGHT", "OTHER"]);

// --- program configuration ---------------------------------------------------

export const programConfigSchema = z
  .object({
    isEnabled: z.boolean().optional(),
    minVideoSeconds: z.number().int().min(3).max(600).optional(),
    maxVideoSeconds: z.number().int().min(3).max(600).optional(),
    maxVideoSizeBytes: z.number().int().min(1_000_000).max(1_073_741_824).optional(),
    allowedMimeTypes: z.array(z.string().trim().max(60)).max(10).optional(),
    maxUploadAttempts: z.number().int().min(1).max(20).optional(),
    submissionWindowDays: z.number().int().min(1).max(365).optional(),
    attributionWindowDays: z.number().int().min(1).max(90).optional(),
    earningHoldDays: z.number().int().min(0).max(90).optional(),
    minRedemptionAmount: nonNegativeAmountSchema.optional(),
    maxRedemptionPercent: z.number().finite().min(0).max(100).optional(),
    creditExpiryDays: z.number().int().min(1).max(3650).nullish(),
    allowSelfPurchaseEarning: z.boolean().optional(),
    maxEarningPerOrder: nonNegativeAmountSchema.nullish(),
    maxEarningPerCreatorPerMonth: nonNegativeAmountSchema.nullish(),
    suspendAtStrikePoints: z.number().int().min(1).max(100).optional(),
    banAtStrikePoints: z.number().int().min(1).max(100).optional(),
    autoApproveVideos: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const publishTermsSchema = z.object({
  version: z.string().trim().min(1).max(40),
  title: shortText,
  content: longText,
  documentUrl: z.url().max(2000).nullish(),
  isCurrent: z.boolean().optional(),
});

// --- onboarding and profile ---------------------------------------------------

export const joinProgramSchema = z.object({
  displayName: shortText.optional(),
  handle: z.string().trim().min(3).max(30).optional(),
  bio: z.string().trim().max(500).nullish(),
  /** Accepting the current terms is implicit in joining, and is recorded. */
  acceptTerms: z.literal(true),
});

export const updateCreatorProfileSchema = z
  .object({
    displayName: shortText.optional(),
    handle: z.string().trim().min(3).max(30).optional(),
    bio: z.string().trim().max(500).nullish(),
    avatarUrl: z.url().max(2000).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listCreatorsSchema = z.object({
  status: creatorStatusSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const setCreatorStatusSchema = z.object({
  status: creatorStatusSchema,
  reason: z.string().trim().max(500).nullish(),
  until: z.coerce.date().nullish(),
});

export const issueStrikeSchema = z.object({
  reason: strikeReasonSchema,
  points: z.number().int().min(1).max(10).nullish(),
  note: z.string().trim().max(1000).nullish(),
  videoId: cuidSchema.nullish(),
  expiresAt: z.coerce.date().nullish(),
});

export const revokeStrikeSchema = z.object({ reason: z.string().trim().max(500).nullish() });

// --- videos --------------------------------------------------------------------

export const createVideoSchema = z.object({
  orderItemId: cuidSchema,
  caption: z.string().trim().max(500).nullish(),
});

export const attachAssetSchema = z.object({
  videoUrl: z.url().max(2000),
  storageKey: z.string().trim().min(1).max(400),
  thumbnailUrl: z.url().max(2000).nullish(),
  /** Enforced against the program's bounds; never trusted as a display value. */
  durationSeconds: z.number().int().min(1).max(3600),
  widthPx: z.number().int().min(1).max(10000).nullish(),
  heightPx: z.number().int().min(1).max(10000).nullish(),
  sizeBytes: z.number().int().min(1).nullish(),
  mimeType: z.string().trim().max(60).nullish(),
});

export const reviewVideoSchema = z
  .object({
    decision: z.enum(["APPROVED", "REJECTED"]),
    reason: rejectionReasonSchema.nullish(),
    note: z.string().trim().max(1000).nullish(),
    checks: z
      .object({
        orderVerified: z.boolean().optional(),
        productMatched: z.boolean().optional(),
        qualityApproved: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((value) => value.decision !== "REJECTED" || Boolean(value.reason), "A rejection needs a reason");

export const takedownSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  /** For fraud: pulls the attributions too, so the sale stops earning. */
  revokeAttributions: z.boolean().optional(),
});

export const reinstateSchema = z.object({ note: z.string().trim().max(500).nullish() });

export const listVideosSchema = z.object({
  creatorId: cuidSchema.optional(),
  productId: cuidSchema.optional(),
  status: videoStatusSchema.optional(),
  isLocked: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const featureVideoSchema = z.object({ rank: z.number().int().min(0).max(9999).nullish() });

export const reportVideoSchema = z.object({
  reason: reportReasonSchema,
  note: z.string().trim().max(1000).nullish(),
  sessionId: sessionId.optional(),
});

export const resolveReportSchema = z.object({ status: z.enum(["REVIEWED", "DISMISSED", "ACTIONED"]) });

export const listReportsSchema = z.object({
  status: z.enum(["OPEN", "REVIEWED", "DISMISSED", "ACTIONED"]).optional(),
  videoId: cuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

// --- engagement ------------------------------------------------------------------

export const recordViewSchema = z.object({
  sessionId: sessionId.optional(),
  surface: surfaceSchema.optional(),
  shareLinkId: cuidSchema.optional(),
  watchedSeconds: z.number().int().min(0).max(3600).optional(),
  isComplete: z.boolean().optional(),
});

export const likeSchema = z.object({ sessionId: sessionId.optional() });

export const shareSchema = z.object({
  channel: shareChannelSchema.optional(),
  sessionId: sessionId.optional(),
  campaign: z.string().trim().max(60).nullish(),
});

export const feedQuerySchema = z.object({
  categoryId: cuidSchema.optional(),
  creatorHandle: z.string().trim().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().max(200).optional(),
});

export const statsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

// --- commission rules --------------------------------------------------------------

const targetSchema = z.object({
  targetType: z.enum(["ORDER", "PRODUCT", "VARIANT", "CATEGORY"]),
  targetId: z.string().trim().min(1).max(40),
  isExcluded: z.boolean().optional(),
});

export const createRuleSchema = z.object({
  name: shortText,
  description: z.string().trim().max(1000).nullish(),
  rewardType: z.enum(["PERCENTAGE", "FIXED"]).optional(),
  rewardValue: positiveAmountSchema,
  basis: z.enum(["ATTRIBUTED_LINE", "ORDER_SUBTOTAL", "ORDER_TOTAL"]).optional(),
  maxRewardAmount: positiveAmountSchema.nullish(),
  conditionBasis: z.enum(["ATTRIBUTED_LINE", "ORDER_SUBTOTAL", "ORDER_TOTAL"]).optional(),
  minOrderAmount: nonNegativeAmountSchema.nullish(),
  minLineQuantity: z.number().int().min(1).max(999).nullish(),
  branchIds: z.array(cuidSchema).max(50).optional(),
  channels: z.array(z.enum(["WEB", "APP", "POS", "PHONE", "QR_TABLE", "KIOSK", "THIRD_PARTY"])).max(10).optional(),
  orderTypes: z.array(z.enum(["DELIVERY", "PICKUP", "DINE_IN", "TAKEAWAY"])).max(6).optional(),
  creatorId: cuidSchema.nullish(),
  priority: z.number().int().min(-1000).max(1000).optional(),
  startsAt: z.coerce.date().nullish(),
  endsAt: z.coerce.date().nullish(),
  isActive: z.boolean().optional(),
  maxPayoutPerOrder: positiveAmountSchema.nullish(),
  totalBudget: positiveAmountSchema.nullish(),
  targets: z.array(targetSchema).max(200).optional(),
});

export const updateRuleSchema = createRuleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listRulesSchema = z.object({
  isActive: z.stringbool().optional(),
  creatorId: cuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const simulateSchema = z.object({
  productId: cuidSchema,
  categoryId: cuidSchema.optional(),
  lineAmount: nonNegativeAmountSchema,
  orderSubtotal: nonNegativeAmountSchema.optional(),
  orderTotal: nonNegativeAmountSchema.optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  branchId: cuidSchema.optional(),
  channel: z.enum(["WEB", "APP", "POS", "PHONE", "QR_TABLE", "KIOSK", "THIRD_PARTY"]).optional(),
  orderType: z.enum(["DELIVERY", "PICKUP", "DINE_IN", "TAKEAWAY"]).optional(),
  creatorId: cuidSchema.optional(),
});

// --- earnings and wallet -------------------------------------------------------

export const listEarningsSchema = z.object({
  creatorId: cuidSchema.optional(),
  orderId: cuidSchema.optional(),
  videoId: cuidSchema.optional(),
  status: z.enum(["PENDING", "APPROVED", "CREDITED", "NOT_QUALIFIED", "REVERSED", "REJECTED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const reverseEarningSchema = z.object({ reason: z.string().trim().min(1).max(500) });

export const adjustWalletSchema = z.object({
  amount: z.number().finite().refine((value) => value !== 0, "An adjustment of zero does nothing"),
  note: z.string().trim().min(1).max(500),
});

export const freezeWalletSchema = z.object({
  isLocked: z.boolean(),
  reason: z.string().trim().max(500).nullish(),
});

export const statementQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});

export const redeemQuoteSchema = z.object({ orderTotal: nonNegativeAmountSchema });

export const markSeenSchema = z.object({ ids: z.array(cuidSchema).max(200).optional() });

export const rollUpSchema = z.object({
  date: z.coerce.date().optional(),
  videoId: cuidSchema.optional(),
});
