import { z } from "zod";

/**
 * The settings registry.
 *
 * Settings are defined in code, stored in the database, and never invented at
 * runtime. That gives three things a free-form key/value table cannot:
 *
 *   * a default, so an unset key still has a correct value everywhere
 *   * a schema, so "delivery fee" can never be saved as the string "free"
 *   * an explicit `isPublic` flag, so nothing leaks to unauthenticated clients
 *     by accident
 *
 * `branchOverridable` marks settings a single outlet may override. Everything
 * else is company-wide, and attempting a branch override is rejected.
 */
export const SETTINGS = [
  // --- storefront identity -------------------------------------------------
  {
    key: "store.name",
    label: "Store name",
    type: "string",
    default: "FoodZone",
    schema: z.string().trim().min(1).max(80),
    isPublic: true,
  },
  {
    key: "store.support_email",
    label: "Support email",
    type: "string",
    default: "",
    schema: z.union([z.literal(""), z.email()]),
    isPublic: true,
  },
  {
    key: "store.support_phone",
    label: "Support phone",
    type: "string",
    default: "",
    schema: z.string().trim().max(20),
    isPublic: true,
  },
  // Social profiles. Empty by default and rendered only when filled in, so a
  // fresh install ships a footer with no dead icons in it. Stored as full URLs
  // rather than handles: every network shapes its own profile URL differently,
  // and guessing the format is how a link ends up 404ing.
  {
    key: "store.social_instagram",
    label: "Instagram URL",
    type: "string",
    default: "",
    schema: z.union([z.literal(""), z.url()]),
    isPublic: true,
  },
  {
    key: "store.social_facebook",
    label: "Facebook URL",
    type: "string",
    default: "",
    schema: z.union([z.literal(""), z.url()]),
    isPublic: true,
  },
  {
    key: "store.social_youtube",
    label: "YouTube URL",
    type: "string",
    default: "",
    schema: z.union([z.literal(""), z.url()]),
    isPublic: true,
  },
  {
    key: "store.social_tiktok",
    label: "TikTok URL",
    type: "string",
    default: "",
    schema: z.union([z.literal(""), z.url()]),
    isPublic: true,
  },
  {
    key: "store.tagline",
    label: "Storefront tagline",
    type: "string",
    default: "",
    schema: z.string().trim().max(200),
    isPublic: true,
  },
  {
    key: "store.currency",
    label: "Currency",
    type: "string",
    default: "PKR",
    schema: z.string().trim().length(3).toUpperCase(),
    isPublic: true,
  },
  {
    key: "store.timezone",
    label: "Default timezone",
    type: "string",
    default: "Asia/Karachi",
    schema: z.string().trim().min(3).max(60),
    isPublic: true,
  },

  // --- ordering ------------------------------------------------------------
  {
    key: "ordering.enabled",
    label: "Accepting orders",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.delivery_enabled",
    label: "Delivery available",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.pickup_enabled",
    label: "Pickup available",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.dine_in_enabled",
    label: "Dine-in available",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.min_order_amount",
    label: "Minimum order amount",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(1_000_000),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.delivery_fee",
    label: "Delivery fee",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(1_000_000),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.free_delivery_above",
    label: "Free delivery above",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(1_000_000),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.packaging_fee",
    label: "Packaging fee",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(1_000_000),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.service_charge_percent",
    label: "Service charge (%)",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(100),
    isPublic: true,
    branchOverridable: true,
  },
  /**
   * Which order types a fee applies to.
   *
   * These exist as settings rather than as a rule buried in the pricing engine
   * because both are genuine business choices that differ between restaurants:
   * a service charge is conventionally dine-in only, and packaging is charged
   * on food that leaves the building. Encoding either as a hidden `if` in the
   * pricing code makes it invisible and unchangeable; here it is neither.
   */
  {
    key: "ordering.service_charge_applies_to",
    label: "Service charge applies to",
    type: "json",
    default: ["DINE_IN"],
    schema: z.array(z.enum(["DELIVERY", "PICKUP", "DINE_IN"])).max(3),
    /** The choices a screen offers; the schema above is what actually decides. */
    options: [
      { value: "DELIVERY", label: "Delivery" },
      { value: "PICKUP", label: "Pickup" },
      { value: "DINE_IN", label: "Dine-in" },
    ],
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.packaging_fee_applies_to",
    label: "Packaging fee applies to",
    type: "json",
    default: ["DELIVERY", "PICKUP"],
    schema: z.array(z.enum(["DELIVERY", "PICKUP", "DINE_IN"])).max(3),
    /** The choices a screen offers; the schema above is what actually decides. */
    options: [
      { value: "DELIVERY", label: "Delivery" },
      { value: "PICKUP", label: "Pickup" },
      { value: "DINE_IN", label: "Dine-in" },
    ],
    isPublic: true,
    branchOverridable: true,
  },
  /**
   * Rounds the grand total to a multiple of this, with the difference recorded
   * on `Order.roundOff` so the books still balance. 0 disables it.
   *
   * Defaults to off: silently changing what a customer is charged is the kind
   * of behaviour that must be switched on deliberately, not inherited.
   */
  {
    key: "ordering.rounding_increment",
    label: "Round totals to the nearest",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(100),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "delivery.driver_base_earning",
    label: "Driver earning per delivery",
    type: "number",
    default: 0,
    schema: z.number().min(0).max(1_000_000),
    isPublic: false,
    branchOverridable: true,
  },
  {
    key: "delivery.max_active_per_driver",
    label: "Default concurrent orders per driver",
    type: "number",
    default: 3,
    schema: z.number().int().min(1).max(20),
    isPublic: false,
    branchOverridable: true,
  },
  {
    key: "payments.enabled_methods",
    label: "Payment methods offered",
    /**
     * What a customer may choose at checkout. Staff methods (counter cash, an
     * aggregator settlement) are governed by permissions rather than this list,
     * because they are not the customer's choice to make.
     */
    type: "json",
    default: ["CASH_ON_DELIVERY", "CARD"],
    schema: z.array(
      z.enum([
        "CASH",
        "CASH_ON_DELIVERY",
        "CARD",
        "UPI",
        "NET_BANKING",
        "WALLET",
        "BANK_TRANSFER",
        "GIFT_CARD",
        "STORE_CREDIT",
        "AGGREGATOR",
        "OTHER",
      ]),
    ),
    options: [
      { value: "CASH", label: "Cash" },
      { value: "CASH_ON_DELIVERY", label: "Cash on delivery" },
      { value: "CARD", label: "Card" },
      { value: "UPI", label: "UPI" },
      { value: "NET_BANKING", label: "Net banking" },
      { value: "WALLET", label: "Wallet" },
      { value: "BANK_TRANSFER", label: "Bank transfer" },
      { value: "GIFT_CARD", label: "Gift card" },
      { value: "STORE_CREDIT", label: "Store credit" },
      { value: "AGGREGATOR", label: "Aggregator" },
      { value: "OTHER", label: "Something else" },
    ],
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "payments.default_provider",
    label: "Online payment provider",
    type: "string",
    default: "mock",
    schema: z.string().min(2).max(40),
    isPublic: false,
    branchOverridable: false,
  },
  {
    key: "payments.require_prepayment_for",
    label: "Order types that must be paid up front",
    /**
     * Empty by default: a restaurant taking cash on delivery is the norm here,
     * and forcing prepayment is a commercial decision rather than a default.
     */
    type: "json",
    default: [],
    schema: z.array(z.enum(["DELIVERY", "PICKUP", "DINE_IN"])),
    /** The choices a screen offers; the schema above is what actually decides. */
    options: [
      { value: "DELIVERY", label: "Delivery" },
      { value: "PICKUP", label: "Pickup" },
      { value: "DINE_IN", label: "Dine-in" },
    ],
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "pricing.max_manual_discount_percent",
    label: "Maximum manual discount",
    /**
     * The ceiling on a discount a member of staff can type in themselves.
     * Manual discounts are the one giveaway with no rule behind them, so this
     * is the only thing standing between a shift manager and a free meal — it
     * is deliberately not branch-overridable, because a branch that can raise
     * its own limit does not have one.
     */
    type: "number",
    default: 20,
    schema: z.number().min(0).max(100),
    isPublic: false,
    branchOverridable: false,
  },
  {
    key: "pricing.promotions_enabled",
    label: "Automatic promotions enabled",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.prices_include_tax",
    label: "Menu prices include tax",
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: true,
  },
  {
    key: "ordering.default_prep_minutes",
    label: "Default preparation time (minutes)",
    type: "number",
    default: 30,
    schema: z.number().int().min(1).max(240),
    isPublic: true,
    branchOverridable: true,
  },
  {
    key: "ordering.max_scheduled_days_ahead",
    label: "How many days ahead an order may be scheduled",
    type: "number",
    default: 7,
    schema: z.number().int().min(0).max(60),
    isPublic: true,
  },

  // --- operational ---------------------------------------------------------
  {
    key: "notifications.order_updates",
    label: "Send order status notifications",
    type: "boolean",
    default: true,
    schema: z.boolean(),
  },
  {
    key: "notifications.marketing_optin_default",
    label: "Opt new customers into marketing by default",
    type: "boolean",
    default: false,
    schema: z.boolean(),
  },
  {
    key: "payroll.require_separate_approver",
    label: "Payroll needs a second person to approve it",
    /**
     * Whoever ran the payroll cannot be the one who approves it.
     *
     * The permissions to run, approve and pay are already separate, but the
     * seeded HR manager holds all three, so without this the same person can
     * compute their own pay, approve it and release the money.
     *
     * Overridable per branch rather than absolute, because a single outlet may
     * genuinely have one person who does payroll, and a control that stops
     * wages going out is a control somebody disables in a hurry. Turning it off
     * is a deliberate, audited change, and an approval made under it is
     * recorded as self-approved on the period's audit entry.
     */
    type: "boolean",
    default: true,
    schema: z.boolean(),
    isPublic: false,
    branchOverridable: true,
  },
  {
    key: "maintenance.enabled",
    label: "Maintenance mode",
    type: "boolean",
    default: false,
    schema: z.boolean(),
    isPublic: true,
  },
  {
    key: "maintenance.message",
    label: "Maintenance message",
    type: "string",
    default: "",
    schema: z.string().trim().max(300),
    isPublic: true,
  },
];

const BY_KEY = new Map(SETTINGS.map((setting) => [setting.key, setting]));

export function settingDefinition(key) {
  return BY_KEY.get(key) ?? null;
}

export function defaultSettings({ publicOnly = false } = {}) {
  const out = {};
  for (const setting of SETTINGS) {
    if (publicOnly && !setting.isPublic) continue;
    out[setting.key] = setting.default;
  }
  return out;
}
