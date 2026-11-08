import assert from "node:assert/strict";
import "dotenv/config";
import { FULFILLED_STATUSES } from "../src/lib/order-status.js";
import { parseProse, firstParagraph } from "../src/lib/prose.js";
import { CONTENT_PAGES } from "../prisma/seeds/content-pages.js";
import { cropReport, HERO_BAND_RATIO, TIGHT_CROP } from "../src/lib/hero-crop.js";
import { runwayNotice } from "../src/lib/fiscal-runway.js";
import { toMenuCard } from "../src/lib/menu-card.js";
import { menusForBranch } from "../src/lib/product-form.js";
import { comboSelectionSchema } from "../src/server/validation/ordering.schemas.js";
import { describeRow, hoursPayload, hoursToForm } from "../src/lib/branch-hours.js";
import { ApiError, fromPrismaError, isNotFound } from "../src/lib/api/errors.js";
import { branchQuerySchema, notificationQuerySchema } from "../src/server/validation/schemas.js";
import {
  canPickMore,
  comboDefaults,
  comboGroupError,
  comboSelectedCount,
  comboSurcharge,
  comboModifierDefaults,
  hasRoomFor,
  toComboPayload,
  validateComboGroups,
  validateComboModifiers,
} from "../src/lib/combo-options.js";

/**
 * Unit tests for logic that is awkward to reach over HTTP — opening-hours
 * arithmetic around midnight above all, which only happens for two hours a day.
 */
const { computeOpenState, zonedNow } = await import("@/server/services/branch.service");
const { assertUploadAllowed, buildStorageKey, resolveKind, uploadPolicies } = await import("@/server/storage/policy");
const { settingDefinition, defaultSettings } = await import("@/server/settings/registry");
const { isExpoPushToken } = await import("@/server/notifications/push");
const { isItemAvailable, menuMatchesAt, pickActiveMenu } = await import("@/server/services/menu.service");
const { assertRulesAreSatisfiable } = await import("@/server/services/modifier.service");
const modifierServiceRules = assertRulesAreSatisfiable;
const { buildTree } = await import("@/server/services/category.service");
const { shortCode, hmacSha256 } = await import("@/server/utils/crypto");
process.env.CREDENTIAL_ENCRYPTION_KEYS =
  "k2:" + Buffer.alloc(32, 7).toString("base64") + ",k1:" + Buffer.alloc(32, 3).toString("base64");
const { encryptSecret, decryptSecret, activeKeyId, parseEnvelope } = await import("@/server/utils/secret-box");
const {
  listProviders: listPaymentProviders,
  getProvider: getPaymentProvider,
  registerProvider: registerPaymentProvider,
} = await import("@/server/payments/providers");
const { webhookUrlFor } = await import("@/server/services/payment-provider.service");
const { safepayProvider, toMinorUnits } = await import("@/server/payments/providers/safepay");
const { chooseProvider } = await import("@/server/payments/choose");
const { refundability } = await import("@/server/payments/refund-window");
const {
  credentialFields,
  validateCredentials,
  sealCredentials,
  openCredentials,
  maskCredentials,
  mergeCredentialUpdate,
  assertReadyToEnable,
  requiresConfiguration,
  providerLabel,
} = await import("@/server/payments/credentials");
const { qrCodeParamSchema } = await import("@/server/validation/dinein.schemas");
const { priceOrder, priceLine, taxForLine, applyRounding, totalsAfterAdding } = await import("@/server/pricing/engine");
const { allowedTransitions, canTransition, TERMINAL_STATUSES } = await import("@/server/services/order.service");
const { canTransitionItem } = await import("@/server/services/kds.service");
const { computeDiscount, eligibleLines, isPromotionEligible, resolvePromotions } = await import(
  "@/server/pricing/promotions"
);
const { assertPromotionIsCoherent } = await import("@/server/services/promotion.service");
const { effectiveRate } = await import("@/server/services/tax.service");
const { toDigits, fromDigits, withDigitAt, withBackspaceAt, digitsFromPaste, firstEmptyIndex } =
  await import("@/lib/otp");
const { safeRedirect, loginHref, registerHref, signInDestination } = await import("@/lib/redirects");
const { queueHealth, ageLabel, minutesSince, STALL_AFTER_MINUTES } = await import("@/lib/queue-health");
const { homeFor, worksTheBoard, worksTheFloor, HOME_PATHS, HOME_CHOICES } = await import("@/lib/home-page");
const { resolveBranch } = await import("@/lib/branch");
const { selectedCount, groupError, validateGroups, canSelectMore, previewTotal, defaultSelections, toModifierPayload } =
  await import("@/lib/product-options");
const { toFormErrors } = await import("@/lib/form-errors");
const { branchFormValues, branchPayload, toDateInput, BRANCH_DEFAULTS } = await import("@/lib/branch-form");
const { branchScope } = await import("@/lib/api/permissions");
const { toTree, flattenTree, descendantIds, heightBelow, parentOptions, reorderSiblings, MAX_CATEGORY_DEPTH } =
  await import("@/lib/category-tree");
const { MAX_DEPTH: SERVER_MAX_CATEGORY_DEPTH } = await import("@/server/services/category.service");
const { categoryFormValues, categoryPayload } = await import("@/lib/category-form");
const { fitWithin } = await import("@/lib/image-upload");
const {
  parseMoney: parsePriceInput,
  parseWhole,
  parseList: parseAllergenList,
  productFormValues,
  productPayload,
  variantPayload,
  productSaleState,
} = await import("@/lib/product-form");
const { isLocalMediaUrl } = await import("@/lib/media-url");
const { patchSchema, injectedDefaults } = await import("@/server/validation/patch");
const { parseMoneyDelta } = await import("@/lib/product-form");
const { describeModifierRule, modifierRuleErrors, modifierGroupHealth, modifierGroupFormValues, modifierGroupPayload, modifierOptionPayload } =
  await import("@/lib/modifier-rules");
const {
  comboOptionAvailable,
  describeSlotRule,
  describeSlotChoices,
  slotFillable,
  comboHealth,
  comboGroupPayload,
  comboOptionPayload,
} = await import("@/lib/combo-rules");
const menuLib = await import("@/lib/menu-schedule");
const orderTypeLib = await import("@/lib/order-type");
const { phoneKey } = await import("@/lib/phone-key");
const customerLib = await import("@/lib/customer-form");
const { ORDER_TYPE_MENU } = await import("@/server/services/menu.service");
const { holdsCompanyWide } = await import("@/lib/api/permissions");
const catalogSchemas = await import("@/server/validation/catalog.schemas");
const { readdirSync } = await import("node:fs");
const { z: zod } = await import("zod");
const {
  DASHBOARD_NAV,
  ACCOUNT_NAV,
  hasPermission,
  canSeeItem,
  visibleNav,
  navItemCount,
  activeHref,
  firstNavHref,
  workspaceLinks,
} = await import("@/lib/dashboard-nav");
const { PERMISSIONS } = await import("../prisma/seeds/permissions.js");
const { SYSTEM_ROLES, resolvePermissionKeys } = await import("../prisma/seeds/roles.js");
const { checkoutBlockers, checkoutPayload, checkoutRequirements, parseTip, quoteItems, tipPresets } =
  await import("@/lib/checkout");
const { amountDue, derivePaymentState, paymentTotals } = await import("@/server/payments/state");
const { getProvider, listProviders } = await import("@/server/payments/providers");
const {
  ACTIVE_STATUSES,
  DELIVERY_TRANSITIONS,
  IN_POSSESSION,
  ORDER_STATUS_FOR_DELIVERY,
  TERMINAL_DELIVERY_STATUSES,
  allowedDeliveryTransitions,
  canTransitionDelivery,
  driverMayTransition,
} = await import("@/server/delivery/state");
const { convertQuantity, convertUnitCost, grossUpForYield } = await import("@/server/inventory/uom");
const { allocateFifo, allocateLandedCost, landedUnitCost, newWeightedAverage, orderBatchesForConsumption } =
  await import("@/server/inventory/costing");
const { directionFor, isOutbound } = await import("@/server/inventory/ledger");
const { escapeCsvField, parseCsv, parseCsvRecords, toCsv } = await import("@/server/catalog/csv");
const { CLEAR, coerceRow, keyOf, parseBoolean, parseList, parseMoney, parseSlug, validateHeaders } = await import(
  "@/server/catalog/import-spec"
);
const { enforceRateLimit, rateLimitHeaders } = await import("@/lib/api/rate-limit");
const {
  accountBalance,
  assertBalanced,
  compact,
  creditLine,
  debitLine,
  normalBalanceFor,
  normaliseLine,
  reverseLines,
  signedLine,
  totals,
} = await import("@/server/accounting/balance");
const { ACCOUNTS, STANDARD_CHART, REQUIRED_CODES } = await import("@/server/accounting/chart");
const {
  SETTLEMENT_BY_METHOD,
  cogsLines,
  driverPayoutLines,
  expenseLines,
  goodsReceiptLines,
  paymentLines,
  pricesIncludedTax,
  productionLines,
  refundLines,
  saleLines,
  settlementCodeFor,
  supplierBillLines,
} = await import("@/server/accounting/posting-rules");
const { ageBalances, balanceSheet, bucketFor, profitAndLoss, trialBalance } = await import(
  "@/server/accounting/reports"
);
const { monthsBetween } = await import("@/server/services/fiscal.service");
const { fiscalYearFor, fiscalYearStartMonth, nextFiscalYearAfter, runwayStatus, RUNWAY_THRESHOLDS } =
  await import("@/server/accounting/fiscal-calendar");
const { NO_ACCOUNTING_PERIOD, isMissingAccountingPeriod, missingPeriodError } = await import(
  "@/server/accounting/posting-errors"
);
const { bootstrapSchema } = await import("@/server/validation/bootstrap.schemas");
const { backupName, backupTakenAt, planRetention } = await import("@/server/ops/backup-policy");
const { isSweepableKey, planUploadSweep, SWEEP_GRACE_MINUTES } = await import("@/server/ops/upload-sweep");
const { safeText, toWinAnsi } = await import("@/server/documents/text");
const { invoiceDocument } = await import("@/server/documents/invoice-document");
const { buildSlots, findSlot, schedulableDates } = await import("@/server/ordering/slots");
const { payslipDocument } = await import("@/server/documents/payslip-document");
const { setupTokenMatches } = await import("@/server/services/bootstrap.service");
const {
  addDays,
  crossesMidnight,
  daysBetween,
  earlyLeaveMinutes,
  formatMinutes,
  lateMinutes,
  parseTimeToMinutes,
  punchBelongsToShift,
  shiftLengthMinutes,
  shiftWindow,
  startOfDay,
  workDateForPunch,
} = await import("@/server/attendance/shift");
const {
  dedupePunches,
  deriveDay,
  deriveStatus,
  pairIntervals,
  payableFactorFor,
  resolveDirections,
  summariseDays,
} = await import("@/server/attendance/derive");
const {
  DisqualifiedReason,
  applyProgramCaps,
  basisAmountFor,
  computeReward,
  resolveCommission,
  ruleQualifies,
  ruleTargetsLine,
  specificityOf,
} = await import("@/server/creator/rules");
const {
  attributionCanEarn,
  expiryFrom,
  isSelfPurchase,
  isWithinWindow,
  matchLines,
  shouldSupersede,
  videoCanAttribute,
} = await import("@/server/creator/attribution");
const {
  activeStrikes,
  attemptsRemaining,
  canReupload,
  defaultPointsFor,
  effectiveStatus,
  isSuspended,
  standingFor,
  totalPoints,
} = await import("@/server/creator/strikes");
const {
  basicPay,
  buildPayslip,
  componentAmount,
  componentApplies,
  hourlyRateFor,
  hoursOf,
  overtimePay,
} = await import("@/server/attendance/payroll");
const { requiredQuantity, mergeLines, MAX_RECIPE_DEPTH } = await import("@/server/production/explode");
const {
  allocateOutputCosts,
  contributionMargin,
  foodCostPercent,
  materialVariance,
  rollUpCost,
  variance,
  yieldVariance,
} = await import("@/server/production/costing");
const {
  PRODUCTION_TRANSITIONS,
  allowedProductionTransitions,
  canTransitionProduction,
} = await import("@/server/production/state");

let passed = 0;
const failures = [];
const {
  ATTENDANCE_STATES,
  EMPLOYEE_STATES,
  addDayKeys,
  clockLabel,
  clockValue,
  componentPayload,
  correctionPayload,
  dayKey,
  devicePayload,
  durationLabel,
  employeeName,
  hasLeft,
  isWeekend,
  manualPunchPayload,
  minutesFromClock,
  rosterPayload,
  salaryPayload,
  shiftLength,
  shiftPayload,
  silenceLabel,
  suggestThresholds,
  weekDays,
  weekStart,
  LEAVE_STATES,
  PAYROLL_STATES,
  PAYROLL_STAGE_HINT,
  holidayPayload,
  leaveAvailable,
  leavePayload,
  leaveTypePayload,
  monthName,
  monthRange,
  payrollPeriodPayload,
} = await import("@/lib/hr");
const { branchFilter, inScope, intersectScopes, reaches, scopeWhere } = await import("@/server/access/scope");
const {
  AGEING_BUCKETS,
  BILL_STATES,
  PO_STATES,
  addAmounts,
  billPaymentPayload,
  dateLabel,
  dueState,
  goodsReceiptPayload,
  orderTotals,
  outstandingOf,
  poCancellable,
  poEditable,
  poReceivable,
  purchaseOrderPayload,
  receiptTotals,
  supplierBillPayload,
  supplierItemPayload,
  supplierPayload,
} = await import("@/lib/purchasing");
const { AGEING_BUCKETS: SERVER_AGEING_BUCKETS } = await import("@/server/accounting/reports");
const {
  ITEM_NEXT,
  ITEM_STATES,
  ORDER_FILTERS,
  ORDER_STATES,
  STATUS_ACTIONS,
  statusAction,
  owedAfter,
  basketPreview,
  bulkTablePayload,
  bulkTablePreview,
  cartState,
  changeDue,
  counterCatalogue,
  counterOrderPayload,
  paymentPayload,
  paysUpFront,
  SET_ASIDE_REASONS,
  ITEM_ACTIONS,
  itemAction,
  qrPayload,
  tablePayload,
  ticketUrgency,
  waitingFor,
} = await import("@/lib/service");
const { orderScope } = await import("@/server/ordering/access");
const {
  DELIVERY_STATES,
  DRIVER_STATES,
  PAYOUT_STATES,
  availability,
  canReassign,
  driverPayload,
  generatePayoutPayload,
  lastSeen,
  lastWeek,
  licenceState,
  payoutBreakdown,
  waitingSince,
} = await import("@/lib/delivery");

const check = (name, fn) => {
  try {
    const result = fn();
    /*
     * An async body would hand back a promise here, and this runner is
     * synchronous: the `try` would see nothing thrown, report PASS, and the
     * assertions inside would settle later as an unhandled rejection nobody
     * reads. A test that cannot fail is worse than no test, so refuse it
     * outright rather than quietly counting it as green.
     */
    if (result && typeof result.then === "function") {
      throw new Error("this runner is synchronous — an async body's assertions never run");
    }
    passed++;
    console.log("PASS ", name);
  } catch (error) {
    failures.push(name);
    console.log("FAIL ", name, "::", error.message);
  }
};

const branch = { id: "b1", isActive: true, timezone: "UTC" };
const at = (iso) => new Date(iso);

// --- opening hours ---------------------------------------------------------
check("open inside a normal window", () => {
  // 2026-09-09 is a Wednesday (dayOfWeek 3).
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: null }];
  const state = computeOpenState({ branch, hours, at: at("2026-09-09T12:00:00Z") });
  assert.equal(state.isOpen, true);
});

check("closed before opening, with a next-open time", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: null }];
  const state = computeOpenState({ branch, hours, at: at("2026-09-09T08:00:00Z") });
  assert.equal(state.isOpen, false);
  assert.equal(state.reason, "OUTSIDE_HOURS");
  assert.ok(state.nextOpenAt instanceof Date);
  // 08:00 + 2h = 10:00, the opening time.
  assert.equal(state.nextOpenAt.toISOString(), "2026-09-09T10:00:00.000Z");
});

check("closed exactly at closing minute", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: null }];
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T22:00:00Z") }).isOpen, false);
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T21:59:00Z") }).isOpen, true);
});

check("open at the opening minute", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: null }];
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T10:00:00Z") }).isOpen, true);
});

check("overnight window covers after midnight", () => {
  // Wednesday 20:00 to Thursday 02:00.
  const hours = [{ dayOfWeek: 3, opensAt: 1200, closesAt: 1560, channel: null }];
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T21:00:00Z") }).isOpen, true, "before midnight");
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-10T01:00:00Z") }).isOpen, true, "after midnight");
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-10T03:00:00Z") }).isOpen, false, "past closing");
});

check("split shifts are both honoured", () => {
  const hours = [
    { dayOfWeek: 3, opensAt: 660, closesAt: 900, channel: null },
    { dayOfWeek: 3, opensAt: 1080, closesAt: 1380, channel: null },
  ];
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T12:00:00Z") }).isOpen, true);
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T16:00:00Z") }).isOpen, false, "the gap");
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T19:00:00Z") }).isOpen, true);
});

check("timezone is respected, not the server's clock", () => {
  const karachi = { ...branch, timezone: "Asia/Karachi" };
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: null }];
  // 06:00 UTC is 11:00 in Karachi — open there, shut by UTC reckoning.
  assert.equal(computeOpenState({ branch: karachi, hours, at: at("2026-09-09T06:00:00Z") }).isOpen, true);
  assert.equal(computeOpenState({ branch, hours, at: at("2026-09-09T06:00:00Z") }).isOpen, false);
});

check("a closure beats open hours", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 0, closesAt: 1439, channel: null }];
  const closures = [{ startsAt: at("2026-09-09T10:00:00Z"), endsAt: at("2026-09-09T14:00:00Z"), reason: "Repairs" }];
  const state = computeOpenState({ branch, hours, closures, at: at("2026-09-09T12:00:00Z") });
  assert.equal(state.isOpen, false);
  assert.equal(state.reason, "CLOSURE");
  assert.equal(state.closureReason, "Repairs");
});

check("an inactive branch is never open", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 0, closesAt: 1439, channel: null }];
  const state = computeOpenState({ branch: { ...branch, isActive: false }, hours, at: at("2026-09-09T12:00:00Z") });
  assert.equal(state.isOpen, false);
  assert.equal(state.reason, "INACTIVE");
});

check("channel-specific hours only apply to that channel", () => {
  const hours = [{ dayOfWeek: 3, opensAt: 600, closesAt: 1320, channel: "QR" }];
  assert.equal(computeOpenState({ branch, hours, channel: "QR", at: at("2026-09-09T12:00:00Z") }).isOpen, true);
  assert.equal(computeOpenState({ branch, hours, channel: "WEB", at: at("2026-09-09T12:00:00Z") }).isOpen, false);
});

check("no hours set reports NO_HOURS_SET", () => {
  const state = computeOpenState({ branch, hours: [], at: at("2026-09-09T12:00:00Z") });
  assert.equal(state.reason, "NO_HOURS_SET");
});

check("zonedNow maps weekday and minutes", () => {
  const utc = zonedNow("UTC", at("2026-09-09T12:34:00Z"));
  assert.deepEqual(utc, { dayOfWeek: 3, minutes: 754 });
  // Karachi is UTC+5, so the same instant is 17:34 there.
  assert.deepEqual(zonedNow("Asia/Karachi", at("2026-09-09T12:34:00Z")), { dayOfWeek: 3, minutes: 1054 });
  // Midnight must be 0, not 1440.
  assert.equal(zonedNow("UTC", at("2026-09-09T00:00:00Z")).minutes, 0);
});

// --- upload policy ---------------------------------------------------------
check("mime types map to kinds", () => {
  assert.equal(resolveKind("image/jpeg"), "IMAGE");
  assert.equal(resolveKind("video/mp4"), "VIDEO");
  assert.equal(resolveKind("application/pdf"), "DOCUMENT");
  assert.equal(resolveKind("application/x-msdownload"), null);
});

check("disallowed types and oversized files are rejected", () => {
  assert.throws(() => assertUploadAllowed({ mimeType: "application/x-msdownload", sizeBytes: 10 }), (e) => e.status === 400);
  const max = uploadPolicies().IMAGE.maxBytes;
  assert.throws(() => assertUploadAllowed({ mimeType: "image/png", sizeBytes: max + 1 }), (e) => e.status === 400);
  assert.ok(assertUploadAllowed({ mimeType: "image/png", sizeBytes: max }));
});

check("image policy demands compression", () => {
  const policy = uploadPolicies().IMAGE;
  assert.equal(policy.compression.required, true);
  assert.ok(policy.compression.maxWidth > 0 && policy.compression.quality < 1);
});

check("storage keys are random, dated and namespaced", () => {
  const a = buildStorageKey({ ownerType: "Product", mimeType: "image/webp" });
  const b = buildStorageKey({ ownerType: "Product", mimeType: "image/webp" });
  assert.notEqual(a, b, "keys must not be guessable or collide");
  assert.match(a, /^product\/\d{4}\/\d{2}\/[0-9a-f]{32}\.webp$/);
  assert.match(buildStorageKey({ ownerType: null, mimeType: "video/mp4" }), /^misc\/.*\.mp4$/);
});

// --- settings registry -----------------------------------------------------
check("settings registry validates values", () => {
  assert.equal(settingDefinition("ordering.delivery_fee").schema.safeParse(150).success, true);
  assert.equal(settingDefinition("ordering.delivery_fee").schema.safeParse("free").success, false);
  assert.equal(settingDefinition("ordering.service_charge_percent").schema.safeParse(101).success, false);
  assert.equal(settingDefinition("nope.not.real"), null);
});

check("public defaults exclude private settings", () => {
  const publicOnly = defaultSettings({ publicOnly: true });
  assert.ok("store.name" in publicOnly);
  assert.ok(!("notifications.order_updates" in publicOnly), "private setting leaked into the public set");
});

// --- push ------------------------------------------------------------------
check("expo push tokens are recognised", () => {
  assert.equal(isExpoPushToken("ExponentPushToken[abc123]"), true);
  assert.equal(isExpoPushToken("ExpoPushToken[abc123]"), true);
  assert.equal(isExpoPushToken("fcm-token-here"), false);
  assert.equal(isExpoPushToken(null), false);
});

// --- menu scheduling -------------------------------------------------------
//
// Menu windows have the same midnight problem as opening hours, plus a
// precedence question that only shows up when two menus overlap.
const menu = (overrides) => ({
  isActive: true,
  activeFrom: null,
  activeTo: null,
  startMinute: null,
  endMinute: null,
  daysOfWeek: [],
  isDefault: false,
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

check("an unscheduled menu always matches", () => {
  assert.equal(menuMatchesAt(menu({}), { dayOfWeek: 3, minutes: 200 }), true);
});

check("an inactive menu never matches", () => {
  assert.equal(menuMatchesAt(menu({ isActive: false }), { dayOfWeek: 3, minutes: 720 }), false);
});

check("a lunch window matches only inside it", () => {
  const lunch = menu({ startMinute: 720, endMinute: 900 });
  assert.equal(menuMatchesAt(lunch, { dayOfWeek: 3, minutes: 800 }), true);
  assert.equal(menuMatchesAt(lunch, { dayOfWeek: 3, minutes: 901 }), false);
  // The end is exclusive: 15:00 is when lunch stops, not a last minute of it.
  assert.equal(menuMatchesAt(lunch, { dayOfWeek: 3, minutes: 900 }), false);
});

check("a late-night window still matches after midnight", () => {
  // Wednesday 20:00 -> Thursday 02:00.
  const late = menu({ startMinute: 1200, endMinute: 1560, daysOfWeek: [3] });
  assert.equal(menuMatchesAt(late, { dayOfWeek: 3, minutes: 1300 }), true, "same evening");
  assert.equal(menuMatchesAt(late, { dayOfWeek: 4, minutes: 60 }), true, "01:00 next morning");
  assert.equal(menuMatchesAt(late, { dayOfWeek: 4, minutes: 180 }), false, "03:00 is past closing");
});

check("weekday restrictions apply without a time window", () => {
  const weekend = menu({ daysOfWeek: [0, 6] });
  assert.equal(menuMatchesAt(weekend, { dayOfWeek: 6, minutes: 600 }), true);
  assert.equal(menuMatchesAt(weekend, { dayOfWeek: 3, minutes: 600 }), false);
});

check("a date range bounds the menu", () => {
  const promo = menu({ activeFrom: new Date("2026-06-01"), activeTo: new Date("2026-06-30") });
  assert.equal(menuMatchesAt(promo, { dayOfWeek: 1, minutes: 600, at: new Date("2026-06-15") }), true);
  assert.equal(menuMatchesAt(promo, { dayOfWeek: 1, minutes: 600, at: new Date("2026-07-15") }), false);
});

check("the more specific menu wins over the default", () => {
  const allDay = menu({ isDefault: true, id: "all-day" });
  const lunch = menu({ startMinute: 720, endMinute: 900, id: "lunch" });
  const picked = pickActiveMenu([allDay, lunch], { dayOfWeek: 3, minutes: 800 });
  assert.equal(picked.id, "lunch", "a scheduled menu should take over during its hours");
});

check("the default menu is used when nothing more specific matches", () => {
  const allDay = menu({ isDefault: true, id: "all-day" });
  const lunch = menu({ startMinute: 720, endMinute: 900, id: "lunch" });
  assert.equal(pickActiveMenu([allDay, lunch], { dayOfWeek: 3, minutes: 1200 }).id, "all-day");
});

check("no menu matching returns null rather than guessing", () => {
  assert.equal(pickActiveMenu([menu({ startMinute: 720, endMinute: 900 })], { dayOfWeek: 3, minutes: 100 }), null);
});

// --- 86 switch -------------------------------------------------------------
check("a timed 86 expires on its own, without the sweep job", () => {
  const now = new Date("2026-09-09T12:00:00Z");
  assert.equal(isItemAvailable({ isAvailable: false, unavailableUntil: new Date("2026-09-09T11:00:00Z") }, now), true);
  assert.equal(isItemAvailable({ isAvailable: false, unavailableUntil: new Date("2026-09-09T13:00:00Z") }, now), false);
});

check("an untimed 86 stays off until someone turns it back on", () => {
  assert.equal(isItemAvailable({ isAvailable: false, unavailableUntil: null }), false);
  assert.equal(isItemAvailable({ isAvailable: true, unavailableUntil: null }), true);
});

// --- modifier rules --------------------------------------------------------
check("a single-choice group cannot ask for two selections", () => {
  assert.throws(
    () => assertRulesAreSatisfiable({ selectionType: "SINGLE", minSelect: 0, maxSelect: 2, optionCount: 3 }),
    /more than one selection/,
  );
});

check("a group cannot demand more choices than it offers", () => {
  assert.throws(
    () => assertRulesAreSatisfiable({ selectionType: "MULTIPLE", minSelect: 3, maxSelect: 5, optionCount: 2 }),
    /more choices than it offers/,
  );
  // ...unless one option can be taken repeatedly.
  assertRulesAreSatisfiable({ selectionType: "MULTIPLE", minSelect: 3, maxSelect: 5, optionCount: 2, allowQuantity: true });
});

check("min above max is rejected", () => {
  assert.throws(
    () => assertRulesAreSatisfiable({ selectionType: "MULTIPLE", minSelect: 4, maxSelect: 2, optionCount: 9 }),
    /cannot exceed the maximum/,
  );
});

// --- category tree ---------------------------------------------------------
check("a category tree nests children under their parent", () => {
  const tree = buildTree([
    { id: "a", parentId: null },
    { id: "b", parentId: "a" },
    { id: "c", parentId: "b" },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].children[0].id, "b");
  assert.equal(tree[0].children[0].children[0].id, "c");
});

check("a child whose parent was filtered out is surfaced, not dropped", () => {
  // Listing only active categories can hide a parent; its children must still
  // be reachable or they vanish from the admin screen entirely.
  const tree = buildTree([{ id: "orphan", parentId: "missing-parent" }]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, "orphan");
});

// --- QR short codes --------------------------------------------------------
//
// The code is printed on a sticker and sometimes typed off it by hand, so the
// alphabet and the parser have to agree exactly.
check("short codes avoid characters that get misread", () => {
  // 1000 samples is enough to hit every alphabet slot many times over.
  const sample = Array.from({ length: 1000 }, () => shortCode(8)).join("");
  assert.equal(sample.length, 8000);
  // I, L, O and U are excluded: I/1, L/1, O/0 and U/V are the pairs people
  // actually confuse when reading a code off a printed sticker.
  assert.match(sample, /^[0-9A-HJKMNP-TV-Z]+$/, "an excluded character was generated");
});

check("every generated code parses as a valid code", () => {
  for (let i = 0; i < 200; i += 1) {
    const code = shortCode(8);
    const parsed = qrCodeParamSchema.safeParse({ code });
    assert.equal(parsed.success, true, `generator produced a code the parser rejects: ${code}`);
  }
});

check("codes are accepted in either case and normalised up", () => {
  const parsed = qrCodeParamSchema.parse({ code: "a2b3c4d5" });
  assert.equal(parsed.code, "A2B3C4D5");
});

check("malformed codes are rejected before the database", () => {
  for (const code of ["", "short", "has-a-dash", "TOOLONGTOOLONGTOOLONG", "ABCDEFGI", "ABCDEFGL"]) {
    assert.equal(qrCodeParamSchema.safeParse({ code }).success, false, `should have rejected "${code}"`);
  }
});

// --- pricing ---------------------------------------------------------------
//
// Every amount a customer is charged comes from here, so these are the tests
// that matter most: the awkward cases (inclusive tax, compound rates, rounding)
// are exactly the ones that silently lose money.
const num = (value) => Number(String(value));

check("modifier deltas are per unit, not per line", () => {
  // Two burgers with extra cheese is two lots of cheese.
  const line = priceLine({ unitPrice: 500, quantity: 2, modifiers: [{ priceDelta: 50, quantity: 1 }] });
  assert.equal(num(line.lineSubtotal), 1100);
  assert.equal(num(line.modifierTotal), 50);
});

check("a repeated modifier multiplies", () => {
  const line = priceLine({ unitPrice: 500, quantity: 1, modifiers: [{ priceDelta: 50, quantity: 3 }] });
  assert.equal(num(line.lineSubtotal), 650);
});

check("exclusive tax is added on top", () => {
  const result = taxForLine({ lineSubtotal: 1000, rates: [{ name: "GST", rate: 17 }], pricesIncludeTax: false });
  assert.equal(num(result.taxable), 1000);
  assert.equal(num(result.taxTotal), 170);
});

check("inclusive tax is extracted from the price, not added", () => {
  // 1170 gross at 17% contains 170 of tax over a 1000 net.
  const result = taxForLine({ lineSubtotal: 1170, rates: [{ name: "GST", rate: 17 }], pricesIncludeTax: true });
  assert.equal(num(result.taxable), 1000);
  assert.equal(num(result.taxTotal), 170);
});

check("compound tax stacks on the running total, not the base", () => {
  // 10% then a compound 5%: 100 -> 10, then 5% of 110 = 5.5, not 5.
  const result = taxForLine({
    lineSubtotal: 100,
    rates: [
      { name: "A", rate: 10, sortOrder: 0 },
      { name: "B", rate: 5, isCompound: true, sortOrder: 1 },
    ],
    pricesIncludeTax: false,
  });
  assert.equal(num(result.taxTotal), 15.5);
});

check("inclusive tax parts always add back to the gross", () => {
  // The property that matters: whatever rounding does to each component, the
  // customer is charged exactly what the menu said.
  for (const gross of [999.99, 1234.56, 77.77, 1]) {
    const result = taxForLine({
      lineSubtotal: gross,
      rates: [{ name: "A", rate: 7.5 }, { name: "B", rate: 2.5 }],
      pricesIncludeTax: true,
    });
    assert.equal(
      Number((num(result.taxable) + num(result.taxTotal)).toFixed(4)),
      gross,
      `parts did not add back for ${gross}`,
    );
  }
});

check("rounding records the adjustment so the books balance", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(applyRounding(102.4, 5)).map(([k, v]) => [k, num(v)])),
    { total: 100, roundOff: -2.4 },
  );
  // Zero disables it rather than rounding everything to zero.
  assert.equal(num(applyRounding(102.4, 0).total), 102.4);
});

check("a delivery fee is waived above the free-delivery threshold", () => {
  const settings = { "ordering.delivery_fee": 150, "ordering.free_delivery_above": 1000 };
  const under = priceOrder({ lines: [{ unitPrice: 500, quantity: 1 }], type: "DELIVERY", settings });
  const over = priceOrder({ lines: [{ unitPrice: 1500, quantity: 1 }], type: "DELIVERY", settings });
  assert.equal(num(under.deliveryFee), 150);
  assert.equal(num(over.deliveryFee), 0);
});

check("a zero threshold means no free delivery, not everything free", () => {
  const result = priceOrder({
    lines: [{ unitPrice: 99999, quantity: 1 }],
    type: "DELIVERY",
    settings: { "ordering.delivery_fee": 150, "ordering.free_delivery_above": 0 },
  });
  assert.equal(num(result.deliveryFee), 150);
});

check("fees apply only to the order types configured for them", () => {
  const settings = {
    "ordering.packaging_fee": 30,
    "ordering.packaging_fee_applies_to": ["DELIVERY", "PICKUP"],
    "ordering.service_charge_percent": 10,
    "ordering.service_charge_applies_to": ["DINE_IN"],
  };
  const lines = [{ unitPrice: 1000, quantity: 1 }];

  const dineIn = priceOrder({ lines, type: "DINE_IN", settings });
  assert.equal(num(dineIn.packagingFee), 0, "dine-in should not be charged packaging");
  assert.equal(num(dineIn.serviceCharge), 100);

  const delivery = priceOrder({ lines, type: "DELIVERY", settings });
  assert.equal(num(delivery.packagingFee), 30);
  assert.equal(num(delivery.serviceCharge), 0, "delivery should not be charged a service charge");
});

check("a second round moves the service charge and nothing else", () => {
  /*
   * A round added at a table is priced on its own and added on. The order's
   * existing lines are snapshots — re-resolving them against today's menu
   * would rewrite what was sold, and re-running the promotion engine over the
   * bigger subtotal would award the same offer twice.
   *
   * So the discount already granted is carried at the amount it was granted
   * at, the flat fees stay flat, and only the service charge — which really is
   * a percentage of what is being charged — follows the new subtotal.
   */
  const settings = {
    "ordering.prices_include_tax": true,
    "ordering.service_charge_percent": 10,
    "ordering.service_charge_applies_to": ["DINE_IN"],
  };

  const order = {
    subtotal: 1000,
    discountTotal: 100,
    taxTotal: 0,
    deliveryFee: 0,
    packagingFee: 30,
    serviceCharge: 90,
    tipAmount: 50,
  };

  const after = totalsAfterAdding({ order, addition: { subtotal: 500, taxTotal: 0 }, type: "DINE_IN", settings });

  assert.equal(num(after.subtotal), 1500);
  assert.equal(num(after.discountTotal), 100, "an offer is awarded once, not again per round");
  assert.equal(num(after.serviceCharge), 140, "10% of 1500 less the 100 already discounted");
  assert.equal(num(after.packagingFee), 30, "a flat fee is per order, not per round");
  assert.equal(num(after.tipAmount), 50);
  // 1500 − 100 + 30 + 140 + 50
  assert.equal(num(after.grandTotal), 1620);

  // Removing is adding a negative, so a line taken off and put back leaves the
  // totals exactly where they started.
  const back = totalsAfterAdding({
    order: { ...order, ...after },
    addition: { subtotal: -500, taxTotal: 0 },
    type: "DINE_IN",
    settings,
  });
  assert.equal(num(back.grandTotal), 1070, "1000 − 100 + 30 + 90 + 50");
});

check("exclusive tax on a second round reaches the total", () => {
  const after = totalsAfterAdding({
    order: { subtotal: 1000, discountTotal: 0, taxTotal: 170, deliveryFee: 0, packagingFee: 0, serviceCharge: 0, tipAmount: 0 },
    addition: { subtotal: 500, taxTotal: 85 },
    type: "DINE_IN",
    settings: { "ordering.prices_include_tax": false },
  });
  assert.equal(num(after.taxTotal), 255);
  assert.equal(num(after.grandTotal), 1755, "1500 goods plus 255 tax");
});

check("inclusive tax is not added to the total a second time", () => {
  const result = priceOrder({
    lines: [{ unitPrice: 1170, quantity: 1, taxRates: [{ name: "GST", rate: 17 }] }],
    type: "DINE_IN",
    settings: { "ordering.prices_include_tax": true },
  });
  assert.equal(num(result.taxTotal), 170, "the tax should still be reported");
  assert.equal(num(result.grandTotal), 1170, "but it is already inside the price");
});

check("a discount reduces the taxable base, not just the total", () => {
  const result = priceOrder({
    lines: [{ unitPrice: 1000, quantity: 1, taxRates: [{ name: "GST", rate: 10 }] }],
    type: "DINE_IN",
    settings: { "ordering.prices_include_tax": false },
    discounts: [{ amount: 200 }],
  });
  // Tax is charged on 800, not 1000.
  assert.equal(num(result.taxTotal), 80);
  assert.equal(num(result.grandTotal), 880);
});

check("a discount larger than the order cannot make a negative total", () => {
  const result = priceOrder({
    lines: [{ unitPrice: 100, quantity: 1 }],
    type: "DINE_IN",
    settings: {},
    discounts: [{ amount: 500 }],
  });
  assert.equal(num(result.grandTotal), 0);
});

check("tax lines are grouped by rate for the invoice", () => {
  const rates = [{ id: "gst", name: "GST", rate: 10 }];
  const result = priceOrder({
    lines: [
      { unitPrice: 100, quantity: 1, taxRates: rates },
      { unitPrice: 200, quantity: 1, taxRates: rates },
    ],
    type: "DINE_IN",
    settings: { "ordering.prices_include_tax": false },
  });
  assert.equal(result.taxLines.length, 1, "one rate should produce one invoice line");
  assert.equal(num(result.taxLines[0].amount), 30);
});

// --- order state machine ---------------------------------------------------
check("a dine-in order can never go out for delivery", () => {
  assert.equal(canTransition("DINE_IN", "READY", "OUT_FOR_DELIVERY"), false);
  assert.equal(canTransition("DELIVERY", "READY", "OUT_FOR_DELIVERY"), true);
});

check("an order cannot go backwards", () => {
  assert.equal(canTransition("DELIVERY", "DELIVERED", "PREPARING"), false);
  assert.equal(canTransition("PICKUP", "READY", "PENDING"), false);
});

check("terminal statuses lead nowhere", () => {
  for (const status of ["CANCELLED", "REJECTED"]) {
    assert.deepEqual(allowedTransitions("DELIVERY", status), [], `${status} should be terminal`);
  }
  // A completed order can still be refunded — money outlives fulfilment.
  assert.deepEqual(allowedTransitions("DELIVERY", "COMPLETED"), ["REFUNDED"]);
});

check("an order in a driver's bag cannot be cancelled by walking it back", () => {
  // Cancelling is allowed, but only as an explicit transition to CANCELLED.
  assert.equal(canTransition("DELIVERY", "OUT_FOR_DELIVERY", "CANCELLED"), true);
  assert.equal(canTransition("DELIVERY", "OUT_FOR_DELIVERY", "READY"), false);
});

check("every status the machine can reach is either terminal or has a way out", () => {
  for (const type of ["DELIVERY", "PICKUP", "DINE_IN"]) {
    for (const status of ["PENDING", "CONFIRMED", "PREPARING", "READY"]) {
      assert.ok(
        allowedTransitions(type, status).length > 0,
        `${type}/${status} is a dead end`,
      );
      assert.ok(!TERMINAL_STATUSES.includes(status));
    }
  }
});

check("a kitchen item cannot un-serve itself", () => {
  assert.equal(canTransitionItem("QUEUED", "PREPARING"), true);
  assert.equal(canTransitionItem("READY", "PREPARING"), true, "a mistake can be sent back");
  assert.equal(canTransitionItem("SERVED", "QUEUED"), false);
  assert.equal(canTransitionItem("CANCELLED", "PREPARING"), false);
});


// --- promotions ------------------------------------------------------------
// The rules engine is the one place in the system whose bugs give money away,
// and every one of them is arithmetic, so they are pinned down here rather than
// over HTTP where a fixture would have to exist for each.

const promo = (over = {}) => ({
  id: "p1",
  name: "Test offer",
  type: "PERCENTAGE",
  value: 10,
  isActive: true,
  isStackable: false,
  priority: 0,
  usageCount: 0,
  requiresCoupon: false,
  newCustomersOnly: false,
  branchIds: [],
  channels: [],
  orderTypes: [],
  daysOfWeek: [],
  targets: [],
  ...over,
});

/** A priced line, as the pricing engine hands them over. */
const line = (over = {}) => ({
  productId: "prod1",
  variantId: "var1",
  categoryId: "cat1",
  quantity: 1,
  lineSubtotal: 100,
  ...over,
});

check("an inactive promotion never applies", () => {
  assert.equal(isPromotionEligible(promo({ isActive: false })).eligible, false);
});

check("a promotion outside its date window does not apply", () => {
  const p = promo({ startsAt: "2026-01-01", endsAt: "2026-02-01" });
  assert.equal(isPromotionEligible(p, { at: at("2026-03-01T12:00:00Z") }).reason, "EXPIRED");
  assert.equal(isPromotionEligible(p, { at: at("2025-12-01T12:00:00Z") }).reason, "NOT_STARTED");
  assert.equal(isPromotionEligible(p, { at: at("2026-01-15T12:00:00Z") }).eligible, true);
});

check("an empty branch list means every branch, not no branch", () => {
  assert.equal(isPromotionEligible(promo({ branchIds: [] }), { branchId: "b9" }).eligible, true);
  assert.equal(isPromotionEligible(promo({ branchIds: ["b1"] }), { branchId: "b9" }).reason, "WRONG_BRANCH");
});

check("a happy hour that crosses midnight still applies after midnight", () => {
  // 22:00 to 02:00, stored as 1320 -> 1560.
  const p = promo({ startMinute: 1320, endMinute: 1560 });
  assert.equal(isPromotionEligible(p, { minuteOfDay: 1380 }).eligible, true, "23:00 is inside");
  assert.equal(isPromotionEligible(p, { minuteOfDay: 60 }).eligible, true, "01:00 is inside");
  assert.equal(isPromotionEligible(p, { minuteOfDay: 600 }).reason, "WRONG_TIME", "10:00 is outside");
});

check("a usage limit that has been reached blocks the offer", () => {
  assert.equal(isPromotionEligible(promo({ usageLimit: 5, usageCount: 5 })).reason, "USAGE_LIMIT_REACHED");
  assert.equal(isPromotionEligible(promo({ usageLimit: 5, usageCount: 4 })).eligible, true);
});

check("a coupon-only offer does not fire on its own", () => {
  assert.equal(isPromotionEligible(promo({ requiresCoupon: true }), { hasCoupon: false }).reason, "REQUIRES_COUPON");
  assert.equal(isPromotionEligible(promo({ requiresCoupon: true }), { hasCoupon: true }).eligible, true);
});

check("an exclusion beats an inclusion", () => {
  const p = promo({
    targets: [
      { targetType: "CATEGORY", targetId: "cat1", isExcluded: false },
      { targetType: "PRODUCT", targetId: "prod2", isExcluded: true },
    ],
  });
  const lines = [line({ productId: "prod1" }), line({ productId: "prod2" })];
  const covered = eligibleLines(p, lines);
  assert.equal(covered.length, 1);
  assert.equal(covered[0].productId, "prod1");
});

check("a percentage discount respects its cap", () => {
  const lines = [line({ lineSubtotal: 1000 })];
  const uncapped = computeDiscount(promo({ value: 50 }), { lines, subtotal: 1000 });
  assert.equal(Number(uncapped.amount), 500);

  const capped = computeDiscount(promo({ value: 50, maxDiscountAmount: 200 }), { lines, subtotal: 1000 });
  assert.equal(Number(capped.amount), 200, "the cap is the whole point of a cap");
});

check("a fixed discount can never exceed the order", () => {
  const lines = [line({ lineSubtotal: 50 })];
  const result = computeDiscount(promo({ type: "FIXED_AMOUNT", value: 500 }), { lines, subtotal: 50 });
  assert.equal(Number(result.amount), 50, "a 500-off code on a 50 order is worth 50, not a refund");
});

check("a percentage discount only counts the items it targets", () => {
  const p = promo({ value: 50, targets: [{ targetType: "PRODUCT", targetId: "prod1", isExcluded: false }] });
  const lines = [line({ productId: "prod1", lineSubtotal: 200 }), line({ productId: "prod2", lineSubtotal: 800 })];
  const result = computeDiscount(p, { lines, subtotal: 1000 });
  assert.equal(Number(result.amount), 100, "50% of the targeted 200, not of the whole 1000");
});

check("free delivery leaves its amount for the pricing engine", () => {
  const result = computeDiscount(promo({ type: "FREE_DELIVERY" }), { lines: [line()], subtotal: 100 });
  assert.equal(result.amount, null);
  assert.equal(result.appliesTo, "DELIVERY");
});

check("a free item gives away the cheapest one", () => {
  const lines = [line({ productId: "a", lineSubtotal: 300 }), line({ productId: "b", lineSubtotal: 100 })];
  const result = computeDiscount(promo({ type: "FREE_ITEM", getQuantity: 1 }), { lines, subtotal: 400 });
  assert.equal(Number(result.amount), 100, "not the 300 one");
});

check("buy one get one free counts units, not lines", () => {
  const p = promo({ type: "BUY_X_GET_Y", buyQuantity: 1, getQuantity: 1 });

  // Two units on one line.
  const oneLine = computeDiscount(p, { lines: [line({ quantity: 2, lineSubtotal: 200 })], subtotal: 200 });
  // The same two units, split across lines.
  const twoLines = computeDiscount(p, {
    lines: [line({ quantity: 1, lineSubtotal: 100 }), line({ productId: "b", quantity: 1, lineSubtotal: 100 })],
    subtotal: 200,
  });

  assert.equal(Number(oneLine.amount), 100);
  assert.equal(Number(twoLines.amount), 100, "how the basket is grouped must not change the price");
});

check("buy one get one gives nothing on a single item", () => {
  const p = promo({ type: "BUY_X_GET_Y", buyQuantity: 1, getQuantity: 1 });
  const result = computeDiscount(p, { lines: [line({ quantity: 1, lineSubtotal: 100 })], subtotal: 100 });
  assert.equal(Number(result.amount), 0, "one item is not a pair");
});

check("buy two get one free frees the cheapest of each three", () => {
  const p = promo({ type: "BUY_X_GET_Y", buyQuantity: 2, getQuantity: 1 });
  const lines = [
    line({ productId: "a", quantity: 2, lineSubtotal: 600 }), // 300 each
    line({ productId: "b", quantity: 1, lineSubtotal: 100 }),
  ];
  const result = computeDiscount(p, { lines, subtotal: 700 });
  assert.equal(Number(result.amount), 100, "three units is one group; the cheapest unit is free");
});

check("a bundle price needs the whole bundle", () => {
  const p = promo({
    type: "BUNDLE_PRICE",
    value: 500,
    targets: [
      { targetType: "PRODUCT", targetId: "burger", isExcluded: false },
      { targetType: "PRODUCT", targetId: "fries", isExcluded: false },
    ],
  });

  const half = computeDiscount(p, { lines: [line({ productId: "burger", lineSubtotal: 400 })], subtotal: 400 });
  assert.equal(Number(half.amount), 0, "half a bundle is not a bundle");

  const whole = computeDiscount(p, {
    lines: [line({ productId: "burger", lineSubtotal: 400 }), line({ productId: "fries", lineSubtotal: 300 })],
    subtotal: 700,
  });
  assert.equal(Number(whole.amount), 200, "700 worth of food for 500");
});

check("two stackable offers combine", () => {
  const { discounts } = resolvePromotions({
    promotions: [
      promo({ id: "a", value: 10, isStackable: true }),
      promo({ id: "b", type: "FIXED_AMOUNT", value: 50, isStackable: true }),
    ],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.equal(discounts.length, 2);
  assert.equal(discounts.reduce((total, d) => total + Number(d.amount), 0), 150);
});

check("two non-stackable offers do not: the better one wins", () => {
  const { discounts } = resolvePromotions({
    promotions: [promo({ id: "a", value: 10 }), promo({ id: "b", value: 30 })],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.equal(discounts.length, 1);
  assert.equal(Number(discounts[0].amount), 300, "the customer gets the better of the two");
});

check("a single big exclusive offer beats a set of small stackable ones", () => {
  const { discounts } = resolvePromotions({
    promotions: [
      promo({ id: "big", value: 50 }),
      promo({ id: "s1", value: 5, isStackable: true }),
      promo({ id: "s2", value: 5, isStackable: true }),
    ],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.equal(discounts.length, 1);
  assert.equal(Number(discounts[0].amount), 500);
});

check("a non-stackable coupon shuts out the automatic offers", () => {
  const { discounts } = resolvePromotions({
    promotions: [promo({ id: "auto", value: 20, isStackable: true })],
    coupons: [{ id: "c1", code: "SAVE", promotion: promo({ id: "cp", type: "FIXED_AMOUNT", value: 100 }) }],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.equal(discounts.length, 1);
  assert.equal(discounts[0].source, "COUPON");
});

check("a typed coupon is applied even when an automatic offer is worth more", () => {
  const { discounts } = resolvePromotions({
    promotions: [promo({ id: "auto", value: 40, isStackable: true })],
    coupons: [
      { id: "c1", code: "SMALL", promotion: promo({ id: "cp", type: "FIXED_AMOUNT", value: 10, isStackable: true }) },
    ],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.ok(discounts.some((d) => d.source === "COUPON"), "the code they went and found still counts");
});

check("a delivery waiver does not compete with a subtotal discount", () => {
  const { discounts } = resolvePromotions({
    promotions: [promo({ id: "pct", value: 10 }), promo({ id: "ship", type: "FREE_DELIVERY" })],
    lines: [line({ lineSubtotal: 1000 })],
    subtotal: 1000,
  });
  assert.equal(discounts.length, 2, "they come off different numbers");
  assert.ok(discounts.some((d) => d.appliesTo === "DELIVERY"));
});

check("an offer below its minimum is rejected with a reason", () => {
  const { discounts, rejected } = resolvePromotions({
    promotions: [promo({ minOrderAmount: 1000 })],
    lines: [line({ lineSubtotal: 100 })],
    subtotal: 100,
  });
  assert.equal(discounts.length, 0);
  assert.equal(rejected[0].reason, "BELOW_MINIMUM");
  assert.ok(rejected[0].message.length > 0, "the customer is told why");
});

// --- discounts through the pricing engine ----------------------------------

check("free delivery waives the fee without shrinking the taxable base", () => {
  const lines = [{ unitPrice: 1000, quantity: 1, taxRates: [{ id: "t", name: "GST", rate: 10 }] }];
  const settings = { "ordering.prices_include_tax": false, "ordering.delivery_fee": 200 };

  const plain = priceOrder({ lines, type: "DELIVERY", settings });
  const waived = priceOrder({
    lines,
    type: "DELIVERY",
    settings,
    discounts: [{ source: "PROMOTION", label: "Free delivery", appliesTo: "DELIVERY", amount: null }],
  });

  assert.equal(Number(waived.taxTotal), Number(plain.taxTotal), "waiving delivery does not make the food cheaper");
  assert.equal(Number(waived.discountTotal), 200);
  assert.equal(Number(waived.grandTotal), Number(plain.grandTotal) - 200);
});

check("a free-delivery code on an order that already has free delivery is worth nothing", () => {
  const lines = [{ unitPrice: 1000, quantity: 1, taxRates: [] }];
  const priced = priceOrder({
    lines,
    type: "PICKUP",
    settings: { "ordering.delivery_fee": 200 },
    discounts: [{ source: "COUPON", label: "Free delivery", appliesTo: "DELIVERY", amount: null }],
  });

  assert.equal(Number(priced.discountTotal), 0, "there is no fee to waive on a pickup");
  assert.equal(priced.discounts.length, 0);
});

check("stacked discounts larger than the order are clamped per row, not just in total", () => {
  const lines = [{ unitPrice: 100, quantity: 1, taxRates: [] }];
  const priced = priceOrder({
    lines,
    settings: {},
    discounts: [
      { source: "PROMOTION", label: "A", amount: 60 },
      { source: "PROMOTION", label: "B", amount: 60 },
    ],
  });

  const rows = priced.discounts.reduce((total, d) => total + Number(d.amount), 0);
  assert.equal(Number(priced.discountTotal), 100);
  assert.equal(rows, 100, "the rows on the invoice must add up to the discount charged");
  assert.equal(Number(priced.grandTotal), 0);
});

check("a discount reduces the service charge with it", () => {
  const lines = [{ unitPrice: 1000, quantity: 1, taxRates: [] }];
  const settings = { "ordering.service_charge_percent": 10, "ordering.service_charge_applies_to": ["DINE_IN"] };

  const full = priceOrder({ lines, type: "DINE_IN", settings });
  const discounted = priceOrder({
    lines,
    type: "DINE_IN",
    settings,
    discounts: [{ source: "MANUAL", label: "Goodwill", amount: 500 }],
  });

  assert.equal(Number(full.serviceCharge), 100);
  assert.equal(Number(discounted.serviceCharge), 50, "a service charge is a share of what is actually paid");
});

// --- promotion coherence ---------------------------------------------------

check("a percentage over 100 is refused at write time", () => {
  assert.throws(() => assertPromotionIsCoherent({ type: "PERCENTAGE", value: 150 }));
  assert.doesNotThrow(() => assertPromotionIsCoherent({ type: "PERCENTAGE", value: 15 }));
});

check("buy-x-get-y without its quantities is refused", () => {
  assert.throws(() => assertPromotionIsCoherent({ type: "BUY_X_GET_Y", value: 0 }));
  assert.doesNotThrow(() =>
    assertPromotionIsCoherent({ type: "BUY_X_GET_Y", buyQuantity: 1, getQuantity: 1 }),
  );
});

check("half a time window is refused", () => {
  assert.throws(() => assertPromotionIsCoherent({ type: "PERCENTAGE", value: 10, startMinute: 600 }));
  assert.doesNotThrow(() =>
    assertPromotionIsCoherent({ type: "PERCENTAGE", value: 10, startMinute: 600, endMinute: 900 }),
  );
});

check("an end date before its start is refused", () => {
  assert.throws(() =>
    assertPromotionIsCoherent({
      type: "PERCENTAGE",
      value: 10,
      startsAt: "2026-06-01",
      endsAt: "2026-05-01",
    }),
  );
});

// --- tax --------------------------------------------------------------------

check("a compound rate stacks on the tax before it", () => {
  assert.equal(effectiveRate([{ rate: 10, isCompound: false, sortOrder: 0 }]), 10);
  assert.equal(
    effectiveRate([
      { rate: 10, isCompound: false, sortOrder: 0 },
      { rate: 5, isCompound: true, sortOrder: 1 },
    ]),
    15.5,
    "5% of 110 is 5.5, so the pair is 15.5% — not 15%",
  );
});


// --- payment state ---------------------------------------------------------
// `Order.paymentState` summarises many payment and refund rows. Every time this
// is wrong, the summary disagrees with the money — so the awkward combinations
// are pinned down here rather than discovered on a Friday night.

const pay = (amount, status = "CAPTURED") => ({ amount, status });
const ref = (amount, status = "COMPLETED") => ({ amount, status });

check("an order with no payments is unpaid", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [], refunds: [] }), "UNPAID");
});

check("a fully captured order is paid", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(1000)] }), "PAID");
});

check("a split bill is paid only once the parts add up", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(400)] }), "PARTIALLY_PAID");
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(400), pay(600)] }), "PAID");
});

check("an authorisation is not a payment", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(1000, "AUTHORIZED")] }), "AUTHORIZED");
});

check("a declined card next to a pending cash payment is not a failed order", () => {
  const state = derivePaymentState({
    grandTotal: 1000,
    payments: [pay(1000, "FAILED"), pay(1000, "PENDING")],
  });
  assert.equal(state, "UNPAID", "the customer still has a way to pay");
});

check("an order where every attempt failed is failed", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(1000, "FAILED")] }), "FAILED");
});

check("a paid then refunded order is refunded, not paid", () => {
  const state = derivePaymentState({ grandTotal: 1000, payments: [pay(1000)], refunds: [ref(1000)] });
  assert.equal(state, "REFUNDED", "the captured total still covers the bill, but the money went back");
});

check("a partial refund is partially refunded", () => {
  assert.equal(
    derivePaymentState({ grandTotal: 1000, payments: [pay(1000)], refunds: [ref(300)] }),
    "PARTIALLY_REFUNDED",
  );
});

check("a refund that has not completed does not count as refunded", () => {
  const state = derivePaymentState({
    grandTotal: 1000,
    payments: [pay(1000)],
    refunds: [ref(1000, "REQUESTED"), ref(1000, "APPROVED"), ref(1000, "PROCESSING")],
  });
  assert.equal(state, "PAID", "the customer is still waiting for the money");
});

check("a rejected refund never reduces what was collected", () => {
  assert.equal(derivePaymentState({ grandTotal: 1000, payments: [pay(1000)], refunds: [ref(1000, "REJECTED")] }), "PAID");
});

check("a zero-total order is not silently marked paid", () => {
  assert.equal(derivePaymentState({ grandTotal: 0, payments: [] }), "UNPAID");
});

check("refunding across two payments still lands on refunded", () => {
  const state = derivePaymentState({
    grandTotal: 1000,
    payments: [pay(400), pay(600)],
    refunds: [ref(400), ref(600)],
  });
  assert.equal(state, "REFUNDED");
});

check("amount due never goes negative on an overpayment", () => {
  assert.equal(Number(amountDue({ grandTotal: 1000, payments: [pay(1200)] })), 0, "an overpayment is a refund, not a credit");
});

check("amount due accounts for refunds", () => {
  assert.equal(Number(amountDue({ grandTotal: 1000, payments: [pay(1000)], refunds: [ref(300)] })), 300);
});

check("totals separate captured from authorised", () => {
  const totals = paymentTotals([pay(500), pay(200, "AUTHORIZED"), pay(100, "FAILED")], []);
  assert.equal(Number(totals.captured), 500);
  assert.equal(Number(totals.authorized), 200);
  assert.equal(totals.failedCount, 1);
});

check("a partially refunded payment still counts as money that was taken", () => {
  const totals = paymentTotals([pay(1000, "PARTIALLY_REFUNDED")], [ref(200)]);
  assert.equal(Number(totals.captured), 1000);
  assert.equal(Number(totals.netCaptured), 800);
});

// --- payment providers -----------------------------------------------------

check("every registered provider implements the adapter interface", () => {
  for (const summary of listProviders()) {
    const provider = getProvider(summary.name);
    for (const method of ["createIntent", "capture", "void", "refund", "verifySignature", "parseEvent"]) {
      assert.equal(typeof provider[method], "function", `${summary.name} is missing ${method}`);
    }
  }
});

check("an unknown provider is rejected, not silently defaulted", () => {
  assert.throws(() => getProvider("definitely-not-a-gateway"));
});

check("the cash provider never claims a callback is genuine", () => {
  const cash = getProvider("cash");
  assert.equal(cash.verifySignature({ rawBody: "{}", headers: {} }), false, "nothing calls back, so nothing can be forged");
  assert.equal(cash.supportsOnline, false);
});

check("the mock provider rejects an unsigned webhook", () => {
  const mock = getProvider("mock");
  assert.equal(mock.verifySignature({ rawBody: "{}", headers: {} }), false);
});

check("the mock provider verifies a correct signature over the raw body", () => {
  const mock = getProvider("mock");
  const rawBody = JSON.stringify({ id: "evt_1", type: "payment.succeeded" });
  const signature = hmacSha256(rawBody, mock.secret());

  assert.equal(mock.verifySignature({ rawBody, headers: { "x-mock-signature": signature } }), true);
  // The same payload re-serialised with different spacing must NOT verify —
  // that is exactly the bug that makes a signature check useless.
  const respaced = JSON.stringify({ id: "evt_1", type: "payment.succeeded" }, null, 2);
  assert.equal(mock.verifySignature({ rawBody: respaced, headers: { "x-mock-signature": signature } }), false);
});


// --- delivery state machine ------------------------------------------------
// The rules here are about sequence: a driver cannot deliver food they never
// collected, and a job cannot be taken back off someone already carrying it.

check("a delivery follows the road in order", () => {
  assert.equal(canTransitionDelivery("PENDING", "ASSIGNED"), true);
  assert.equal(canTransitionDelivery("ASSIGNED", "ACCEPTED"), true);
  assert.equal(canTransitionDelivery("ACCEPTED", "PICKED_UP"), true);
  assert.equal(canTransitionDelivery("PICKED_UP", "ON_THE_WAY"), true);
  assert.equal(canTransitionDelivery("ON_THE_WAY", "DELIVERED"), true);
});

check("food cannot be delivered before it is collected", () => {
  assert.equal(canTransitionDelivery("PENDING", "DELIVERED"), false);
  assert.equal(canTransitionDelivery("ASSIGNED", "DELIVERED"), false);
  assert.equal(canTransitionDelivery("ACCEPTED", "DELIVERED"), false);
});

check("an unaccepted job goes back to the pool", () => {
  assert.equal(canTransitionDelivery("ASSIGNED", "PENDING"), true);
  assert.equal(canTransitionDelivery("REJECTED", "PENDING"), true);
  assert.equal(canTransitionDelivery("ACCEPTED", "PENDING"), true);
});

check("a job cannot go back to the pool once the food is in the bag", () => {
  for (const status of IN_POSSESSION) {
    assert.equal(canTransitionDelivery(status, "PENDING"), false, `${status} should not return to the pool`);
    assert.equal(canTransitionDelivery(status, "ASSIGNED"), false, `${status} should not be reassignable`);
  }
});

check("a delivered order is the end of the road", () => {
  assert.deepEqual(allowedDeliveryTransitions("DELIVERED"), []);
  assert.deepEqual(allowedDeliveryTransitions("CANCELLED"), []);
});

check("a failed delivery can be retried, a delivered one cannot", () => {
  assert.ok(allowedDeliveryTransitions("FAILED").includes("PENDING"), "a failed drop goes back for another attempt");
  assert.equal(canTransitionDelivery("DELIVERED", "PENDING"), false);
});

check("every non-terminal delivery state has a way out", () => {
  for (const status of Object.keys(DELIVERY_TRANSITIONS)) {
    if (TERMINAL_DELIVERY_STATUSES.includes(status)) continue;
    assert.ok(allowedDeliveryTransitions(status).length > 0, `${status} is a dead end`);
  }
});

check("a driver may move their own job forward but not cancel the order", () => {
  assert.equal(driverMayTransition("ASSIGNED", "ACCEPTED"), true);
  assert.equal(driverMayTransition("PICKED_UP", "DELIVERED"), true);
  assert.equal(driverMayTransition("ACCEPTED", "FAILED"), true);
  assert.equal(driverMayTransition("ASSIGNED", "CANCELLED"), false, "cancelling an order is dispatch's call");
});

check("a driver cannot hand a job back after collecting the food", () => {
  assert.equal(canTransitionDelivery("ACCEPTED", "PENDING"), true, "dispatch can, before pickup");
  assert.equal(driverMayTransition("ACCEPTED", "PENDING"), false, "but a driver never sends work back to the pool");
  assert.equal(driverMayTransition("PICKED_UP", "PENDING"), false);
});

check("only pickup and delivery are mirrored onto the order", () => {
  assert.equal(ORDER_STATUS_FOR_DELIVERY.PICKED_UP, "OUT_FOR_DELIVERY");
  assert.equal(ORDER_STATUS_FOR_DELIVERY.DELIVERED, "DELIVERED");
  // Intermediate driver steps are detail the order does not need.
  assert.equal(ORDER_STATUS_FOR_DELIVERY.ACCEPTED, undefined);
  assert.equal(ORDER_STATUS_FOR_DELIVERY.ARRIVED, undefined);
});

check("carrying the food counts against a driver's active slots", () => {
  for (const status of IN_POSSESSION) {
    assert.ok(ACTIVE_STATUSES.includes(status), `${status} must occupy a slot`);
  }
  assert.ok(!ACTIVE_STATUSES.includes("DELIVERED"), "a finished drop frees the slot");
  assert.ok(!ACTIVE_STATUSES.includes("FAILED"));
  assert.ok(!ACTIVE_STATUSES.includes("PENDING"), "an unassigned job is nobody's slot");
});


// --- unit conversion -------------------------------------------------------
// The quietest and most expensive class of inventory bug: a recipe calling for
// 200g of something stocked in kg must deduct 0.2, not 200.

const kg = { id: "kg", code: "kg", type: "WEIGHT", factor: 1000, baseUnitId: null };
const g = { id: "g", code: "g", type: "WEIGHT", factor: 1, baseUnitId: "base" };
const litre = { id: "l", code: "l", type: "VOLUME", factor: 1000, baseUnitId: null };

check("converting grams to kilograms divides, not multiplies", () => {
  // kg is a base (factor ignored), g converts at 1 to the base.
  const kgAsBase = { id: "kg", code: "kg", type: "WEIGHT", factor: 1, baseUnitId: null };
  const gram = { id: "g", code: "g", type: "WEIGHT", factor: 0.001, baseUnitId: "kg" };
  assert.equal(Number(convertQuantity({ quantity: 200, from: gram, to: kgAsBase })), 0.2);
});

check("converting the same unit is a no-op", () => {
  assert.equal(Number(convertQuantity({ quantity: 5, from: kg, to: kg })), 5);
});

check("converting across measurement types is refused, not guessed", () => {
  assert.throws(
    () => convertQuantity({ quantity: 2, from: litre, to: kg }),
    "2 litres of something sold by weight is a mistake, not a conversion",
  );
});

check("a unit cost converts the opposite way to a quantity", () => {
  const kgAsBase = { id: "kg", code: "kg", type: "WEIGHT", factor: 1, baseUnitId: null };
  const gram = { id: "g", code: "g", type: "WEIGHT", factor: 0.001, baseUnitId: "kg" };
  // 500 per kg is 0.5 per gram — not 500,000.
  assert.equal(Number(convertUnitCost({ unitCost: 500, from: kgAsBase, to: gram })), 0.5);
});

check("yield grosses up what has to leave the shelf", () => {
  // An item yielding 80% means 800g on the plate needs 1kg drawn.
  assert.equal(Number(grossUpForYield({ net: 800, yieldPercent: 80 })), 1000);
  assert.equal(Number(grossUpForYield({ net: 800, yieldPercent: 100 })), 800, "a full yield changes nothing");
});

// --- FIFO ------------------------------------------------------------------

const batch = (id, qty, cost, expiry = null, received = "2026-01-01") => ({
  id,
  remainingQuantity: qty,
  unitCost: cost,
  expiryDate: expiry,
  receivedAt: received,
  status: "ACTIVE",
});

check("stock that expires soonest leaves first", () => {
  const ordered = orderBatchesForConsumption([
    batch("later", 10, 5, "2026-03-01", "2026-01-01"),
    batch("sooner", 10, 5, "2026-02-01", "2026-01-05"),
  ]);
  assert.equal(ordered[0].id, "sooner", "expiry beats receipt date, or the older batch is thrown away");
});

check("with no expiry, oldest stock leaves first", () => {
  const ordered = orderBatchesForConsumption([
    batch("new", 10, 5, null, "2026-02-01"),
    batch("old", 10, 5, null, "2026-01-01"),
  ]);
  assert.equal(ordered[0].id, "old");
});

check("FIFO consumes across batches at the price each was bought for", () => {
  const result = allocateFifo({
    batches: [batch("a", 5, 10, null, "2026-01-01"), batch("b", 10, 20, null, "2026-02-01")],
    required: 8,
  });

  assert.equal(result.allocations.length, 2);
  assert.equal(Number(result.allocations[0].quantity), 5);
  assert.equal(Number(result.allocations[1].quantity), 3);
  // 5 at 10 plus 3 at 20 is 110, not 8 at either price.
  assert.equal(Number(result.totalCost), 110);
  assert.equal(Number(result.shortfall), 0);
});

check("FIFO reports a shortfall rather than inventing stock", () => {
  const result = allocateFifo({ batches: [batch("a", 3, 10)], required: 10 });
  assert.equal(Number(result.shortfall), 7);
  assert.equal(Number(result.totalCost), 30, "only what existed is costed");
});

check("a depleted batch is flagged so it stops being offered", () => {
  const result = allocateFifo({ batches: [batch("a", 5, 10)], required: 5 });
  assert.equal(result.allocations[0].depletes, true);
});

check("quarantined batches are not allocated", () => {
  const held = { ...batch("q", 100, 10), status: "QUARANTINED" };
  const result = allocateFifo({ batches: [held, batch("ok", 2, 10)], required: 5 });
  assert.equal(Number(result.shortfall), 3, "the quarantined 100 must not be used");
});

// --- weighted average ------------------------------------------------------

check("weighted average blends by quantity", () => {
  // 10 at 100 plus 10 at 200 averages 150.
  const blended = newWeightedAverage({
    currentQuantity: 10,
    currentCost: 100,
    incomingQuantity: 10,
    incomingCost: 200,
  });
  assert.equal(Number(blended), 150);
});

check("receiving against zero stock takes the incoming cost", () => {
  const blended = newWeightedAverage({
    currentQuantity: 0,
    currentCost: 999,
    incomingQuantity: 5,
    incomingCost: 50,
  });
  assert.equal(Number(blended), 50, "there is nothing to blend with");
});

check("receiving against negative stock does not produce a nonsense average", () => {
  const blended = newWeightedAverage({
    currentQuantity: -20,
    currentCost: 100,
    incomingQuantity: 10,
    incomingCost: 50,
  });
  assert.equal(Number(blended), 50, "blending against a negative balance would price every plate wrong");
});

// --- landed cost -----------------------------------------------------------

check("freight is spread by line value, not evenly", () => {
  const allocated = allocateLandedCost({
    lines: [{ lineTotal: 900 }, { lineTotal: 100 }],
    landedCost: 100,
  });
  assert.equal(Number(allocated[0].landedShare), 90);
  assert.equal(Number(allocated[1].landedShare), 10);
});

check("the spread always adds back to the whole", () => {
  const allocated = allocateLandedCost({
    lines: [{ lineTotal: 33.33 }, { lineTotal: 33.33 }, { lineTotal: 33.34 }],
    landedCost: 10,
  });
  const total = allocated.reduce((sum, line) => sum + Number(line.landedShare), 0);
  assert.equal(Math.round(total * 10000) / 10000, 10, "rounding must not lose or invent money");
});

check("no freight leaves the lines untouched", () => {
  const allocated = allocateLandedCost({ lines: [{ lineTotal: 500 }], landedCost: 0 });
  assert.equal(Number(allocated[0].landedShare), 0);
});

check("landed unit cost includes the freight on that line", () => {
  // 10 units costing 1000 with 100 freight is 110 each, not 100.
  const cost = landedUnitCost({ quantity: 10, lineTotal: 1000, landedShare: 100 });
  assert.equal(Number(cost), 110);
});

// --- ledger direction ------------------------------------------------------

check("movement direction comes from the type, not the caller's sign", () => {
  // A wastage sent as a positive number must still remove stock.
  assert.equal(Number(directionFor("WASTAGE", 5)), -5);
  assert.equal(Number(directionFor("SALE_OUT", 5)), -5);
  assert.equal(Number(directionFor("PURCHASE_IN", 5)), 5);
  assert.equal(Number(directionFor("ADJUSTMENT_OUT", 5)), -5, "an out sent positive must not add stock");
});

check("a count correction keeps the caller's sign", () => {
  // A count is the one case where the sign is the finding.
  assert.equal(Number(directionFor("COUNT_CORRECTION", -3)), -3);
  assert.equal(Number(directionFor("COUNT_CORRECTION", 3)), 3);
});

check("outbound types are exactly the ones that remove stock", () => {
  for (const type of ["SALE_OUT", "WASTAGE", "TRANSFER_OUT", "ADJUSTMENT_OUT", "RETURN_TO_SUPPLIER"]) {
    assert.equal(isOutbound(type), true, `${type} should reduce stock`);
  }
  for (const type of ["PURCHASE_IN", "TRANSFER_IN", "ADJUSTMENT_IN", "CUSTOMER_RETURN", "PRODUCTION_IN"]) {
    assert.equal(isOutbound(type), false, `${type} should add stock`);
  }
});


// --- Phase 10: recipe explosion ---------------------------------------------

const KG = { id: "kg", code: "kg", type: "WEIGHT", factor: 1000, baseUnitId: "g", precision: 3 };
const G = { id: "g", code: "g", type: "WEIGHT", factor: 1, baseUnitId: null, precision: 0 };
const L = { id: "l", code: "L", type: "VOLUME", factor: 1000, baseUnitId: "ml", precision: 3 };
const ML = { id: "ml", code: "ml", type: "VOLUME", factor: 1, baseUnitId: null, precision: 0 };

check("a recipe ingredient converts into the item's stocking unit", () => {
  // 200 g of an item stocked in kg is 0.2, not 200. Getting this backwards
  // empties a store room and makes every plate cost a thousand times too much.
  const required = requiredQuantity({
    ingredient: { quantity: 200, uom: G, item: { yieldPercent: 100, uom: KG } },
    multiplier: 1,
    yieldQuantity: 1,
  });
  assert.equal(Number(required), 0.2);
});

check("recipe wastage is added on top of the quantity", () => {
  const required = requiredQuantity({
    ingredient: { quantity: 100, wastagePercent: 10, uom: G, item: { yieldPercent: 100, uom: G } },
    multiplier: 1,
    yieldQuantity: 1,
  });
  assert.equal(Number(required), 110);
});

check("item yield is grossed up after the unit conversion", () => {
  // 800 g needed from an item that yields 80% draws 1 kg off the shelf.
  const required = requiredQuantity({
    ingredient: { quantity: 800, uom: G, item: { yieldPercent: 80, uom: G } },
    multiplier: 1,
    yieldQuantity: 1,
  });
  assert.equal(Number(required), 1000);
});

check("a recipe that yields four portions draws a quarter per portion", () => {
  const required = requiredQuantity({
    ingredient: { quantity: 1000, uom: G, item: { yieldPercent: 100, uom: G } },
    multiplier: 1,
    yieldQuantity: 4,
  });
  assert.equal(Number(required), 250);
});

check("a sub-recipe line converts into the sub-recipe's yield unit", () => {
  // "200 ml of sauce" against a sauce recipe that yields in litres must hand
  // 0.2 to the recursion, not 200 — otherwise the sub-recipe is exploded a
  // thousand times over and the store room empties.
  const required = requiredQuantity({
    ingredient: { quantity: 200, uom: ML, subRecipe: { yieldUom: L } },
    multiplier: 1,
    yieldQuantity: 1,
  });
  assert.equal(Number(required), 0.2);
});

check("a sub-recipe line is not grossed up for item yield", () => {
  // Yield belongs to the sub-recipe's own ingredients, one level down.
  const required = requiredQuantity({
    ingredient: { quantity: 1, uom: L, subRecipe: { yieldUom: L } },
    multiplier: 1,
    yieldQuantity: 1,
  });
  assert.equal(Number(required), 1);
});

check("an ingredient used twice is merged into one line", () => {
  // Cheese in the recipe and cheese in a modifier is one deduction, not two.
  const merged = mergeLines([
    { itemId: "cheese", quantity: 0.03, name: "Cheese" },
    { itemId: "beef", quantity: 0.18, name: "Beef" },
    { itemId: "cheese", quantity: 0.02, name: "Cheese" },
  ]);
  assert.equal(merged.length, 2);
  assert.equal(Number(merged.find((line) => line.itemId === "cheese").quantity), 0.05);
});

check("recipes may not nest without limit", () => {
  assert.ok(MAX_RECIPE_DEPTH > 0 && MAX_RECIPE_DEPTH <= 10);
});

// --- Phase 10: recipe costing ------------------------------------------------

check("a roll-up is per output unit, not per batch", () => {
  // 20 portions costing 400 in total is 20 a portion. Storing 400 against the
  // variant would make every plate look twenty times dearer.
  const rolled = rollUpCost({
    ingredientCosts: [300, 60],
    laborCost: 30,
    overheadCost: 10,
    yieldQuantity: 20,
  });
  assert.equal(Number(rolled.materialCost), 360);
  assert.equal(Number(rolled.totalCost), 400);
  assert.equal(Number(rolled.unitCost), 20);
});

check("labour and overhead are inside the roll-up", () => {
  const withLabour = rollUpCost({ ingredientCosts: [100], laborCost: 50, overheadCost: 25, yieldQuantity: 1 });
  const without = rollUpCost({ ingredientCosts: [100], yieldQuantity: 1 });
  assert.equal(Number(withLabour.unitCost), 175);
  assert.equal(Number(without.unitCost), 100);
});

check("a recipe yielding nothing does not divide by zero", () => {
  const rolled = rollUpCost({ ingredientCosts: [100], yieldQuantity: 0 });
  assert.equal(Number(rolled.unitCost), 100);
});

check("by-products are credited and the primary output absorbs the rest", () => {
  // Nobody runs a stock pot to make bones, so the bones must not carry away
  // part of the cost of the roast.
  const allocated = allocateOutputCosts({
    totalCost: 1000,
    outputs: [
      { itemId: "roast", quantity: 10, isPrimary: true },
      { itemId: "trim", quantity: 5, isPrimary: false, standardUnitCost: 20 },
    ],
  });

  const roast = allocated.find((row) => row.itemId === "roast");
  const trim = allocated.find((row) => row.itemId === "trim");
  assert.equal(Number(trim.totalCost), 100);
  assert.equal(Number(roast.totalCost), 900);
  assert.equal(Number(roast.unitCost), 90);
});

check("a primary output never absorbs a negative cost", () => {
  // By-products notionally worth more than the run is a data problem, not a
  // reason to book negative stock.
  const allocated = allocateOutputCosts({
    totalCost: 50,
    outputs: [
      { itemId: "main", quantity: 1, isPrimary: true },
      { itemId: "side", quantity: 10, isPrimary: false, standardUnitCost: 20 },
    ],
  });
  assert.equal(Number(allocated.find((row) => row.itemId === "main").totalCost), 0);
});

check("two primary outputs share the remainder by quantity", () => {
  const allocated = allocateOutputCosts({
    totalCost: 300,
    outputs: [
      { itemId: "a", quantity: 2, isPrimary: true },
      { itemId: "b", quantity: 1, isPrimary: true },
    ],
  });
  assert.equal(Number(allocated.find((row) => row.itemId === "a").totalCost), 200);
  assert.equal(Number(allocated.find((row) => row.itemId === "b").totalCost), 100);
});

check("food cost percent is null when there is no price, never zero", () => {
  // An uncosted dish reported as 0% would head the most-profitable list.
  assert.equal(foodCostPercent({ cost: 30, price: 0 }), null);
  assert.equal(foodCostPercent({ cost: 30, price: null }), null);
  assert.equal(foodCostPercent({ cost: 30, price: 100 }), 30);
});

check("contribution margin is price less cost", () => {
  assert.equal(Number(contributionMargin({ cost: 30, price: 100 })), 70);
  assert.equal(contributionMargin({ cost: 30, price: null }), null);
});

// --- Phase 10: variances -----------------------------------------------------

check("spending more than standard is unfavourable", () => {
  const over = variance({ standard: 100, actual: 120 });
  assert.equal(Number(over.variance), 20);
  assert.equal(over.variancePercent, 20);
  assert.equal(over.favourable, false);
});

check("spending less than standard is favourable", () => {
  const under = variance({ standard: 100, actual: 80 });
  assert.equal(Number(under.variance), -20);
  assert.equal(under.favourable, true);
});

check("producing more than planned is favourable, unlike spending more", () => {
  // The same sign means opposite things for cost and for output; mixing them
  // up inverts the whole report.
  const output = variance({ standard: 100, actual: 120, higherIsBetter: true });
  assert.equal(output.favourable, true);
});

check("a variance against a zero standard does not divide by zero", () => {
  const none = variance({ standard: 0, actual: 50 });
  assert.equal(Number(none.variance), 50);
  assert.equal(none.variancePercent, 0);
});

check("yield variance reports what came out as a percentage of the plan", () => {
  const yields = yieldVariance({ planned: 20, produced: 18, wasted: 2 });
  assert.equal(yields.yieldPercent, 90);
  assert.equal(Number(yields.shortfall), 2);
  assert.equal(yields.favourable, false);
});

check("hitting the planned yield is favourable and has no shortfall", () => {
  const yields = yieldVariance({ planned: 20, produced: 20 });
  assert.equal(yields.yieldPercent, 100);
  assert.equal(Number(yields.shortfall), 0);
  assert.equal(yields.favourable, true);
});

check("a material variance splits into price and usage", () => {
  // The two have different owners: price is the buyer's, usage is the
  // kitchen's. One combined number tells nobody what to fix.
  const split = materialVariance({
    standardQuantity: 10,
    actualQuantity: 12,
    standardUnitCost: 5,
    actualUnitCost: 6,
  });
  assert.equal(Number(split.standardCost), 50);
  assert.equal(Number(split.actualCost), 72);
  assert.equal(Number(split.priceVariance), 12);
  assert.equal(Number(split.usageVariance), 10);
  assert.equal(Number(split.totalVariance), 22);
  assert.equal(split.favourable, false);
});

check("the two material variances always add back to the total", () => {
  const split = materialVariance({
    standardQuantity: 7.5,
    actualQuantity: 6.25,
    standardUnitCost: 3.2,
    actualUnitCost: 2.8,
  });
  const sum = Number(split.priceVariance) + Number(split.usageVariance);
  assert.equal(Number(split.totalVariance), Number(sum.toFixed(4)));
  assert.equal(Number(split.actualCost) - Number(split.standardCost), Number(sum.toFixed(4)));
});

check("a material variance with no actual price assumes the standard one", () => {
  const split = materialVariance({ standardQuantity: 10, actualQuantity: 11, standardUnitCost: 4 });
  assert.equal(Number(split.priceVariance), 0);
  assert.equal(Number(split.usageVariance), 4);
});

// --- Phase 10: production state ---------------------------------------------

check("a production run follows plan, start, complete", () => {
  assert.equal(canTransitionProduction("PLANNED", "IN_PROGRESS"), true);
  assert.equal(canTransitionProduction("IN_PROGRESS", "COMPLETED"), true);
  assert.equal(canTransitionProduction("PLANNED", "COMPLETED"), false);
});

check("a completed run is terminal", () => {
  // Re-opening it would mean unbooking finished stock that has likely been
  // sold, and re-costing history under it.
  assert.deepEqual(allowedProductionTransitions("COMPLETED"), []);
  assert.deepEqual(allowedProductionTransitions("CANCELLED"), []);
  assert.equal(canTransitionProduction("COMPLETED", "IN_PROGRESS"), false);
});

check("a run can be cancelled before or during, never after", () => {
  assert.equal(canTransitionProduction("PLANNED", "CANCELLED"), true);
  assert.equal(canTransitionProduction("IN_PROGRESS", "CANCELLED"), true);
  assert.equal(canTransitionProduction("COMPLETED", "CANCELLED"), false);
});

check("every production status has a transition list", () => {
  for (const status of ["PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
    assert.ok(Array.isArray(PRODUCTION_TRANSITIONS[status]), `${status} missing`);
  }
});


// --- rate limiting ----------------------------------------------------------

// Awaited out here: `check` is synchronous, so an async body would report PASS
// even when it threw.
const rateLimitKey = `unit-test-${Date.now()}`;
const rateLimitConfig = { limit: 1, windowMs: 60_000 };
await enforceRateLimit(rateLimitKey, rateLimitConfig);

let rateLimitRejection = null;
try {
  await enforceRateLimit(rateLimitKey, rateLimitConfig);
} catch (error) {
  rateLimitRejection = error;
}

check("a rejected request still carries the rate-limit reading", () => {
  // The 429 is the one response where a client most needs to know when the
  // window resets, and it used to be the only one that went out without it.
  assert.ok(rateLimitRejection, "the second call should have been refused");
  assert.equal(rateLimitRejection.status, 429);
  assert.ok(rateLimitRejection.rateLimit, "the reading should ride along on the error");

  const headers = rateLimitHeaders(rateLimitRejection.rateLimit);
  assert.equal(headers["RateLimit-Limit"], "1");
  assert.equal(headers["RateLimit-Remaining"], "0");
  assert.ok(Number(headers["RateLimit-Reset"]) > 0);
});


// --- Phase 11: double-entry arithmetic --------------------------------------

const sumOf = (lines) => totals(lines);

check("a balanced entry passes and reports its totals", () => {
  const result = assertBalanced([debitLine("1100", 100), creditLine("4100", 100)]);
  assert.equal(Number(result.totalDebit), 100);
  assert.equal(Number(result.totalCredit), 100);
  assert.equal(result.balanced, true);
});

check("an entry that does not balance is refused with the difference", () => {
  // "out of balance by 0.01" tells the reader where to look; "unbalanced" does not.
  assert.throws(
    () => assertBalanced([debitLine("1100", 100), creditLine("4100", 99.99)]),
    (error) => String(error.message).includes("0.01"),
  );
});

check("a single-sided entry is refused", () => {
  // Nearly always a caller that built the other side conditionally and lost it.
  assert.throws(() => assertBalanced([debitLine("1100", 100)]));
});

check("a line cannot be both a debit and a credit", () => {
  // Somebody's netting shortcut, and it makes the account unreadable.
  assert.throws(() => normaliseLine({ accountCode: "1100", debit: 10, credit: 5 }));
});

check("a negative line is refused rather than reinterpreted", () => {
  // A negative credit is a debit; allowing both spellings breaks any report
  // that sums a column.
  assert.throws(() => normaliseLine({ accountCode: "1100", debit: -10 }));
});

check("a line that moves nothing is refused", () => {
  assert.throws(() => normaliseLine({ accountCode: "1100", debit: 0, credit: 0 }));
});

check("an asset and a liability with the same numbers read as opposite balances", () => {
  // Normal balance decides the sign of a balance, not of a line.
  assert.equal(Number(accountBalance({ normalBalance: "DEBIT", debit: 500, credit: 200 })), 300);
  assert.equal(Number(accountBalance({ normalBalance: "CREDIT", debit: 200, credit: 500 })), 300);
  assert.equal(Number(accountBalance({ normalBalance: "CREDIT", debit: 500, credit: 200 })), -300);
});

check("normal balance is derived from the account type", () => {
  assert.equal(normalBalanceFor("ASSET"), "DEBIT");
  assert.equal(normalBalanceFor("EXPENSE"), "DEBIT");
  assert.equal(normalBalanceFor("LIABILITY"), "CREDIT");
  assert.equal(normalBalanceFor("INCOME"), "CREDIT");
  assert.equal(normalBalanceFor("EQUITY"), "CREDIT");
});

check("a reversal flips every line and still balances", () => {
  const original = [debitLine("1100", 100), creditLine("4100", 100)];
  const flipped = reverseLines(original);

  assert.equal(Number(flipped[0].credit), 100);
  assert.equal(Number(flipped[0].debit), 0);
  assert.equal(sumOf(flipped).balanced, true);
});

check("zero lines are dropped rather than written to the ledger", () => {
  // Posting rules build lines from figures that are often zero — an order with
  // no delivery fee. A zero line is noise, not information.
  const kept = compact([debitLine("1100", 100), creditLine("4200", 0), creditLine("4100", 100)]);
  assert.equal(kept.length, 2);
});

check("a signed line picks its own side", () => {
  assert.equal(Number(signedLine("1100", 5).debit), 5);
  assert.equal(Number(signedLine("1100", -5).credit), 5);
  assert.equal(signedLine("1100", 0), null);
});

// --- Phase 11: the chart ------------------------------------------------------

check("every account code the posting rules use exists in the chart", () => {
  // A code in the rules but not the seed is a posting that fails at runtime for
  // a business event that has already happened.
  const codes = new Set(STANDARD_CHART.map((account) => account.code));
  const missing = REQUIRED_CODES.filter((code) => !codes.has(code));
  assert.deepEqual(missing, []);
});

check("discounts given is contra-income, not an expense", () => {
  // A discount is revenue never earned. Booking it as a cost would overstate
  // revenue and costs together — profit right, every margin wrong.
  const discounts = STANDARD_CHART.find((account) => account.code === ACCOUNTS.DISCOUNTS_GIVEN);
  assert.equal(discounts.type, "INCOME");
  assert.equal(discounts.normalBalance, "DEBIT");
});

check("tips are a liability, not income", () => {
  // A tip belongs to the staff; the restaurant is holding it, not earning it.
  const tips = STANDARD_CHART.find((account) => account.code === ACCOUNTS.TIPS_PAYABLE);
  assert.equal(tips.type, "LIABILITY");
});

check("every account's normal balance matches its type, bar deliberate contras", () => {
  const contras = [ACCOUNTS.DISCOUNTS_GIVEN];
  for (const account of STANDARD_CHART) {
    if (contras.includes(account.code)) continue;
    assert.equal(
      account.normalBalance,
      normalBalanceFor(account.type),
      `${account.code} ${account.name} has the wrong normal balance`,
    );
  }
});

check("a child account is always the same type as its parent", () => {
  const byCode = new Map(STANDARD_CHART.map((account) => [account.code, account]));
  for (const account of STANDARD_CHART) {
    if (!account.parentCode) continue;
    assert.equal(byCode.get(account.parentCode).type, account.type, `${account.code} is filed under the wrong parent`);
  }
});

// --- Phase 11: posting rules --------------------------------------------------

const exclusiveOrder = {
  orderNumber: "ORD-1",
  userId: "u1",
  subtotal: 1000,
  discountTotal: 100,
  taxTotal: 90,
  deliveryFee: 50,
  packagingFee: 20,
  serviceCharge: 30,
  tipAmount: 40,
  roundOff: 0,
  grandTotal: 1130,
};

const inclusiveOrder = {
  orderNumber: "ORD-2",
  userId: null,
  subtotal: 1000,
  discountTotal: 0,
  taxTotal: 90,
  deliveryFee: 0,
  packagingFee: 0,
  serviceCharge: 0,
  tipAmount: 0,
  roundOff: 0,
  grandTotal: 1000,
};

check("a tax-exclusive order is recognised as such from its own figures", () => {
  // Derived from the document rather than a mutable setting, so a flag flipped
  // next year cannot silently re-post historical orders.
  assert.equal(pricesIncludedTax(exclusiveOrder), false);
});

check("a tax-inclusive order is recognised as such", () => {
  assert.equal(pricesIncludedTax(inclusiveOrder), true);
});

check("a sale entry balances", () => {
  assert.equal(sumOf(saleLines(exclusiveOrder)).balanced, true);
});

check("a tax-exclusive sale credits the full subtotal to sales", () => {
  const sales = saleLines(exclusiveOrder).find((line) => line.accountCode === ACCOUNTS.FOOD_SALES);
  assert.equal(Number(sales.credit), 1000);
});

check("a tax-inclusive sale credits sales net of the tax inside the price", () => {
  // Missing this overstates revenue by the tax on every order and leaves the
  // entry out of balance by the same amount.
  const lines = saleLines(inclusiveOrder);
  const sales = lines.find((line) => line.accountCode === ACCOUNTS.FOOD_SALES);
  const tax = lines.find((line) => line.accountCode === ACCOUNTS.TAX_PAYABLE);

  assert.equal(Number(sales.credit), 910);
  assert.equal(Number(tax.credit), 90);
  assert.equal(sumOf(lines).balanced, true);
});

check("a sale debits receivable, not cash, even for a cash order", () => {
  // The sale and the money are separate events that can happen in either order.
  const receivable = saleLines(exclusiveOrder).find(
    (line) => line.accountCode === ACCOUNTS.ACCOUNTS_RECEIVABLE,
  );
  assert.equal(Number(receivable.debit), 1130);
});

check("a discount is debited to contra-income", () => {
  const discount = saleLines(exclusiveOrder).find((line) => line.accountCode === ACCOUNTS.DISCOUNTS_GIVEN);
  assert.equal(Number(discount.debit), 100);
});

check("a tip is credited to a liability, never to sales", () => {
  const tips = saleLines(exclusiveOrder).find((line) => line.accountCode === ACCOUNTS.TIPS_PAYABLE);
  assert.equal(Number(tips.credit), 40);
});

check("rounding goes to whichever side it needs and still balances", () => {
  const up = saleLines({ ...exclusiveOrder, roundOff: 0.5, grandTotal: 1130.5 });
  const down = saleLines({ ...exclusiveOrder, roundOff: -0.5, grandTotal: 1129.5 });

  assert.equal(sumOf(up).balanced, true);
  assert.equal(sumOf(down).balanced, true);
  assert.equal(Number(up.find((line) => line.accountCode === ACCOUNTS.ROUNDING).credit), 0.5);
  assert.equal(Number(down.find((line) => line.accountCode === ACCOUNTS.ROUNDING).debit), 0.5);
});

check("an order with no tip, delivery or discount still balances", () => {
  const plain = {
    orderNumber: "ORD-3",
    subtotal: 500,
    discountTotal: 0,
    taxTotal: 0,
    deliveryFee: 0,
    packagingFee: 0,
    serviceCharge: 0,
    tipAmount: 0,
    roundOff: 0,
    grandTotal: 500,
  };
  const lines = saleLines(plain);
  assert.equal(lines.length, 2);
  assert.equal(sumOf(lines).balanced, true);
});

check("a payment clears the whole receivable and expenses the fee", () => {
  // The customer paid the full amount; the provider's cut is a cost of
  // collecting it, not a smaller sale.
  const lines = paymentLines({ amount: 1000, feeAmount: 25, settlementCode: "1250", orderNumber: "ORD-1" });
  const clearing = lines.find((line) => line.accountCode === "1250");
  const fee = lines.find((line) => line.accountCode === ACCOUNTS.GATEWAY_FEES);
  const receivable = lines.find((line) => line.accountCode === ACCOUNTS.ACCOUNTS_RECEIVABLE);

  assert.equal(Number(clearing.debit), 975);
  assert.equal(Number(fee.debit), 25);
  assert.equal(Number(receivable.credit), 1000);
  assert.equal(sumOf(lines).balanced, true);
});

check("a cash payment with no fee balances in two lines", () => {
  const lines = paymentLines({ amount: 500, settlementCode: ACCOUNTS.CASH, orderNumber: "ORD-4" });
  assert.equal(lines.length, 2);
  assert.equal(sumOf(lines).balanced, true);
});

check("a refund gives back the tax in proportion", () => {
  // Refunding gross against sales alone leaves tax payable overstated for ever
  // — money handed to a tax authority for a sale that did not happen.
  const lines = refundLines({ amount: 500, taxPortion: 45, orderNumber: "ORD-1", settlementCode: ACCOUNTS.CASH });
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.FOOD_SALES).debit), 455);
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.TAX_PAYABLE).debit), 45);
  assert.equal(sumOf(lines).balanced, true);
});

check("a goods receipt credits GRNI, not payables", () => {
  // The delivery and the invoice are days apart; crediting payables here would
  // double up when the real invoice lands.
  const lines = goodsReceiptLines({ amount: 5000, grnNumber: "GRN-1", supplierId: "s1" });
  assert.ok(lines.find((line) => line.accountCode === ACCOUNTS.GOODS_RECEIVED_NOT_INVOICED));
  assert.equal(lines.find((line) => line.accountCode === ACCOUNTS.ACCOUNTS_PAYABLE), undefined);
  assert.equal(sumOf(lines).balanced, true);
});

check("a bill against a receipt clears GRNI rather than expensing it again", () => {
  const lines = supplierBillLines({
    subtotal: 5000,
    taxTotal: 500,
    grandTotal: 5500,
    billNumber: "BILL-1",
    supplierId: "s1",
    hasReceipt: true,
  });
  assert.ok(lines.find((line) => line.accountCode === ACCOUNTS.GOODS_RECEIVED_NOT_INVOICED));
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.ACCOUNTS_PAYABLE).credit), 5500);
  assert.equal(sumOf(lines).balanced, true);
});

check("a bill with no receipt behind it hits an expense instead", () => {
  const lines = supplierBillLines({
    subtotal: 1000,
    taxTotal: 0,
    grandTotal: 1000,
    billNumber: "BILL-2",
    supplierId: "s1",
    hasReceipt: false,
  });
  assert.ok(lines.find((line) => line.accountCode === ACCOUNTS.OTHER_EXPENSE));
  assert.equal(sumOf(lines).balanced, true);
});

check("a production run balances and shows its conversion cost", () => {
  // Absorption: labour and overhead are charged and then absorbed, so both the
  // cost of the run and the cost of what came out of it are visible.
  // Output 792 + waste 88 = 880 debits; material 800 + labour 60 + overhead 20
  // = 880 credits. Labour and overhead are credited, not debited: they were
  // charged to their own accounts when incurred, and production absorbs them.
  const lines = productionLines({
    materialCost: 800,
    laborCost: 60,
    overheadCost: 20,
    outputValue: 792,
    wastageValue: 88,
    productionNumber: "PRD-1",
  });
  assert.equal(sumOf(lines).balanced, true);
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.WASTAGE).debit), 88);
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.PRODUCTION_LABOR).credit), 60);
});

check("a driver payout splits between cash retained and what is still owed", () => {
  // COD makes this two-sided; posting only the payable leaves that cash on the
  // books twice.
  const lines = driverPayoutLines({ grossAmount: 1000, codDeducted: 400, driverId: "d1", payoutNumber: "P-1" });
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.CASH).credit), 400);
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.DRIVER_PAYABLE).credit), 600);
  assert.equal(sumOf(lines).balanced, true);
});

check("an expense splits out recoverable tax", () => {
  const lines = expenseLines({
    amount: 1100,
    taxAmount: 100,
    expenseCode: ACCOUNTS.UTILITIES,
    paidFromCode: ACCOUNTS.BANK,
    expenseNumber: "EXP-1",
  });
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.UTILITIES).debit), 1000);
  assert.equal(Number(lines.find((line) => line.accountCode === ACCOUNTS.BANK).credit), 1100);
  assert.equal(sumOf(lines).balanced, true);
});

check("cogs balances", () => {
  assert.equal(sumOf(cogsLines({ amount: 400, orderNumber: "ORD-1" })).balanced, true);
});

check("every payment method maps to an account", () => {
  // A method with no mapping falls through to a default and books real money
  // into a clearing account nobody reconciles.
  const methods = [
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
  ];
  for (const method of methods) {
    assert.ok(SETTLEMENT_BY_METHOD[method], `${method} has no settlement account`);
    assert.ok(REQUIRED_CODES.includes(settlementCodeFor(method)), `${method} maps outside the chart`);
  }
});

check("a gift card settles a liability rather than counting as new money", () => {
  // The cash came in when the card was sold; counting it again would double it.
  assert.equal(settlementCodeFor("GIFT_CARD"), ACCOUNTS.CUSTOMER_CREDIT);
  assert.equal(settlementCodeFor("STORE_CREDIT"), ACCOUNTS.CUSTOMER_CREDIT);
});

// --- Phase 11: statements -----------------------------------------------------

// Built from six real, balanced entries so the fixture cannot itself be wrong:
//   Dr Cash 800            Cr Capital 800        capital introduced
//   Dr Inventory 800       Cr Payables 800       stock bought on credit
//   Dr Cash 900 + Dr Discounts 100   Cr Sales 1000    a sale, discounted
//   Dr COGS 300            Cr Inventory 300      the cost of that sale
//   Dr Rent 100            Cr Cash 100           rent paid
//   Dr Payables 400        Cr Cash 400           part-paid the supplier
const statementRows = [
  { code: "1100", name: "Cash", type: "ASSET", normalBalance: "DEBIT", debit: 1700, credit: 500 },
  { code: "1400", name: "Inventory", type: "ASSET", normalBalance: "DEBIT", debit: 800, credit: 300 },
  { code: "2100", name: "Payables", type: "LIABILITY", normalBalance: "CREDIT", debit: 400, credit: 800 },
  { code: "3100", name: "Capital", type: "EQUITY", normalBalance: "CREDIT", debit: 0, credit: 800 },
  { code: "4100", name: "Sales", type: "INCOME", normalBalance: "CREDIT", debit: 0, credit: 1000 },
  { code: "4900", name: "Discounts", type: "INCOME", normalBalance: "DEBIT", debit: 100, credit: 0 },
  { code: "5100", name: "COGS", subType: "COGS", type: "EXPENSE", normalBalance: "DEBIT", debit: 300, credit: 0 },
  { code: "5700", name: "Rent", subType: "Occupancy", type: "EXPENSE", normalBalance: "DEBIT", debit: 100, credit: 0 },
].map((row) => ({
  ...row,
  // What the ledger query hands the report functions.
  balance: row.normalBalance === "DEBIT" ? row.debit - row.credit : row.credit - row.debit,
}));

check("a contra-income account reduces revenue without a special case", () => {
  // The whole reason discounts are modelled as contra-income: the arithmetic
  // falls out correctly and both gross and net revenue are readable.
  const pnl = profitAndLoss(statementRows);
  assert.equal(Number(pnl.grossRevenue), 1000);
  assert.equal(Number(pnl.contraRevenue), 100);
  assert.equal(Number(pnl.netRevenue), 900);
});

check("gross profit is net revenue less cost of sales", () => {
  const pnl = profitAndLoss(statementRows);
  assert.equal(Number(pnl.costOfSales), 300);
  assert.equal(Number(pnl.grossProfit), 600);
  assert.equal(Number(pnl.operatingExpenses), 100);
  assert.equal(Number(pnl.netProfit), 500);
});

check("a contra-income account is not mistaken for revenue", () => {
  // Discounts is DEBIT-normal but sits in the income section. Read in its own
  // direction it is +100 and gets added to revenue; read in its section's
  // direction it is -100 and correctly reduces it.
  const pnl = profitAndLoss(statementRows);
  assert.equal(Number(pnl.income.find((row) => row.code === "4900").balance), -100);
  assert.equal(Number(pnl.grossRevenue), 1000);
});

check("margins are null rather than zero when there is no revenue", () => {
  const pnl = profitAndLoss([
    { code: "5700", type: "EXPENSE", subType: "Occupancy", normalBalance: "DEBIT", debit: 50, credit: 0, balance: 50 },
  ]);
  assert.equal(pnl.grossMarginPercent, null);
  assert.equal(Number(pnl.netProfit), -50);
});

check("a balance sheet only balances once the period's profit is in equity", () => {
  // The single commonest way a home-grown ledger produces a visibly wrong
  // report: assets 1500, liabilities 400, posted equity 800, profit 500.
  const sheet = balanceSheet(statementRows);
  assert.equal(Number(sheet.totalAssets), 1700);
  assert.equal(Number(sheet.totalLiabilities), 400);
  assert.equal(Number(sheet.postedEquity), 800);
  assert.equal(Number(sheet.currentEarnings), 500);
  assert.equal(Number(sheet.totalEquity), 1300);
  assert.equal(Number(sheet.totalLiabilitiesAndEquity), 1700);
  assert.equal(sheet.balanced, true);
});

check("a trial balance agrees when every entry balanced", () => {
  const trial = trialBalance(statementRows);
  assert.equal(Number(trial.totalDebit), 3400);
  assert.equal(Number(trial.totalCredit), 3400);
  assert.equal(trial.balanced, true);
});

check("a trial balance flags an account sitting on the wrong side", () => {
  const trial = trialBalance(statementRows);
  // Discounts is DEBIT-normal in a CREDIT-normal section, so it always reads
  // as contrary — which is exactly the flag doing its job.
  assert.equal(trial.accounts.find((row) => row.code === "1100").isContrary, false);
  assert.equal(trial.accounts.find((row) => row.code === "2100").isContrary, false);
});

check("ageing puts an invoice in the right bucket", () => {
  const asOf = new Date("2026-03-01T00:00:00Z");
  assert.equal(bucketFor("2026-03-15", asOf), "current");
  assert.equal(bucketFor("2026-02-20", asOf), "1-30");
  assert.equal(bucketFor("2026-01-20", asOf), "31-60");
  assert.equal(bucketFor("2025-12-20", asOf), "61-90");
  assert.equal(bucketFor("2025-06-01", asOf), "90+");
});

check("ageing totals only what is actually outstanding", () => {
  const aged = ageBalances(
    [
      { dueDate: "2026-02-01", outstanding: 100 },
      { dueDate: "2026-02-01", outstanding: 0 },
      { dueDate: "2026-03-10", outstanding: 50 },
    ],
    new Date("2026-03-01T00:00:00Z"),
  );
  assert.equal(aged.rows.length, 2);
  assert.equal(Number(aged.total), 150);
  assert.equal(Number(aged.buckets["1-30"]), 100);
  assert.equal(Number(aged.buckets.current), 50);
});

// --- Phase 11: the fiscal calendar --------------------------------------------

check("a fiscal year generates one period per month", () => {
  const months = monthsBetween("2026-04-01", "2027-03-31");
  assert.equal(months.length, 12);
  assert.equal(months[0].name, "April 2026");
  assert.equal(months[11].name, "March 2027");
});

check("periods are clipped to the year rather than reaching outside it", () => {
  // A year starting mid-month gets a short first period, not one that reaches
  // back before the year began.
  const months = monthsBetween("2026-04-15", "2026-06-10");
  assert.equal(months.length, 3);
  assert.equal(months[0].startDate.toISOString().slice(0, 10), "2026-04-15");
  assert.equal(months[2].endDate.toISOString().slice(0, 10), "2026-06-10");
});

check("periods never overlap and leave no gap", () => {
  const months = monthsBetween("2026-01-01", "2026-12-31");
  for (let i = 1; i < months.length; i += 1) {
    const previousEnd = months[i - 1].endDate.getTime();
    const thisStart = months[i].startDate.getTime();
    assert.equal(thisStart - previousEnd, 86_400_000, `gap or overlap before period ${i}`);
  }
});

// The fiscal year a fresh install starts with. Pakistan's financial year runs
// 1 July to 30 June, which is what these assert; the start month is
// configurable because the same code has to serve a client whose year does not.

check("the default fiscal year is Pakistan's July-to-June", () => {
  const year = fiscalYearFor("2026-11-05");
  assert.equal(year.startDate.toISOString().slice(0, 10), "2026-07-01");
  assert.equal(year.endDate.toISOString().slice(0, 10), "2027-06-30");
  assert.equal(year.name, "FY 2026-27");
});

check("a date before July belongs to the year that began the previous July", () => {
  // The trap: March 2026 is *in* FY 2025-26, not FY 2026-27. Getting this
  // backwards would hand a new install a year that has not started yet, and
  // every posting would be refused for being outside every period.
  const year = fiscalYearFor("2026-03-31");
  assert.equal(year.startDate.toISOString().slice(0, 10), "2025-07-01");
  assert.equal(year.endDate.toISOString().slice(0, 10), "2026-06-30");
  assert.equal(year.name, "FY 2025-26");
});

check("the first and last days of a fiscal year fall inside it", () => {
  const first = fiscalYearFor("2026-07-01");
  assert.equal(first.name, "FY 2026-27");
  assert.equal(first.startDate.toISOString().slice(0, 10), "2026-07-01");

  const last = fiscalYearFor("2026-06-30");
  assert.equal(last.name, "FY 2025-26");
  assert.equal(last.endDate.toISOString().slice(0, 10), "2026-06-30");
});

check("the year covering a date always contains it, every month of the year", () => {
  // Brute force over a whole year, because an off-by-one month is the whole
  // risk here and it only shows at one boundary.
  for (let month = 1; month <= 12; month += 1) {
    const day = `2026-${String(month).padStart(2, "0")}-15`;
    const year = fiscalYearFor(day);
    const date = new Date(`${day}T00:00:00Z`);
    assert.ok(year.startDate <= date, `${day} is before ${year.name} starts`);
    assert.ok(year.endDate >= date, `${day} is after ${year.name} ends`);
  }
});

check("a January start is named for one year, not two", () => {
  // "FY 2026-26" would be nonsense, so a calendar fiscal year is "FY 2026".
  const year = fiscalYearFor("2026-11-05", { startMonth: 1 });
  assert.equal(year.startDate.toISOString().slice(0, 10), "2026-01-01");
  assert.equal(year.endDate.toISOString().slice(0, 10), "2026-12-31");
  assert.equal(year.name, "FY 2026");
});

check("a fiscal year ending in February covers the leap day", () => {
  // March start, so FY 2027-28 ends 29 February 2028. A hand-written end date
  // of "-02-28" would leave the leap day in no period at all.
  const year = fiscalYearFor("2027-06-01", { startMonth: 3 });
  assert.equal(year.startDate.toISOString().slice(0, 10), "2027-03-01");
  assert.equal(year.endDate.toISOString().slice(0, 10), "2028-02-29");
  assert.equal(year.name, "FY 2027-28");
});

check("the generated year is exactly twelve whole periods", () => {
  const year = fiscalYearFor("2026-11-05");
  const months = monthsBetween(year.startDate, year.endDate);
  assert.equal(months.length, 12);
  assert.equal(months[0].name, "July 2026");
  assert.equal(months[11].name, "June 2027");
});

check("a nonsense start month is refused rather than quietly defaulted", () => {
  // Silently falling back to July would mean a typo'd FISCAL_YEAR_START_MONTH
  // builds a year nobody asked for and nobody notices until the books are wrong.
  assert.throws(() => fiscalYearStartMonth("13"), /FISCAL_YEAR_START_MONTH/);
  assert.throws(() => fiscalYearStartMonth("0"), /FISCAL_YEAR_START_MONTH/);
  assert.throws(() => fiscalYearStartMonth("july"), /FISCAL_YEAR_START_MONTH/);
  assert.throws(() => fiscalYearStartMonth("7.5"), /FISCAL_YEAR_START_MONTH/);
});

// --- backup retention ------------------------------------------------------
//
// The only destructive part of a backup system, so it is the part with tests.

check("a backup name carries its own timestamp, and reads back", () => {
  const name = backupName(new Date("2026-11-07T14:30:00Z"));
  assert.equal(name, "foodzone-2026-11-07T14-30-00Z.dump");
  assert.equal(backupTakenAt(name).toISOString(), "2026-11-07T14:30:00.000Z");
});

check("anything that is not one of our backups is left alone", () => {
  /*
   * The backup directory is a directory, and directories collect things:
   * somebody's notes, a half-copied file, a dump from another system. The
   * pruner must never delete a file it cannot prove it wrote.
   */
  const plan = planRetention(["notes.txt", "foodzone.dump", "old-backup.sql", ".keep"], { now: new Date("2026-11-07T00:00:00Z") });
  assert.deepEqual(plan.remove, []);
  assert.deepEqual(plan.keep, []);
  assert.equal(plan.ignored.length, 4);
});

check("backups older than the window are pruned", () => {
  const names = [
    "foodzone-2026-11-07T02-00-00Z.dump",
    "foodzone-2026-11-01T02-00-00Z.dump",
    "foodzone-2026-10-20T02-00-00Z.dump",
    "foodzone-2026-09-15T02-00-00Z.dump",
  ];
  const plan = planRetention(names, { now: new Date("2026-11-07T06:00:00Z"), keepDays: 14, keepAtLeast: 1 });
  assert.deepEqual(plan.keep, ["foodzone-2026-11-07T02-00-00Z.dump", "foodzone-2026-11-01T02-00-00Z.dump"]);
  assert.deepEqual(plan.remove, ["foodzone-2026-10-20T02-00-00Z.dump", "foodzone-2026-09-15T02-00-00Z.dump"]);
});

check("a machine that was switched off does not prune itself to nothing", () => {
  /*
   * The failure this exists for: every backup is older than the window, a
   * pure age rule deletes all of them, and the retention policy becomes the
   * thing that lost the data. Keeping the newest few always wins over age.
   */
  const names = [
    "foodzone-2026-01-03T02-00-00Z.dump",
    "foodzone-2026-01-02T02-00-00Z.dump",
    "foodzone-2026-01-01T02-00-00Z.dump",
  ];
  const plan = planRetention(names, { now: new Date("2026-11-07T06:00:00Z"), keepDays: 14, keepAtLeast: 3 });
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.keep.length, 3);
});

check("the newest is kept even when everything is ancient and the floor is one", () => {
  const plan = planRetention(["foodzone-2020-01-01T02-00-00Z.dump"], { now: new Date("2026-11-07T06:00:00Z"), keepAtLeast: 1 });
  assert.deepEqual(plan.remove, []);
});

check("pruning keeps the newest, not whatever the filesystem listed first", () => {
  // Directory order is not sorted order, and trusting it would delete the
  // most recent backup on some machines and not others.
  const plan = planRetention(
    ["foodzone-2026-09-01T02-00-00Z.dump", "foodzone-2026-11-06T02-00-00Z.dump", "foodzone-2026-10-01T02-00-00Z.dump"],
    { now: new Date("2026-11-07T06:00:00Z"), keepDays: 5, keepAtLeast: 1 },
  );
  assert.deepEqual(plan.keep, ["foodzone-2026-11-06T02-00-00Z.dump"]);
  assert.equal(plan.remove.length, 2);
});

// --- first-run setup -----------------------------------------------------
//
// The one screen that creates an account nobody is signed in to create. Its
// guards are the whole of its security, so they are tested rather than assumed.

const SETUP_INPUT = {
  owner: { name: "Restaurant Owner", email: "owner@example.com", password: "a-long-enough-passphrase" },
  branch: { code: "fz-khi-01", name: "Main Branch", city: "Karachi" },
};

check("setup fills in the defaults a Pakistani restaurant would choose", () => {
  const parsed = bootstrapSchema.parse(structuredClone(SETUP_INPUT));
  assert.equal(parsed.branch.timezone, "Asia/Karachi");
  assert.equal(parsed.branch.currency, "PKR");
  // Branch codes are upper-cased elsewhere in the system; setup must not be
  // the one place that creates a lower-case one.
  assert.equal(parsed.branch.code, "FZ-KHI-01");
});

check("setup will not create an owner with a weak password", () => {
  const weak = structuredClone(SETUP_INPUT);
  weak.owner.password = "short";
  assert.equal(bootstrapSchema.safeParse(weak).success, false);
});

check("setup needs an owner and a branch, not one or the other", () => {
  assert.equal(bootstrapSchema.safeParse({ owner: SETUP_INPUT.owner }).success, false);
  assert.equal(bootstrapSchema.safeParse({ branch: SETUP_INPUT.branch }).success, false);
  const noEmail = structuredClone(SETUP_INPUT);
  delete noEmail.owner.email;
  assert.equal(bootstrapSchema.safeParse(noEmail).success, false);
});

check("an unset setup token refuses everything", () => {
  /*
   * Fail closed. If SETUP_TOKEN is missing from the environment the setup
   * endpoint must be unusable, not open — a deployment where somebody forgot
   * the variable is exactly the one an attacker would find first.
   */
  assert.equal(setupTokenMatches("anything", undefined), false);
  assert.equal(setupTokenMatches("anything", ""), false);
  assert.equal(setupTokenMatches("anything", "   "), false);
  assert.equal(setupTokenMatches("", undefined), false);
});

check("the setup token has to match exactly", () => {
  assert.equal(setupTokenMatches("right-token", "right-token"), true);
  assert.equal(setupTokenMatches("wrong-token", "right-token"), false);
  // A prefix must not pass: a comparison that stops at the shorter string
  // would let "r" through.
  assert.equal(setupTokenMatches("r", "right-token"), false);
  assert.equal(setupTokenMatches("right-token-and-more", "right-token"), false);
  assert.equal(setupTokenMatches("", "right-token"), false);
  assert.equal(setupTokenMatches(null, "right-token"), false);
  assert.equal(setupTokenMatches(undefined, "right-token"), false);
});

// --- the next year, and how much runway is left in this one -------------------

check("the next year continues the shape of the last one", () => {
  const next = nextFiscalYearAfter("2027-06-30");
  assert.equal(next.startDate.toISOString().slice(0, 10), "2027-07-01");
  assert.equal(next.endDate.toISOString().slice(0, 10), "2028-06-30");
  assert.equal(next.name, "FY 2027-28");
});

check("a calendar year is followed by a calendar year", () => {
  const next = nextFiscalYearAfter("2026-12-31");
  assert.equal(next.startDate.toISOString().slice(0, 10), "2027-01-01");
  assert.equal(next.endDate.toISOString().slice(0, 10), "2027-12-31");
  assert.equal(next.name, "FY 2027");
});

check("an odd year is continued as it is, not corrected", () => {
  // A business that ran a short transition year keeps its own calendar: the
  // suggestion follows the books, it does not impose the configured default.
  const next = nextFiscalYearAfter("2027-03-31");
  assert.equal(next.startDate.toISOString().slice(0, 10), "2027-04-01");
  assert.equal(next.endDate.toISOString().slice(0, 10), "2028-03-31");
  assert.equal(next.name, "FY 2027-28");
});

check("a year ending in February still ends in February", () => {
  const next = nextFiscalYearAfter("2028-02-29");
  assert.equal(next.startDate.toISOString().slice(0, 10), "2028-03-01");
  assert.equal(next.endDate.toISOString().slice(0, 10), "2029-02-28");
});

check("with no year on file the configured default is used", () => {
  const next = nextFiscalYearAfter(null, { now: new Date("2026-11-05T00:00:00Z") });
  const seeded = fiscalYearFor("2026-11-05");
  assert.equal(next.name, seeded.name);
  assert.equal(next.startDate.toISOString(), seeded.startDate.toISOString());
  assert.equal(next.endDate.toISOString(), seeded.endDate.toISOString());
});

check("runway counts whole days to the end of the year", () => {
  const now = new Date("2026-11-05T09:00:00Z");
  assert.equal(runwayStatus({ yearEndDate: "2027-06-30", now }).daysLeft, 237);
  assert.equal(runwayStatus({ yearEndDate: "2026-11-06", now }).daysLeft, 1);
  // The last day of the year is still a day you can post into.
  const lastDay = runwayStatus({ yearEndDate: "2026-11-05", now });
  assert.equal(lastDay.daysLeft, 0);
  assert.equal(lastDay.state, "EXPIRING");
});

check("a calendar with nothing covering today is lapsed, not merely expiring", () => {
  // The distinction matters: expiring is a reminder, lapsed is an outage —
  // postings are already being refused and parked.
  assert.equal(runwayStatus({ yearEndDate: null }).state, "LAPSED");
  assert.equal(runwayStatus({ yearEndDate: "2026-11-04", now: new Date("2026-11-05T09:00:00Z") }).state, "LAPSED");
});

check("the warning escalates at sixty, thirty and seven days", () => {
  const now = new Date("2026-11-05T09:00:00Z");
  const at = (days) => {
    const end = new Date(Date.UTC(2026, 10, 5 + days));
    return runwayStatus({ yearEndDate: end, now });
  };
  assert.deepEqual(RUNWAY_THRESHOLDS, [60, 30, 7]);
  assert.equal(at(90).state, "OK");
  assert.equal(at(90).threshold, null);
  assert.equal(at(61).state, "OK");
  // Exactly on a threshold counts as crossed, or a cron that runs once a day
  // can step straight over it.
  assert.equal(at(60).threshold, 60);
  assert.equal(at(45).threshold, 60);
  assert.equal(at(30).threshold, 30);
  assert.equal(at(8).threshold, 30);
  assert.equal(at(7).threshold, 7);
  assert.equal(at(0).threshold, 7);
  assert.equal(at(45).state, "EXPIRING");
});

// The banner's wording. Pure, like queue-health: the decision of what to say
// is testable and the component only renders it.

check("nothing is said while the calendar has runway", () => {
  const notice = runwayNotice({ state: "OK", daysLeft: 200, blockedPostings: 0 });
  assert.equal(notice.level, "ok");
  assert.equal(notice.title, null);
});

check("a year about to end is a warning, and says the date", () => {
  const notice = runwayNotice({
    state: "EXPIRING",
    daysLeft: 21,
    threshold: 30,
    fiscalYear: { name: "FY 2026-27" },
    calendarEndsAt: "2027-06-30",
    suggestion: { name: "FY 2027-28" },
    blockedPostings: 0,
  });
  assert.equal(notice.level, "expiring");
  assert.match(notice.title, /21 days/);
  assert.match(notice.body, /2027-06-30/);
  assert.match(notice.body, /FY 2027-28/);
});

check("a lapsed calendar is the serious one and names the damage", () => {
  const notice = runwayNotice({
    state: "LAPSED",
    daysLeft: -3,
    blockedPostings: 14,
    suggestion: { name: "FY 2026-27" },
  });
  assert.equal(notice.level, "lapsed");
  assert.equal(notice.serious, true);
  assert.match(notice.body, /14 postings/);
});

check("postings waiting are surfaced even while the calendar looks healthy", () => {
  /*
   * The blind spot worth closing: a document dated into a gap the calendar
   * does not cover — a year somebody deleted, an invoice dated years back —
   * parks a posting while today is perfectly well covered. Neither the queue
   * banner (it is not failed, and not pending) nor an expiry warning would
   * mention it, and the ledger would simply be short.
   */
  const notice = runwayNotice({ state: "OK", daysLeft: 200, blockedPostings: 3 });
  assert.equal(notice.level, "waiting");
  assert.equal(notice.serious, false);
  assert.match(notice.body, /3 postings/);
});

check("one waiting posting is not \"1 postings\"", () => {
  const notice = runwayNotice({ state: "OK", daysLeft: 200, blockedPostings: 1 });
  assert.match(notice.body, /1 posting is/);
});

check("a lapsed calendar outranks postings merely waiting", () => {
  const notice = runwayNotice({ state: "LAPSED", daysLeft: null, blockedPostings: 2, suggestion: { name: "FY x" } });
  assert.equal(notice.level, "lapsed");
});

// A posting refused for want of an accounting period is a configuration fault,
// not a bad event: the work becomes valid the moment somebody opens the year.
// The outbox has to be able to tell the two apart, so the marker is tested.

check("a missing accounting period is recognisable to the worker", () => {
  const error = missingPeriodError("2001-03-03");
  assert.equal(isMissingAccountingPeriod(error), true);
  assert.equal(error.details?.reason, NO_ACCOUNTING_PERIOD);
  // Still a 400 to an API caller: the request genuinely cannot be served.
  assert.equal(error.status, 400);
});

check("every other failure is left to the normal retry budget", () => {
  // The danger is a predicate so loose that a real bug gets parked for ever
  // instead of failing loudly.
  assert.equal(isMissingAccountingPeriod(new Error("That date is not in any accounting period")), false);
  assert.equal(isMissingAccountingPeriod(new Error("connection reset")), false);
  assert.equal(isMissingAccountingPeriod({ details: { reason: "SOMETHING_ELSE" } }), false);
  assert.equal(isMissingAccountingPeriod({ details: null }), false);
  assert.equal(isMissingAccountingPeriod(null), false);
  assert.equal(isMissingAccountingPeriod(undefined), false);
});

check("an unset start month is July", () => {
  assert.equal(fiscalYearStartMonth(undefined), 7);
  assert.equal(fiscalYearStartMonth(""), 7);
  assert.equal(fiscalYearStartMonth("  "), 7);
  assert.equal(fiscalYearStartMonth("4"), 4);
  assert.equal(fiscalYearStartMonth(" 4 "), 4);
});


// --- Phase 12: shift arithmetic ----------------------------------------------

const dayShift = {
  id: "s-day",
  startMinute: 540, // 09:00
  endMinute: 1080, // 18:00
  breakMinutes: 60,
  graceMinutes: 10,
  halfDayThresholdMinutes: 240,
  fullDayThresholdMinutes: 480,
};

// 22:00 to 06:00 — the end is 1800, past midnight, not 360.
const nightShift = {
  id: "s-night",
  startMinute: 1320,
  endMinute: 1800,
  breakMinutes: 30,
  graceMinutes: 15,
  halfDayThresholdMinutes: 210,
  fullDayThresholdMinutes: 420,
};

check("a time parses into minutes from midnight", () => {
  assert.equal(parseTimeToMinutes("09:00"), 540);
  assert.equal(parseTimeToMinutes("9:30"), 570);
  assert.equal(parseTimeToMinutes("00:00"), 0);
  assert.throws(() => parseTimeToMinutes("25:99"));
  assert.throws(() => parseTimeToMinutes("nine"));
});

check("minutes past midnight format with the day they land on", () => {
  assert.equal(formatMinutes(540), "09:00");
  assert.equal(formatMinutes(1320), "22:00");
  assert.equal(formatMinutes(1800), "06:00 (+1)");
});

check("a shift's length is net of its break", () => {
  assert.equal(shiftLengthMinutes(dayShift), 480);
  assert.equal(shiftLengthMinutes(nightShift), 450);
});

check("a night shift is recognised as crossing midnight", () => {
  // Storing the end as 360 rather than 1800 would make every night worker
  // appear to have worked minus sixteen hours.
  assert.equal(crossesMidnight(nightShift), true);
  assert.equal(crossesMidnight(dayShift), false);
  assert.ok(shiftLengthMinutes(nightShift) > 0);
});

check("a night shift's window ends on the following day", () => {
  const window = shiftWindow({ shift: nightShift, workDate: "2026-09-11" });
  assert.equal(window.start.toISOString(), "2026-09-11T22:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-12T06:00:00.000Z");
});

check("a shift's hours are the branch's wall clock, not UTC's", () => {
  // The bug this pins: `shiftWindow` read the shift's minutes off UTC midnight,
  // so Karachi's 09:00 opening was asserted at 09:00Z — 14:00 locally. Every
  // morning punch-in fell outside the window and was discarded, the punch-out
  // was read as the arrival, and the whole branch derived as MISSING_PUNCH
  // five hours late. Attendance is what payroll pays from.
  const karachi = shiftWindow({ shift: dayShift, workDate: "2026-09-11", timezone: "Asia/Karachi" });
  assert.equal(karachi.start.toISOString(), "2026-09-11T04:00:00.000Z", "09:00 in Karachi is 04:00Z");
  assert.equal(karachi.end.toISOString(), "2026-09-11T13:00:00.000Z");

  // West of Greenwich the window runs the other way, and into the next UTC day.
  const newYork = shiftWindow({ shift: dayShift, workDate: "2026-09-11", timezone: "America/New_York" });
  assert.equal(newYork.start.toISOString(), "2026-09-11T13:00:00.000Z");

  // Left out, nothing moves: UTC is the column default and the old behaviour.
  assert.equal(
    shiftWindow({ shift: dayShift, workDate: "2026-09-11" }).start.toISOString(),
    "2026-09-11T09:00:00.000Z",
  );

  // And the whole day derives against it: 08:52 to 17:10 in Karachi is a
  // present full day, not an absence.
  const day = deriveDay({
    punches: [
      { punchedAt: "2026-09-11T03:52:00Z", direction: "IN" },
      { punchedAt: "2026-09-11T12:10:00Z", direction: "OUT" },
    ],
    shift: dayShift,
    workDate: "2026-09-11",
    timezone: "Asia/Karachi",
  });
  assert.equal(day.status, "PRESENT");
  assert.equal(day.lateMinutes, 0);
});

check("a punch is filed under the branch's calendar date", () => {
  // 02:00 Karachi on the 12th is 21:00Z on the 11th. Taking the candidates
  // from the UTC date offers the roster the 10th and the 11th — and the night
  // shift that punch closes began on the 11th, so it only looks right by
  // accident. An 06:00 local punch on the 12th (01:00Z) is the case that broke.
  // A baker rostered 04:00–12:00 on the 12th, arriving at 03:00 local. That
  // instant is 22:00Z on the *11th*, so UTC's date offers the roster the 10th
  // and the 11th — and the 12th, the only day that covers the punch, is never
  // looked at. The baker reads as absent and the early start is unpaid.
  const earlyShift = { id: "early", startMinute: 240, endMinute: 720, graceMinutes: 10 };
  const assignments = [
    { workDate: new Date("2026-09-11T00:00:00Z"), shift: earlyShift, isWeeklyOff: false },
    { workDate: new Date("2026-09-12T00:00:00Z"), shift: earlyShift, isWeeklyOff: false },
  ];
  const resolved = workDateForPunch({
    punchedAt: "2026-09-11T22:00:00Z",
    assignments,
    timezone: "Asia/Karachi",
  });
  assert.equal(resolved.workDate.toISOString().slice(0, 10), "2026-09-12", "03:00 in Karachi is still the 12th");
  // The date alone is not the claim: falling through to "no roster covers it"
  // reaches the same date with no shift, and that is the absence being fixed.
  assert.equal(resolved.shift?.id, "early", "the 12th's shift claimed the punch");

  // And a 2am punch still resolves backwards to the night shift it closes.
  const night = [
    { workDate: new Date("2026-09-11T00:00:00Z"), shift: nightShift, isWeeklyOff: false },
    { workDate: new Date("2026-09-12T00:00:00Z"), shift: nightShift, isWeeklyOff: false },
  ];
  assert.equal(
    workDateForPunch({ punchedAt: "2026-09-11T21:00:00Z", assignments: night, timezone: "Asia/Karachi" })
      .workDate.toISOString().slice(0, 10),
    "2026-09-11",
  );

  // Unrostered, it lands on the branch's date rather than UTC's.
  const orphan = workDateForPunch({ punchedAt: "2026-09-11T21:00:00Z", assignments: [], timezone: "Asia/Karachi" });
  assert.equal(orphan.workDate.toISOString().slice(0, 10), "2026-09-12");
});

check("a punch just outside the shift still belongs to it", () => {
  // People arrive early and leave late; without a margin an employee who
  // punched four minutes early reads as absent.
  assert.equal(
    punchBelongsToShift({ punchedAt: "2026-09-11T08:56:00Z", shift: dayShift, workDate: "2026-09-11" }),
    true,
  );
  assert.equal(
    punchBelongsToShift({ punchedAt: "2026-09-11T03:00:00Z", shift: dayShift, workDate: "2026-09-11" }),
    false,
  );
});

check("a 2am punch resolves to the night shift that started yesterday", () => {
  // Resolving it forwards splits every night worker's shift across two days,
  // halving one and inventing the other.
  const assignments = [
    { workDate: new Date("2026-09-11T00:00:00Z"), shift: nightShift, isWeeklyOff: false },
    { workDate: new Date("2026-09-12T00:00:00Z"), shift: nightShift, isWeeklyOff: false },
  ];
  const resolved = workDateForPunch({ punchedAt: "2026-09-12T02:00:00Z", assignments });
  assert.equal(resolved.workDate.toISOString().slice(0, 10), "2026-09-11");
});

check("a punch with no roster still lands on its own date", () => {
  const resolved = workDateForPunch({ punchedAt: "2026-09-12T10:00:00Z", assignments: [] });
  assert.equal(resolved.workDate.toISOString().slice(0, 10), "2026-09-12");
  assert.equal(resolved.shift, null);
});

check("grace forgives lateness without redefining the start", () => {
  // Within grace is not late at all; past it, lateness is measured from the
  // actual start, not from the end of grace.
  assert.equal(lateMinutes({ firstInAt: "2026-09-11T09:08:00Z", shift: dayShift, workDate: "2026-09-11" }), 0);
  assert.equal(lateMinutes({ firstInAt: "2026-09-11T09:25:00Z", shift: dayShift, workDate: "2026-09-11" }), 25);
});

check("leaving before the shift ends is measured against the end", () => {
  assert.equal(earlyLeaveMinutes({ lastOutAt: "2026-09-11T17:30:00Z", shift: dayShift, workDate: "2026-09-11" }), 30);
  assert.equal(earlyLeaveMinutes({ lastOutAt: "2026-09-11T18:10:00Z", shift: dayShift, workDate: "2026-09-11" }), 0);
});

check("days between two dates count both ends", () => {
  assert.equal(daysBetween("2026-09-01", "2026-09-30"), 30);
  assert.equal(daysBetween("2026-09-11", "2026-09-11"), 1);
  assert.equal(addDays("2026-09-11", 1).toISOString().slice(0, 10), "2026-09-12");
  assert.equal(startOfDay("2026-09-11T23:59:00Z").toISOString(), "2026-09-11T00:00:00.000Z");
});

// --- Phase 12: folding punches into a day -------------------------------------

const punchAt = (time, direction = "UNKNOWN") => ({ punchedAt: `2026-09-11T${time}:00Z`, direction });

check("a double tap on the sensor is collapsed", () => {
  // Left in, the pairing reads the repeat as the matching OUT and records a
  // shift lasting four seconds.
  const kept = dedupePunches([
    { punchedAt: "2026-09-11T09:00:00Z", direction: "IN" },
    { punchedAt: "2026-09-11T09:00:04Z", direction: "IN" },
    { punchedAt: "2026-09-11T18:00:00Z", direction: "OUT" },
  ]);
  assert.equal(kept.length, 2);
});

check("a deliberate correction a second later is not a double tap", () => {
  const kept = dedupePunches([
    { punchedAt: "2026-09-11T09:00:00Z", direction: "IN" },
    { punchedAt: "2026-09-11T09:00:02Z", direction: "OUT" },
  ]);
  assert.equal(kept.length, 2);
});

check("a device that reports no direction gets one by alternating", () => {
  const resolved = resolveDirections([punchAt("09:00"), punchAt("13:00"), punchAt("14:00"), punchAt("18:00")]);
  assert.deepEqual(resolved.map((punch) => punch.direction), ["IN", "OUT", "IN", "OUT"]);
  assert.equal(resolved.every((punch) => punch.inferred), true);
});

check("a stated direction is trusted and resets the alternation", () => {
  const resolved = resolveDirections([punchAt("09:00"), punchAt("13:00", "IN"), punchAt("18:00")]);
  assert.deepEqual(resolved.map((punch) => punch.direction), ["IN", "IN", "OUT"]);
});

check("intervals pair up and report what did not", () => {
  const paired = pairIntervals(
    resolveDirections([punchAt("09:00", "IN"), punchAt("13:00", "OUT"), punchAt("14:00", "IN")]),
  );
  assert.equal(paired.work.length, 1);
  assert.equal(paired.openAtEnd, true);
  assert.ok(paired.unmatched > 0);
});

check("a full day of punches derives as present", () => {
  const day = deriveDay({
    punches: [punchAt("09:00", "IN"), punchAt("18:00", "OUT")],
    shift: dayShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.status, "PRESENT");
  assert.equal(day.workedMinutes, 540);
  assert.equal(Number(day.payableFactor), 1);
  assert.equal(day.lateMinutes, 0);
});

check("an explicit break comes out of the worked total", () => {
  const day = deriveDay({
    punches: [
      punchAt("09:00", "IN"),
      punchAt("13:00", "BREAK_START"),
      punchAt("13:30", "BREAK_END"),
      punchAt("18:00", "OUT"),
    ],
    shift: dayShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.breakMinutes, 30);
  assert.equal(day.workedMinutes, 510);
});

check("arriving after grace is late but still a full day", () => {
  const day = deriveDay({
    punches: [punchAt("09:30", "IN"), punchAt("18:00", "OUT")],
    shift: dayShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.status, "LATE");
  assert.equal(day.lateMinutes, 30);
  assert.equal(Number(day.payableFactor), 1);
});

check("a forgotten punch-out is flagged, never guessed", () => {
  // Assuming they left at their shift end pays unworked hours; assuming they
  // never arrived steals worked ones.
  const day = deriveDay({
    punches: [punchAt("09:00", "IN")],
    shift: dayShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.status, "MISSING_PUNCH");
  assert.equal(Number(day.payableFactor), 0);
});

check("half a day worked pays half", () => {
  const day = deriveDay({
    punches: [punchAt("09:00", "IN"), punchAt("14:00", "OUT")],
    shift: dayShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.status, "HALF_DAY");
  assert.equal(Number(day.payableFactor), 0.5);
});

check("no punches at all is an absence", () => {
  const day = deriveDay({ punches: [], shift: dayShift, workDate: "2026-09-11" });
  assert.equal(day.status, "ABSENT");
  assert.equal(Number(day.payableFactor), 0);
});

check("no punches on a holiday is a holiday, not an absence", () => {
  const day = deriveDay({ punches: [], shift: dayShift, workDate: "2026-09-11", isHoliday: true });
  assert.equal(day.status, "HOLIDAY");
  assert.equal(Number(day.payableFactor), 1);
});

check("no punches on a weekly off is not an absence either", () => {
  const day = deriveDay({ punches: [], shift: dayShift, workDate: "2026-09-11", isWeeklyOff: true });
  assert.equal(day.status, "WEEKLY_OFF");
  assert.equal(Number(day.payableFactor), 1);
});

check("approved paid leave pays, unpaid leave does not", () => {
  const paid = deriveDay({ punches: [], workDate: "2026-09-11", leave: { isPaid: true } });
  const unpaid = deriveDay({ punches: [], workDate: "2026-09-11", leave: { isPaid: false } });
  assert.equal(paid.status, "ON_LEAVE");
  assert.equal(Number(paid.payableFactor), 1);
  assert.equal(Number(unpaid.payableFactor), 0);
});

check("working a holiday is a worked day, not a holiday", () => {
  const day = deriveDay({
    punches: [punchAt("09:00", "IN"), punchAt("18:00", "OUT")],
    shift: dayShift,
    workDate: "2026-09-11",
    isHoliday: true,
  });
  assert.equal(day.status, "PRESENT");
});

check("overtime is beyond the shift's own length, not beyond eight hours", () => {
  // A six-hour shift worked for eight is two hours of overtime to whoever
  // worked it.
  const shortShift = { ...dayShift, endMinute: 900, breakMinutes: 0, fullDayThresholdMinutes: 300 };
  const day = deriveDay({
    punches: [punchAt("09:00", "IN"), punchAt("17:00", "OUT")],
    shift: shortShift,
    workDate: "2026-09-11",
  });
  assert.equal(day.workedMinutes, 480);
  assert.equal(day.overtimeMinutes, 120);
});

check("deriving the same punches twice gives the same day", () => {
  const punches = [punchAt("09:00", "IN"), punchAt("18:00", "OUT")];
  const first = deriveDay({ punches, shift: dayShift, workDate: "2026-09-11" });
  const second = deriveDay({ punches, shift: dayShift, workDate: "2026-09-11" });
  assert.equal(first.workedMinutes, second.workedMinutes);
  assert.equal(first.status, second.status);
});

check("a month of days rolls up into payroll figures", () => {
  const summary = summariseDays([
    { status: "PRESENT", payableFactor: 1, workedMinutes: 480, overtimeMinutes: 0, lateMinutes: 0 },
    { status: "LATE", payableFactor: 1, workedMinutes: 470, overtimeMinutes: 0, lateMinutes: 20 },
    { status: "HALF_DAY", payableFactor: 0.5, workedMinutes: 240, overtimeMinutes: 0, lateMinutes: 0 },
    { status: "ABSENT", payableFactor: 0, workedMinutes: 0, overtimeMinutes: 0, lateMinutes: 0 },
    { status: "ON_LEAVE", payableFactor: 1, workedMinutes: 0, overtimeMinutes: 0, lateMinutes: 0 },
    { status: "MISSING_PUNCH", payableFactor: 0, workedMinutes: 0, overtimeMinutes: 0, lateMinutes: 0 },
  ]);
  assert.equal(Number(summary.payableDays), 3.5);
  assert.equal(Number(summary.presentDays), 2.5);
  assert.equal(Number(summary.absentDays), 1);
  assert.equal(Number(summary.leaveDays), 1);
  assert.equal(summary.missingPunchDays, 1);
  assert.equal(summary.lateMinutes, 20);
});

// --- Phase 12: payroll --------------------------------------------------------

const monthly = { salaryType: "MONTHLY", baseSalary: 30000, overtimeMultiplier: 1.5 };
const hourly = { salaryType: "HOURLY", baseSalary: 0, hourlyRate: 200, overtimeMultiplier: 2 };
const daily = { salaryType: "DAILY", baseSalary: 1200, overtimeMultiplier: 1.5 };

check("minutes convert to hours to three places", () => {
  assert.equal(Number(hoursOf(90)), 1.5);
  assert.equal(Number(hoursOf(100)), 1.667);
});

check("a monthly salary is prorated over the period's own days", () => {
  // February and July pay the same monthly figure, so a day off must cost the
  // same fraction in both. A fixed 30-day divisor gets February wrong.
  const feb = basicPay({ employee: monthly, payableDays: 27, periodDays: 28, workedMinutes: 0 });
  const jul = basicPay({ employee: monthly, payableDays: 30, periodDays: 31, workedMinutes: 0 });
  assert.equal(Number(feb.amount), 28928.5714);
  assert.equal(Number(jul.amount), 29032.2581);
});

check("a full month pays the whole salary", () => {
  const pay = basicPay({ employee: monthly, payableDays: 30, periodDays: 30, workedMinutes: 0 });
  assert.equal(Number(pay.amount), 30000);
});

check("a daily employee is paid per payable day", () => {
  const pay = basicPay({ employee: daily, payableDays: 22, periodDays: 30, workedMinutes: 0 });
  assert.equal(Number(pay.amount), 26400);
});

check("an hourly employee is paid for minutes actually worked", () => {
  const pay = basicPay({ employee: hourly, payableDays: 20, periodDays: 30, workedMinutes: 9000 });
  assert.equal(Number(pay.amount), 30000);
});

check("a salaried employee still earns overtime", () => {
  // Returning zero here means a manager who covers two double shifts is paid
  // nothing for either.
  const ot = overtimePay({ employee: monthly, overtimeMinutes: 120 });
  assert.ok(Number(ot.amount) > 0);
  // 30000 / 208 = 144.230769... an hour, x1.5 x2 hours. Rounded once at the
  // end rather than compounding an already-rounded rate.
  assert.equal(Number(ot.amount), 432.6923);
});

check("an hourly employee's overtime uses their own rate", () => {
  const ot = overtimePay({ employee: hourly, overtimeMinutes: 60 });
  assert.equal(Number(ot.amount), 400);
});

check("no overtime produces no line at all", () => {
  assert.equal(overtimePay({ employee: monthly, overtimeMinutes: 0 }), null);
});

check("an hourly rate is derived when none is set", () => {
  assert.equal(Number(hourlyRateFor(hourly)), 200);
  assert.equal(Number(hourlyRateFor(daily)), 150);
  assert.ok(Number(hourlyRateFor(monthly)) > 0);
});

check("a percentage component follows the prorated base, not the full one", () => {
  // Otherwise somebody absent for half a month keeps a full month's allowance.
  const full = componentAmount({ component: { percentOfBase: 10 }, proratedBase: 30000 });
  const half = componentAmount({ component: { percentOfBase: 10 }, proratedBase: 15000 });
  assert.equal(Number(full), 3000);
  assert.equal(Number(half), 1500);
});

check("a flat component is the same whatever the base", () => {
  assert.equal(Number(componentAmount({ component: { amount: 2000 }, proratedBase: 15000 })), 2000);
});

check("a component only applies inside its own effective dates", () => {
  const period = { periodStart: "2026-09-01", periodEnd: "2026-09-30" };
  assert.equal(componentApplies({ effectiveFrom: "2026-01-01" }, period), true);
  assert.equal(componentApplies({ effectiveFrom: "2026-10-01" }, period), false);
  assert.equal(componentApplies({ effectiveTo: "2026-08-31" }, period), false);
  assert.equal(componentApplies({ effectiveFrom: "2026-09-15" }, period), true);
});

check("a payslip totals its own lines", () => {
  const slip = buildPayslip({
    employee: monthly,
    attendance: { payableDays: 30, workedMinutes: 14400, overtimeMinutes: 0 },
    components: [
      { name: "House rent", isEarning: true, percentOfBase: 10 },
      { name: "Provident fund", isEarning: false, amount: 1200 },
    ],
    periodDays: 30,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });

  assert.equal(Number(slip.grossAmount), 33000);
  assert.equal(Number(slip.deductionAmount), 1200);
  assert.equal(Number(slip.netAmount), 31800);
  assert.equal(slip.lines.length, 3);
});

check("a payslip shows its working, not just a total", () => {
  // "Basic 12,000" invites a dispute; "22 days at 545.45" answers one.
  const slip = buildPayslip({
    employee: monthly,
    attendance: { payableDays: 22, workedMinutes: 10560, overtimeMinutes: 0 },
    periodDays: 30,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });
  const basic = slip.lines.find((line) => line.code === "BASIC");
  assert.equal(Number(basic.quantity), 22);
  assert.equal(Number(basic.rate), 1000);
});

check("a deduction carries the account it belongs in", () => {
  // `PayslipLine.accountId` exists and is documented as "Ledger account this
  // component posts to", and nothing ever wrote it — so every deduction, from a
  // provident fund to an advance recovery, was credited to 2200 Tax payable.
  const slip = buildPayslip({
    employee: monthly,
    attendance: { payableDays: 30, workedMinutes: 14400, overtimeMinutes: 0 },
    components: [
      { name: "Provident fund", isEarning: false, amount: 1200, accountId: "acct-pf" },
      { name: "Income tax", isEarning: false, amount: 800, accountId: "acct-tax" },
      { name: "Canteen", isEarning: false, amount: 100 },
    ],
    periodDays: 30,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });

  const by = (label) => slip.lines.find((line) => line.label === label);
  assert.equal(by("Provident fund").accountId, "acct-pf");
  assert.equal(by("Income tax").accountId, "acct-tax");
  // Not every component names one. A null is honest; a wrong account is not.
  assert.equal(by("Canteen").accountId, null);
});

check("net pay never goes negative", () => {
  // Deductions larger than the pay are a data problem; a negative wage is not
  // a thing that can happen.
  const slip = buildPayslip({
    employee: monthly,
    attendance: { payableDays: 1, workedMinutes: 480, overtimeMinutes: 0 },
    components: [{ name: "Advance repayment", isEarning: false, amount: 50000 }],
    periodDays: 30,
    periodStart: "2026-09-01",
    periodEnd: "2026-09-30",
  });
  assert.equal(Number(slip.netAmount), 0);
});


// --- Phase 13: commission rules ----------------------------------------------

const globalRule = { id: "r-global", isActive: true, priority: 0, rewardType: "PERCENTAGE", rewardValue: 5, basis: "ATTRIBUTED_LINE", createdAt: "2026-01-01", targets: [] };
const productRule = { id: "r-product", isActive: true, priority: 0, rewardType: "FIXED", rewardValue: 200, basis: "ATTRIBUTED_LINE", createdAt: "2026-01-02", targets: [{ targetType: "PRODUCT", targetId: "p1", isExcluded: false }] };
const categoryRule = { id: "r-cat", isActive: true, priority: 0, rewardType: "PERCENTAGE", rewardValue: 8, basis: "ATTRIBUTED_LINE", createdAt: "2026-01-03", targets: [{ targetType: "CATEGORY", targetId: "c1", isExcluded: false }] };

const lineContext = { productId: "p1", variantId: "v1", categoryId: "c1", lineAmount: 1000, orderSubtotal: 3000, orderTotal: 3400, quantity: 2, creatorId: "cr1", creatorStatus: "ACTIVE" };

check("specificity ranks creator over product over category over global", () => {
  assert.equal(specificityOf({ creatorId: "cr1", targets: [] }), 4);
  assert.equal(specificityOf(productRule), 3);
  assert.equal(specificityOf(categoryRule), 2);
  assert.equal(specificityOf(globalRule), 1);
});

check("a rule with no targets applies everywhere", () => {
  assert.equal(ruleTargetsLine(globalRule, lineContext), true);
});

check("an exclusion beats an inclusion", () => {
  // "Everything except alcohol" is a global rule with an excluded category, and
  // an exclusion that could be outvoted would not express it.
  const rule = { targets: [{ targetType: "CATEGORY", targetId: "c1", isExcluded: true }] };
  assert.equal(ruleTargetsLine(rule, lineContext), false);
});

check("a basis picks the amount it names", () => {
  assert.equal(Number(basisAmountFor("ATTRIBUTED_LINE", lineContext)), 1000);
  assert.equal(Number(basisAmountFor("ORDER_SUBTOTAL", lineContext)), 3000);
  assert.equal(Number(basisAmountFor("ORDER_TOTAL", lineContext)), 3400);
});

check("exactly one rule is applied, never stacked", () => {
  // Two overlapping campaigns paying together produce a promotion nobody
  // modelled, and an unbounded payout.
  const resolved = resolveCommission({ rules: [globalRule, productRule, categoryRule], context: lineContext });
  assert.ok(resolved.rule);
  assert.equal(resolved.rule.id, "r-product");
  assert.equal(Number(resolved.amount), 200);
});

check("priority beats specificity", () => {
  const boosted = { ...globalRule, priority: 10 };
  const resolved = resolveCommission({ rules: [boosted, productRule], context: lineContext });
  assert.equal(resolved.rule.id, "r-global");
});

check("a creator-specific rate outranks a blanket campaign", () => {
  const negotiated = { ...globalRule, id: "r-cr", creatorId: "cr1", rewardValue: 12, targets: [] };
  const resolved = resolveCommission({ rules: [negotiated, productRule], context: lineContext });
  assert.equal(resolved.rule.id, "r-cr");
  assert.equal(Number(resolved.amount), 120);
});

check("resolution is deterministic when everything ties", () => {
  const a = { ...globalRule, id: "r-a", createdAt: "2026-01-05" };
  const b = { ...globalRule, id: "r-b", createdAt: "2026-01-05" };
  const first = resolveCommission({ rules: [a, b], context: lineContext }).rule.id;
  const second = resolveCommission({ rules: [b, a], context: lineContext }).rule.id;
  assert.equal(first, second);
});

check("an order below the threshold reports that, not 'no rule'", () => {
  // A creator shown "no rule matched" when they nearly hit a threshold will
  // conclude the program is broken.
  const gated = { ...globalRule, minOrderAmount: 5000, conditionBasis: "ORDER_TOTAL" };
  const resolved = resolveCommission({ rules: [gated], context: lineContext });
  assert.equal(resolved.rule, null);
  assert.equal(resolved.reason, DisqualifiedReason.BELOW_MIN_ORDER);
});

check("a threshold can measure the order while the reward measures the line", () => {
  const rule = { ...globalRule, minOrderAmount: 3000, conditionBasis: "ORDER_TOTAL", basis: "ATTRIBUTED_LINE" };
  const resolved = resolveCommission({ rules: [rule], context: lineContext });
  assert.equal(Number(resolved.amount), 50);
  assert.equal(Number(resolved.basisAmount), 1000);
});

check("too few units is its own reason", () => {
  const rule = { ...globalRule, minLineQuantity: 5 };
  assert.equal(resolveCommission({ rules: [rule], context: lineContext }).reason, DisqualifiedReason.BELOW_MIN_QUANTITY);
});

check("a percentage is capped by its ceiling", () => {
  // The guard that stops "10% of the order total" paying thousands on a
  // catering order.
  const rule = { ...globalRule, rewardValue: 10, basis: "ORDER_TOTAL", maxRewardAmount: 100 };
  assert.equal(Number(computeReward(rule, lineContext).amount), 100);
});

check("a spent budget stops paying and says so", () => {
  const rule = { ...globalRule, totalBudget: 500, budgetSpent: 500 };
  const resolved = resolveCommission({ rules: [rule], context: lineContext });
  assert.equal(resolved.rule, null);
  assert.equal(resolved.reason, DisqualifiedReason.BUDGET_EXHAUSTED);
});

check("a nearly-spent budget pays only what is left", () => {
  const rule = { ...globalRule, rewardValue: 50, totalBudget: 500, budgetSpent: 480 };
  assert.equal(Number(computeReward(rule, lineContext).amount), 20);
});

check("a creator's own purchase earns nothing by default", () => {
  const resolved = resolveCommission({
    rules: [globalRule],
    context: { ...lineContext, isSelfPurchase: true },
  });
  assert.equal(resolved.reason, DisqualifiedReason.SELF_PURCHASE);
});

check("unless the program allows it", () => {
  const resolved = resolveCommission({
    rules: [globalRule],
    context: { ...lineContext, isSelfPurchase: true, allowSelfPurchaseEarning: true },
  });
  assert.equal(Number(resolved.amount), 50);
});

check("a suspended creator earns nothing", () => {
  const resolved = resolveCommission({
    rules: [globalRule],
    context: { ...lineContext, creatorStatus: "SUSPENDED" },
  });
  assert.equal(resolved.reason, DisqualifiedReason.CREATOR_NOT_ACTIVE);
});

check("an expired campaign does not pay", () => {
  const rule = { ...globalRule, endsAt: "2026-01-31" };
  const resolved = resolveCommission({ rules: [rule], context: { ...lineContext, at: new Date("2026-06-01") } });
  assert.equal(resolved.rule, null);
});

check("an empty scope array means everywhere, not nowhere", () => {
  const rule = { ...globalRule, branchIds: [], channels: [], orderTypes: [] };
  assert.equal(ruleQualifies(rule, { ...lineContext, branchId: "b1", channel: "WEB" }).ok, true);
});

check("a scoped rule respects its scope", () => {
  const rule = { ...globalRule, branchIds: ["b2"] };
  assert.equal(ruleQualifies(rule, { ...lineContext, branchId: "b1" }).ok, false);
});

check("a per-order cap trims the payout", () => {
  const capped = applyProgramCaps({ amount: 500, orderPaidSoFar: 800, maxPerOrder: 1000 });
  assert.equal(Number(capped.amount), 200);
  assert.equal(capped.capped, true);
});

check("a monthly cap already reached pays nothing and says why", () => {
  const capped = applyProgramCaps({ amount: 500, monthPaidSoFar: 5000, maxPerMonth: 5000 });
  assert.equal(Number(capped.amount), 0);
  assert.equal(capped.reason, DisqualifiedReason.MONTHLY_CAP_REACHED);
});

check("no caps configured leaves the amount alone", () => {
  assert.equal(Number(applyProgramCaps({ amount: 500 }).amount), 500);
});

// --- Phase 13: attribution ----------------------------------------------------

check("only an approved video can attribute", () => {
  assert.equal(videoCanAttribute({ status: "APPROVED" }), true);
  assert.equal(videoCanAttribute({ status: "PENDING_REVIEW" }), false);
  assert.equal(videoCanAttribute({ status: "TAKEN_DOWN" }), false);
});

check("the window runs from the touch", () => {
  const expires = expiryFrom("2026-09-01T00:00:00Z", 7);
  assert.equal(expires.toISOString(), "2026-09-08T00:00:00.000Z");
  assert.equal(isWithinWindow({ expiresAt: expires }, new Date("2026-09-05")), true);
  assert.equal(isWithinWindow({ expiresAt: expires }, new Date("2026-09-20")), false);
});

check("the same video touching again refreshes rather than supersedes", () => {
  const same = shouldSupersede({ existing: { videoId: "v1" }, videoId: "v1" });
  assert.deepEqual(same, { create: false, supersede: false, refresh: true });
});

check("a different video supersedes — last touch wins", () => {
  const other = shouldSupersede({ existing: { videoId: "v1" }, videoId: "v2" });
  assert.equal(other.supersede, true);
});

check("a first touch creates", () => {
  assert.equal(shouldSupersede({ existing: null, videoId: "v1" }).create, true);
});

check("a converted attribution can earn; a live cart one cannot", () => {
  assert.equal(attributionCanEarn({ status: "CONVERTED" }), true);
  assert.equal(attributionCanEarn({ status: "ACTIVE" }), false);
  assert.equal(attributionCanEarn({ status: "REVOKED" }), false);
});

check("the earning is computed from what was actually bought", () => {
  // The viewer is free to change quantity between watching and paying.
  const matched = matchLines({
    attribution: { productId: "p1", variantId: "v1" },
    orderItems: [
      { id: "oi1", productId: "p1", variantId: "v1", quantity: 3, lineTotal: 1500 },
      { id: "oi2", productId: "p9", variantId: "v9", quantity: 1, lineTotal: 400 },
    ],
  });
  assert.equal(matched.quantity, 3);
  assert.equal(Number(matched.lineAmount), 1500);
});

check("watching one variant and buying another still counts", () => {
  // Somebody sold a pizza by that video, whichever size they chose.
  const matched = matchLines({
    attribution: { productId: "p1", variantId: "large" },
    orderItems: [{ id: "oi1", productId: "p1", variantId: "small", quantity: 1, lineTotal: 800 }],
  });
  assert.equal(matched.quantity, 1);
  assert.equal(Number(matched.lineAmount), 800);
});

check("an attributed product that was not bought matches nothing", () => {
  const matched = matchLines({
    attribution: { productId: "p1" },
    orderItems: [{ id: "oi1", productId: "p2", quantity: 1, lineTotal: 500 }],
  });
  assert.equal(matched.quantity, 0);
});

check("a creator buying through their own video is a self purchase", () => {
  assert.equal(isSelfPurchase({ creatorUserId: "u1", buyerUserId: "u1" }), true);
  assert.equal(isSelfPurchase({ creatorUserId: "u1", buyerUserId: "u2" }), false);
  assert.equal(isSelfPurchase({ creatorUserId: null, buyerUserId: null }), false);
});

// --- Phase 13: strikes --------------------------------------------------------

check("strike weights differ by severity", () => {
  // A watermarked clip is not a fake order.
  assert.ok(defaultPointsFor("FAKE_ORDER") > defaultPointsFor("REPEATED_REJECTIONS"));
  assert.equal(defaultPointsFor("UNKNOWN_REASON"), 1);
});

check("revoked and expired strikes stop counting", () => {
  const strikes = [
    { points: 2 },
    { points: 3, revokedAt: new Date("2026-01-01") },
    { points: 2, expiresAt: new Date("2026-01-01") },
  ];
  assert.equal(activeStrikes(strikes, new Date("2026-09-01")).length, 1);
  assert.equal(totalPoints(strikes, new Date("2026-09-01")), 2);
});

check("points drive suspension and then a ban", () => {
  assert.equal(standingFor({ points: 1 }).status, "ACTIVE");
  assert.equal(standingFor({ points: 3 }).status, "SUSPENDED");
  assert.equal(standingFor({ points: 5 }).status, "BANNED");
});

check("past the ban threshold is banned, not suspended", () => {
  assert.equal(standingFor({ points: 9, suspendAtStrikePoints: 3, banAtStrikePoints: 5 }).status, "BANNED");
});

check("the re-upload limit counts rejections, not uploads", () => {
  // A creator whose first four attempts were approved has used nothing up.
  assert.equal(canReupload({ rejectionCount: 4, maxUploadAttempts: 5 }), true);
  assert.equal(canReupload({ rejectionCount: 5, maxUploadAttempts: 5 }), false);
  assert.equal(attemptsRemaining({ rejectionCount: 2, maxUploadAttempts: 5 }), 3);
});

check("a locked video cannot be re-uploaded whatever the count", () => {
  assert.equal(canReupload({ rejectionCount: 0, maxUploadAttempts: 5, isLocked: true }), false);
});

check("a lapsed suspension is over without waiting for a job", () => {
  const creator = { status: "SUSPENDED", suspendedUntil: new Date("2026-01-01") };
  assert.equal(isSuspended(creator, new Date("2026-09-01")), false);
  assert.equal(effectiveStatus(creator, new Date("2026-09-01")), "ACTIVE");
});

check("a suspension with no end date does not lapse", () => {
  assert.equal(isSuspended({ status: "SUSPENDED" }), true);
});

check("a ban is a ban regardless of dates", () => {
  assert.equal(isSuspended({ status: "BANNED", suspendedUntil: new Date("2020-01-01") }), true);
});

// --- catalog CSV round trip --------------------------------------------------

check("a quoted field may contain a comma", () => {
  assert.deepEqual(parseCsv('a,"b,c",d'), [["a", "b,c", "d"]]);
});

check("a quoted field may contain a newline", () => {
  assert.deepEqual(parseCsv('name,note\r\n"Pizza","big\nslice"'), [
    ["name", "note"],
    ["Pizza", "big\nslice"],
  ]);
});

check("a doubled quote is one literal quote", () => {
  assert.deepEqual(parseCsv('"He said ""hi"""'), [['He said "hi"']]);
});

check("CRLF and LF parse the same", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d"), parseCsv("a,b\nc,d"));
});

check("a trailing newline is not an extra empty row", () => {
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

check("a leading BOM is stripped from the first header", () => {
  const { headers } = parseCsvRecords("\ufeffslug,name\nx,Y");
  assert.deepEqual(headers, ["slug", "name"]);
});

check("headers are matched case- and space-insensitively", () => {
  const { records } = parseCsvRecords(" Slug , Name \nburger,Burger");
  assert.equal(records[0].values.slug, "burger");
  assert.equal(records[0].values.name, "Burger");
});

check("a short row is padded rather than rejected", () => {
  const { records } = parseCsvRecords("slug,name,description\nburger,Burger");
  assert.equal(records[0].values.description, "");
});

check("the reported line number is the one in the spreadsheet", () => {
  const { records } = parseCsvRecords("slug\na\nb");
  // Header is line 1, so the first record is line 2.
  assert.deepEqual(
    records.map((record) => record.line),
    [2, 3],
  );
});

check("a field needing quotes gets them, and one that does not is left bare", () => {
  assert.equal(escapeCsvField("plain"), "plain");
  assert.equal(escapeCsvField("a,b"), '"a,b"');
  assert.equal(escapeCsvField('say "hi"'), '"say ""hi"""');
  // Surrounding spaces are meaningful in a name and are eaten unless quoted.
  assert.equal(escapeCsvField(" padded "), '" padded "');
});

check("writing then reading returns the original values", () => {
  const rows = [{ slug: "a,b", name: 'He said "hi"', note: "line\nbreak" }];
  const { records } = parseCsvRecords(toCsv(["slug", "name", "note"], rows));
  assert.equal(records[0].values.slug, "a,b");
  assert.equal(records[0].values.name, 'He said "hi"');
  assert.equal(records[0].values.note, "line\nbreak");
});

// --- catalog import parsing --------------------------------------------------

check("booleans accept what a spreadsheet actually writes", () => {
  for (const yes of ["yes", "Yes", "TRUE", "y", "1"]) {
    assert.equal(parseBoolean(yes, { field: "is_active" }).value, true, yes);
  }
  for (const no of ["no", "False", "N", "0"]) {
    assert.equal(parseBoolean(no, { field: "is_active" }).value, false, no);
  }
  assert.ok(parseBoolean("maybe", { field: "is_active" }).error);
});

check("money keeps its exact decimal string, symbols and separators removed", () => {
  assert.equal(parseMoney("$1,299.95", { field: "price" }).value, "1299.95");
  assert.equal(parseMoney("19.99", { field: "price" }).value, "19.99");
  // Never via Number: 19.99 has no exact binary representation.
  assert.equal(typeof parseMoney("19.99", { field: "price" }).value, "string");
});

check("money rejects more precision than the column stores", () => {
  assert.ok(parseMoney("1.234567", { field: "price" }).error);
  assert.ok(parseMoney("-5", { field: "price" }).error);
  assert.ok(parseMoney("free", { field: "price" }).error);
});

check("lists are pipe-separated, de-duplicated and checked", () => {
  const result = parseList("VEG | halal |VEG", { field: "dietary", allowed: ["VEG", "HALAL"] });
  assert.deepEqual(result.value, ["VEG", "HALAL"]);
  assert.ok(parseList("VEG|MYSTERY", { field: "dietary", allowed: ["VEG"] }).error);
});

check("a slug must be a slug", () => {
  assert.equal(parseSlug(" Smash-Burger ", { field: "slug" }).value, "smash-burger");
  assert.ok(parseSlug("smash burger", { field: "slug" }).error);
  assert.ok(parseSlug("-leading", { field: "slug" }).error);
});

check("a blank cell leaves the field alone, and -- clears it", () => {
  const blank = coerceRow("categories", { slug: "mains", name: "Mains", description: "" });
  assert.equal("description" in blank.values, false, "blank must not appear in the update");

  const cleared = coerceRow("categories", { slug: "mains", name: "Mains", description: CLEAR });
  assert.equal(cleared.values.description, null);
  assert.deepEqual(cleared.cleared, ["description"]);
});

check("a field that is not clearable refuses --", () => {
  const row = coerceRow("categories", { slug: "mains", name: CLEAR });
  assert.ok(row.errors.some((error) => error.includes("cannot be cleared")));
});

check("every problem in a row is reported at once", () => {
  const row = coerceRow("products", {
    slug: "not a slug",
    name: "X",
    category_slug: "mains",
    price: "free",
    spice_level: "9",
  });
  assert.equal(row.errors.length, 3, row.errors.join("; "));
});

check("a missing required cell is an error, not a silent default", () => {
  const row = coerceRow("variants", { sku: "SKU-1", product_slug: "burger", name: "Large" });
  assert.ok(row.errors.some((error) => error.startsWith("price:")));
});

check("a header without the key column is refused outright", () => {
  const missing = validateHeaders("products", ["name", "category_slug"]);
  assert.ok(missing.errors.some((error) => error.includes("slug")));
});

check("unknown columns are reported but tolerated", () => {
  const result = validateHeaders("categories", ["slug", "name", "notes_for_me"]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.unknown, ["notes_for_me"]);
});

check("a menu item is keyed by branch, menu, product and variant together", () => {
  const one = keyOf("menu-items", { branch_code: "B1", menu_slug: "lunch", product_slug: "burger", variant_sku: "L" });
  const two = keyOf("menu-items", { branch_code: "B1", menu_slug: "lunch", product_slug: "burger", variant_sku: "S" });
  assert.notEqual(one, two, "two sizes on one menu are different rows");
});

// --- one-time-code field ----------------------------------------------------

check("a typed digit lands in its own box", () => {
  assert.equal(withDigitAt("", 6, 0, "8"), "8");
  assert.equal(withDigitAt("84", 6, 2, "2"), "842");
});

check("typing into a full box replaces it rather than appending", () => {
  assert.equal(withDigitAt("842", 6, 0, "9"), "942");
});

check("a non-digit keystroke changes nothing", () => {
  assert.equal(withDigitAt("842", 6, 3, "x"), "842");
  assert.equal(withDigitAt("842", 6, 3, ""), "842");
});

check("backspace clears the box it is in", () => {
  assert.deepEqual(withBackspaceAt("842", 6, 2), { value: "84", focusIndex: 2 });
});

check("backspace in an empty box clears the one before and steps back", () => {
  assert.deepEqual(withBackspaceAt("842", 6, 3), { value: "84", focusIndex: 2 });
});

check("backspace at the start is a no-op, not a crash", () => {
  assert.deepEqual(withBackspaceAt("", 6, 0), { value: "", focusIndex: 0 });
});

check("a pasted code is taken whatever surrounds it", () => {
  assert.equal(digitsFromPaste("842913", 6), "842913");
  assert.equal(digitsFromPaste("Your code is 842 913\n", 6), "842913");
  assert.equal(digitsFromPaste("8429137777", 6), "842913", "longer than the field is truncated");
});

check("pasting nothing usable is ignored", () => {
  assert.equal(digitsFromPaste("no digits here", 6), "");
  assert.equal(digitsFromPaste(null, 6), "");
});

check("the field renders one slot per box regardless of how full it is", () => {
  assert.deepEqual(toDigits("84", 6), ["8", "4", "", "", "", ""]);
  assert.equal(fromDigits(["8", "4", "", "", "", ""]), "84");
});

check("focus goes to the first empty box, or the last when the code is full", () => {
  assert.equal(firstEmptyIndex("84", 6), 2);
  assert.equal(firstEmptyIndex("", 6), 0);
  assert.equal(firstEmptyIndex("842913", 6), 5);
});

check("a code field is not hardcoded to six digits", () => {
  assert.deepEqual(toDigits("1234", 4), ["1", "2", "3", "4"]);
  assert.equal(digitsFromPaste("12345678", 8), "12345678");
  assert.equal(firstEmptyIndex("123", 8), 3);
});

// --- post-login redirects ---------------------------------------------------

check("a same-site path is honoured", () => {
  assert.equal(safeRedirect("/orders"), "/orders");
  assert.equal(safeRedirect("/menu?offers=1"), "/menu?offers=1");
});

check("an off-site destination is refused", () => {
  assert.equal(safeRedirect("https://evil.example/x"), "/");
  assert.equal(safeRedirect("//evil.example/x"), "/");
  assert.equal(safeRedirect("/\\evil.example"), "/");
  assert.equal(safeRedirect("evil.example"), "/");
});

check("an auth page is never the destination", () => {
  assert.equal(safeRedirect("/login"), "/");
  assert.equal(safeRedirect("/register?next=/x"), "/");
  assert.equal(loginHref("/login"), "/login");
});

check("a redirect is carried in the query when there is one worth carrying", () => {
  assert.equal(loginHref("/orders"), "/login?next=%2Forders");
  assert.equal(registerHref("/orders"), "/register?next=%2Forders");
  assert.equal(loginHref("/"), "/login", "no pointless ?next=/");
});

check("whoever works a board opens on the board", () => {
  /*
   * A kitchen display is a screen on a wall, not a widget on a dashboard, and
   * the overview has nothing on it a cook can use. The test for "this is your
   * job" is reading a board without taking orders — a cashier and a shift
   * supervisor read the board too, but their day is at the counter.
   */
  const cook = ["dashboard.view", "kds.read", "orders.read"];
  const cashier = ["dashboard.view", "kds.read", "orders.read", "orders.create"];

  assert.equal(worksTheBoard(cook), true);
  assert.equal(worksTheBoard(cashier), false, "a cashier's day is at the counter");

  assert.equal(homeFor({ permissions: cook }), HOME_PATHS.kitchen);
  assert.equal(homeFor({ permissions: cashier }), HOME_PATHS.overview);

  // Anyone may override it, in either direction.
  assert.equal(homeFor({ permissions: cook, preference: "overview" }), HOME_PATHS.overview);
  assert.equal(homeFor({ permissions: cashier, preference: "kitchen" }), HOME_PATHS.kitchen);
  assert.equal(homeFor({ permissions: cook, preference: "" }), HOME_PATHS.kitchen, "cleared falls back to the default");

  // A choice is honoured only while it is still reachable: roles change, and
  // somebody moved off the kitchen must not be redirected every morning to a
  // page that will bounce them straight back.
  assert.equal(homeFor({ permissions: ["dashboard.view"], preference: "kitchen" }), HOME_PATHS.overview);

  // And somebody with neither still lands on a door they hold.
  assert.equal(homeFor({ permissions: ["deliveries.read"] }), "/dashboard/dispatch");
  assert.equal(homeFor({ permissions: [] }), "/account");

  // Every choice offered is one the resolver understands.
  for (const choice of HOME_CHOICES) {
    assert.ok(choice.value === "" || HOME_PATHS[choice.value], `no path for "${choice.value}"`);
  }
});

check("whoever works the floor opens on the pass", () => {
  /*
   * A waiter reads a board too, so `kds.read` alone was handing them the
   * cook's screen — station filters, a "start it" for a fryer they do not
   * work. What makes somebody a waiter rather than a cook is that they take
   * orders; what makes them a waiter rather than a cashier is that they do not
   * take the money.
   */
  const waiter = ["dashboard.view", "kds.read", "orders.read", "orders.create", "tables.read"];
  const cashier = [...waiter, "payments.capture"];
  const cook = ["dashboard.view", "kds.read", "orders.read"];

  assert.equal(worksTheFloor(waiter), true);
  assert.equal(worksTheFloor(cashier), false, "a cashier's day is at the till");
  assert.equal(worksTheFloor(cook), false, "a cook does not take orders");
  assert.equal(worksTheBoard(waiter), false, "a waiter is not on the stove");

  assert.equal(homeFor({ permissions: waiter }), HOME_PATHS.pass);
  assert.equal(homeFor({ permissions: cashier }), HOME_PATHS.overview);
  assert.equal(homeFor({ permissions: cook }), HOME_PATHS.kitchen);

  // Overridable both ways, and only while the choice is still reachable.
  assert.equal(homeFor({ permissions: waiter, preference: "overview" }), HOME_PATHS.overview);
  assert.equal(homeFor({ permissions: cashier, preference: "pass" }), HOME_PATHS.pass);
  assert.equal(
    homeFor({ permissions: ["dashboard.view"], preference: "pass" }),
    HOME_PATHS.overview,
    "the pass needs a board to read",
  );
});

check("a stopped queue is judged on age, not on depth", () => {
  /*
   * The whole reason this went unnoticed for days: a count on its own cannot
   * tell a busy queue from a stopped one. Fifty events that are seconds old is
   * a shop doing well; one event an hour old is a worker that is not running
   * and a ledger that is not being written to.
   */
  const now = new Date("2026-10-25T12:00:00Z");
  const at = (minutes) => new Date(now.getTime() - minutes * 60_000);

  assert.equal(queueHealth({ pending: 50, oldestPendingAt: at(0), now }).level, "ok", "busy is not broken");
  assert.equal(queueHealth({ pending: 1, oldestPendingAt: at(90), now }).level, "stalled", "one old event is a stopped worker");
  assert.equal(queueHealth({ pending: 0, failed: 0, now }).level, "ok");

  // Right on the threshold counts; a minute under does not.
  assert.equal(queueHealth({ pending: 1, oldestPendingAt: at(STALL_AFTER_MINUTES), now }).level, "stalled");
  assert.equal(queueHealth({ pending: 1, oldestPendingAt: at(STALL_AFTER_MINUTES - 1), now }).level, "ok");

  // A stall outranks failures: a stopped queue is why they stopped retrying.
  assert.equal(queueHealth({ pending: 3, failed: 2, oldestPendingAt: at(60), now }).level, "stalled");
  assert.equal(queueHealth({ pending: 0, failed: 2, now }).level, "failing");

  // And it carries the reason verbatim. These messages are written for whoever
  // can fix them and usually name the fix outright, so "an error occurred"
  // would throw away the only useful part.
  const failing = queueHealth({
    pending: 0,
    failed: 4,
    topFailure: { reason: "That date is not in any accounting period", count: 4 },
    now,
  });
  assert.match(failing.body, /That date is not in any accounting period/);
  assert.equal(failing.reason, "That date is not in any accounting period");
  assert.doesNotMatch(queueHealth({ pending: 0, failed: 1, now }).body, /Most of them said/);

  // And it says what is actually not happening, because that is the part
  // nobody can see from any other screen.
  const stalled = queueHealth({ pending: 20, oldestPendingAt: at(60), now });
  assert.match(stalled.body, /ledger/);
  assert.match(stalled.body, /stock/);
  assert.match(stalled.body, /notification/);
  assert.match(stalled.body, /Orders and payments themselves are unaffected/);
});

check("an age reads in the largest unit that is still true", () => {
  assert.equal(ageLabel(0), "less than a minute");
  assert.equal(ageLabel(1), "1 minute");
  assert.equal(ageLabel(59), "59 minutes");
  assert.equal(ageLabel(60), "1 hour");
  assert.equal(ageLabel(60 * 26), "1 day");
  assert.equal(ageLabel(60 * 24 * 3), "3 days");

  const now = new Date("2026-10-25T12:00:00Z");
  assert.equal(minutesSince(new Date("2026-10-25T11:30:00Z"), now), 30);
  assert.equal(minutesSince(null, now), 0);
  assert.equal(minutesSince(new Date("2026-10-25T12:30:00Z"), now), 0, "a clock skew is not a negative age");
});

check("a member of staff lands at work, not on the customer verify-email page", () => {
  /*
   * Routing on `emailVerified` alone sent every cashier, chef and rider to a
   * consumer page headed "unlock secret menu items", asking for a code posted
   * to an address the restaurant had invented for them. Email verification is
   * a checkout gate; staff do not check out.
   */
  const cashier = { emailVerified: false, permissions: ["dashboard.view", "orders.read"] };
  assert.equal(signInDestination(cashier, "/"), "/dashboard");
  assert.equal(signInDestination(cashier, "/dashboard/orders"), "/dashboard/orders", "and back to the page they asked for");

  // A rider holds no dashboard.view but can read deliveries, so the workspace
  // is still theirs — the same question the layout asks.
  assert.equal(signInDestination({ emailVerified: false, permissions: ["deliveries.read"] }, "/"), "/dashboard");

  // A customer is unchanged in both directions.
  const customer = { emailVerified: false, permissions: ["self.view_own_orders"] };
  assert.equal(signInDestination(customer, "/menu"), "/verify-email");
  assert.equal(signInDestination({ ...customer, emailVerified: true }, "/menu"), "/menu");

  // And the open-redirect filter still applies to staff.
  assert.equal(signInDestination(cashier, "https://evil.example/x"), "/dashboard");
  assert.equal(signInDestination(cashier, "//evil.example"), "/dashboard");
});

// --- form errors ------------------------------------------------------------

check("field messages are attached to their fields, not dumped in a banner", () => {
  const result = toFormErrors(
    { code: "VALIDATION_ERROR", message: "Invalid request body", details: { email: ["Enter a valid email address"] } },
    { fields: ["email", "password"] },
  );
  assert.deepEqual(result.fieldErrors, { email: "Enter a valid email address" });
  assert.equal(result.formError, null, "no duplicate banner over a field that already says it");
});

check("a message for a field the form does not render still reaches the user", () => {
  const result = toFormErrors(
    { code: "VALIDATION_ERROR", message: "Invalid request body", details: { branchId: ["Required"] } },
    { fields: ["email"] },
  );
  assert.deepEqual(result.fieldErrors, {});
  assert.equal(result.formError, "Invalid request body");
});

check("an error with nothing to attach to becomes the form-level message", () => {
  const result = toFormErrors({ code: "UNAUTHORIZED", message: "Incorrect email or password" }, { fields: ["email"] });
  assert.equal(result.formError, "Incorrect email or password");
});

check("a duplicate email is shown beside the email box", () => {
  const result = toFormErrors(
    { code: "CONFLICT", message: "That email is already registered" },
    { fields: ["name", "email", "password"], conflictField: "email" },
  );
  assert.deepEqual(result.fieldErrors, { email: "That email is already registered" });
  assert.equal(result.formError, null);
});

// --- outlet selection -------------------------------------------------------

const OUTLETS = [
  { id: "b1", code: "FZ-DT", name: "Downtown" },
  { id: "b2", code: "FZ-SS", name: "Seaside" },
];

check("a single-outlet restaurant needs nobody to choose", () => {
  const only = [OUTLETS[0]];
  assert.equal(resolveBranch(only, null)?.id, "b1");
  // Even a cookie naming something else: there is one outlet, so that is the one.
  assert.equal(resolveBranch(only, "b2")?.id, "b1");
});

check("the cookie selects by id or by branch code", () => {
  assert.equal(resolveBranch(OUTLETS, "b2")?.name, "Seaside");
  assert.equal(resolveBranch(OUTLETS, "FZ-SS")?.name, "Seaside");
});

check("a cookie naming an outlet that is no longer listed selects nothing", () => {
  // Closed, renamed or deleted: it must not go on being "selected".
  assert.equal(resolveBranch(OUTLETS, "b9"), null);
  assert.equal(resolveBranch(OUTLETS, ""), null);
  assert.equal(resolveBranch(OUTLETS, null), null);
});

check("no outlets at all resolves to nothing rather than throwing", () => {
  assert.equal(resolveBranch([], "b1"), null);
  assert.equal(resolveBranch(undefined, "b1"), null);
});

check("with several outlets and no choice made, none is assumed", () => {
  // Guessing would price a basket against a kitchen the customer never picked.
  assert.equal(resolveBranch(OUTLETS, null), null);
});

// --- product option rules ---------------------------------------------------

const SAUCES = {
  id: "g-sauce",
  name: "Sauces",
  selectionType: "MULTIPLE",
  allowQuantity: false,
  isRequired: false,
  minSelect: 0,
  maxSelect: 2,
  options: [
    { id: "o-ghost", name: "Ghost pepper", priceDelta: 100, isDefault: false },
    { id: "o-ranch", name: "Ranch", priceDelta: 50, isDefault: true },
    { id: "o-bbq", name: "BBQ", priceDelta: 0, isDefault: false },
  ],
};

const PATTY = {
  id: "g-patty",
  name: "Patty",
  selectionType: "SINGLE",
  allowQuantity: false,
  isRequired: true,
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: "o-single", name: "Single", priceDelta: 0, isDefault: true },
    { id: "o-double", name: "Double", priceDelta: 300, isDefault: false },
  ],
};

const BACON = {
  id: "g-bacon",
  name: "Extra bacon",
  selectionType: "MULTIPLE",
  allowQuantity: true,
  isRequired: false,
  minSelect: 0,
  maxSelect: 3,
  options: [{ id: "o-bacon", name: "Bacon", priceDelta: 200, isDefault: false }],
};

check("a quantity counts against the group maximum, not just the option", () => {
  // "max 3" must mean three rashers, not three ticked boxes of any depth.
  assert.equal(selectedCount(BACON, { "o-bacon": 3 }), 3);
  assert.equal(canSelectMore(BACON, { "o-bacon": 3 }, "o-bacon"), false);
  assert.equal(canSelectMore(BACON, { "o-bacon": 2 }, "o-bacon"), true);
});

check("a required group is unsatisfied until something is chosen", () => {
  assert.equal(groupError(PATTY, {}), "Choose 1 option");
  assert.equal(groupError(PATTY, { "o-double": 1 }), null);
});

check("an optional group is satisfied by choosing nothing", () => {
  assert.equal(groupError(SAUCES, {}), null);
});

check("exceeding a maximum is reported as its own problem", () => {
  assert.equal(groupError(SAUCES, { "o-ghost": 1, "o-ranch": 1, "o-bbq": 1 }), "Choose up to 2 options");
});

check("a single-select group always allows the click, because it replaces", () => {
  assert.equal(canSelectMore(PATTY, { "o-single": 1 }, "o-double"), true);
});

check("validation reports every unsatisfied group at once", () => {
  const errors = validateGroups([PATTY, SAUCES], { [SAUCES.id]: { "o-ghost": 1, "o-ranch": 1, "o-bbq": 1 } });
  assert.deepEqual(Object.keys(errors).sort(), ["g-patty", "g-sauce"]);
});

check("defaults are pre-selected, and a single-select group takes only one", () => {
  const defaults = defaultSelections([PATTY, SAUCES, BACON]);
  assert.deepEqual(defaults[PATTY.id], { "o-single": 1 });
  assert.deepEqual(defaults[SAUCES.id], { "o-ranch": 1 });
  assert.deepEqual(defaults[BACON.id], {});
});

check("the preview total adds modifier deltas before multiplying by quantity", () => {
  const total = previewTotal({
    basePrice: 1000,
    groups: [PATTY, BACON],
    selectionsByGroup: { [PATTY.id]: { "o-double": 1 }, [BACON.id]: { "o-bacon": 2 } },
    quantity: 2,
  });
  // (1000 + 300 + 200*2) * 2
  assert.equal(total, 3400);
});

check("the preview total is base price alone when nothing is selected", () => {
  assert.equal(previewTotal({ basePrice: 1499, groups: [PATTY, SAUCES], selectionsByGroup: {}, quantity: 1 }), 1499);
});

check("the cart payload carries quantities and drops emptied options", () => {
  const payload = toModifierPayload({
    [PATTY.id]: { "o-double": 1 },
    [BACON.id]: { "o-bacon": 2 },
    [SAUCES.id]: { "o-ranch": 0 },
  });
  assert.deepEqual(payload.sort((a, b) => a.optionId.localeCompare(b.optionId)), [
    { optionId: "o-bacon", quantity: 2 },
    { optionId: "o-double", quantity: 1 },
  ]);
});

// --- checkout rules ---------------------------------------------------------

const READY_CART = {
  branchId: "b1",
  type: "PICKUP",
  couponCode: null,
  minimumOrderAmount: 0,
  items: [{ id: "i1", productId: "p1", variantId: "v1", quantity: 2, modifiers: [], comboSelections: [] }],
  totals: { subtotal: 1000, itemCount: 2 },
};

check("delivery needs an account and an address; pickup needs neither", () => {
  const delivery = checkoutRequirements({ type: "DELIVERY", signedIn: false });
  assert.equal(delivery.needsAccount, true);
  assert.equal(delivery.needsAddress, true);
  // A guest delivery is refused by the server, so we never ask a guest for
  // contact details we could not use.
  assert.equal(delivery.needsContact, false);

  const pickup = checkoutRequirements({ type: "PICKUP", signedIn: false });
  assert.equal(pickup.needsAccount, false);
  assert.equal(pickup.needsAddress, false);
  assert.equal(pickup.needsContact, true);
});

check("a signed-in customer is never asked for guest contact details", () => {
  assert.equal(checkoutRequirements({ type: "PICKUP", signedIn: true }).needsContact, false);
});

check("a tip is offered for delivery and dine-in, but not at a pickup counter", () => {
  assert.equal(checkoutRequirements({ type: "DELIVERY", signedIn: true }).acceptsTip, true);
  assert.equal(checkoutRequirements({ type: "DINE_IN", signedIn: true }).acceptsTip, true);
  assert.equal(checkoutRequirements({ type: "PICKUP", signedIn: true }).acceptsTip, false);
});

check("an empty basket is the only blocker reported, not a pile of consequences", () => {
  const blockers = checkoutBlockers({ cart: { ...READY_CART, items: [] }, signedIn: false });
  assert.deepEqual(blockers.map((blocker) => blocker.code), ["EMPTY"]);
});

check("a guest may check out a pickup order once they give a name and phone", () => {
  const without = checkoutBlockers({ cart: READY_CART, signedIn: false, guest: { name: "", phone: "" } });
  assert.deepEqual(without.map((blocker) => blocker.code), ["CONTACT_REQUIRED"]);

  const withContact = checkoutBlockers({
    cart: READY_CART,
    signedIn: false,
    guest: { name: "Sana", phone: "+923001234567" },
  });
  assert.deepEqual(withContact, []);
});

check("whitespace is not a name", () => {
  const blockers = checkoutBlockers({ cart: READY_CART, signedIn: false, guest: { name: "   ", phone: "  " } });
  assert.deepEqual(blockers.map((blocker) => blocker.code), ["CONTACT_REQUIRED"]);
});

check("a guest is told to sign in for delivery rather than to pick an address", () => {
  const blockers = checkoutBlockers({ cart: { ...READY_CART, type: "DELIVERY" }, signedIn: false });
  // Asking someone with no account to choose from an address book they cannot
  // have is a dead end.
  assert.deepEqual(blockers.map((blocker) => blocker.code), ["SIGN_IN_REQUIRED"]);
});

check("a signed-in delivery customer is asked for an address until one is chosen", () => {
  const user = { emailVerified: true };
  const without = checkoutBlockers({ cart: { ...READY_CART, type: "DELIVERY" }, user, signedIn: true });
  assert.deepEqual(without.map((blocker) => blocker.code), ["ADDRESS_REQUIRED"]);

  const chosen = checkoutBlockers({
    cart: { ...READY_CART, type: "DELIVERY" },
    user,
    signedIn: true,
    addressId: "a1",
  });
  assert.deepEqual(chosen, []);
});

check("an unverified account is blocked before the form is filled in", () => {
  const blockers = checkoutBlockers({ cart: READY_CART, user: { emailVerified: false }, signedIn: true });
  assert.deepEqual(blockers.map((blocker) => blocker.code), ["EMAIL_UNVERIFIED"]);
});

check("unavailable lines and a missing branch are reported as basket problems", () => {
  const blockers = checkoutBlockers({
    cart: {
      ...READY_CART,
      branchId: null,
      items: [{ ...READY_CART.items[0], problem: "Sold out" }],
    },
    user: { emailVerified: true },
    signedIn: true,
  });

  assert.deepEqual(blockers.map((blocker) => blocker.code), ["NO_BRANCH", "UNAVAILABLE_ITEMS"]);
  // Every one of them is fixed in the basket, not on the checkout form.
  assert.ok(blockers.every((blocker) => blocker.fix === "cart"));
});

check("a basket below the branch minimum cannot be checked out", () => {
  const blockers = checkoutBlockers({
    cart: { ...READY_CART, minimumOrderAmount: 1500 },
    user: { emailVerified: true },
    signedIn: true,
  });
  assert.deepEqual(blockers.map((blocker) => blocker.code), ["BELOW_MINIMUM"]);
});

check("the quote payload carries ids and quantities, and drops unavailable lines", () => {
  const items = quoteItems({
    items: [
      {
        productId: "p1",
        variantId: "v1",
        quantity: 2,
        unitPrice: 500,
        modifiers: [{ optionId: "o1", groupId: "g1", groupName: "Patty", name: "Double", priceDelta: 300, quantity: 1 }],
        comboSelections: [],
      },
      { productId: "p2", variantId: "v2", quantity: 1, problem: "Sold out", modifiers: [], comboSelections: [] },
    ],
  });

  assert.deepEqual(items, [
    {
      productId: "p1",
      variantId: "v1",
      quantity: 2,
      modifiers: [{ optionId: "o1", quantity: 1 }],
      comboSelections: [],
    },
  ]);
  // No price of any kind travels to the server.
  assert.equal(JSON.stringify(items).includes("500"), false);
});

check("a combo selection keeps the group it was chosen from", () => {
  const [item] = quoteItems({
    items: [
      {
        productId: "p1",
        quantity: 1,
        modifiers: [],
        comboSelections: [
          { groupId: "g1", groupName: "Drink", optionId: "co1", productId: "p9", variantId: "v9", quantity: 1 },
        ],
      },
    ],
  });

  assert.deepEqual(item.comboSelections, [{ groupId: "g1", productId: "p9", variantId: "v9", quantity: 1 }]);
});

check("tip presets are percentages of the subtotal, and zero is one of them", () => {
  const presets = tipPresets(1000);
  assert.deepEqual(presets, [
    { percent: 0, amount: 0 },
    { percent: 5, amount: 50 },
    { percent: 10, amount: 100 },
    { percent: 15, amount: 150 },
  ]);
});

check("tip presets keep minor units rather than rounding a percentage away", () => {
  // 10% of 12.30 is 1.23, not 1. Rounding to a whole unit would quietly change
  // the percentage the button claims to be.
  assert.equal(tipPresets(12.3).find((preset) => preset.percent === 10).amount, 1.23);
});

check("a subtotal that is missing or negative produces no tip rather than NaN", () => {
  assert.deepEqual(tipPresets(undefined).map((preset) => preset.amount), [0, 0, 0, 0]);
  assert.deepEqual(tipPresets(-100).map((preset) => preset.amount), [0, 0, 0, 0]);
});

check("a typed tip is accepted only in a shape the server would take", () => {
  assert.equal(parseTip(""), 0);
  assert.equal(parseTip("250"), 250);
  assert.equal(parseTip("12.50"), 12.5);
  assert.equal(parseTip("abc"), null);
  assert.equal(parseTip("-5"), null);
  assert.equal(parseTip("Infinity"), null);
  // Excess precision is rounded to the four decimal places moneySchema allows,
  // rather than rejected for a digit the customer cannot see is wrong.
  assert.equal(parseTip("1.234567"), 1.2346);
});

check("the checkout payload sends an address only for delivery", () => {
  const pickup = checkoutPayload({
    cart: READY_CART,
    signedIn: true,
    addressId: "a1",
    note: "",
    tipAmount: 100,
  });
  assert.equal("addressId" in pickup, false);
  // A tip offered nowhere must not be sent from a stale piece of state.
  assert.equal(pickup.tipAmount, 0);

  const delivery = checkoutPayload({
    cart: { ...READY_CART, type: "DELIVERY" },
    signedIn: true,
    addressId: "a1",
    note: "  ",
    tipAmount: 100,
  });
  assert.equal(delivery.addressId, "a1");
  assert.equal(delivery.tipAmount, 100);
  // A note of pure whitespace is not a note.
  assert.equal("customerNote" in delivery, false);
});

check("the checkout payload never sends the coupon back", () => {
  const payload = checkoutPayload({
    cart: { ...READY_CART, couponCode: "TEN-OFF" },
    signedIn: true,
    note: "",
    tipAmount: 0,
  });
  // The code lives on the cart; echoing it back only creates a chance to send a
  // stale one.
  assert.equal("couponCode" in payload, false);
});

check("guest details are trimmed and an empty email is omitted", () => {
  const payload = checkoutPayload({
    cart: READY_CART,
    signedIn: false,
    guest: { name: "  Sana  ", phone: " +923001234567 ", email: "  " },
    note: "Extra napkins",
    tipAmount: 0,
  });

  assert.deepEqual(payload.guest, { name: "Sana", phone: "+923001234567" });
  assert.equal(payload.customerNote, "Extra napkins");
});

check("guest count rides along for dine-in only", () => {
  const dineIn = checkoutPayload({
    cart: { ...READY_CART, type: "DINE_IN" },
    signedIn: true,
    guestCount: 4,
    note: "",
    tipAmount: 0,
  });
  assert.equal(dineIn.guestCount, 4);

  const pickup = checkoutPayload({ cart: READY_CART, signedIn: true, guestCount: 4, note: "", tipAmount: 0 });
  assert.equal("guestCount" in pickup, false);
});

// --- dashboard navigation ---------------------------------------------------

const EVERY_PERMISSION_KEY = new Set(PERMISSIONS.map((permission) => permission.key));
const ALL_NAV_ITEMS = [...DASHBOARD_NAV, ...ACCOUNT_NAV].flatMap((section) => section.items);

check("every permission the sidebar names exists in the catalogue", () => {
  // The one mistake that fails silently: a mistyped key hides its link from
  // everybody, forever, without raising anything.
  const unknown = [];
  for (const item of ALL_NAV_ITEMS) {
    for (const key of item.anyOf ?? [item.permission]) {
      if (!EVERY_PERMISSION_KEY.has(key)) unknown.push(`${item.label} -> ${key}`);
    }
  }
  assert.deepEqual(unknown, []);
});

check("no two sidebar links point at the same page", () => {
  const seen = new Set();
  const duplicates = [];
  for (const item of ALL_NAV_ITEMS) {
    if (seen.has(item.href)) duplicates.push(item.href);
    seen.add(item.href);
  }
  assert.deepEqual(duplicates, []);
});

check("every staff link lives under /dashboard and every account link under /account", () => {
  for (const section of DASHBOARD_NAV) {
    for (const item of section.items) assert.ok(item.href.startsWith("/dashboard"), item.href);
  }
  for (const section of ACCOUNT_NAV) {
    for (const item of section.items) assert.ok(item.href.startsWith("/account"), item.href);
  }
});

check("a super admin's \"*\" covers everything without enumerating it", () => {
  assert.equal(hasPermission(["*"], "orders.read"), true);
  assert.equal(hasPermission(["*"], "anything.at.all"), true);
  assert.equal(navItemCount(DASHBOARD_NAV, ["*"]), ALL_NAV_ITEMS.length - ACCOUNT_NAV.flatMap((s) => s.items).length);
});

check("a module wildcard grant is honoured", () => {
  assert.equal(hasPermission(["orders.*"], "orders.read"), true);
  assert.equal(hasPermission(["orders.*"], "payments.read"), false);
});

check("no permissions means no navigation at all", () => {
  assert.deepEqual(visibleNav(DASHBOARD_NAV, []), []);
  assert.deepEqual(visibleNav(DASHBOARD_NAV, undefined), []);
  assert.equal(navItemCount(DASHBOARD_NAV, []), 0);
});

check("an item needing any of several permissions shows when one is held", () => {
  const reports = DASHBOARD_NAV.find((s) => s.id === "insights").items.find((i) => i.label === "Reports");
  assert.equal(canSeeItem(reports, new Set(["reports.view_hr"])), true);
  assert.equal(canSeeItem(reports, new Set(["reports.export"])), false);
});

check("a section with nothing left in it is dropped, not rendered empty", () => {
  // A heading with no links under it reads as something that failed to load.
  const nav = visibleNav(DASHBOARD_NAV, ["orders.read"]);
  assert.deepEqual(nav.map((section) => section.id), ["service"]);
  assert.deepEqual(nav[0].items.map((item) => item.label), ["Orders"]);
});

check("a cashier sees service and finance but never payroll or the ledger", () => {
  const cashier = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "cashier"),
    [...EVERY_PERMISSION_KEY],
  );
  const labels = visibleNav(DASHBOARD_NAV, cashier).flatMap((section) => section.items.map((i) => i.label));

  assert.ok(labels.includes("Orders"));
  assert.ok(!labels.includes("Payroll"), "a cashier must not see payroll");
  assert.ok(!labels.includes("Journal"), "a cashier must not see the ledger");
  assert.ok(!labels.includes("Roles"), "a cashier must not see role administration");
});

check("a customer gets an account area and no staff navigation", () => {
  const customer = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "customer"),
    [...EVERY_PERMISSION_KEY],
  );
  assert.equal(navItemCount(DASHBOARD_NAV, customer), 0);
  assert.ok(navItemCount(ACCOUNT_NAV, customer) > 0);
});

check("a driver reaches the dashboard without holding dashboard.view", () => {
  const driver = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "driver"),
    [...EVERY_PERMISSION_KEY],
  );

  // Gating the shell on dashboard.view alone would lock a driver out of the
  // deliveries they are employed to read.
  assert.equal(hasPermission(driver, "dashboard.view"), false);
  assert.ok(navItemCount(DASHBOARD_NAV, driver) > 0);
  assert.ok(firstNavHref(DASHBOARD_NAV, driver).startsWith("/dashboard"));
});

check("the landing link is null when there is nothing to land on", () => {
  assert.equal(firstNavHref(DASHBOARD_NAV, []), null);
});

check("the longest matching link wins, so a nested page does not highlight its parent", () => {
  const nav = visibleNav(DASHBOARD_NAV, ["*"]);
  assert.equal(activeHref(nav, "/dashboard/stock-transfers"), "/dashboard/stock-transfers");
  assert.equal(activeHref(nav, "/dashboard/orders/abc123"), "/dashboard/orders");
});

check("an exact link only highlights its own page", () => {
  const nav = visibleNav(DASHBOARD_NAV, ["*"]);
  assert.equal(activeHref(nav, "/dashboard"), "/dashboard");
  // Without `exact`, Dashboard would stay lit on every page beneath it.
  assert.equal(activeHref(nav, "/dashboard/payments"), "/dashboard/payments");
});

check("an unknown path highlights nothing rather than guessing", () => {
  assert.equal(activeHref(visibleNav(DASHBOARD_NAV, ["*"]), "/dashboard/nope"), null);
  assert.equal(activeHref(DASHBOARD_NAV, null), null);
});

check("the header offers staff both a dashboard and their own account", () => {
  const manager = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "branch-manager"),
    [...EVERY_PERMISSION_KEY],
  );
  const links = workspaceLinks(manager);

  // An employee ordering lunch from their own restaurant is still a customer.
  assert.deepEqual(links.map((link) => link.label), ["Dashboard", "My account"]);
  assert.ok(links[0].href.startsWith("/dashboard"));
  assert.ok(links[1].href.startsWith("/account"));
});

check("the header offers a customer only their account", () => {
  const customer = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "customer"),
    [...EVERY_PERMISSION_KEY],
  );
  assert.deepEqual(workspaceLinks(customer).map((link) => link.label), ["My account"]);
});

check("a driver's dashboard link skips the overview they cannot open", () => {
  const driver = resolvePermissionKeys(
    SYSTEM_ROLES.find((role) => role.key === "driver"),
    [...EVERY_PERMISSION_KEY],
  );
  const [dashboard] = workspaceLinks(driver);

  assert.notEqual(dashboard.href, "/dashboard");
  assert.ok(dashboard.href.startsWith("/dashboard/"));
});

check("a visitor with no permissions is offered nothing", () => {
  assert.deepEqual(workspaceLinks([]), []);
});

// --- branch form <-> API mapping --------------------------------------------

check("a blank optional field is cleared, not left as an empty string", () => {
  const body = branchPayload({ ...BRANCH_DEFAULTS, name: "Gulberg", code: "GLB" });

  // `""` fails `phoneSchema` and `emailSchema`, so a user who deliberately left
  // them blank would see the form reject itself.
  assert.equal(body.phone, null);
  assert.equal(body.email, null);
  assert.equal(body.legalName, null);
});

check("a blank defaulted field is omitted so the server's default applies", () => {
  const body = branchPayload({ ...BRANCH_DEFAULTS, name: "Gulberg", code: "GLB", country: "", currency: "", timezone: "" });

  // `null` is rejected by a fixed-length check; absence is what means "default".
  assert.ok(!("country" in body));
  assert.ok(!("currency" in body));
  assert.ok(!("timezone" in body));
});

check("numeric fields are sent as numbers, and blank ones as null", () => {
  const body = branchPayload({
    ...BRANCH_DEFAULTS,
    name: "Gulberg",
    code: "GLB",
    latitude: "31.5204",
    longitude: "74.3587",
    deliveryRadiusKm: "",
  });

  assert.equal(body.latitude, 31.5204);
  assert.equal(body.longitude, 74.3587);
  assert.equal(body.deliveryRadiusKm, null);
});

check("values are trimmed before they are sent", () => {
  const body = branchPayload({ ...BRANCH_DEFAULTS, name: "  Gulberg  ", code: " glb-01 " });
  assert.equal(body.name, "Gulberg");
  assert.equal(body.code, "glb-01");
});

check("isActive is always a boolean", () => {
  assert.equal(branchPayload({ ...BRANCH_DEFAULTS, name: "A", code: "A" }).isActive, true);
  assert.equal(branchPayload({ ...BRANCH_DEFAULTS, name: "A", code: "A", isActive: false }).isActive, false);
});

check("an existing branch's nulls become empty inputs, not the string 'null'", () => {
  const values = branchFormValues({
    id: "b1",
    code: "GLB",
    name: "Gulberg",
    legalName: null,
    phone: null,
    latitude: 31.5204,
    country: "PK",
    isActive: false,
    openedAt: new Date("2024-03-01T00:00:00.000Z"),
  });

  assert.equal(values.legalName, "");
  assert.equal(values.phone, "");
  assert.equal(values.latitude, "31.5204");
  assert.equal(values.openedAt, "2024-03-01");
  assert.equal(values.isActive, false);
});

check("a round trip through the form leaves a branch unchanged", () => {
  const branch = {
    code: "GLB",
    name: "Gulberg",
    legalName: null,
    taxIdentifier: null,
    phone: "+92 300 1234567",
    email: null,
    addressLine1: "12 Main Boulevard",
    addressLine2: null,
    city: "Lahore",
    state: "Punjab",
    country: "PK",
    postalCode: null,
    latitude: 31.5204,
    longitude: 74.3587,
    timezone: "Asia/Karachi",
    currency: "PKR",
    deliveryRadiusKm: 8,
    openedAt: null,
    isActive: true,
  };

  const body = branchPayload(branchFormValues(branch));

  for (const [key, value] of Object.entries(branch)) {
    assert.deepEqual(body[key], value, `${key} changed on the way through the form`);
  }
});

check("an unset date stays unset", () => {
  assert.equal(toDateInput(null), "");
  assert.equal(toDateInput("not a date"), "");
});

// --- branch scoping ----------------------------------------------------------

const scopedPrincipal = ({ allow = [], deny = [], isSuperAdmin = false } = {}) => {
  const toMap = (entries) => {
    const map = new Map();
    for (const [key, branchId] of entries) {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(branchId);
    }
    return map;
  };
  // Every registered user really does carry a company-wide role for their own
  // account, so `branchIds` includes null for everybody. That is precisely why
  // "do they hold a role at that branch" cannot be the disclosure test.
  return { isSuperAdmin, allow: toMap(allow), deny: toMap(deny), branchIds: [null] };
};

check("a super admin is scoped to every branch", () => {
  assert.deepEqual(branchScope(scopedPrincipal({ isSuperAdmin: true }), "branches.read"), {
    all: true,
    except: [],
  });
});

check("a company-wide grant covers every branch", () => {
  const scope = branchScope(scopedPrincipal({ allow: [["branches.read", null]] }), "branches.read");
  assert.equal(scope.all, true);
  assert.deepEqual(scope.except, []);
});

check("a branch-scoped grant covers only that branch", () => {
  const scope = branchScope(scopedPrincipal({ allow: [["branches.read", "b1"]] }), "branches.read");
  assert.deepEqual(scope, { all: false, ids: ["b1"] });
});

check("a permission held nowhere filters everything out, not nothing", () => {
  // The dangerous reading of an empty list is "no filter" — which would hand
  // the whole company to the one person entitled to none of it.
  const scope = branchScope(scopedPrincipal({ allow: [["orders.read", "b1"]] }), "branches.read");
  assert.deepEqual(scope, { all: false, ids: [] });
});

// A stub module so the record-access rules can be tested without a database:
// one kind, one company-wide record, one record at branch b1.
const { recordAccess: makeRecordAccess } = await import("@/server/access/scope");
const stubAccess = makeRecordAccess(
  { thing: async (id) => (id === "company" ? [null] : id === "atB1" ? ["b1"] : null) },
  { thing: "Thing not found" },
);

/** Runs an access check and reduces it to a status, so `check` can stay synchronous. */
async function accessOutcome(principal, id, permissionKey) {
  try {
    await stubAccess.assertRecordAccess(principal, "thing", id, permissionKey);
    return "allowed";
  } catch (error) {
    return error?.status ?? error?.code ?? "threw";
  }
}

const companyWideForScoped = await accessOutcome(scopedPrincipal({ allow: [["holidays.read", "b1"]] }), "company", "holidays.read");
const companyWideForAdmin = await accessOutcome(scopedPrincipal({ isSuperAdmin: true }), "company", "holidays.read");
const companyWideForOutsider = await accessOutcome(scopedPrincipal({ allow: [["orders.read", "b1"]] }), "company", "holidays.read");
const ownBranchRecord = await accessOutcome(scopedPrincipal({ allow: [["holidays.read", "b1"]] }), "atB1", "holidays.read");
const otherBranchRecord = await accessOutcome(scopedPrincipal({ allow: [["holidays.read", "b2"]] }), "atB1", "holidays.read");
const missingRecord = await accessOutcome(scopedPrincipal({ isSuperAdmin: true }), "nope", "holidays.read");

check("a company-wide record opens for anyone holding the permission anywhere", () => {
  // A holiday on every site and a payroll run across every branch both carry a
  // null branch. Refusing a null branch as "a branch must be specified" turned
  // the ordinary case into a 400 for everybody, super admins included.
  assert.equal(companyWideForScoped, "allowed");
  assert.equal(companyWideForAdmin, "allowed");
});

check("a company-wide record is still refused to someone without the permission", () => {
  assert.equal(companyWideForOutsider, 403);
});

check("a record at your own branch opens, one at another branch is not found", () => {
  assert.equal(ownBranchRecord, "allowed");
  // Not 403: that would confirm the id is real to anyone who guessed one.
  assert.equal(otherBranchRecord, 404);
});

check("a record that does not exist is not found", () => {
  assert.equal(missingRecord, 404);
});

check("a global DENY beats a global grant", () => {
  const scope = branchScope(
    scopedPrincipal({ allow: [["branches.read", null]], deny: [["branches.read", null]] }),
    "branches.read",
  );
  assert.deepEqual(scope, { all: false, ids: [] });
});

check("a DENY at one branch carves it out of a company-wide grant", () => {
  const scope = branchScope(
    scopedPrincipal({ allow: [["branches.read", null]], deny: [["branches.read", "b2"]] }),
    "branches.read",
  );
  assert.deepEqual(scope, { all: true, except: ["b2"] });
});

check("a DENY removes a branch from a scoped grant", () => {
  const scope = branchScope(
    scopedPrincipal({ allow: [["branches.read", "b1"], ["branches.read", "b2"]], deny: [["branches.read", "b2"]] }),
    "branches.read",
  );
  assert.deepEqual(scope, { all: false, ids: ["b1"] });
});

check("nobody at all is scoped to nothing", () => {
  assert.deepEqual(branchScope(null, "branches.read"), { all: false, ids: [] });
});

// --- category tree ------------------------------------------------------------

// Drinks > Hot > Tea > Green  (4 levels) ; Food > Burgers ; Sides
const cat = (id, name, parentId = null, sortOrder = 0) => ({ id, name, parentId, sortOrder });
const CATS = [
  cat("food", "Food", null, 0),
  cat("drinks", "Drinks", null, 10),
  cat("sides", "Sides", null, 0),
  cat("burgers", "Burgers", "food"),
  cat("hot", "Hot", "drinks"),
  cat("tea", "Tea", "hot"),
  cat("green", "Green", "tea"),
];

check("the client's depth limit matches the server's", () => {
  assert.equal(MAX_CATEGORY_DEPTH, SERVER_MAX_CATEGORY_DEPTH);
});

check("the tree is in menu order: sortOrder, then name", () => {
  assert.deepEqual(
    flattenTree(toTree(CATS)).map((row) => `${row.depth}:${row.id}`),
    ["1:food", "2:burgers", "1:sides", "1:drinks", "2:hot", "3:tea", "4:green"],
  );
});

check("a row whose parent is missing is shown at the top, not dropped", () => {
  const tree = toTree([cat("orphan", "Orphan", "gone")]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].depth, 1);
});

check("already-cyclic data does not hang the tree", () => {
  const rows = [cat("a", "A", "b"), cat("b", "B", "a"), cat("root", "Root")];
  assert.deepEqual(flattenTree(toTree(rows)).map((row) => row.id), ["root"]);
});

check("descendants and height are measured through every level", () => {
  assert.deepEqual([...descendantIds(CATS, "drinks")].sort(), ["green", "hot", "tea"]);
  assert.equal(heightBelow(CATS, "drinks"), 3);
  assert.equal(heightBelow(CATS, "green"), 0);
});

check("a category cannot be offered itself or its own descendants as a parent", () => {
  const options = parentOptions(CATS, "hot");
  const disabled = options.filter((option) => option.disabled).map((option) => option.value);
  for (const id of ["hot", "tea", "green"]) assert.ok(disabled.includes(id), `${id} should be disabled`);
  assert.ok(!disabled.includes("food"));
});

check("a parent that would make the tree too deep is disabled with the reason", () => {
  // "hot" carries two levels below it; under "burgers" (depth 2) it would reach 5.
  const burgers = parentOptions(CATS, "hot").find((option) => option.value === "burgers");
  assert.equal(burgers.disabled, true);
  assert.match(burgers.label, /too deep/);

  // A brand-new leaf can go under depth 3, but not under depth 4.
  const fresh = parentOptions(CATS);
  assert.equal(fresh.find((option) => option.value === "tea").disabled, false);
  assert.equal(fresh.find((option) => option.value === "green").disabled, true);
});

check("moving a category renumbers every sibling, so two zeros can still swap", () => {
  const siblings = [cat("a", "Alpha", null, 0), cat("b", "Beta", null, 0), cat("c", "Gamma", null, 0)];
  assert.deepEqual(reorderSiblings(siblings, "c", "up"), [
    { id: "a", sortOrder: 0 },
    { id: "c", sortOrder: 10 },
    { id: "b", sortOrder: 20 },
  ]);
});

check("an impossible move is refused rather than sent", () => {
  const siblings = [cat("a", "A", null, 0), cat("b", "B", null, 10)];
  assert.equal(reorderSiblings(siblings, "a", "up"), null);
  assert.equal(reorderSiblings(siblings, "b", "down"), null);
  assert.equal(reorderSiblings(siblings, "zzz", "up"), null);
});

// --- category form ---------------------------------------------------------------

check("clearing a category's description and image sends null", () => {
  const body = categoryPayload({ name: "Burgers", slug: "", description: "  ", imageUrl: "", parentId: "", isActive: true });
  assert.equal(body.description, null);
  assert.equal(body.imageUrl, null);
  assert.equal(body.parentId, null);
});

check("an unchanged web address is not sent, so saving never renames a link", () => {
  const original = { name: "Burgers", slug: "burgers", description: null, imageUrl: null, parentId: null, isActive: true };
  assert.ok(!("slug" in categoryPayload(categoryFormValues(original), { original })));
  assert.equal(categoryPayload({ ...categoryFormValues(original), slug: "smash-burgers" }, { original }).slug, "smash-burgers");
});

check("a blank web address on create is left for the server to derive", () => {
  assert.ok(!("slug" in categoryPayload(categoryFormValues(null))));
});

check("a new category starts under the requested parent, and visible", () => {
  const values = categoryFormValues(null, { parentId: "drinks" });
  assert.equal(values.parentId, "drinks");
  assert.equal(values.isActive, true);
});

// --- image upload ---------------------------------------------------------------

check("a large photo is scaled to fit, keeping its shape", () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 2000, height: 1500 });
  assert.deepEqual(fitWithin(1080, 4000), { width: 540, height: 2000 });
});

check("a small image is never enlarged", () => {
  assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 });
});

// --- product form: money ----------------------------------------------------------

check("prices parse plainly, with thousands separators, and to four places", () => {
  assert.deepEqual(parsePriceInput("850"), { value: 850 });
  assert.deepEqual(parsePriceInput(" 1,200.50 "), { value: 1200.5 });
  assert.deepEqual(parsePriceInput("12.3456"), { value: 12.3456 });
  assert.deepEqual(parsePriceInput(""), { value: null });
});

check("a price that cannot be read with certainty is refused, not guessed", () => {
  // "3,50" is a European decimal; reading it as 350 would be a silent 100x error.
  assert.ok(parsePriceInput("3,50").error);
  assert.ok(parsePriceInput("12.34567").error);
  assert.ok(parsePriceInput("-5").error);
  assert.ok(parsePriceInput("abc").error);
  assert.ok(parsePriceInput("1.2.3").error);
});

check("whole numbers respect their bounds", () => {
  assert.deepEqual(parseWhole("15", { max: 1440 }), { value: 15 });
  assert.ok(parseWhole("1441", { max: 1440 }).error);
  assert.ok(parseWhole("2.5").error);
  assert.deepEqual(parseWhole(" "), { value: null });
});

check("allergens split on commas and lines, without blanks or duplicates", () => {
  assert.deepEqual(parseAllergenList("gluten, Dairy,,\n dairy , sesame"), ["gluten", "Dairy", "sesame"]);
});

// --- product form: payloads -------------------------------------------------------

const baseForm = () => ({ ...productFormValues(null), name: "Smash Burger", categoryId: "c1" });

check("a new single-price product sends its price and no variants", () => {
  const { body, errors } = productPayload({ ...baseForm(), price: "850" });
  assert.deepEqual(errors, {});
  assert.equal(body.price, 850);
  assert.ok(!("variants" in body));
});

check("a new product starts with the database's 15-minute prep time, and blank is refused", () => {
  assert.equal(productFormValues(null).prepTimeMinutes, "15");
  const { errors } = productPayload({ ...baseForm(), price: "850", prepTimeMinutes: "" });
  assert.ok(errors.prepTimeMinutes);
});

check("sizes become variants with exactly one default", () => {
  const { body, errors } = productPayload({
    ...baseForm(),
    pricing: "sizes",
    sizes: [
      { key: "a", name: "Regular", price: "650" },
      { key: "b", name: "Large", price: "850" },
    ],
    defaultSize: "b",
  });
  assert.deepEqual(errors, {});
  assert.deepEqual(
    body.variants.map((variant) => [variant.name, variant.price, variant.isDefault]),
    [["Regular", 650, false], ["Large", 850, true]],
  );
});

check("sizes are checked for names, duplicates, prices and count before sending", () => {
  const sized = (sizes) => productPayload({ ...baseForm(), pricing: "sizes", sizes, defaultSize: "a" }).errors.variants;
  assert.match(sized([{ key: "a", name: "Regular", price: "650" }]), /at least two/);
  assert.match(sized([{ key: "a", name: "Large", price: "1" }, { key: "b", name: "large", price: "2" }]), /twice/);
  assert.match(sized([{ key: "a", name: "Regular", price: "" }, { key: "b", name: "Large", price: "2" }]), /needs a price/);
  // A completely empty row is ignored rather than reported.
  assert.match(sized([{ key: "a", name: "Regular", price: "1" }, { key: "b", name: "", price: "" }]), /at least two/);
});

check("editing never sends prices from the details form", () => {
  const original = { name: "Smash Burger", slug: "smash-burger", categoryId: "c1", prepTimeMinutes: 15 };
  const { body } = productPayload({ ...productFormValues(original), price: "999" }, { original });
  assert.ok(!("price" in body) && !("variants" in body));
  assert.ok(!("slug" in body), "an unchanged web address is not re-sent");
});

check("clearing optional product fields sends null", () => {
  const original = { name: "A", slug: "a", categoryId: "c1", prepTimeMinutes: 15, calories: 500, spiceLevel: 3, stationId: "s1" };
  const { body } = productPayload(
    { ...productFormValues(original), calories: "", spiceLevel: "", stationId: "", description: " " },
    { original },
  );
  assert.equal(body.calories, null);
  assert.equal(body.spiceLevel, null);
  assert.equal(body.stationId, null);
  assert.equal(body.description, null);
});

check("a 'was' price must be above the price, and can be cleared", () => {
  assert.ok(variantPayload({ name: "Large", price: "850", compareAtPrice: "850" }).errors.compareAtPrice);
  const { body, errors } = variantPayload({ name: "Large", price: "850", compareAtPrice: "", sku: "SKU-1" });
  assert.deepEqual(errors, {});
  assert.equal(body.compareAtPrice, null);
});

check("a blank SKU is left for the server on create, and never sent as empty on edit", () => {
  assert.ok(!("sku" in variantPayload({ name: "Large", price: "1", sku: "" }, { creating: true }).body));
  assert.ok(!("sku" in variantPayload({ name: "Large", price: "1", sku: " " }).body));
});

// --- product sale state ------------------------------------------------------------

const live = { isActive: true, deletedAt: null, category: { name: "Burgers", isActive: true } };

check("the first unmet condition is the one reported", () => {
  assert.equal(productSaleState({ ...live, deletedAt: "2026-01-01", isActive: false }).key, "DELETED");
  assert.equal(productSaleState({ ...live, isActive: false }).key, "DRAFT");
  assert.equal(productSaleState({ ...live, category: { name: "Burgers", isActive: false } }).key, "CATEGORY_HIDDEN");
  assert.equal(productSaleState(live, []).key, "NOT_ON_MENU");
  assert.equal(productSaleState(live, [{ isActive: true }]).key, "ON_SALE");
});

check("a combo with a slot that cannot be filled is not on sale, whatever its menus say", () => {
  const state = productSaleState(live, [{ isActive: true }], { comboIssues: [{ level: "warning", message: "w" }, { level: "blocking", message: "Drink slot is empty" }] });
  assert.equal(state.key, "COMBO_INCOMPLETE");
  assert.equal(state.detail, "Drink slot is empty");
  assert.equal(productSaleState(live, [{ isActive: true }], { comboIssues: [{ level: "warning", message: "w" }] }).key, "ON_SALE");
});

check("being on only switched-off menus is not being on sale", () => {
  const state = productSaleState(live, [{ isActive: false }]);
  assert.equal(state.key, "NOT_ON_MENU");
  assert.match(state.detail, /switched off/);
});

// --- local media ------------------------------------------------------------------

check("local-driver uploads are recognised, other hosts are not", () => {
  assert.equal(isLocalMediaUrl("http://localhost:3000/api/v1/media/file/product/2026/09/a.webp"), true);
  assert.equal(isLocalMediaUrl("/api/v1/media/file/x.webp"), true);
  assert.equal(isLocalMediaUrl("https://res.cloudinary.com/demo/image/upload/a.jpg"), false);
  assert.equal(isLocalMediaUrl("https://evil.test/?u=/api/v1/media/file/"), false);
  assert.equal(isLocalMediaUrl(null), false);
});

// --- partial updates never invent values -----------------------------------------

check("a patch schema drops create-time defaults at any depth", () => {
  const create = zod.object({
    name: zod.string().default("Regular"),
    sortOrder: zod.number().default(0).optional(),
    note: zod.string().default("x").nullable().optional(),
    isActive: zod.boolean().default(true),
  });
  const patch = patchSchema(create);
  assert.deepEqual(patch.parse({ isActive: false }), { isActive: false });
  assert.deepEqual(patch.parse({ note: null }), { note: null });
  assert.deepEqual(injectedDefaults(patch), []);
});

check("an empty patch is refused now that defaults cannot fill it", () => {
  const patch = patchSchema(zod.object({ sortOrder: zod.number().default(0) }));
  assert.equal(patch.safeParse({}).success, false);
});

check("patch schemas keep each field's own validation", () => {
  const patch = patchSchema(zod.object({ code: zod.string().min(2).transform((v) => v.toUpperCase()).default("AA") }));
  assert.equal(patch.safeParse({ code: "x" }).success, false);
  assert.deepEqual(patch.parse({ code: "ab" }), { code: "AB" });
});

// Loaded up front: `check` is synchronous, and an async body would report a
// pass before its assertions ran.
const validationModules = await Promise.all(
  readdirSync(new URL("../src/server/validation/", import.meta.url))
    .filter((name) => name.endsWith(".js"))
    .map(async (file) => [file, await import(`@/server/validation/${file.replace(/\.js$/, "")}`)]),
);

check("no update schema anywhere fills in a field the request left out", () => {
  // The bug this guards: in Zod 4, `.default()` survives `.partial()`, so a
  // PATCH of `{ isDefault: true }` renamed a variant to "Regular", and a PATCH
  // of a branch's name reopened it. Every update* schema in every validation
  // module is walked, so a new one written the old way fails here.
  const offenders = [];
  let checked = 0;
  for (const [file, mod] of validationModules) {
    for (const [name, schema] of Object.entries(mod)) {
      if (!/^update.*Schema$/.test(name) || !schema?._zod) continue;
      checked += 1;
      const injected = injectedDefaults(schema);
      if (injected.length) offenders.push(`${file}:${name} -> ${injected.join(", ")}`);
    }
  }
  assert.ok(checked >= 40, `expected to find the update schemas, found ${checked}`);
  assert.deepEqual(offenders, []);
});

check("the specific corruptions are gone", () => {
  const catalog = Object.fromEntries(validationModules)["catalog.schemas.js"];
  const identity = Object.fromEntries(validationModules)["schemas.js"];
  assert.deepEqual(catalog.updateVariantSchema.parse({ isDefault: true }), { isDefault: true });
  assert.deepEqual(catalog.updateModifierOptionSchema.parse({ name: "Mayo" }), { name: "Mayo" });
  assert.deepEqual(identity.updateBranchSchema.parse({ name: "Gulberg" }), { name: "Gulberg" });
  assert.deepEqual(identity.updateAddressSchema.parse({ label: "Work" }), { label: "Work" });
});

// --- modifier groups ----------------------------------------------------------------

check("price adjustments may be negative, in any of the ways people type a minus", () => {
  assert.deepEqual(parseMoneyDelta("-50"), { value: -50 });
  assert.deepEqual(parseMoneyDelta("− 50"), { value: -50 });
  assert.deepEqual(parseMoneyDelta("+30"), { value: 30 });
  assert.deepEqual(parseMoneyDelta("-0"), { value: 0 });
  assert.ok(parseMoneyDelta("-3,50").error);
});

check("a group's rule is described the way checkout enforces it", () => {
  // The minimum only bites once something is picked; saying "pick 2" would
  // promise a rule checkout does not keep.
  assert.equal(describeModifierRule({ selectionType: "SINGLE", minSelect: 1, maxSelect: 1 }), "One choice");
  assert.equal(describeModifierRule({ selectionType: "MULTIPLE", minSelect: 0, maxSelect: 3 }), "Up to 3");
  assert.equal(describeModifierRule({ selectionType: "MULTIPLE", minSelect: 2, maxSelect: 2 }), "Exactly 2 if any are picked");
  assert.equal(describeModifierRule({ selectionType: "MULTIPLE", minSelect: 1, maxSelect: 3, allowQuantity: true }), "1–3 if any are picked · repeats allowed");
});

check("the form's rule errors mirror the server's", () => {
  // Every case assertRulesAreSatisfiable refuses, refused here first.
  const { assertRulesAreSatisfiable } = { assertRulesAreSatisfiable: modifierServiceRules };
  const cases = [
    { selectionType: "SINGLE", minSelect: 0, maxSelect: 2, allowQuantity: false, optionCount: 3 },
    { selectionType: "MULTIPLE", minSelect: 3, maxSelect: 2, allowQuantity: false, optionCount: 5 },
    { selectionType: "MULTIPLE", minSelect: 3, maxSelect: 4, allowQuantity: false, optionCount: 2 },
    { selectionType: "MULTIPLE", minSelect: 3, maxSelect: 4, allowQuantity: true, optionCount: 2 },
    { selectionType: "MULTIPLE", minSelect: 1, maxSelect: 3, allowQuantity: false, optionCount: 3 },
  ];
  for (const rules of cases) {
    let serverRefuses = false;
    try { assertRulesAreSatisfiable(rules); } catch { serverRefuses = true; }
    assert.equal(Object.keys(modifierRuleErrors(rules)).length > 0, serverRefuses, JSON.stringify(rules));
  }
});

check("a new one-choice group sends one pick max, and its choices with prices", () => {
  const form = {
    ...modifierGroupFormValues(),
    name: "Choose a sauce",
    maxSelect: "5", // ignored for a one-choice group
    options: [
      { key: "a", name: "Ketchup", priceDelta: "", isDefault: true },
      { key: "b", name: "Mayo", priceDelta: "30", isDefault: false },
      { key: "c", name: "", priceDelta: "", isDefault: false },
    ],
  };
  const { body, errors } = modifierGroupPayload(form, { creating: true });
  assert.deepEqual(errors, {});
  assert.equal(body.maxSelect, 1);
  assert.equal(body.allowQuantity, false);
  assert.deepEqual(body.options.map((o) => [o.name, o.priceDelta, o.isDefault]), [["Ketchup", 0, true], ["Mayo", 30, false]]);
  assert.ok(!("internalName" in body));
});

check("a new group is checked for duplicate choices, two defaults and an impossible minimum", () => {
  const base = { ...modifierGroupFormValues(), name: "Extras" };
  const dup = modifierGroupPayload({ ...base, options: [{ key: "a", name: "Cheese", priceDelta: "", isDefault: false }, { key: "b", name: "cheese", priceDelta: "", isDefault: false }] }, { creating: true });
  assert.match(dup.errors.options, /twice/);
  const twoDefaults = modifierGroupPayload({ ...base, options: [{ key: "a", name: "A", priceDelta: "", isDefault: true }, { key: "b", name: "B", priceDelta: "", isDefault: true }] }, { creating: true });
  assert.match(twoDefaults.errors.options, /only one/);
  const tooMany = modifierGroupPayload({ ...base, selectionType: "MULTIPLE", minSelect: "3", maxSelect: "4", options: [{ key: "a", name: "A", priceDelta: "", isDefault: false }] }, { creating: true });
  assert.match(tooMany.errors.minSelect, /Only 1 choice/);
});

check("a one-choice group's minimum above 1 is refused, not quietly lowered", () => {
  const { errors } = modifierGroupPayload({ ...modifierGroupFormValues(), name: "Crust", minSelect: "3" }, { optionCount: 4 });
  assert.match(errors.minSelect, /0 or 1/);
});

check("editing a group's rules sends no options and clears an internal name with null", () => {
  const group = { name: "Extras", internalName: "burger-extras", selectionType: "MULTIPLE", minSelect: 0, maxSelect: 3, allowQuantity: true, isActive: true };
  const { body, errors } = modifierGroupPayload({ ...modifierGroupFormValues(group), internalName: "" }, { optionCount: 4 });
  assert.deepEqual(errors, {});
  assert.ok(!("options" in body));
  assert.equal(body.internalName, null);
});

check("a group with too few switched-on choices is reported as blocking", () => {
  const issues = modifierGroupHealth({ isActive: true, minSelect: 2, allowQuantity: false, options: [{ isActive: true }, { isActive: false }] });
  assert.equal(issues[0].level, "blocking");
  assert.equal(modifierGroupHealth({ isActive: true, minSelect: 0, options: [{ isActive: true }] }).length, 0);
  assert.equal(modifierGroupHealth({ isActive: true, minSelect: 0, options: [] })[0].level, "blocking");
});

check("an option's price adjustment defaults to zero, and a bad one is refused", () => {
  assert.deepEqual(modifierOptionPayload({ name: " Extra cheese ", priceDelta: "" }), { body: { name: "Extra cheese", priceDelta: 0 }, errors: {} });
  assert.ok(modifierOptionPayload({ name: "x", priceDelta: "abc" }).errors.priceDelta);
});

// --- combos ------------------------------------------------------------------------

const opt = (name, { isActive = true, deletedAt = null, variantActive = true } = {}) => ({
  product: { name, isActive, deletedAt },
  variant: { isActive: variantActive },
});

check("a combo choice is only available if its product and size are both on sale", () => {
  assert.equal(comboOptionAvailable(opt("Coke")), true);
  assert.equal(comboOptionAvailable(opt("Coke", { isActive: false })), false);
  assert.equal(comboOptionAvailable(opt("Coke", { deletedAt: "2026-01-01" })), false);
  assert.equal(comboOptionAvailable(opt("Coke", { variantActive: false })), false);
});

check("slot rules read plainly", () => {
  assert.equal(describeSlotRule({ minSelect: 1, maxSelect: 1 }), "Pick 1");
  assert.equal(describeSlotRule({ minSelect: 0, maxSelect: 2 }), "Optional · up to 2");
  assert.equal(describeSlotRule({ minSelect: 1, maxSelect: 2 }), "Pick 1–2");
});

check("a slot that cannot be filled blocks the combo, naming the slot", () => {
  const issues = comboHealth([
    { name: "Choose a drink", minSelect: 1, options: [opt("Coke", { isActive: false }), opt("Sprite", { variantActive: false })] },
    { name: "Choose a side", minSelect: 1, options: [opt("Fries"), opt("Old Wedges", { deletedAt: "x" })] },
  ]);
  assert.equal(issues[0].level, "blocking");
  // Every choice in it has been withdrawn, so there is nothing to pick.
  assert.match(issues[0].message, /Choose a drink.*no choices that can be sold/);
  assert.equal(issues[1].level, "warning");
  assert.match(issues[1].message, /Old Wedges is not on sale/);
});

check("an optional slot with nothing available is not blocking, and no slots is a warning", () => {
  assert.equal(comboHealth([{ name: "Extras", minSelect: 0, options: [opt("x", { isActive: false })] }])[0].level, "warning");
  assert.equal(comboHealth([])[0].level, "warning");
  assert.deepEqual(comboHealth([{ name: "Drink", minSelect: 1, options: [opt("Coke")] }]), []);
});

check("slot and choice payloads validate before sending", () => {
  assert.match(comboGroupPayload({ name: "Drink", minSelect: "2", maxSelect: "1" }).errors.minSelect, /more than the maximum/);
  assert.deepEqual(comboGroupPayload({ name: " Drink ", minSelect: "", maxSelect: "1" }).body, { name: "Drink", minSelect: 0, maxSelect: 1 });
  assert.deepEqual(comboOptionPayload({ productId: "p1", variantId: "", priceDelta: "-20", isDefault: false }).body, { productId: "p1", priceDelta: -20, isDefault: false });
  assert.ok(comboOptionPayload({ productId: "", priceDelta: "" }).errors.productId);
});

// --- menus & stations -------------------------------------------------------

check("clock input parses 24-hour times and refuses nonsense", () => {
  assert.equal(menuLib.parseClock("9:05"), 545);
  assert.equal(menuLib.parseClock(" 23:59 "), 1439);
  assert.equal(menuLib.parseClock("24:00"), null);
  assert.equal(menuLib.parseClock("12:60"), null);
  assert.equal(menuLib.parseClock("noon"), null);
  assert.equal(menuLib.formatClock(1560), "02:00");
});

check("weekday lists compress into readable runs, Monday first", () => {
  assert.equal(menuLib.describeDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assert.equal(menuLib.describeDays([6, 0]), "Sat, Sun");
  assert.equal(menuLib.describeDays([0, 1, 2, 3, 4, 5, 6]), "Every day");
  assert.equal(menuLib.describeDays([]), "Every day");
  assert.equal(menuLib.describeDays([1, 3, 4, 5, 0]), "Mon, Wed–Fri, Sun");
});

check("a local date becomes that branch's midnight, across timezones and DST", () => {
  assert.equal(menuLib.localMidnight("2026-10-01", "Asia/Karachi").toISOString(), "2026-09-30T19:00:00.000Z");
  assert.equal(menuLib.localMidnight("2026-10-01", "UTC").toISOString(), "2026-10-01T00:00:00.000Z");
  // New York leaves DST on 1 Nov 2026: midnight that day is still EDT (-4).
  assert.equal(menuLib.localMidnight("2026-11-01", "America/New_York").toISOString(), "2026-11-01T04:00:00.000Z");
  assert.equal(menuLib.localMidnight("2026-11-02", "America/New_York").toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(menuLib.localMidnight("2026-02-30", "UTC"), null);
  assert.equal(menuLib.zonedDateInput("2026-09-30T19:00:00.000Z", "Asia/Karachi"), "2026-10-01");
});

check("rest-of-today ends at the branch's next midnight, not the viewer's", () => {
  const end = menuLib.endOfLocalDay("Asia/Karachi", new Date("2026-09-17T20:30:00Z")); // 01:30 on the 18th in Karachi
  assert.equal(end.toISOString(), "2026-09-18T19:00:00.000Z");
});

const menuForm = (overrides = {}) => ({ ...menuLib.menuFormValues(null, { branchId: "b1" }), name: "Lunch", ...overrides });

check("a window ending before it starts runs past midnight; equal or half-set windows are refused", () => {
  const late = menuLib.menuPayload(menuForm({ start: "20:00", end: "02:00" }), { creating: true });
  assert.deepEqual([late.body.startMinute, late.body.endMinute], [1200, 1560]);
  assert.match(menuLib.menuPayload(menuForm({ start: "12:00", end: "12:00" })).errors.end, /same time/);
  assert.match(menuLib.menuPayload(menuForm({ start: "12:00" })).errors.end, /both times/);
  const allDay = menuLib.menuPayload(menuForm());
  assert.equal(allDay.body.startMinute, null);
  assert.equal(allDay.body.endMinute, null);
});

check("menu dates are inclusive whole days in the branch's timezone and read back unchanged", () => {
  const { body, errors } = menuLib.menuPayload(menuForm({ from: "2026-10-01", to: "2026-10-31", days: [1, 2, 3, 4, 5, 6, 0] }), { timezone: "Asia/Karachi" });
  assert.deepEqual(errors, {});
  assert.equal(body.activeFrom, "2026-09-30T19:00:00.000Z");
  assert.equal(body.activeTo, "2026-10-31T18:59:59.999Z");
  assert.deepEqual(body.daysOfWeek, [], "all seven days is stored as every day");
  const back = menuLib.menuFormValues({ ...body, name: "x", type: "DINE_IN" }, { timezone: "Asia/Karachi" });
  assert.deepEqual([back.from, back.to], ["2026-10-01", "2026-10-31"]);
  assert.match(menuLib.menuPayload(menuForm({ from: "2026-10-05", to: "2026-10-01" })).errors.to, /before the first day/);
});

check("menu payload requires a branch on create, a name and a known channel", () => {
  const { errors } = menuLib.menuPayload({ ...menuForm(), branchId: "", name: " ", type: "FAX" }, { creating: true });
  assert.ok(errors.branchId && errors.name && errors.type);
  assert.equal(menuLib.menuPayload(menuForm()).body.branchId, undefined, "an edit never moves a menu between branches");
  assert.equal(menuLib.menuPayload(menuForm({ description: "  " })).body.description, null);
});

check("schedules are described in the branch's own terms", () => {
  assert.equal(menuLib.describeSchedule({ daysOfWeek: [], startMinute: null, endMinute: null }, "UTC"), "Every day · all day");
  assert.equal(
    menuLib.describeSchedule({ daysOfWeek: [5, 6], startMinute: 1200, endMinute: 1560, activeTo: "2026-10-31T18:59:59.999Z" }, "Asia/Karachi"),
    "Fri, Sat · 20:00–02:00 next day · until 31 Oct 2026",
  );
});

check("live state names the decisive reason, including being outranked", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const menu = { id: "m1", isActive: true };
  assert.equal(menuLib.menuLiveState({ menu: { ...menu, isActive: false }, matchesNow: true, picked: null, now }).key, "OFF");
  assert.equal(menuLib.menuLiveState({ menu: { ...menu, activeTo: "2026-09-01T00:00:00Z" }, matchesNow: false, picked: null, now }).key, "ENDED");
  assert.equal(menuLib.menuLiveState({ menu: { ...menu, activeFrom: "2026-10-01T00:00:00Z" }, matchesNow: false, picked: null, now }).key, "UPCOMING");
  assert.equal(menuLib.menuLiveState({ menu, matchesNow: false, picked: null, now }).key, "OUT_OF_HOURS");
  const outranked = menuLib.menuLiveState({ menu, matchesNow: true, picked: { id: "m2", name: "Lunch" }, now });
  assert.deepEqual([outranked.key, outranked.by], ["OUTRANKED", "Lunch"]);
  assert.equal(menuLib.menuLiveState({ menu, matchesNow: true, picked: { id: "m1" }, now }).key, "LIVE");
});

const menuRow = (id, productId, overrides = {}) => ({
  id,
  productId,
  sectionId: overrides.sectionId ?? null,
  sortOrder: overrides.sortOrder ?? 0,
  isAvailable: overrides.isAvailable ?? true,
  unavailableUntil: overrides.unavailableUntil ?? null,
  isRecommended: overrides.isRecommended ?? false,
  product: { name: overrides.name ?? productId, isActive: overrides.productActive ?? true, deletedAt: null },
  variant: { name: overrides.size ?? "Regular", price: overrides.price ?? 100, sortOrder: overrides.variantSort ?? 0, isActive: overrides.sizeActive ?? true },
});

check("a row's state honours an expired sold-out deadline without a job clearing it", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  assert.equal(menuLib.menuRowState(menuRow("r", "p", { isAvailable: false, unavailableUntil: "2026-09-17T11:00:00Z" }), now).key, "AVAILABLE");
  assert.equal(menuLib.menuRowState(menuRow("r", "p", { isAvailable: false, unavailableUntil: "2026-09-17T13:00:00Z" }), now).key, "SOLD_OUT");
  assert.equal(menuLib.menuRowState(menuRow("r", "p", { productActive: false }), now).key, "DRAFT");
  assert.equal(menuLib.menuRowState(menuRow("r", "p", { sizeActive: false }), now).key, "SIZE_OFF");
});

check("rows group into products per section, sections in order, unsectioned last", () => {
  const sections = [{ id: "s2", sortOrder: 1, name: "Drinks" }, { id: "s1", sortOrder: 0, name: "Mains" }];
  const groups = menuLib.groupMenuProducts(
    [
      menuRow("a", "pizza", { sectionId: "s1", sortOrder: 3, size: "Large", variantSort: 2 }),
      menuRow("b", "pizza", { sectionId: "s1", sortOrder: 3, size: "Small", variantSort: 1, isRecommended: true }),
      menuRow("c", "burger", { sectionId: "s1", sortOrder: 1 }),
      menuRow("d", "coke", { sectionId: "s2", sortOrder: 0 }),
      menuRow("e", "cake", { sectionId: null, sortOrder: 0 }),
      menuRow("f", "orphan", { sectionId: "gone", sortOrder: 0 }),
    ],
    sections,
  );
  assert.deepEqual(groups.map((group) => group.section?.id ?? null), ["s1", "s2", null]);
  assert.deepEqual(groups[0].products.map((entry) => entry.productId), ["burger", "pizza"]);
  assert.deepEqual(groups[0].products[1].rows.map((row) => row.variant.name), ["Small", "Large"]);
  assert.equal(groups[0].products[1].isRecommended, true);
  assert.deepEqual(groups[2].products.map((entry) => entry.productId).sort(), ["cake", "orphan"]);
});

check("moving a product swaps within its section and returns the full menu order", () => {
  const groups = [
    { section: { id: "s1" }, products: [{ productId: "a" }, { productId: "b" }] },
    { section: { id: "s2" }, products: [{ productId: "c" }] },
  ];
  assert.deepEqual(menuLib.productOrderAfterMove(groups, "b", -1), ["b", "a", "c"]);
  assert.equal(menuLib.productOrderAfterMove(groups, "c", 1), null, "cannot move past the end of its section");
  assert.equal(menuLib.productOrderAfterMove(groups, "a", -1), null);
});

check("product availability distinguishes all, some and none sold out, ignoring sizes not offered", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const later = "2026-09-17T19:00:00Z";
  assert.equal(menuLib.productAvailability([menuRow("a", "p"), menuRow("b", "p", { isAvailable: false })], now).key, "PARTLY");
  const all = menuLib.productAvailability([menuRow("a", "p", { unavailableUntil: later, isAvailable: false }), menuRow("b", "p", { sizeActive: false })], now);
  assert.equal(all.key, "SOLD_OUT");
  assert.equal(all.until.toISOString(), "2026-09-17T19:00:00.000Z");
  assert.equal(menuLib.productAvailability([menuRow("a", "p", { unavailableUntil: later, isAvailable: false }), menuRow("b", "p", { isAvailable: false })], now).until, null, "one size is off indefinitely");
  assert.equal(menuLib.productAvailability([menuRow("a", "p", { productActive: false })], now).key, "NOT_OFFERED");
});

check("menu price override: blank uses the product price, otherwise a valid amount", () => {
  assert.deepEqual(menuLib.priceOverridePayload(" "), { value: null, error: null });
  assert.deepEqual(menuLib.priceOverridePayload("1,250.50"), { value: 1250.5, error: null });
  assert.ok(menuLib.priceOverridePayload("12abc").error);
});

check("menu health: empty is blocking, hidden sections and drafts are named", () => {
  const menu = { isActive: true };
  assert.equal(menuLib.menuHealth({ menu, items: [] })[0].level, "blocking");
  const issues = menuLib.menuHealth({
    menu,
    sections: [{ id: "s1", name: "Desserts", isActive: false }],
    items: [menuRow("a", "cake", { sectionId: "s1" }), menuRow("b", "tea", { name: "ZZ Tea", productActive: false })],
  });
  assert.equal(issues[0].level, "blocking", "nothing left to order");
  assert.match(issues[1].message, /Desserts.*1 product is hidden/);
  assert.match(issues[2].message, /ZZ Tea is unpublished/);
  assert.deepEqual(menuLib.menuHealth({ menu, items: [menuRow("a", "cake")] }), []);
});

check("station payload uppercases the code, checks its shape, and clears a blank printer", () => {
  assert.deepEqual(menuLib.stationPayload({ name: " Grill ", code: "grill-1", printerId: " " }).body, { name: "Grill", code: "GRILL-1", printerId: null });
  assert.ok(menuLib.stationPayload({ name: "", code: "a b", printerId: "" }).errors.code);
  assert.ok(menuLib.stationPayload({ name: "", code: "AB", printerId: "" }).errors.name);
});

check("station and section edits can clear their optional fields", () => {
  assert.equal(catalogSchemas.updateStationSchema.parse({ printerId: null }).printerId, null);
  assert.equal(catalogSchemas.updateSectionSchema.parse({ description: null }).description, null);
  assert.equal(catalogSchemas.createMenuSchema.parse({ branchId: "cjld2cjxh0000qzrmn831i7rn", name: "M", description: null }).isActive, undefined, "active state is decided by the service, not a schema default");
});

check("no catalog create schema injects a position, so services can append at the end", () => {
  const offenders = Object.entries(catalogSchemas)
    .filter(([name, schema]) => /^(create|add)|Schema$/.test(name) && schema?._zod)
    .flatMap(([name, schema]) => {
      const found = [];
      const walk = (node, path) => {
        const def = node?._zod?.def;
        if (!def) return;
        if (def.type === "object") for (const [key, child] of Object.entries(def.shape)) walk(child, `${path}.${key}`);
        else if (def.type === "array") walk(def.element, `${path}[]`);
        else if (["optional", "nullable", "pipe"].includes(def.type)) { walk(def.innerType ?? def.in, path); }
        else if (def.type === "default" || def.type === "prefault") { if (path.endsWith(".sortOrder")) found.push(`${name}${path}`); walk(def.innerType, path); }
      };
      walk(schema, "");
      return found;
    });
  assert.deepEqual(offenders, []);
  assert.equal(catalogSchemas.createSectionSchema.parse({ name: "Mains" }).sortOrder, undefined);
  assert.equal(catalogSchemas.variantInputSchema.parse({ price: 5 }).sortOrder, undefined);
});

check("the website's order type defaults to the cart's own default and ignores anything else", () => {
  assert.equal(orderTypeLib.resolveOrderType("PICKUP"), "PICKUP");
  assert.equal(orderTypeLib.resolveOrderType(null), "DELIVERY");
  assert.equal(orderTypeLib.resolveOrderType("DINE_IN"), "DELIVERY", "dine-in is the QR flow, not a website choice");
  assert.equal(orderTypeLib.resolveOrderType("<script>"), "DELIVERY");
});

check("each order type reads the menu channel checkout charges from", () => {
  assert.deepEqual(ORDER_TYPE_MENU, { DELIVERY: "DELIVERY", PICKUP: "TAKEAWAY", DINE_IN: "DINE_IN" });
});

// --- customers --------------------------------------------------------------

check("a phone number reduces to one comparable key however it was typed", () => {
  const same = ["+92 300 1234567", "0300-1234567", "(0300) 1234567", "92 300 1234567", "00923001234567"];
  assert.deepEqual([...new Set(same.map(phoneKey))], ["3001234567"], "one person, five spellings");
  assert.equal(phoneKey("300 1234"), "3001234", "a short local number keeps what it has");
  assert.equal(phoneKey(""), "");
  assert.equal(phoneKey(null), "");
  assert.equal(phoneKey("no digits here"), "");
  assert.notEqual(phoneKey("+92 300 1234567"), phoneKey("+92 301 1234567"), "different people stay different");
});

check("last seen reads as a person would say it", () => {
  const now = new Date("2026-09-17T12:00:00Z");
  const ago = (days) => customerLib.lastSeen(new Date(now.getTime() - days * 86400000), { now });
  assert.equal(customerLib.lastSeen(null), "Never");
  assert.equal(ago(0), "Today");
  assert.equal(ago(1), "Yesterday");
  assert.equal(ago(5), "5 days ago");
  assert.equal(ago(40), "1 month ago");
  assert.equal(ago(200), "6 months ago");
  assert.equal(ago(800), "2 years ago");
});

check("a customer edit sends only what changed, and refuses an empty save", () => {
  const original = { name: "Ayesha", phone: "+92 300 1234567" };
  const form = { name: "Ayesha Khan", phone: "+92 300 1234567", locale: "en" };
  assert.deepEqual(customerLib.customerPayload(form, { original }).body, { name: "Ayesha Khan" }, "the phone is not re-sent");
  assert.deepEqual(customerLib.customerPayload({ ...form, phone: "" }, { original }).body, { name: "Ayesha Khan", phone: null });
  assert.equal(customerLib.customerPayload({ name: "Ayesha", phone: "+92 300 1234567", locale: "en" }, { original }).errors.form, "Nothing has changed.");
  assert.ok(customerLib.customerPayload({ name: "A", phone: "", locale: "en" }).errors.name);
  assert.ok(customerLib.customerPayload({ name: "Ayesha", phone: "12", locale: "en" }).errors.phone);
});

check("changing a confirmed phone number says what it costs", () => {
  const original = { phone: "+92 300 1234567", phoneVerifiedAt: "2026-01-01T00:00:00Z" };
  assert.match(customerLib.phoneChangeWarning({ phone: "+92 301 0000000" }, original), /unconfirmed/);
  assert.equal(customerLib.phoneChangeWarning({ phone: "+92 300 1234567" }, original), null);
  assert.equal(customerLib.phoneChangeWarning({ phone: "+92 301 0000000" }, { phone: "+92 300 1234567" }), null, "an unconfirmed number loses nothing");
});

check("company-wide means a global grant with nothing carved out", () => {
  const principal = (allow, deny = []) => ({
    isSuperAdmin: false,
    allow: new Map([["kitchen_stations.manage", new Set(allow)]]),
    deny: new Map(deny.length ? [["kitchen_stations.manage", new Set(deny)]] : []),
  });
  assert.equal(holdsCompanyWide(principal([null]), "kitchen_stations.manage"), true);
  assert.equal(holdsCompanyWide(principal(["b1"]), "kitchen_stations.manage"), false, "a branch manager's grant");
  assert.equal(holdsCompanyWide(principal([null], ["b2"]), "kitchen_stations.manage"), false);
  assert.equal(holdsCompanyWide({ isSuperAdmin: true }, "kitchen_stations.manage"), true);
  assert.equal(holdsCompanyWide(null, "kitchen_stations.manage"), false);
});


// --- inventory ------------------------------------------------------------------

const inv = await import("@/lib/inventory");
const invAccess = await import("@/server/inventory/access");
const { STANDARD_UNITS } = await import("@/server/services/uom.service");

check("quantities format from decimal strings without float drift", () => {
  assert.equal(inv.formatQuantity("1250.500000", { precision: 3 }), "1,250.5");
  assert.equal(inv.formatQuantity("-2.0005", { precision: 3 }), "−2.001", "rounds half away from zero on the digits");
  assert.equal(inv.formatQuantity("999.9996", { precision: 3, unit: "kg" }), "1,000 kg", "carries through every digit");
  assert.equal(inv.formatQuantity("0.000000", { precision: 3 }), "0");
  assert.equal(inv.formatQuantity("-0.0001", { precision: 3 }), "0", "a rounded-away negative is not −0");
  assert.equal(inv.formatQuantity("3", { precision: 0, signed: true }), "+3");
  assert.equal(inv.formatQuantity("12.5", { precision: 0 }), "13");
  assert.equal(inv.formatQuantity(null), "—");
  assert.equal(inv.formatQuantity("abc"), "—");
  assert.equal(inv.roundDecimalString("9.995", 2), "10.00");
  assert.equal(inv.roundDecimalString("0.3", 6), "0.300000");
});

check("typed quantities are parsed strictly, and blank is not zero", () => {
  assert.deepEqual(inv.parseQuantity("1,250"), { value: 1250 });
  assert.deepEqual(inv.parseQuantity(" 2.5 "), { value: 2.5 });
  assert.deepEqual(inv.parseQuantity("5."), { value: 5 });
  assert.deepEqual(inv.parseQuantity(".5"), { value: 0.5 });
  assert.ok(inv.parseQuantity("").error);
  assert.ok(inv.parseQuantity("0").error, "zero is refused by default");
  assert.deepEqual(inv.parseQuantity("0", { allowZero: true }), { value: 0 });
  assert.ok(inv.parseQuantity("-1").error);
  assert.deepEqual(inv.parseQuantity("-1", { allowNegative: true }), { value: -1 });
  assert.ok(inv.parseQuantity("1.1234567").error, "seven decimals is more than the column holds");
  assert.ok(inv.parseQuantity("2kg").error);
  assert.ok(inv.parseQuantity("-").error);
  assert.deepEqual(inv.parseCost(""), { value: undefined });
  assert.ok(inv.parseCost("", { optional: false }).error);
  assert.ok(inv.parseCost("-5").error);
  assert.deepEqual(inv.parseCost("450.25"), { value: 450.25 });
});

check("a new item needs a name and a unit, and says why a perishable is incoherent", () => {
  const blank = inv.itemFormValues();
  const { errors } = inv.itemPayload(blank);
  assert.ok(errors.name && errors.uomId);

  const perishable = inv.itemPayload({ ...blank, name: "Chicken", uomId: "u1", isPerishable: true });
  assert.match(perishable.errors.shelfLifeDays, /shelf life/);
  assert.equal(inv.itemPayload({ ...blank, name: "Chicken", uomId: "u1", isPerishable: true, trackBatches: true }).errors.shelfLifeDays, undefined);

  assert.ok(inv.itemPayload({ ...blank, name: "Flour", uomId: "u1", reorderQuantity: "10" }).errors.reorderLevel, "a reorder amount with no trigger");
  assert.ok(inv.itemPayload({ ...blank, name: "Flour", uomId: "u1", sku: "has space" }).errors.sku);

  const { body } = inv.itemPayload({ ...blank, name: " Flour ", uomId: "u1", reorderLevel: "5" });
  assert.deepEqual(body, {
    name: "Flour",
    type: "RAW_MATERIAL",
    uomId: "u1",
    costingMethod: "WEIGHTED_AVERAGE",
    isPerishable: false,
    trackBatches: false,
    reorderLevel: 5,
    yieldPercent: 100,
  }, "blanks are left for the server's defaults");
});

check("editing an item sends only what changed — never an unchanged unit", () => {
  const original = {
    name: "Flour",
    sku: "FLOUR",
    type: "RAW_MATERIAL",
    categoryId: null,
    uomId: "u1",
    description: null,
    barcode: null,
    costingMethod: "WEIGHTED_AVERAGE",
    isPerishable: false,
    trackBatches: false,
    shelfLifeDays: null,
    reorderLevel: "5.000000",
    reorderQuantity: null,
    yieldPercent: "100.000",
  };
  const form = inv.itemFormValues(original);
  assert.equal(form.reorderLevel, "5");
  assert.equal(inv.itemPayload(form, { original }).errors.form, "Nothing has changed.");
  assert.deepEqual(inv.itemPayload({ ...form, name: "Plain flour" }, { original }).body, { name: "Plain flour" });
  assert.deepEqual(inv.itemPayload({ ...form, reorderLevel: "" }, { original }).body, { reorderLevel: null });
  assert.deepEqual(inv.itemPayload({ ...form, yieldPercent: "90" }, { original }).body, { yieldPercent: 90 });
});

check("adjustment lines say which way they go instead of trusting a minus sign", () => {
  const result = inv.adjustmentPayload({
    locationId: "l1",
    reason: "Found a sack behind the fridge",
    lines: [
      { itemId: "a", direction: "add", quantity: "2", unitCost: "450", note: "" },
      { itemId: "b", direction: "remove", quantity: "1.5", unitCost: "999" },
    ],
  });
  assert.deepEqual(result.errors, {});
  assert.deepEqual(result.body.items, [
    { itemId: "a", quantity: 2, unitCost: 450 },
    { itemId: "b", quantity: -1.5 },
  ], "stock going out never carries a typed cost");

  const bad = inv.adjustmentPayload({ locationId: "", reason: "x", lines: [{ itemId: "", direction: "add", quantity: "0" }] });
  assert.ok(bad.errors.locationId && bad.errors.reason && bad.errors.lines);
  assert.ok(bad.lineErrors[0].itemId && bad.lineErrors[0].quantity);
  assert.ok(inv.adjustmentPayload({ locationId: "l1", reason: "Because", lines: [] }).errors.lines);
});

check("a transfer needs two different places", () => {
  assert.ok(inv.transferPayload({ fromLocationId: "a", toLocationId: "a", lines: [{ itemId: "i", quantity: "1" }] }).errors.toLocationId);
  const ok = inv.transferPayload({ fromLocationId: "a", toLocationId: "b", notes: " van 2 ", lines: [{ itemId: "i", quantity: "3" }] });
  assert.deepEqual(ok.body, { fromLocationId: "a", toLocationId: "b", items: [{ itemId: "i", quantitySent: 3 }], notes: "van 2" });
});

check("a count sheet refuses blanks but accepts a counted zero", () => {
  const sheet = [{ itemId: "a" }, { itemId: "b" }, { itemId: "c" }];
  const { lines, lineErrors } = inv.countPayload(sheet, { a: { counted: "0" }, b: { counted: "" }, c: { counted: "4.5", reason: " torn bag " } });
  assert.deepEqual(lines, [{ itemId: "a", countedQuantity: 0 }, { itemId: "c", countedQuantity: 4.5, reason: "torn bag" }]);
  assert.match(lineErrors.b, /enter 0/);
});

check("wastage needs a reason, and 'other' needs words", () => {
  const base = { locationId: "l", itemId: "i", reason: "SPOILED", quantity: "2", notes: "" };
  assert.deepEqual(inv.wastagePayload(base).errors, {});
  assert.ok(inv.wastagePayload({ ...base, reason: "OTHER" }).errors.notes);
  assert.ok(inv.wastagePayload({ ...base, quantity: "0" }).errors.quantity);
});

check("unit form: a base unit carries no factor", () => {
  const base = inv.unitPayload({ code: "g", name: "Gram", type: "WEIGHT", precision: "1", baseUnitId: "", factor: "1000" });
  assert.deepEqual(base.body, { code: "g", name: "Gram", type: "WEIGHT", precision: 1, baseUnitId: null });
  const derived = inv.unitPayload({ code: "kg", name: "Kilogram", type: "WEIGHT", precision: "3", baseUnitId: "g1", factor: "1000" });
  assert.equal(derived.body.factor, 1000);
  assert.ok(inv.unitPayload({ code: "kg", name: "Kilogram", type: "WEIGHT", precision: "3", baseUnitId: "g1", factor: "0" }).errors.factor);
});

check("the standard units are coherent: every derived unit converts to an earlier base of its own type", () => {
  const seen = new Map();
  for (const unit of STANDARD_UNITS) {
    if (unit.base) {
      const base = seen.get(unit.base);
      assert.ok(base, `${unit.code}'s base comes first`);
      assert.equal(base.type, unit.type);
      assert.equal(base.base, undefined, "one hop only");
      assert.ok(unit.factor > 1);
    }
    seen.set(unit.code, unit);
  }
});

check("transfer stage comes from the timestamps, not the status alone", () => {
  assert.equal(inv.transferStage({ status: "DRAFT" }).value, "DRAFT");
  assert.equal(inv.transferStage({ status: "APPROVED", dispatchedAt: "2026-01-01" }).value, "IN_TRANSIT");
  assert.equal(inv.transferStage({ status: "COMPLETED", dispatchedAt: "x", receivedAt: "y" }).value, "RECEIVED");
  assert.equal(inv.transferStage({ status: "CANCELLED" }).value, "CANCELLED");
  assert.equal(inv.selfApproved("u1", "u1"), true);
  assert.equal(inv.selfApproved("u1", "u2"), false);
  assert.equal(inv.selfApproved(null, "u1"), false, "unknown raiser is not self-approval");
});

check("expiry reads as a kitchen reads it", () => {
  const now = new Date("2026-09-18T12:00:00Z");
  assert.equal(inv.expiryState("2026-09-18T10:00:00Z", { now }).label, "Expired");
  assert.equal(inv.expiryState("2026-09-18T20:00:00Z", { now }).label, "Expires today");
  assert.equal(inv.expiryState("2026-09-20T13:00:00Z", { now }).label, "2 days left");
  assert.equal(inv.expiryState(null, { now }).label, "No expiry");
});

check("movement sources link to their documents", () => {
  assert.equal(inv.movementSource({ referenceType: "ADJUSTMENT", referenceId: "a1" }).href, "/dashboard/stock-adjustments/a1");
  assert.equal(inv.movementSource({ referenceType: "TRANSFER", referenceId: "t1" }).href, "/dashboard/stock-transfers/t1");
  assert.equal(inv.movementSource({ referenceType: "ORDER", order: { orderNumber: "FZ-1" } }).label, "Order FZ-1");
  assert.equal(inv.movementSource({ referenceType: null }), null);
  for (const type of Object.keys(inv.MOVEMENT_TYPES)) assert.ok(inv.movementLabel(type) !== type, `${type} has words`);
});

check("inventory branch filters match branchScope's three shapes", () => {
  assert.equal(invAccess.branchFilter({ all: true, except: [] }), null, "company-wide filters nothing");
  assert.deepEqual(invAccess.branchFilter({ all: true, except: ["b2"] }), { notIn: ["b2"] });
  assert.deepEqual(invAccess.branchFilter({ all: false, ids: [] }), { in: [] }, "held nowhere filters everything");
  assert.deepEqual(invAccess.scopeWhere({ all: false, ids: ["b1"] }, (f) => ({ location: { branchId: f } })), { location: { branchId: { in: ["b1"] } } });
  assert.deepEqual(invAccess.scopeWhere({ all: true, except: [] }), {});
  assert.equal(invAccess.inScope({ all: false, ids: ["b1"] }, "b2"), false);
  assert.equal(invAccess.inScope({ all: true, except: ["b2"] }, "b2"), false);
  assert.equal(invAccess.inScope({ all: true, except: [] }, "b9"), true);
});

const { isLowSomewhere } = await import("@/server/services/inventory-item.service");
check("an item is low when any location is low, or none is held — not on the total", () => {
  assert.equal(isLowSomewhere("5", [{ quantity: "14" }, { quantity: "5" }]), true, "the kitchen is at its level even though the total is 19");
  assert.equal(isLowSomewhere("5", [{ quantity: "14" }, { quantity: "6" }]), false);
  assert.equal(isLowSomewhere("5", []), true, "none anywhere is low");
  assert.equal(isLowSomewhere(null, []), false, "no reorder level, never low");
});

const fsForGuard = await import("node:fs");
const postingRulesForPayout = await import("@/server/accounting/posting-rules");
const deliveryLibForBoard = await import("@/lib/delivery");
const { ACCOUNTS: ACCOUNTS_FOR_PAYOUT } = await import("@/server/accounting/chart");
const pathForGuard = await import("node:path");
check("raw SQL with interpolations is always built with Prisma.sql and passed whole", () => {
  // The tagged form ($queryRaw`...${fragment}`) decides what is SQL by
  // `instanceof` against the client's own copy of Prisma's Sql class. In the
  // dev server the client is kept on globalThis across reloads, so a fragment
  // built by a fresh module copy is sent as a *value* — "syntax error at or
  // near $1". Passing a finished Prisma.sql object is read by shape, not class.
  const { readdirSync, readFileSync, statSync } = fsForGuard;
  const { join } = pathForGuard;
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (path.includes("generated")) continue;
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith(".js")) {
        const text = readFileSync(path, "utf8");
        for (const match of text.matchAll(/\.\$(queryRaw|executeRaw)`([^`]*)`/g)) {
          if (match[2].includes("${")) offenders.push(path);
        }
      }
    }
  };
  walk("src");
  assert.deepEqual(offenders, []);
});

// --- recipes, production and opening stock --------------------------------

const prod = await import("@/lib/production");
const { withoutRunCosts } = await import("@/server/services/production-order.service");
const { openingStockLines } = await import("@/server/accounting/posting-rules");

const U = {
  g: { id: "g", code: "g", name: "Gram", type: "WEIGHT", factor: 1, baseUnitId: null },
  kg: { id: "kg", code: "kg", name: "Kilogram", type: "WEIGHT", factor: 1000, baseUnitId: "g" },
  pc: { id: "pc", code: "pc", name: "Piece", type: "COUNT", factor: 1, baseUnitId: null },
  box: { id: "box", code: "box", name: "Box", type: "COUNT", factor: 1, baseUnitId: null },
  ml: { id: "ml", code: "ml", name: "Millilitre", type: "VOLUME", factor: 1, baseUnitId: null },
};

check("two unlinked bases of one type do not convert 1:1", () => {
  assert.throws(() => convertQuantity({ quantity: 24, from: U.box, to: U.pc }), /not linked|Cannot convert/);
  assert.equal(Number(convertQuantity({ quantity: 2, from: U.kg, to: U.g })), 2000, "linked units still convert");
  assert.equal(Number(convertQuantity({ quantity: 500, from: U.g, to: U.kg })), 0.5);
});

check("a unit family is its base and everything linked to it — not every unit of the type", () => {
  const units = Object.values(U);
  assert.deepEqual(prod.unitFamily(units, "kg").map((unit) => unit.id).sort(), ["g", "kg"]);
  assert.deepEqual(prod.unitFamily(units, "pc").map((unit) => unit.id), ["pc"], "box is a separate base");
  assert.deepEqual(prod.unitFamily(units, "missing"), []);
});

const recipeItems = [
  { id: "flour", name: "Flour", uomId: "kg", type: "RAW_MATERIAL" },
  { id: "dough", name: "Dough", uomId: "kg", type: "SEMI_FINISHED" },
  { id: "egg", name: "Egg", uomId: "pc", type: "RAW_MATERIAL" },
];
const recipeList = [{ id: "sauce", name: "Sauce", yieldUomId: "ml" }];
const recipeForm = (patch = {}) => ({
  ...prod.recipeFormValues(null, { kind: "STOCK" }),
  outputItemId: "dough",
  name: "Dough",
  yieldQuantity: "10",
  yieldUomId: "kg",
  lines: [prod.blankIngredient({ itemId: "flour", quantity: "6", uomId: "kg" }), prod.blankIngredient({ itemId: "egg", quantity: "12", uomId: "pc" })],
  ...patch,
});
const recipeOptionsFor = { units: Object.values(U), items: recipeItems, recipes: recipeList, outputItem: recipeItems[1] };

check("a prep recipe form becomes a batch-produced recipe for the item", () => {
  const { body, errors, lineErrors } = prod.recipePayload(recipeForm(), recipeOptionsFor);
  assert.deepEqual(errors, {});
  assert.deepEqual(lineErrors, {});
  assert.equal(body.outputItemId, "dough");
  assert.equal(body.variantId, undefined);
  assert.equal(body.isBatchProduced, true);
  assert.equal(body.ingredients.length, 2);
  assert.deepEqual(body.ingredients[0], { itemId: "flour", quantity: 6, uomId: "kg", isOptional: false, sortOrder: 0, note: null });
  assert.equal("laborCost" in body, false, "no cost fields without cost access");
});

check("a dish recipe is made to order", () => {
  const { body, errors } = prod.recipePayload(recipeForm({ kind: "DISH", variantId: "v1", outputItemId: "", yieldUomId: "pc", yieldQuantity: "1" }), { ...recipeOptionsFor, outputItem: null });
  assert.deepEqual(errors, {});
  assert.equal(body.variantId, "v1");
  assert.equal(body.isBatchProduced, false);
});

check("a recipe line in a unit its ingredient cannot convert to is refused before sending", () => {
  const form = recipeForm({ lines: [prod.blankIngredient({ itemId: "flour", quantity: "6", uomId: "pc" })] });
  const { lineErrors, errors } = prod.recipePayload(form, recipeOptionsFor);
  assert.ok(lineErrors[0].uomId, "pieces of flour");
  assert.ok(errors.lines);
});

check("the yield unit of a prep recipe must convert to how the item is stocked", () => {
  const { errors } = prod.recipePayload(recipeForm({ yieldUomId: "ml" }), recipeOptionsFor);
  assert.ok(errors.yieldUomId);
});

check("the same ingredient twice, or the recipe inside itself, is refused", () => {
  const twice = recipeForm({ lines: [prod.blankIngredient({ itemId: "flour", quantity: "1", uomId: "kg" }), prod.blankIngredient({ itemId: "flour", quantity: "2", uomId: "g" })] });
  assert.ok(prod.recipePayload(twice, recipeOptionsFor).lineErrors[1].ingredient);
  const self = recipeForm({ lines: [prod.blankIngredient({ source: "RECIPE", subRecipeId: "me", quantity: "1", uomId: "ml" })] });
  assert.ok(prod.recipePayload(self, { ...recipeOptionsFor, selfId: "me" }).lineErrors[0].ingredient);
});

check("waste percentage is capped at 100 and a sub-recipe line is measured in its yield unit", () => {
  const form = recipeForm({ lines: [prod.blankIngredient({ source: "RECIPE", subRecipeId: "sauce", quantity: "200", uomId: "ml", wastagePercent: "150" })] });
  assert.ok(prod.recipePayload(form, recipeOptionsFor).lineErrors[0].wastagePercent);
  const ok = recipeForm({ lines: [prod.blankIngredient({ source: "RECIPE", subRecipeId: "sauce", quantity: "200", uomId: "ml", wastagePercent: "5" })] });
  const { body, errors } = prod.recipePayload(ok, recipeOptionsFor);
  assert.deepEqual(errors, {});
  assert.deepEqual(body.ingredients[0].subRecipeId, "sauce");
  assert.equal(body.ingredients[0].wastagePercent, 5);
});

check("labour and overhead are sent only with cost access, and a blank one on an edit means none", () => {
  const withCost = prod.recipePayload(recipeForm({ laborCost: "250" }), { ...recipeOptionsFor, includeCost: true, mode: "edit" });
  assert.equal(withCost.body.laborCost, 250);
  assert.equal(withCost.body.overheadCost, 0, "cleared on purpose");
  assert.equal(withCost.body.outputItemId, undefined, "the output is fixed on an edit");
  const created = prod.recipePayload(recipeForm({ laborCost: "" }), { ...recipeOptionsFor, includeCost: true });
  assert.equal("laborCost" in created.body, false, "blank on create is left to the default");
});

check("a saved recipe loads back into the form it came from", () => {
  const saved = {
    variantId: null,
    outputItemId: "dough",
    name: "Dough",
    yieldQuantity: "10.000000",
    yieldUomId: "kg",
    prepTimeMinutes: 20,
    cookTimeMinutes: null,
    instructions: null,
    laborCost: "150.0000",
    overheadCost: "0.0000",
    ingredients: [{ itemId: "flour", subRecipeId: null, quantity: "6.000000", uomId: "kg", wastagePercent: "0.000", isOptional: false, note: null }],
  };
  const form = prod.recipeFormValues(saved);
  assert.equal(form.kind, "STOCK");
  assert.equal(form.yieldQuantity, "10");
  assert.equal(form.prepTimeMinutes, "20");
  assert.equal(form.laborCost, "150");
  assert.equal(form.overheadCost, "0");
  assert.equal(form.lines[0].quantity, "6");
  assert.equal(form.lines[0].wastagePercent, "");
  const { errors } = prod.recipePayload(form, recipeOptionsFor);
  assert.deepEqual(errors, {});
});

check("a recipe that has been produced from is revised, not edited", () => {
  assert.equal(prod.recipeSaveMode(null), "create");
  assert.equal(prod.recipeSaveMode({ usage: { isUsed: false } }), "edit");
  assert.equal(prod.recipeSaveMode({ usage: { isUsed: true } }), "revise");
});

check("starting a run at the plan sends nothing, so the server issues exactly the recipe", () => {
  const materials = [
    { itemId: "flour", plannedQuantity: "6.000000" },
    { itemId: "egg", plannedQuantity: "12.000000" },
  ];
  assert.deepEqual(prod.startRunPayload(materials, { flour: "6", egg: "12" }).body, {});
  const changed = prod.startRunPayload(materials, { flour: "5.5", egg: "0" });
  assert.deepEqual(changed.body, { items: [{ itemId: "flour", quantity: 5.5 }] }, "a zero line is left off");
  assert.ok(prod.startRunPayload(materials, { flour: "0", egg: "0" }).errors.form, "nothing to issue");
  assert.ok(prod.startRunPayload(materials, { flour: "abc", egg: "12" }).errors.flour);
});

check("finishing a run: produced is required, waste carries its reason, costs only with access", () => {
  assert.ok(prod.completeRunPayload({ producedQuantity: "0" }).errors.producedQuantity);
  const { body } = prod.completeRunPayload({ producedQuantity: "9", wastedQuantity: "1", wastageReason: "SPILLAGE", laborCost: "99" });
  assert.deepEqual(body, { producedQuantity: 9, wastedQuantity: 1, wastageReason: "SPILLAGE" }, "labour dropped without access");
  assert.ok(prod.completeRunPayload({ producedQuantity: "9", wastedQuantity: "1", wastageReason: "OTHER" }).errors.wastageNotes);
  const tracked = prod.completeRunPayload({ producedQuantity: "9", batchNumber: "B1", expiryDate: "2026-01-01" }, { tracked: true, today: "2026-09-19" });
  assert.ok(tracked.errors.expiryDate, "a past use-by date");
  const costs = prod.completeRunPayload({ producedQuantity: "9", laborCost: "40" }, { includeCost: true });
  assert.equal(costs.body.laborCost, 40);
});

check("issuing more to a run: each item once, positive amounts", () => {
  const result = prod.issuePayload([{ itemId: "flour", quantity: "1" }, { itemId: "flour", quantity: "2" }, { itemId: "", quantity: "-1" }]);
  assert.ok(result.lineErrors[1].itemId);
  assert.ok(result.lineErrors[2].itemId && result.lineErrors[2].quantity);
  assert.ok(result.error);
  assert.deepEqual(prod.issuePayload([{ itemId: "flour", quantity: "1.5" }]).body, { items: [{ itemId: "flour", quantity: 1.5 }] });
});

check("planning a run needs a recipe, a place and an amount", () => {
  const { errors } = prod.productionPlanPayload({ plannedQuantity: "" });
  assert.ok(errors.recipeId && errors.locationId && errors.plannedQuantity);
  const { body } = prod.productionPlanPayload({ recipeId: "r", locationId: "l", plannedQuantity: "5", scheduledFor: "2026-09-20", batchNumber: " ", notes: "" });
  assert.deepEqual(body, { recipeId: "r", locationId: "l", plannedQuantity: 5, scheduledFor: "2026-09-20" });
});

check("yield is good output over everything made", () => {
  assert.equal(prod.yieldPercent("9", "1"), 90);
  assert.equal(prod.yieldPercent("0", "0"), null);
});

check("a run's money is taken out whole for someone who may not see it", () => {
  const run = {
    id: "r",
    status: "COMPLETED",
    producedQuantity: 9,
    materialCost: 100,
    laborCost: 10,
    overheadCost: 5,
    totalCost: 115,
    unitCost: 12.7,
    standardCost: 110,
    costVariance: { variance: 5 },
    recipe: { id: "x", laborCost: 10, overheadCost: 5, yieldUom: { code: "kg" } },
    consumptions: [{ itemId: "flour", quantity: 6, unitCost: 10, totalCost: 60 }],
    outputs: [{ itemId: "dough", quantity: 9, unitCost: 12.7, totalCost: 115 }],
    materials: [{ itemId: "flour", plannedQuantity: 6, actualQuantity: 6, unitCost: 10, onHand: 3 }],
  };
  const text = JSON.stringify(withoutRunCosts(run));
  for (const word of ["Cost", "costVariance", "unitCost", "totalCost"]) assert.equal(text.includes(word), false, `${word} leaked`);
  const stripped = withoutRunCosts(run);
  assert.equal(stripped.producedQuantity, 9, "the work stays");
  assert.equal(stripped.materials[0].onHand, 3);
  assert.equal(stripped.recipe.yieldUom.code, "kg");
});

check("production cost scope is the branches where both permissions meet", () => {
  const { intersectScopes } = invAccess;
  assert.deepEqual(intersectScopes({ all: false, ids: ["a", "b"] }, { all: false, ids: ["b", "c"] }), { all: false, ids: ["b"] });
  assert.deepEqual(intersectScopes({ all: true, except: ["b"] }, { all: false, ids: ["a", "b"] }), { all: false, ids: ["a"] });
  assert.deepEqual(intersectScopes({ all: true, except: ["x"] }, { all: true, except: ["y"] }), { all: true, except: ["x", "y"] });
});

check("opening stock posts to equity, not to the period's profit", () => {
  const lines = openingStockLines({ amount: "1250.50", reference: "ADJ-1" });
  assert.equal(lines.length, 2);
  const debit = lines.find((line) => Number(line.debit) > 0);
  const credit = lines.find((line) => Number(line.credit) > 0);
  assert.equal(debit.accountCode, ACCOUNTS.INVENTORY);
  assert.equal(credit.accountCode, ACCOUNTS.OPENING_BALANCE_EQUITY);
  assert.equal(Number(debit.debit), 1250.5);
  assert.equal(Number(credit.credit), 1250.5);
  assert.deepEqual(openingStockLines({ amount: 0 }), [], "nothing to post");
  assert.notEqual(ACCOUNTS.OPENING_BALANCE_EQUITY, ACCOUNTS.INVENTORY_VARIANCE);
});

check("an opening stock form only adds, needs a cost, and takes each item once", () => {
  const tracked = (id) => id === "chicken";
  const base = { type: "OPENING_STOCK", locationId: "loc", reason: "Opening day", isTracked: tracked, today: "2026-09-19" };
  const { body, errors } = inv.adjustmentPayload({
    ...base,
    lines: [
      { itemId: "flour", direction: "remove", quantity: "25", unitCost: "120" },
      { itemId: "chicken", quantity: "8", unitCost: "650", batchNumber: " LOT-7 ", expiryDate: "2026-09-25" },
    ],
  });
  assert.deepEqual(errors, {});
  assert.equal(body.type, "OPENING_STOCK");
  assert.deepEqual(body.items[0], { itemId: "flour", quantity: 25, unitCost: 120 }, "direction is ignored — opening stock only adds");
  assert.deepEqual(body.items[1], { itemId: "chicken", quantity: 8, unitCost: 650, batchNumber: "LOT-7", expiryDate: "2026-09-25" });

  const missing = inv.adjustmentPayload({ ...base, lines: [{ itemId: "flour", quantity: "25", unitCost: "" }, { itemId: "flour", quantity: "1", unitCost: "0" }] });
  assert.ok(missing.lineErrors[0].unitCost, "a cost is required");
  assert.ok(missing.lineErrors[1].itemId, "the same item twice");
  const expired = inv.adjustmentPayload({ ...base, lines: [{ itemId: "chicken", quantity: "1", unitCost: "5", expiryDate: "2026-09-01" }] });
  assert.ok(expired.lineErrors[0].expiryDate);
});

check("a correction still removes and leaves a blank cost to the average", () => {
  const { body, errors } = inv.adjustmentPayload({ locationId: "loc", reason: "Found short", lines: [{ itemId: "flour", direction: "remove", quantity: "2", unitCost: "" }] });
  assert.deepEqual(errors, {});
  assert.equal(body.type, "CORRECTION");
  assert.deepEqual(body.items, [{ itemId: "flour", quantity: -2 }]);
});

check("a production run's movements link to the run", () => {
  assert.deepEqual(inv.movementSource({ referenceType: "PRODUCTION_ORDER", referenceId: "p1" }), { href: "/dashboard/production/p1", label: "Production run" });
  assert.deepEqual(inv.movementSource({ referenceType: "PRODUCTION_CANCELLED", referenceId: "p1" }), { href: "/dashboard/production/p1", label: "Production run" });
  assert.equal(inv.movementLabel("OPENING_BALANCE"), "Opening stock");
});

// --- administration: users, roles, numbering --------------------------------

const people = await import("@/lib/people");
const { DOCUMENT_TYPES, documentTypeLabel } = await import("@/server/services/numbering.service");
const { generateTemporaryPassword } = await import("@/server/utils/password");
const { formatDocumentNumber } = await import("@/server/utils/sequence");

check("a role list reads as who does what, where", () => {
  assert.equal(
    people.roleSummary([
      { name: "Branch Manager", branch: { name: "Downtown" }, branchId: "b1" },
      { name: "Accountant", branchId: null },
    ]),
    "Branch Manager at Downtown, Accountant",
  );
  assert.match(people.roleSummary([]), /No role yet/);
});

check("a grant with an end date stops counting once it passes", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  assert.equal(people.grantExpired({ expiresAt: "2026-09-19T00:00:00Z" }, now), true);
  assert.equal(people.grantExpired({ expiresAt: "2026-09-21T00:00:00Z" }, now), false);
  assert.equal(people.grantExpired({ expiresAt: null }, now), false);
});

check("inviting someone needs a name, an address and a role", () => {
  const { errors } = people.userPayload({ name: "A", email: "nope", roleIds: [] });
  assert.ok(errors.name && errors.email && errors.roleIds);
  const branchy = people.userPayload({ name: "Sana Khan", email: "S@Example.COM ", roleIds: ["r1"], needsBranch: true });
  assert.ok(branchy.errors.branchId, "a branch role has to name its branch");
  const { body, errors: none } = people.userPayload({ name: " Sana Khan ", email: "S@Example.COM ", phone: " 03001234567 ", roleIds: ["r1"], needsBranch: true, branchId: "b1" });
  assert.deepEqual(none, {});
  assert.deepEqual(body, { name: "Sana Khan", email: "s@example.com", phone: "03001234567", roleIds: ["r1"], branchId: "b1" });
});

check("a new role needs a name, a level and something it may do", () => {
  const { errors } = people.rolePayload({ name: "", level: "abc", permissionKeys: [] }, { mode: "create" });
  assert.ok(errors.name && errors.level && errors.permissionKeys);
  const { body } = people.rolePayload({ name: " Weekend cover ", description: " Evenings ", scope: "GLOBAL", level: "40", permissionKeys: ["orders.read", "orders.read"] }, { mode: "create" });
  assert.deepEqual(body, { name: "Weekend cover", description: "Evenings", scope: "GLOBAL", level: 40, permissionKeys: ["orders.read"] });
  const edit = people.rolePayload({ name: "Weekend cover", level: "40", scope: "BRANCH" }, { mode: "edit" });
  assert.equal("permissionKeys" in edit.body, false, "an edit does not silently replace the permissions");
});

check("a module of permissions ticks and clears as a whole", () => {
  const keys = ["orders.read", "orders.create", "orders.cancel"];
  assert.equal(people.moduleState(keys, []), "none");
  assert.equal(people.moduleState(keys, ["orders.read"]), "some");
  assert.equal(people.moduleState(keys, keys), "all");
  assert.deepEqual(people.toggleModule(keys, ["orders.read"]).sort(), [...keys].sort(), "partly ticked fills up");
  assert.deepEqual(people.toggleModule(keys, keys), [], "fully ticked clears");
  assert.deepEqual(people.toggleModule(keys, ["stock.read", ...keys]), ["stock.read"], "other modules are left alone");
});

check("a session reads as a device somebody recognises", () => {
  assert.equal(people.deviceLabel({ client: "WEB", userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120" }), "Browser · Chrome · Windows");
  assert.equal(people.deviceLabel({ client: "IOS", userAgent: "" }), "iPhone app");
  assert.equal(people.deviceLabel({}), "Device");
});

check("a document number preview matches what the server will issue", () => {
  const shape = { prefix: "INV-PM", periodKey: "2026-09", value: 7, padding: 4 };
  assert.equal(people.previewNumber(shape), "INV-PM-2026-09-0007");
  assert.equal(people.previewNumber(shape), formatDocumentNumber(shape), "the screen and the allocator agree");
  assert.equal(people.previewNumber({ value: 7, padding: 2 }), "07", "no prefix, no period");
});

check("numbering: the prefix is checked and the padding must fit the counter", () => {
  assert.ok(people.sequencePayload({ prefix: "IN V", padding: "4" }).errors.prefix);
  assert.ok(people.sequencePayload({ prefix: "INV", padding: "0" }).errors.padding);
  assert.ok(people.sequencePayload({ prefix: "INV", padding: "2" }, { nextValue: 1200 }).errors.padding, "1200 needs four digits");
  const { body, errors } = people.sequencePayload({ prefix: " INV-PM ", padding: "5" }, { nextValue: 12 });
  assert.deepEqual(errors, {});
  assert.deepEqual(body, { prefix: "INV-PM", padding: 5 });
});

check("every document type the system issues has words for it", () => {
  const issued = ["ORDER", "INVOICE", "GOODS_RECEIPT", "PURCHASE_ORDER", "SUPPLIER_BILL", "EXPENSE", "JOURNAL_ENTRY", "STOCK_ADJUSTMENT", "STOCK_TRANSFER", "STOCK_COUNT", "PRODUCTION_ORDER"];
  for (const type of issued) assert.ok(DOCUMENT_TYPES[type]?.label, `${type} has no label`);
  assert.equal(documentTypeLabel("SOMETHING_NEW"), "SOMETHING_NEW", "an unknown one still reads as itself");
});

check("a temporary password is long, varied and not from Math.random", () => {
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const password = generateTemporaryPassword();
    assert.match(password, /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/, password);
    assert.ok(password.length >= 16);
    seen.add(password);
  }
  assert.ok(seen.size > 190, `expected variety, got ${seen.size} different values in 200`);
});

check("the API refuses everything but a password change while one is owed", () => {
  const text = fsForGuard.readFileSync("src/lib/api/handler.js", "utf8");
  assert.match(text, /mustChangePassword/, "the handler has to enforce it, not only the screens");
  const allowed = text.slice(text.indexOf("PASSWORD_CHANGE_ALLOWED"), text.indexOf("function isPasswordChangePath"));
  assert.match(allowed, /auth\/password\/change/);
  assert.match(allowed, /"\/api\/v1\/me", methods: \["GET"\]/, "reading your own profile stays possible; editing it does not");
  for (const path of ["admin/users", "orders", "admin/settings"]) {
    assert.equal(allowed.includes(path), false, `${path} must not be reachable on a temporary password`);
  }
});

check("setting a password anywhere clears the obligation to change it", () => {
  const files = ["src/server/services/password.service.js", "src/server/services/user.service.js"];
  for (const file of files) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /mustChangePassword: false/, `${file} sets a password without clearing the flag`);
  }
});


// --- HR: shift times -------------------------------------------------------

check("a night shift rolls past midnight rather than wrapping the clock", () => {
  const { body, errors, paidMinutes } = shiftPayload({
    name: "Nights",
    branchId: "b1",
    startTime: "22:00",
    endTime: "06:00",
    breakMinutes: 30,
    graceMinutes: 10,
    fullDayThresholdMinutes: 450,
    halfDayThresholdMinutes: 225,
  });
  assert.deepEqual(errors, {});
  assert.equal(body.startMinute, 1320);
  // 06:00 the next morning is 1800, never 360 — stored as 360 every duration
  // goes negative and a night worker appears to owe sixteen hours.
  assert.equal(body.endMinute, 1800);
  assert.equal(paidMinutes, 450);
});

check("clock values survive a round trip, and say when they are the next day", () => {
  assert.equal(minutesFromClock("22:00"), 1320);
  assert.equal(clockValue(1800), "06:00");
  assert.equal(clockLabel(1800), "06:00 next day");
  assert.equal(clockLabel(1320), "22:00");
  assert.equal(clockValue(minutesFromClock("00:00")), "00:00");
  assert.equal(minutesFromClock("not a time"), null);
  assert.equal(minutesFromClock("25:99"), null);
});

check("a break longer than the shift is refused", () => {
  const { errors } = shiftPayload({ name: "Short", branchId: "b1", startTime: "09:00", endTime: "11:00", breakMinutes: 180, graceMinutes: 0, fullDayThresholdMinutes: 60, halfDayThresholdMinutes: 30 });
  assert.match(errors.breakMinutes, /longer than the shift/i);
});

check("a full day cannot need more time than the shift pays", () => {
  const { errors } = shiftPayload({
    name: "Lunch",
    branchId: "b1",
    startTime: "11:00",
    endTime: "15:00",
    breakMinutes: 0,
    graceMinutes: 5,
    fullDayThresholdMinutes: 600,
    halfDayThresholdMinutes: 120,
  });
  // Otherwise nobody who works this shift can ever earn a full day.
  assert.match(errors.fullDayThresholdMinutes, /only pays/i);
});

check("a half day cannot need more than a full one", () => {
  const { errors } = shiftPayload({ name: "Day", branchId: "b1", startTime: "09:00", endTime: "17:00", breakMinutes: 0, graceMinutes: 0, fullDayThresholdMinutes: 300, halfDayThresholdMinutes: 400 });
  assert.match(errors.halfDayThresholdMinutes, /cannot need more/i);
});

check("suggested thresholds follow the hours they were suggested from", () => {
  assert.deepEqual(suggestThresholds({ startTime: "09:00", endTime: "17:00", breakMinutes: 60 }), {
    fullDayThresholdMinutes: 420,
    halfDayThresholdMinutes: 210,
  });
  assert.equal(suggestThresholds({ startTime: "", endTime: "17:00" }), null);
});

check("shift length is net of the unpaid break", () => {
  assert.equal(shiftLength({ startMinute: 1320, endMinute: 1800, breakMinutes: 30 }), 450);
  assert.equal(durationLabel(450), "7h 30m");
  assert.equal(durationLabel(60), "1h");
  assert.equal(durationLabel(25), "25m");
  assert.equal(durationLabel(0), "none");
});

// --- HR: dates -------------------------------------------------------------

check("roster dates never drift through a local timezone", () => {
  // A roster day is a @db.Date compared at UTC midnight. Turning one into a
  // local Date and back is how a rota silently shifts by a day.
  assert.equal(dayKey("2026-09-20T00:00:00.000Z"), "2026-09-20");
  assert.equal(dayKey(new Date("2026-09-20T23:30:00.000Z")), "2026-09-20");
  assert.equal(addDayKeys("2026-09-30", 1), "2026-10-01");
  assert.equal(addDayKeys("2026-01-01", -1), "2025-12-31");
});

check("a week starts on Monday, whichever day you ask about", () => {
  assert.equal(weekStart("2026-09-20"), "2026-09-14"); // a Sunday
  assert.equal(weekStart("2026-09-14"), "2026-09-14"); // the Monday itself
  assert.equal(weekStart("2026-09-19"), "2026-09-14"); // a Saturday
  const days = weekDays("2026-09-14");
  assert.equal(days.length, 7);
  assert.equal(days[0], "2026-09-14");
  assert.equal(days[6], "2026-09-20");
  assert.equal(isWeekend("2026-09-19"), true);
  assert.equal(isWeekend("2026-09-20"), true);
  assert.equal(isWeekend("2026-09-18"), false);
});

// --- HR: form rules --------------------------------------------------------

check("a day off still names a shift", () => {
  // The column is required and the flag is what derivation reads, so a day off
  // with no shift cannot be stored at all.
  const { errors } = rosterPayload({ employeeIds: ["e1"], shiftId: "", from: "2026-09-14", isWeeklyOff: true });
  assert.match(errors.shiftId, /would otherwise work/i);

  const ok = rosterPayload({ employeeIds: ["e1"], shiftId: "s1", from: "2026-09-14", isWeeklyOff: true });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.isWeeklyOff, true);
  // A single day rosters as a range of one, not as an open end.
  assert.equal(ok.body.to, "2026-09-14");
});

check("rostering nobody, or backwards, is refused", () => {
  assert.match(rosterPayload({ employeeIds: [], shiftId: "s1", from: "2026-09-14" }).errors.employeeIds, /at least one/i);
  assert.match(rosterPayload({ employeeIds: ["e1"], shiftId: "s1", from: "2026-09-14", to: "2026-09-01" }).errors.to, /before the first day/i);
});

check("a correction cannot be saved without a reason", () => {
  const { errors } = correctionPayload({ status: "PRESENT", payableFactor: 1, workedMinutes: 480, overtimeMinutes: 0, reason: "  " });
  assert.match(errors.reason, /say why/i);

  const ok = correctionPayload({ status: "PRESENT", payableFactor: 1, workedMinutes: 480, overtimeMinutes: 0, reason: "Device was down" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.reason, "Device was down");
});

check("a payable factor outside 0 to 2 is refused", () => {
  assert.ok(correctionPayload({ payableFactor: 3, reason: "x", workedMinutes: 0, overtimeMinutes: 0 }).errors.payableFactor);
  assert.ok(correctionPayload({ payableFactor: -1, reason: "x", workedMinutes: 0, overtimeMinutes: 0 }).errors.payableFactor);
  assert.equal(correctionPayload({ payableFactor: 0.5, reason: "x", workedMinutes: 0, overtimeMinutes: 0 }).errors.payableFactor, undefined);
});

check("hourly pay with no hourly rate is refused", () => {
  // It would compute to nothing, and nobody notices until the payslip says zero.
  const { errors } = salaryPayload({ salaryType: "HOURLY", baseSalary: 0, hourlyRate: "", overtimeMultiplier: 1.5 });
  assert.match(errors.hourlyRate, /how this person is paid/i);

  const ok = salaryPayload({ salaryType: "HOURLY", baseSalary: 0, hourlyRate: "450", overtimeMultiplier: 1.5 });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.hourlyRate, 450);
});

check("an overtime multiplier below 1 or above 5 is refused", () => {
  assert.ok(salaryPayload({ salaryType: "MONTHLY", baseSalary: 1, overtimeMultiplier: 0.5 }).errors.overtimeMultiplier);
  assert.ok(salaryPayload({ salaryType: "MONTHLY", baseSalary: 1, overtimeMultiplier: 6 }).errors.overtimeMultiplier);
});

check("a salary component is an amount or a percentage, never both", () => {
  const amount = componentPayload({ name: "Housing", basis: "AMOUNT", amount: "5000", effectiveFrom: "2026-09-01" });
  assert.deepEqual(amount.errors, {});
  assert.equal(amount.body.amount, 5000);
  assert.equal("percentOfBase" in amount.body, false);

  const percent = componentPayload({ name: "PF", basis: "PERCENT", percentOfBase: "8", effectiveFrom: "2026-09-01" });
  assert.deepEqual(percent.errors, {});
  assert.equal(percent.body.percentOfBase, 8);
  assert.equal("amount" in percent.body, false);

  assert.ok(componentPayload({ name: "X", basis: "AMOUNT", amount: "0", effectiveFrom: "2026-09-01" }).errors.amount);
  assert.ok(componentPayload({ name: "X", basis: "PERCENT", percentOfBase: "120", effectiveFrom: "2026-09-01" }).errors.percentOfBase);
});

check("a component cannot end before it starts", () => {
  const { errors } = componentPayload({ name: "X", basis: "AMOUNT", amount: "10", effectiveFrom: "2026-09-10", effectiveTo: "2026-09-01" });
  assert.match(errors.effectiveTo, /before it starts/i);
});

check("a manual punch becomes one instant, not a wall-clock reading", () => {
  const { body, errors } = manualPunchPayload({ employeeId: "e1", date: "2026-09-20", time: "09:15", direction: "IN", note: "" });
  assert.deepEqual(errors, {});
  assert.match(body.punchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.equal(new Date(body.punchedAt).getHours(), 9, "the supervisor's own 09:15 is what is meant");
  assert.equal(body.note, null);

  assert.ok(manualPunchPayload({ employeeId: "e1", date: "2026-09-20", time: "" }).errors.time);
  assert.ok(manualPunchPayload({ employeeId: "", date: "2026-09-20", time: "09:00" }).errors.employeeId);
});

check("registering a terminal needs a serial and a branch, editing one does not", () => {
  assert.ok(devicePayload({ name: "Back door" }, { mode: "create" }).errors.serialNumber);
  assert.ok(devicePayload({ name: "Back door", serialNumber: "ZK-1" }, { mode: "create" }).errors.branchId);

  const edit = devicePayload({ name: "Back door", vendor: "ZKTeco" }, { mode: "edit" });
  assert.deepEqual(edit.errors, {});
  // The serial and branch are fixed: both place every punch the box has sent.
  assert.equal("serialNumber" in edit.body, false);
  assert.equal("branchId" in edit.body, false);
});

check("HR words cover every state the database can hold", () => {
  for (const status of ["ACTIVE", "ON_LEAVE", "SUSPENDED", "RESIGNED", "TERMINATED"]) {
    assert.ok(EMPLOYEE_STATES[status]?.label, `${status} has no label`);
  }
  for (const status of ["PRESENT", "ABSENT", "HALF_DAY", "LATE", "ON_LEAVE", "HOLIDAY", "WEEKLY_OFF", "MISSING_PUNCH"]) {
    assert.ok(ATTENDANCE_STATES[status]?.label, `${status} has no label`);
  }
  assert.equal(hasLeft({ status: "RESIGNED" }), true);
  assert.equal(hasLeft({ status: "ON_LEAVE" }), false);
  assert.equal(employeeName({ firstName: "Ana", lastName: "Diaz" }), "Ana Diaz");
  assert.equal(employeeName({ firstName: "Ana" }), "Ana");
  assert.equal(employeeName({ employeeCode: "MN-0001" }), "MN-0001");
  assert.equal(silenceLabel(null), "never synced");
  assert.equal(silenceLabel(1), "just now");
  assert.equal(silenceLabel(90), "1 hour ago");
});

// --- branch scoping --------------------------------------------------------

check("a scope held nowhere filters everything out, not nothing", () => {
  // The dangerous bug is the inverse: an empty scope that produces no filter
  // hands a manager with no grant the whole company.
  assert.deepEqual(branchFilter({ all: false, ids: [] }), { in: [] });
  assert.deepEqual(branchFilter({ all: false, ids: ["b1"] }), { in: ["b1"] });
  assert.equal(branchFilter({ all: true, except: [] }), null);
  assert.deepEqual(branchFilter({ all: true, except: ["b2"] }), { notIn: ["b2"] });
  assert.equal(branchFilter(null), null);
});

check("scopeWhere places the filter wherever the model keeps its branch", () => {
  assert.deepEqual(scopeWhere({ all: false, ids: ["b1"] }), { branchId: { in: ["b1"] } });
  assert.deepEqual(
    scopeWhere({ all: false, ids: ["b1"] }, (branchId) => ({ employee: { branchId } })),
    { employee: { branchId: { in: ["b1"] } } },
  );
  assert.deepEqual(scopeWhere({ all: true, except: [] }), {});
});

check("a second round is its own ticket, priced without re-awarding an offer", () => {
  /*
   * Four things hold this together, and each has gone wrong in a POS before:
   *
   *   * the addition is priced with offers OFF, or a table ordering a round
   *     an hour later claims the lunch deal again;
   *   * the new lines carry a `course` and a `firedAt`, or the kitchen board
   *     reopens an hour-old ticket and paints two coffees red;
   *   * a delivery order is refused, because the totals maths carries the
   *     order's discount as a discount on goods and a delivery waiver is not
   *     that;
   *   * the payment state is re-derived, because a bill that was settled and
   *     then grew is no longer settled.
   */
  const source = fsForGuard.readFileSync("src/server/services/order-items.service.js", "utf8");
  const addCourse = source.slice(source.indexOf("export async function addCourse"));

  assert.match(
    addCourse.slice(0, addCourse.indexOf("withRetryingTransaction")),
    /allowDiscounts:\s*false/,
    "a second round must not re-run the promotion engine",
  );
  // Scoped to the parent line's own create: the combo-child create below it
  // carries the same two fields, so an unscoped match was satisfied by the
  // wrong block and survived having them removed from the line itself.
  const parentLine = addCourse.slice(addCourse.indexOf("const item = await tx.orderItem.create"), addCourse.indexOf("if (line.modifiers?.length)"));
  assert.match(parentLine, /course,\s*\n\s*firedAt: at,/, "new lines carry the round they belong to and when it fired");
  const comboChild = addCourse.slice(addCourse.indexOf("for (const choice of line.comboSelections"));
  assert.match(comboChild, /course,\s*\n\s*firedAt: at,/, "and so do a combo's children, or half a meal lands on a different ticket");

  const openFor = source.slice(source.indexOf("async function openOrderForEdit"), source.indexOf("async function lastCourse"));
  assert.match(openFor, /type === "DELIVERY"/, "a delivery order cannot take a second round");
  assert.match(openFor, /OPEN_STATUSES\.includes/, "a closed order cannot take one either");
  assert.match(openFor, /setAsideAt/, "nor one the kitchen has handed back");

  const applyTotals = source.slice(source.indexOf("async function applyTotals"));
  assert.match(applyTotals, /syncOrderPaymentState\(tx, orderId\)/, "what is owed has changed, so the state must be re-derived");

  const removeItem = source.slice(source.indexOf("export async function removeOrderItem"), source.indexOf("async function withdrawTax"));
  assert.match(removeItem, /item\.status !== "QUEUED"/, "food a cook has started cannot be deleted, only voided");
});

check("the kitchen board clocks each round separately", () => {
  /*
   * The one signal a kitchen screen exists to give is how late a ticket is.
   * Hanging a later round on the original ticket destroys it: the most
   * ordinary thing a customer can do — order dessert — would make an hour-old
   * ticket out of two coffees ordered a minute ago.
   */
  const source = fsForGuard.readFileSync("src/server/services/kds.service.js", "utf8");

  const asTickets = source.slice(source.indexOf("function asTickets"), source.indexOf("function firedFor"));
  assert.match(asTickets, /item\.course \?\? 1/, "tickets are grouped by round");
  assert.match(asTickets, /waitingMinutes: Math\.floor\(\(now - firedAt\)/, "the clock runs from when the round fired");
  assert.match(asTickets, /ticketId: `\$\{order\.id\}:\$\{course\}`/, "a ticket is an order and a round, not an order");

  const bump = source.slice(source.indexOf("export async function bumpOrder"));
  assert.match(
    bump.slice(0, bump.indexOf("select: { id: true, status: true }")),
    /\.\.\.\(course \? \{ course \} : \{\}\),/,
    "a bump covers the round on screen, not every round on the bill",
  );
  assert.match(
    bump,
    /status === "SERVED" \? \["READY"\]/,
    "handing a tray over picks up the ready lines, not the outstanding ones",
  );

  const pass = source.slice(source.indexOf("export async function readyToRun"));
  assert.match(pass, /status: "READY"/, "the pass is cooked food, not work in progress");
  assert.match(pass, /\$\{item\.order\.id\}:\$\{item\.course \?\? 1\}/, "one tray per round, so a starter and a dessert are two trips");
});

check("every event the code enqueues has a handler waiting for it", () => {
  /*
   * An event with no handler does not retry and does not warn: the worker
   * marks it FAILED, permanently, and whatever was supposed to happen simply
   * never does. Nothing about the request that enqueued it looks wrong — the
   * order is placed, the payment is taken — so the only way to find out is to
   * go looking in the outbox.
   *
   * This is that look, done once over the whole tree rather than per feature:
   * if something enqueues a name nothing handles, this fails before it ships.
   * Two event types shipped exactly that way before this existed.
   */
  const { readdirSync, readFileSync, statSync } = fsForGuard;

  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = `${dir}/${entry}`;
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  const sources = walk("src").filter((file) => file.endsWith(".js") && !file.includes("/generated/"));

  const enqueued = new Set();
  for (const file of sources) {
    for (const [, name] of readFileSync(file, "utf8").matchAll(/eventType:\s*"([a-z_]+\.[a-z_]+)"/g)) {
      enqueued.add(name);
    }
  }

  const handlers = readFileSync("src/server/jobs/handlers.js", "utf8");
  const handled = new Set(
    [...handlers.matchAll(/registerHandler\(\s*"([a-z_]+\.[a-z_]+)"/g)].map(([, name]) => name),
  );
  // The ledger postings are registered through one helper rather than by hand.
  for (const [, name] of handlers.matchAll(/posting\(\s*"([a-z_]+\.[a-z_]+)"/g)) handled.add(name);

  assert.ok(enqueued.size > 20, `expected to find the event names, found ${enqueued.size}`);

  const orphans = [...enqueued].filter((name) => !handled.has(name)).sort();
  assert.deepEqual(orphans, [], `these events are enqueued but nothing handles them: ${orphans.join(", ")}`);
});

check("telling the till a table is waiting finds the people, not a role name", () => {
  /*
   * Roles are database rows: the seeded twenty are a starting point and an
   * administrator can author more, so a lookup that named "cashier" would be
   * wrong the first time somebody made a custom role and silently wrong after.
   * The question asked is the same one the API asks before it answers — may
   * this person take money at this branch.
   */
  const source = fsForGuard.readFileSync("src/server/jobs/handlers.js", "utf8");
  const lookup = source.slice(source.indexOf("async function staffWhoCan"), source.indexOf("export function registerJobHandlers"));

  assert.match(lookup, /permission: \{ key: \{ in: \[permissionKey, moduleKey\] \} \}/, "a module wildcard grants it too");
  assert.match(lookup, /\{ branchId \}, \{ branchId: null \}/, "a company-wide grant counts at every branch");
  assert.match(lookup, /isSuperAdmin: true/, "a super admin holds it by bypass, not by grant");
  assert.match(lookup, /effect: "DENY"/, "and an explicit denial takes it away again");
  assert.ok(!lookup.includes('role: { key:'), "never by role name");

  const handler = source.slice(source.indexOf('registerHandler("order.bill_requested"'), source.indexOf('registerHandler("order.course_added"'));
  assert.match(handler, /if \(!order\?\.billRequestedAt\) return;/, "paid or cleared before the worker ran: nothing to say");
  // The set has to be built from the rows already written, not merely exist:
  // an empty `new Set()` satisfies a looser match and notifies everybody again.
  assert.match(
    handler,
    /const told = new Set\(existing\.map\(\(row\) => row\.userId\)\);/,
    "a waiter passing the table twice must not notify everybody twice",
  );
  assert.match(handler, /if \(!toTell\.length\) return;/, "and nobody new means nothing to write");
});

check("the overview shows a manager their own branch, not the company", () => {
  /*
   * The most-opened screen in the product was the one that leaked. The
   * overview was composed with no branch cut at all, so a branch manager
   * opened the company's revenue, best sellers, order mix and live queue —
   * while the role they hold carries `excludes: ["orders.read_all_branches"]`
   * to deny exactly that. One outlet hides it; the second outlet turns it
   * into every manager reading each other's trading.
   */
  const service = fsForGuard.readFileSync("src/server/services/dashboard.service.js", "utf8");

  assert.match(service, /function withinScope\(branchId, filter\)/, "every figure needs one cut to pass through");
  assert.match(
    service,
    /export async function dashboardOverview\(\{ branchId = null, scope = null,/,
    "the overview has to be told whose branches these are",
  );
  assert.match(service, /const filter = branchFilter\(scope\);/, "and turn that scope into a filter");

  // Each block, by name: one left unscoped is one figure that still leaks.
  for (const block of ["sellingWindow", "dailySeries", "byOrderType", "bestSellers", "liveQueue"]) {
    const fn = service.slice(service.indexOf(`async function ${block}(`));
    const body = fn.slice(0, fn.indexOf("\n}"));
    assert.match(body, /\.\.\.withinScope\(branchId, filter\)/, `${block} is not scoped`);
  }
  // Stock takes the scope itself rather than a filter, and must still get it.
  assert.match(service, /inventoryReport\(\{ branchId, scope \}\)/, "the stock block is not scoped");

  // And the page has to hand it over, or none of the above runs.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/page.js", "utf8");
  assert.match(
    page,
    /scope: branchScope\(principal, "dashboard\.view"\),/,
    "the overview must be told the viewer's scope",
  );
});

check("a document's transaction budget grows with its lines", () => {
  /*
   * The bug this replaces was invisible until the data got real: posting stock
   * is about seven sequential round trips a line, so a fixed 15-second
   * transaction was not a limit on the work but an undocumented limit on how
   * many lines a document could have. A 33-line opening stock count expired
   * halfway and rolled back, reporting a transaction timeout rather than
   * anything the manager had done.
   */
  const source = fsForGuard.readFileSync("src/server/utils/db.js", "utf8");
  const bulk = source.slice(source.indexOf("export function withBulkTransaction"));
  assert.match(bulk, /Math\.min\(base \+ Math\.max\(0, lines\) \* perLineMs, max\)/, "the budget must follow the line count");

  // Every path that posts a line per item must use it: one left on the fixed
  // budget is one document that still cannot be approved.
  for (const [file, lines] of [
    ["src/server/services/stock-adjustment.service.js", "adjustment.items.length"],
    ["src/server/services/stock-count.service.js", "count.items.length"],
    ["src/server/services/goods-receipt.service.js", "withLanded.length"],
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const posting = text.slice(text.indexOf("const posted = await"));
    assert.match(posting, /^const posted = await withBulkTransaction\(/m, `${file} posts on a fixed clock`);
    assert.ok(posting.includes(`{ lines: ${lines} }`), `${file} must tell it how many lines there are`);
  }
});

check("a posted entry cannot lose its accounting period", () => {
  /*
   * An orphaned entry is the quietest kind of wrong. It stays in the ledger
   * and in the account balances, so nothing looks missing — but every
   * statement is built by period, so it silently stops being counted. Seven
   * real sales were orphaned exactly this way, by a test deleting a fiscal
   * year that real postings had landed in.
   *
   * `Restrict` is what makes that impossible: deleting a period with a
   * posting under it now fails at the database rather than nulling the link.
   */
  const schema = fsForGuard.readFileSync("prisma/schema/11-finance.prisma", "utf8");
  const entry = schema.slice(schema.indexOf("model JournalEntry"), schema.indexOf("model JournalLine"));
  assert.match(
    entry,
    /period\s+AccountingPeriod\? @relation\(fields: \[periodId\], references: \[id\], onDelete: Restrict\)/,
    "the books must be hard to destroy by accident",
  );

  // And every suite that bins a fiscal year clears its postings first, or that
  // constraint turns a cleanup into a failing run.
  for (const file of [
    "tests/phase11.e2e.mjs",
    "tests/phase18.e2e.mjs",
    "tests/phase19.e2e.mjs",
    "tests/mobile-finance.mjs",
    "tests/mobile-insights.mjs",
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const cleanup = text.slice(text.lastIndexOf("journalLine.deleteMany"));
    assert.ok(
      text.includes("journalEntry.deleteMany({ where: { periodId: { in: ownPeriodIds } } })"),
      `${file} must clear its entries before its periods`,
    );
    assert.ok(
      cleanup.indexOf("accountingPeriod.deleteMany") > 0,
      `${file} must delete periods after the entries in them`,
    );
  }
});

check("a settled bill stops being a table waiting to pay", () => {
  /*
   * Cleared where the money lands rather than on the till's screen: a payment
   * can arrive from a card terminal's callback or from the customer's own
   * phone, and a table left on the list after it has paid sends somebody to
   * interrupt their dessert.
   */
  const source = fsForGuard.readFileSync("src/server/services/payment.service.js", "utf8");
  const sync = source.slice(source.indexOf("export async function syncOrderPaymentState"));
  assert.match(
    sync.slice(0, sync.indexOf("return state")),
    /state === "PAID" \? \{ billRequestedAt: null/,
    "paying must take the table off the till's list",
  );

  // And the waiter asks rather than charges: the role holds the ask and not
  // the capture, which is the whole shape of "the till takes the money".
  const roles = fsForGuard.readFileSync("prisma/seeds/roles.js", "utf8");
  const waiter = roles.slice(roles.indexOf('key: "waiter"'), roles.indexOf('key: "kitchen-staff"'));
  assert.match(waiter, /"orders\.request_bill"/, "a waiter asks for the bill");
  assert.ok(!waiter.includes('"payments.capture"'), "a waiter does not take the money");
  assert.ok(!waiter.includes('"payments.mark_collected"'), "nor finish a payment nobody started");
  assert.ok(!waiter.includes('"invoices.create"'), "nor issue a tax document for a bill they cannot settle");
});

check("the floor plan seats the table under your finger", () => {
  // Without this a waiter crossed the room, opened the counter screen and
  // picked the table they had just been standing at out of a list of twenty.
  const editor = fsForGuard.readFileSync("src/components/dashboard/service/TablesEditor.js", "utf8");
  assert.match(
    editor,
    /canSeat && !seated\[table\.id\] && table\.isActive/,
    "a free table offers to seat, a taken one does not",
  );
  assert.match(editor, /orders\/new\?branch=\$\{branchId\}&type=DINE_IN&table=\$\{table\.id\}/);

  // And the counter checks that claim against the room rather than trusting it.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/new/page.js", "utf8");
  assert.match(page, /tables\.some\(\(row\) => row\.id === wantedTable\)/, "a table id in a URL is a claim, not a fact");
});

check("the overview hands a waiter the pass, not the stove", () => {
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/page.js", "utf8");
  assert.match(
    page,
    /readsKitchen && !onTheFloor \? await kitchenBlock\(principal\) : null/,
    "station chips and a start button are the cook's, not the waiter's",
  );

  // The pass is a page of its own at its own URL, never drawn onto the
  // overview — the same rule the kitchen board follows, for the same reason.
  assert.ok(!page.includes("<PassBoard"), "the pass keeps one URL");
  assert.ok(!page.includes("<KitchenBoard"), "and so does the board");
});

check("two scopes intersect to what both cover", () => {
  const read = { all: false, ids: ["b1", "b2"] };
  const pay = { all: false, ids: ["b2", "b3"] };
  assert.deepEqual(intersectScopes(read, pay), { all: false, ids: ["b2"] });
  assert.deepEqual(intersectScopes({ all: true, except: ["b1"] }, read), { all: false, ids: ["b2"] });
  assert.deepEqual(intersectScopes({ all: true, except: ["b1"] }, { all: true, except: ["b2"] }), {
    all: true,
    except: ["b1", "b2"],
  });
});

check("inScope and reaches agree with the filters they stand beside", () => {
  assert.equal(inScope({ all: false, ids: ["b1"] }, "b1"), true);
  assert.equal(inScope({ all: false, ids: ["b1"] }, "b2"), false);
  assert.equal(inScope({ all: true, except: ["b2"] }, "b2"), false);
  assert.equal(reaches({ isSuperAdmin: true, branchIds: [] }, "anything"), true);
  assert.equal(reaches({ isSuperAdmin: false, branchIds: [null] }, "b9"), true);
  assert.equal(reaches({ isSuperAdmin: false, branchIds: ["b1"] }, "b2"), false);
  assert.equal(reaches(null, "b1"), false);
});

check("every HR list applies the caller's branch scope", () => {
  // A list that forgets this hands a supervisor at one outlet the whole
  // company the moment they omit the branch filter.
  const scoped = [
    ["src/server/services/employee.service.js", "listEmployees"],
    ["src/server/services/shift.service.js", "listShifts"],
    ["src/server/services/shift.service.js", "roster"],
    ["src/server/services/attendance.service.js", "listAttendance"],
    ["src/server/services/attendance.service.js", "attendanceSummary"],
    ["src/server/services/attendance.service.js", "approveAttendance"],
    ["src/server/services/attendance.service.js", "deriveRange"],
    ["src/server/services/punch.service.js", "listPunches"],
    ["src/server/services/punch.service.js", "unmatchedPunches"],
    ["src/server/services/attendance-device.service.js", "listDevices"],
    ["src/server/services/attendance-device.service.js", "deviceHealth"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1400);
    assert.match(body, /scope = null|scope,/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("every HR route that names a record by id checks the caller may reach it", () => {
  const guarded = [
    "src/app/api/v1/admin/employees/[id]/route.js",
    "src/app/api/v1/admin/employees/[id]/salary/route.js",
    "src/app/api/v1/admin/employees/[id]/status/route.js",
    "src/app/api/v1/admin/employees/[id]/components/route.js",
    "src/app/api/v1/admin/shifts/[id]/route.js",
    "src/app/api/v1/admin/attendance/[id]/correct/route.js",
    "src/app/api/v1/admin/attendance/[id]/revert/route.js",
    "src/app/api/v1/admin/attendance-devices/[id]/route.js",
    "src/app/api/v1/admin/attendance-devices/[id]/rotate-key/route.js",
    "src/app/api/v1/admin/roster/route.js",
    "src/app/api/v1/admin/roster/assignment/route.js",
    "src/app/api/v1/admin/attendance-punches/manual/route.js",
    "src/app/api/v1/admin/attendance-punches/claim/route.js",
  ];

  for (const file of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /assertRecordAccess\(auth, "(employee|shift|attendanceDay|device)"/, `${file} names a record without checking whose it is`);
  }
});

check("the employees endpoint withholds pay per row rather than per request", () => {
  // A list can span branches where only some carry employees.view_salary.
  const text = fsForGuard.readFileSync("src/app/api/v1/admin/employees/route.js", "utf8");
  assert.match(text, /salaryVisible\(auth, row\.branchId\)/);
  assert.match(text, /withoutPay/);
});


// --- leave, holidays and payroll -------------------------------------------

check("a half day is one day, not a range", () => {
  const { body, errors } = leavePayload({
    employeeId: "e1",
    leaveTypeId: "t1",
    startDate: "2026-04-10",
    endDate: "2026-04-10",
    halfDay: true,
  });
  assert.deepEqual(errors, {});
  assert.equal(body.totalDays, 0.5);

  const spread = leavePayload({
    employeeId: "e1",
    leaveTypeId: "t1",
    startDate: "2026-04-10",
    endDate: "2026-04-12",
    halfDay: true,
  });
  assert.match(spread.errors.endDate, /one day/i);
});

check("a full-day leave request states no day count of its own", () => {
  // The range decides. Two sources of truth for the same number is how a
  // balance drifts away from the days actually taken.
  const { body, errors } = leavePayload({
    employeeId: "e1",
    leaveTypeId: "t1",
    startDate: "2026-04-10",
    endDate: "2026-04-12",
  });
  assert.deepEqual(errors, {});
  assert.equal("totalDays" in body, false);
  assert.equal(body.endDate, "2026-04-12");
});

check("leave needs a person, a kind and a start", () => {
  const { errors } = leavePayload({ employeeId: "", leaveTypeId: "", startDate: "" });
  assert.ok(errors.employeeId);
  assert.ok(errors.leaveTypeId);
  assert.ok(errors.startDate);
  assert.ok(leavePayload({ employeeId: "e1", leaveTypeId: "t1", startDate: "2026-04-10", endDate: "2026-04-01" }).errors.endDate);
});

check("an available balance counts entitlement plus carry-over, less what is used", () => {
  assert.equal(leaveAvailable({ entitledDays: 14, carriedDays: 3, usedDays: 5 }), 12);
  assert.equal(leaveAvailable({ entitledDays: "14", carriedDays: "0", usedDays: "14" }), 0);
  assert.equal(leaveAvailable(null), 0);
});

check("a leave type's quota of zero means no limit, not none allowed", () => {
  const { body, errors } = leaveTypePayload({ name: "Sick", code: "sl", annualQuota: 0 });
  assert.deepEqual(errors, {});
  assert.equal(body.annualQuota, 0);
  assert.equal(body.code, "SL", "codes are stored upper case");
  assert.ok(leaveTypePayload({ name: "X", code: "X", annualQuota: 400 }).errors.annualQuota);
  // A rename does not resend the code: it is the stable identifier.
  assert.equal("code" in leaveTypePayload({ name: "Renamed" }, { mode: "edit" }).body, false);
});

check("a holiday with no branch is company-wide", () => {
  const { body, errors } = holidayPayload({ name: "Eid", date: "2026-04-10", branchId: "" });
  assert.deepEqual(errors, {});
  assert.equal(body.branchId, null);
  assert.equal(body.isPaid, true);
  assert.equal(holidayPayload({ name: "Local", date: "2026-04-10", branchId: "b1" }).body.branchId, "b1");
  assert.ok(holidayPayload({ name: "", date: "2026-04-10" }).errors.name);
  assert.ok(holidayPayload({ name: "Eid", date: "" }).errors.date);
});

check("a pay run cannot end before it starts, or pay before it ends", () => {
  const ok = payrollPeriodPayload({ name: "April 2026", startDate: "2026-04-01", endDate: "2026-04-30", payDate: "2026-05-05" });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.body.payDate, "2026-05-05");

  assert.ok(payrollPeriodPayload({ name: "X", startDate: "2026-04-30", endDate: "2026-04-01" }).errors.endDate);
  // Paying before the period closes means paying for days nobody has worked.
  assert.ok(payrollPeriodPayload({ name: "X", startDate: "2026-04-01", endDate: "2026-04-30", payDate: "2026-04-10" }).errors.payDate);
});

check("a month range and its name agree with each other", () => {
  assert.deepEqual(monthRange("2026-04-17"), { from: "2026-04-01", to: "2026-04-30" });
  assert.deepEqual(monthRange("2026-02-05"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(monthRange("2024-02-05"), { from: "2024-02-01", to: "2024-02-29" }, "a leap year");
  assert.deepEqual(monthRange("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
  assert.equal(monthName("2026-04-01"), "April 2026");
});

check("leave and payroll words cover every state the database can hold", () => {
  for (const status of ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]) {
    assert.ok(LEAVE_STATES[status]?.label, `${status} has no label`);
  }
  for (const status of ["DRAFT", "PROCESSING", "APPROVED", "PAID", "CANCELLED"]) {
    assert.ok(PAYROLL_STATES[status]?.label, `${status} has no label`);
    assert.ok(PAYROLL_STAGE_HINT[status], `${status} does not say what it commits`);
  }
});

check("every leave and payroll list applies the caller's branch scope", () => {
  const scoped = [
    ["src/server/services/leave.service.js", "listLeaveRequests"],
    ["src/server/services/leave.service.js", "listHolidays"],
    ["src/server/services/payroll.service.js", "listPayrollPeriods"],
    ["src/server/services/payroll.service.js", "listPayslips"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1400);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("every leave and payroll route that names a record checks the caller may reach it", () => {
  const guarded = [
    "src/app/api/v1/admin/leave-requests/[id]/approve/route.js",
    "src/app/api/v1/admin/leave-requests/[id]/reject/route.js",
    "src/app/api/v1/admin/leave-requests/[id]/cancel/route.js",
    "src/app/api/v1/admin/holidays/[id]/route.js",
    "src/app/api/v1/admin/payroll-periods/[id]/route.js",
    "src/app/api/v1/admin/payroll-periods/[id]/generate/route.js",
    "src/app/api/v1/admin/payroll-periods/[id]/approve/route.js",
    "src/app/api/v1/admin/payroll-periods/[id]/mark-paid/route.js",
    "src/app/api/v1/admin/payroll-periods/[id]/cancel/route.js",
    "src/app/api/v1/admin/payslips/[id]/route.js",
  ];

  for (const file of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(
      text,
      /assertRecordAccess\(auth, "(leaveRequest|holiday|payrollPeriod|payslip)"/,
      `${file} names a record without checking whose it is`,
    );
  }
});

check("an out-of-scope record answers not-found rather than confirming it exists", () => {
  // Every signed-in person carries a company-wide role for their own account,
  // so "has a role at that branch" is true for everybody and cannot be the
  // test — it would confirm the id is real to anyone who guessed one.
  const text = fsForGuard.readFileSync("src/server/access/scope.js", "utf8");
  const start = text.indexOf("async function assertRecordAccess(");
  assert.notEqual(start, -1);
  const body = text.slice(start, text.indexOf("return { recordBranches"));
  assert.match(body, /inScope\(branchScope\(principal, permissionKey\), branchId\)/);
  assert.match(body, /throw ApiError\.notFound/);
});

// --- purchasing -------------------------------------------------------------

check("order totals are exact, not floating point", () => {
  // 0.1 × 3 is 0.30000000000000004 in a float. A twenty-line order priced that
  // way disagrees with the server by a rupee, and nobody can tell which is the
  // lie.
  const totals = orderTotals([
    { quantity: "3", unitPrice: "0.1" },
    { quantity: "1", unitPrice: "0.2" },
  ]);
  assert.equal(totals.subtotal, "0.50");
  assert.equal(totals.grandTotal, "0.50");
});

check("a discount comes off the line before tax is worked out", () => {
  // Tax is owed on what is actually paid. Taxing the gross over-charges every
  // discounted line, and the error hides until a supplier disputes an invoice.
  const totals = orderTotals([{ quantity: "10", unitPrice: "99.99", taxRate: 17, discountAmount: "50" }], {
    shippingCost: "250",
  });
  assert.equal(totals.subtotal, "949.90");
  assert.equal(totals.taxTotal, "161.48");
  assert.equal(totals.discountTotal, "50.00");
  assert.equal(totals.grandTotal, "1361.38");
});

check("a discount larger than the line does not make the line negative", () => {
  const totals = orderTotals([{ quantity: "1", unitPrice: "100", discountAmount: "150" }]);
  assert.equal(totals.subtotal, "0.00");
});

check("rejected stock is neither counted nor paid for", () => {
  // What arrived and what was kept are different numbers, and the difference is
  // the whole point of inspecting a delivery.
  const totals = receiptTotals([{ quantity: "10", rejectedQuantity: "2", unitCost: "125.5", taxRate: 5 }], {
    landedCost: "100",
  });
  assert.equal(totals.lines[0].accepted, "8.000000");
  assert.equal(totals.subtotal, "1004.00");
  assert.equal(totals.taxTotal, "50.20");
  assert.equal(totals.grandTotal, "1154.20");
});

check("what is left on a bill is the total less what has been paid", () => {
  assert.equal(outstandingOf({ grandTotal: "1170.88", paidAmount: "170.88" }), "1000.00");
  assert.equal(outstandingOf({ grandTotal: "500", paidAmount: "500" }), "0.00");
  assert.equal(addAmounts("1200.50", "204.09"), "1404.59");
});

check("a supplier code is stored the way the form shows it", () => {
  const { body, errors } = supplierPayload({ code: " freshco ", name: "Freshco Foods" });
  assert.equal(body.code, "FRESHCO");
  assert.deepEqual(errors, {});
  assert.match(supplierPayload({ code: "F", name: "X" }).errors.code, /at least 2/);
  assert.match(supplierPayload({ code: "AB", name: "" }).errors.name, /name/i);
});

check("a price-list line needs a price", () => {
  assert.match(supplierItemPayload({ itemId: "itm_1", unitPrice: "" }).errors.unitPrice, /cost/i);
  const { body, errors } = supplierItemPayload({ itemId: "itm_1", unitPrice: "450", isPreferred: true });
  assert.deepEqual(errors, {});
  assert.equal(body.unitPrice, 450);
  assert.equal(body.isPreferred, true);
});

check("the same item cannot be ordered twice on one order", () => {
  // Two lines for one item is how a quantity gets doubled: the second is nearly
  // always a re-entry of the first.
  const { lineErrors } = purchaseOrderPayload({
    branchId: "br_1",
    supplierId: "sp_1",
    lines: [
      { itemId: "itm_1", quantity: "5", unitPrice: "100" },
      { itemId: "itm_1", quantity: "5", unitPrice: "100" },
    ],
  });
  assert.match(lineErrors[1].itemId, /already on the order/);
});

check("an order line with no price is refused rather than guessed", () => {
  const { errors, lineErrors } = purchaseOrderPayload({
    branchId: "br_1",
    supplierId: "sp_1",
    lines: [{ itemId: "itm_1", quantity: "5", unitPrice: "" }],
  });
  assert.ok(lineErrors[0].unitPrice);
  assert.ok(errors.items);
});

check("an order needs a branch, a supplier and a line", () => {
  const { errors } = purchaseOrderPayload({ branchId: "", supplierId: "", lines: [] });
  assert.ok(errors.branchId);
  assert.ok(errors.supplierId);
  assert.ok(errors.items);
});

check("more cannot be rejected than was delivered", () => {
  const { lineErrors } = goodsReceiptPayload({
    locationId: "loc_1",
    supplierId: "sp_1",
    lines: [{ itemId: "itm_1", quantity: "5", rejectedQuantity: "6", unitCost: "10" }],
  });
  assert.match(lineErrors[0].rejectedQuantity, /cannot reject more/i);
});

check("a blank line on a receipt built from an order means none of it arrived", () => {
  // Not an error: a partial delivery is the ordinary case, and forcing a zero
  // into every box invites a mistyped one.
  const { body, errors } = goodsReceiptPayload({
    locationId: "loc_1",
    supplierId: "sp_1",
    lines: [
      { itemId: "itm_1", quantity: "5", unitCost: "10", optional: true },
      { itemId: "itm_2", quantity: "", rejectedQuantity: "", unitCost: "10", optional: true },
    ],
  });
  assert.deepEqual(errors, {});
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].itemId, "itm_1");
});

check("a receipt with nothing on it at all is refused", () => {
  const { errors } = goodsReceiptPayload({
    locationId: "loc_1",
    supplierId: "sp_1",
    lines: [{ itemId: "itm_1", quantity: "", rejectedQuantity: "", unitCost: "10", optional: true }],
  });
  assert.match(errors.items, /Nothing has been received/);
});

check("a batch number is only sent for an item that tracks batches", () => {
  const tracked = goodsReceiptPayload({
    locationId: "loc_1",
    supplierId: "sp_1",
    lines: [{ itemId: "itm_1", quantity: "5", unitCost: "10", batchNumber: "LOT-9" }],
    tracksBatches: () => true,
  });
  assert.equal(tracked.body.items[0].batchNumber, "LOT-9");

  const untracked = goodsReceiptPayload({
    locationId: "loc_1",
    supplierId: "sp_1",
    lines: [{ itemId: "itm_1", quantity: "5", unitCost: "10", batchNumber: "LOT-9" }],
    tracksBatches: () => false,
  });
  assert.equal(untracked.body.items[0].batchNumber, undefined);
});

check("a bill that does not add up is caught before it is sent", () => {
  assert.match(supplierBillPayload({ supplierId: "sp_1", branchId: "br_1", subtotal: "0" }).errors.subtotal, /for something/);
  assert.match(
    supplierBillPayload({ supplierId: "sp_1", branchId: "br_1", subtotal: "100", billDate: "2026-05-10", dueDate: "2026-05-01" }).errors.dueDate,
    /before the invoice date/,
  );
});

check("a bill cannot be overpaid", () => {
  // An overpayment is almost always a duplicate, and it creates a negative
  // payable that understates what is owed across every supplier.
  assert.match(billPaymentPayload({ amount: "1000.005" }, { outstanding: "1000.00" }).errors.amount, /outstanding/);
  assert.deepEqual(billPaymentPayload({ amount: "1000.00" }, { outstanding: "1000.000" }).errors, {});
  assert.deepEqual(billPaymentPayload({ amount: "1" }, { outstanding: "1000" }).errors, {});
});

check("a bill due today is due, not overdue", () => {
  const now = new Date("2026-09-28T23:30:00Z");
  assert.equal(dueState({ dueDate: "2026-09-28T00:00:00Z", status: "APPROVED" }, { now }).label, "Due today");
  assert.equal(dueState({ dueDate: "2026-09-25T00:00:00Z", status: "APPROVED" }, { now }).label, "3 days overdue");
  assert.equal(dueState({ dueDate: "2026-09-29T00:00:00Z", status: "APPROVED" }, { now }).label, "Due in 1 day");
  assert.equal(dueState({ dueDate: "2026-09-01T00:00:00Z", status: "PAID" }, { now }).label, "Paid");
});

check("an order that has taken a delivery can no longer be cancelled", () => {
  // The goods exist and the supplier is owed for them. The honest ending is a
  // short close, not a cancellation that pretends the delivery never happened.
  assert.equal(poCancellable({ status: "SENT", items: [{ receivedQuantity: "0" }] }), true);
  assert.equal(poCancellable({ status: "PARTIALLY_RECEIVED", items: [{ receivedQuantity: "2" }] }), false);
  assert.equal(poCancellable({ status: "RECEIVED", items: [{ receivedQuantity: "0" }] }), false);
  assert.equal(poEditable("APPROVED"), false);
  assert.equal(poEditable("DRAFT"), true);
});

check("every purchasing state the server can return has words for it", () => {
  for (const state of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "CLOSED"]) {
    assert.ok(PO_STATES[state]?.label, `no words for purchase order ${state}`);
  }
  for (const state of ["DRAFT", "AWAITING_APPROVAL", "APPROVED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"]) {
    assert.ok(BILL_STATES[state]?.label, `no words for bill ${state}`);
  }
});

check("the ageing columns are the buckets the server actually fills", () => {
  // Naming them anything else draws a column that is always empty.
  assert.deepEqual(AGEING_BUCKETS.map((bucket) => bucket.key), SERVER_AGEING_BUCKETS);
});

check("every purchasing list applies the caller's branch scope", () => {
  // A buyer scoped to one outlet who omits the branch filter must not be handed
  // the company's whole spend — or, with bills, its whole payables position.
  const scoped = [
    ["src/server/services/purchase-order.service.js", "listPurchaseOrders"],
    ["src/server/services/goods-receipt.service.js", "listGoodsReceipts"],
    ["src/server/services/supplier-bill.service.js", "listSupplierBills"],
    ["src/server/services/supplier-bill.service.js", "payablesAgeing"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1400);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("every purchasing route that names a record checks the caller may reach it", () => {
  const guarded = [
    "src/app/api/v1/admin/purchase-orders/[id]/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/submit/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/approve/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/send/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/cancel/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/close/route.js",
    "src/app/api/v1/admin/purchase-orders/[id]/outstanding/route.js",
    "src/app/api/v1/admin/goods-receipts/[id]/route.js",
    "src/app/api/v1/admin/goods-receipts/[id]/post/route.js",
    "src/app/api/v1/admin/goods-receipts/[id]/cancel/route.js",
    "src/app/api/v1/admin/supplier-bills/[id]/route.js",
    "src/app/api/v1/admin/supplier-bills/[id]/submit/route.js",
    "src/app/api/v1/admin/supplier-bills/[id]/approve/route.js",
    "src/app/api/v1/admin/supplier-bills/[id]/cancel/route.js",
    "src/app/api/v1/admin/supplier-bills/[id]/payments/route.js",
    "src/app/api/v1/admin/supplier-bills/from-receipt/[goodsReceiptId]/route.js",
  ];

  for (const file of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(
      text,
      /assertRecordAccess\(auth, "(purchaseOrder|goodsReceipt|supplierBill)"/,
      `${file} names a record without checking whose it is`,
    );
  }
});

check("receiving is checked against the branch the stock lands in", () => {
  // The branch is not in the body — it comes from the location — so a plain
  // `branch: "body"` check would pass for a location at another outlet.
  const text = fsForGuard.readFileSync("src/app/api/v1/admin/goods-receipts/route.js", "utf8");
  assert.match(text, /assertRecordAccess\(auth, "stockLocation", body\.locationId, "goods_receipts\.create"\)/);
});

check("the purchasing lists pass the caller's own scope, not a fixed one", () => {
  const lists = [
    ["src/app/api/v1/admin/purchase-orders/route.js", "purchase_orders.read"],
    ["src/app/api/v1/admin/goods-receipts/route.js", "goods_receipts.read"],
    ["src/app/api/v1/admin/supplier-bills/route.js", "supplier_bills.read"],
    ["src/app/api/v1/admin/supplier-bills/ageing/route.js", "supplier_bills.read"],
  ];

  for (const [file, key] of lists) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.ok(text.includes(`scope: branchScope(auth, "${key}")`), `${file} does not scope its list to the caller`);
  }
});

// --- service ----------------------------------------------------------------

check("change from a cash sale is exact", () => {
  // This number is counted out of a drawer into somebody's hand. A float
  // rounding error here is not a display bug, it is a coin.
  assert.deepEqual(changeDue("1000", "740"), { short: false, change: "260.00", shortfall: "0.00" });
  assert.deepEqual(changeDue("1", "0.30"), { short: false, change: "0.70", shortfall: "0.00" });
  assert.equal(changeDue("500", "740").short, true);
  assert.equal(changeDue("500", "740").shortfall, "240.00");
  // Exact money is change of zero, not a shortfall.
  assert.deepEqual(changeDue("740", "740"), { short: false, change: "0.00", shortfall: "0.00" });
});

check("what is owed is the total less what was actually captured", () => {
  // `Order.paidTotal` is a column nothing ever writes, so it must never be the
  // input here — reading it would make every order look unpaid. The page works
  // the figure out from the payment rows and passes it in.
  assert.equal(owedAfter("1500.00", "500"), "1000.00");
  assert.equal(owedAfter("1500.00", "1500.00"), "0.00");
  assert.equal(owedAfter("1500.00", 0), "1500.00");
  // Never negative: an overpayment is not a debt owed back on this line.
  assert.equal(owedAfter("100", "150"), "0.00");
});

check("the order page never reads the unmaintained paidTotal column", () => {
  const text = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/[id]/page.js", "utf8");
  assert.match(text, /takings\.amountDue/, "the page does not take what is owed from the payment rows");
  assert.doesNotMatch(text, /order\.paidTotal/, "the page reads a column nothing maintains");
});

check("a till cannot be made to overpay or take too little", () => {
  const till = (form, options) => paymentPayload({ orderId: "ord1", ...form }, options);
  assert.match(till({ method: "CASH", amount: "5000" }, { outstanding: "500" }).errors.amount, /still owed/);
  assert.match(till({ method: "CASH", amount: "0" }, { outstanding: "500" }).errors.amount, /for something/);
  assert.match(till({ method: "CASH", amount: "100", tender: "50" }).errors.tender, /less than/);
  assert.deepEqual(till({ method: "CASH", amount: "500", tender: "1000" }, { outstanding: "500" }).errors, {});
  // A part payment is a smaller number, not an error.
  assert.deepEqual(till({ method: "CARD", amount: "100" }, { outstanding: "500" }).errors, {});
});

check("collection is paid before it fires; a table is not", () => {
  /*
   * How every shop that serves both ways does it. A collection customer takes
   * the bag and leaves, so there is no later; a seated table has not eaten
   * yet, and a bill that is already closed cannot take a second round.
   */
  assert.equal(paysUpFront("PICKUP"), true);
  assert.equal(paysUpFront("DINE_IN"), false);
  assert.equal(paysUpFront("DELIVERY"), false, "settled online or by the rider at the door");
});

check("an order typed by staff arrives already accepted", () => {
  /*
   * "Awaiting confirmation" means something for an order that came from the
   * website: somebody at the shop has to agree to cook it. An order a cashier
   * has just typed with the customer in front of them has already been agreed
   * to by the only person who could agree, so Accept was a tap that confirmed
   * their own decision back to them. A kiosk is excluded — nobody from the
   * shop touched that one.
   */
  const route = fsForGuard.readFileSync("src/app/api/v1/admin/orders/route.js", "utf8");
  const list = /const SELF_ACCEPTING = \[([^\]]*)\]/.exec(route);
  assert.ok(list, "the counter no longer accepts its own orders");
  assert.match(list[1], /"POS"/);
  assert.match(list[1], /"PHONE"/);
  assert.doesNotMatch(list[1], /"KIOSK"/);
  assert.match(route, /toStatus: "CONFIRMED"/);
});

check("a till payment names the order it is taken against", () => {
  /*
   * The endpoint requires `orderId`; the form built a body without one, so
   * every payment a cashier tried to take came back "Invalid request body" —
   * a till that could ring an order up and then take no money for it.
   *
   * Asserted over `body`, not over `errors`: the old test only ever read
   * `errors`, so a payload that validated cleanly and was refused by the
   * server looked exactly like a passing test.
   */
  const { body, errors } = paymentPayload(
    { orderId: "ord1", method: "CASH", amount: "4200", tender: "5000", registerSessionId: "sess1", idempotencyKey: "pos-ord1-0" },
    { outstanding: "4200" },
  );
  assert.deepEqual(errors, {});
  assert.deepEqual(body, {
    orderId: "ord1",
    method: "CASH",
    amount: 4200,
    registerSessionId: "sess1",
    idempotencyKey: "pos-ord1-0",
  });

  // And a form with no order behind it is refused before it reaches the wire.
  assert.match(paymentPayload({ method: "CASH", amount: "100" }).errors.orderId, /no order/);
});

check("a receipt works out what was paid instead of reading the stale column", () => {
  /*
   * `Order.paidTotal` is a column nothing maintains — the order screen says so
   * and sums the payment rows itself. The receipt did read it, so a bill the
   * customer had just settled in cash printed "paid 0" under a grand total of
   * the full amount.
   *
   * Guarded against the source because the alternative is a database round
   * trip: what matters is that this payload is never built from that column
   * again.
   */
  const source = fsForGuard.readFileSync("src/server/services/invoice.service.js", "utf8");
  const payload = source.slice(source.indexOf("export async function receiptPayload"));
  assert.ok(payload.length > 0, "receiptPayload has moved or been renamed");
  assert.doesNotMatch(payload, /order\.paidTotal/, "the receipt is reading Order.paidTotal again");
  assert.match(payload, /paymentTotals\(order\.payments, order\.refunds\)/);
});

check("the counter reads a product's id whichever way the menu spells it", () => {
  /*
   * A branch menu names a product `productId`; the catalogue read names it
   * `id`. The counter read only `id`, so every line reached the server with no
   * product on it and the screen answered "Invalid request body" for every
   * order anybody tried to take — a till that cannot take an order at all.
   */
  const fromBranchMenu = counterCatalogue({
    sections: [
      {
        name: "Mains",
        products: [
          { productId: "p1", slug: "zinger", name: "Zinger", type: "SIMPLE", variants: [{ variantId: "v1", name: "Regular", price: 450 }] },
        ],
      },
    ],
  });
  assert.equal(fromBranchMenu[0].productId, "p1", "a branch menu line has no product on it");
  assert.equal(fromBranchMenu[0].variantId, "v1");

  const fromCatalogue = counterCatalogue({
    sections: [{ name: "Mains", products: [{ id: "p2", slug: "wrap", name: "Wrap", variants: [{ id: "v2", name: "Regular", price: 300 }] }] }],
  });
  assert.equal(fromCatalogue[0].productId, "p2");
  assert.equal(fromCatalogue[0].variantId, "v2");

  // A combo always has something to choose, so it must open the builder even
  // when the menu read did not carry its slots.
  const combo = counterCatalogue({
    sections: [{ name: "Deals", products: [{ productId: "c1", name: "Feast", type: "COMBO", variants: [{ variantId: "cv1", name: "Regular", price: 3200 }] }] }],
  });
  assert.equal(combo[0].hasOptions, true, "a combo would be added straight to the ticket, unbuilt");

  // Sold out stays on the list and is marked; a counter still has to see it.
  const off = counterCatalogue({
    sections: [{ name: "Mains", products: [{ productId: "p3", name: "Fish", variants: [{ variantId: "v3", name: "Regular", price: 500, available: false }] }] }],
  });
  assert.equal(off[0].available, false);
});

check("a walk-in at a table does not have to give a name", () => {
  /*
   * The counter screen said the name was optional and the server refused the
   * order without one: `A name is required for a guest order`. A dine-in order
   * carries its table, and the table is the better answer — the food goes to
   * table six whoever is sitting there.
   */
  const dineIn = counterOrderPayload({
    branchId: "br_1", type: "DINE_IN", tableId: "tb_1",
    lines: [{ productId: "p1", quantity: 1 }], customer: {},
  });
  assert.deepEqual(dineIn.errors, {}, "a table is not enough to identify the order");

  // Collection has no table, so the name is how it is called out.
  const collection = counterOrderPayload({
    branchId: "br_1", type: "COLLECTION",
    lines: [{ productId: "p1", quantity: 1 }], customer: {},
  });
  assert.match(collection.errors.customer, /name/);
  assert.deepEqual(
    counterOrderPayload({ branchId: "br_1", type: "COLLECTION", lines: [{ productId: "p1", quantity: 1 }], customer: { name: "Sana" } }).errors,
    {},
  );

  // And the server agrees, rather than the screen simply being more lenient.
  const checkout = fsForGuard.readFileSync("src/server/services/checkout.service.js", "utf8");
  assert.match(checkout, /if \(!userId && !guest\?\.name && !\(type === "DINE_IN" && tableId\)\)/);
});

check("a combo can be built at the counter, with the same rules as the website", () => {
  /*
   * The counter only ever read a product's modifier groups, so a combo was
   * added with no slots answered and the server refused the whole order. One
   * builder for both screens: a counter cannot assemble something the website
   * would reject, and there is one place to fix when the rules change.
   */
  const counter = fsForGuard.readFileSync("src/components/dashboard/service/CounterOrder.js", "utf8");
  assert.match(counter, /import ComboSlots from "@\/components\/products\/ComboSlots"/);
  assert.match(counter, /comboSelections: toComboPayload\(comboGroups, comboPicks, comboMods\)/);
  assert.match(counter, /validateComboGroups\(comboGroups, comboPicks\)/);

  // Two combos built differently are two lines, not a quantity of one.
  assert.match(counter, /JSON\.stringify\(modifiers\)\}:\$\{JSON\.stringify\(comboSelections\)/);
});

check("a counter order sends ids and quantities, never prices", () => {
  // A screen that could set prices is a screen that can sell a steak for
  // nothing. The server prices the order from the live menu.
  const { body } = counterOrderPayload({
    branchId: "br_1",
    type: "DINE_IN",
    tableId: "tb_1",
    lines: [{ productId: "p1", variantId: "v1", quantity: 2, unitPrice: "999999", modifiers: [{ optionId: "o1", quantity: 1 }] }],
    customer: { name: "Walk in" },
  });
  assert.deepEqual(body.items, [
    { productId: "p1", variantId: "v1", quantity: 2, modifiers: [{ optionId: "o1", quantity: 1 }], comboSelections: [] },
  ]);
  assert.equal(JSON.stringify(body).includes("999999"), false, "a price reached the request body");
  assert.equal(body.channel, "POS");
});

check("a dine-in order needs a table and a delivery needs an account", () => {
  assert.ok(counterOrderPayload({ branchId: "b", type: "DINE_IN", lines: [{ productId: "p", quantity: 1 }], customer: {} }).errors.tableId);
  // A rider cannot navigate to a walk-in's name, so a delivery needs a saved
  // address, which means an account.
  assert.match(
    counterOrderPayload({ branchId: "b", type: "DELIVERY", lines: [{ productId: "p", quantity: 1 }], customer: { name: "Ali" } }).errors.customer,
    /account/,
  );
  assert.ok(
    counterOrderPayload({ branchId: "b", type: "DELIVERY", lines: [{ productId: "p", quantity: 1 }], customer: { userId: "u1" } }).errors.addressId,
  );
  assert.ok(counterOrderPayload({ branchId: "b", type: "PICKUP", lines: [], customer: {} }).errors.items);
});

check("the basket estimate adds up exactly", () => {
  assert.equal(basketPreview([{ unitPrice: "0.10", quantity: 3 }, { unitPrice: "0.20", quantity: 1 }]), "0.50");
  assert.equal(basketPreview([{ unitPrice: "100", quantity: 2, modifierPrices: ["50", "25"] }]), "350.00");
  assert.equal(basketPreview([]), "0.00");
});

check("how long an order has waited is said in minutes, and escalates", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(waitingFor(new Date("2026-10-03T11:55:00Z"), { now }).label, "5 min");
  assert.equal(waitingFor(new Date("2026-10-03T11:55:00Z"), { now }).tone, "text-on-surface-variant");
  assert.equal(waitingFor(new Date("2026-10-03T11:35:00Z"), { now }).tone, "text-warning");
  assert.equal(waitingFor(new Date("2026-10-03T11:00:00Z"), { now }).tone, "text-error");
  assert.equal(waitingFor(new Date("2026-10-03T10:00:00Z"), { now }).label, "2h 0m");
  assert.equal(waitingFor(null, { now }).label, "—");
});

check("a kitchen ticket's urgency is a band, not a number", () => {
  // Generous on purpose: a board that cries wolf at four minutes is one the
  // kitchen learns to ignore, and then it is useless at forty.
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(ticketUrgency(new Date("2026-10-03T11:55:00Z"), { now }).level, "fresh");
  assert.equal(ticketUrgency(new Date("2026-10-03T11:45:00Z"), { now }).level, "ageing");
  assert.equal(ticketUrgency(new Date("2026-10-03T11:30:00Z"), { now }).level, "late");
});

check("a kitchen line advances one step at a time and stops at served", () => {
  assert.equal(ITEM_NEXT.QUEUED, "PREPARING");
  assert.equal(ITEM_NEXT.PREPARING, "READY");
  assert.equal(ITEM_NEXT.READY, "SERVED");
  assert.equal(ITEM_NEXT.SERVED, undefined);
});

check("a station bumping its own lines does not finish the whole ticket", () => {
  /*
   * The grill, looking at a board filtered to the grill and showing one
   * burger, pressed a button captioned "All ready" and marked the pizza still
   * in the oven ready too — taking the order to READY and sending a waiter to
   * run food that did not exist. `bumpOrder` loaded every active line on the
   * order and the endpoint took no station at all.
   *
   * The set it bumps now matches the set on screen exactly, unrouted lines
   * included, because those show on every station's board.
   */
  const service = fsForGuard.readFileSync("src/server/services/kds.service.js", "utf8");
  const bump = service.slice(service.indexOf("export async function bumpOrder"));
  assert.match(bump, /stationId = null/, "bumpOrder ignores the station again");
  assert.match(bump, /OR: \[\{ stationId \}, \{ stationId: null \}\]/);

  const schema = fsForGuard.readFileSync("src/server/validation/ordering.schemas.js", "utf8");
  assert.match(schema, /stationId: cuidSchema\.nullish\(\)/, "the endpoint will not accept a station");

  const board = fsForGuard.readFileSync("src/components/dashboard/service/KitchenBoard.js", "utf8");
  assert.match(board, /\.\.\.\(stationId \? \{ stationId \} : \{\}\)/, "the board stopped sending its filter");
  // And the caption names the set it covers rather than claiming all of them.
  assert.match(board, /stationName \? `\$\{stationName\} done`/);
});

check("a kitchen button is an instruction, not a status", () => {
  /*
   * The board captioned the button with the label of the status it moves to,
   * so the control that marks a line ready said "Ready" — on the same screen
   * as a finished line whose chip also said "Ready". One word, two opposite
   * meanings, read at speed by somebody holding a pan.
   */
  for (const [status, verb] of Object.entries(ITEM_ACTIONS)) {
    assert.ok(verb, `no words for ${status}`);
    assert.notEqual(verb, ITEM_STATES[status]?.label, `${status} reuses its own status label`);
  }
  assert.equal(itemAction("READY"), "It's ready");
  assert.equal(itemAction("PREPARING"), "Start it");
  assert.ok(itemAction("SOMETHING_NEW"), "an unknown status still needs a caption");

  const board = fsForGuard.readFileSync("src/components/dashboard/service/KitchenBoard.js", "utf8");
  assert.match(board, /\{itemAction\(next\)\}/, "the button is back to showing a status name");
});

check("a stuck ticket is set aside by a person, never by a clock", () => {
  /*
   * The tempting design is to expire a ticket after a few hours. A clock
   * cannot tell an abandoned order from a kitchen running three hours behind,
   * and those are exactly the hours when hiding uncooked work is most
   * dangerous — the order is still live, still paid for, and now nobody is
   * making it. So a person decides, and has to say why.
   */
  const service = fsForGuard.readFileSync("src/server/services/kds.service.js", "utf8");
  assert.match(service, /export async function setAsideTicket/);
  assert.match(service, /export async function recallTicket/);
  // Nothing in the kitchen may expire a ticket on age.
  assert.doesNotMatch(service, /setAsideAt: \{ lte:/, "tickets are being set aside by elapsed time");

  // The board stops showing them; the order is untouched. Scoped to the board
  // query, because `recallTicket` clears the same column and would otherwise
  // satisfy a looser match on its own.
  const queue = service.slice(service.indexOf("export async function stationQueue"), service.indexOf("export async function setItemStatus"));
  assert.match(queue, /setAsideAt: null,/, "set-aside tickets are back on the board");
  const setAside = service.slice(service.indexOf("export async function setAsideTicket"), service.indexOf("export async function recallTicket"));
  assert.doesNotMatch(setAside, /changeOrderStatus|status: "CANCELLED"/, "setting aside must not touch the sale");

  // A reason is required, because the next person decides from it.
  const schema = fsForGuard.readFileSync("src/server/validation/ordering.schemas.js", "utf8");
  // Scoped to this schema: another in the same file requires a reason too, and
  // a file-wide match would pass on that one alone.
  const setAsideSchema = schema.slice(schema.indexOf("export const setAsideSchema"));
  assert.match(setAsideSchema.slice(0, 200), /reason: z\.string\(\)\.trim\(\)\.min\(3/, "a ticket can be set aside with no reason");

  // Asked for in the ticket, not in a browser prompt: this is a wall-mounted
  // touchscreen operated with the side of a thumb, and an OS dialog with a
  // text field is the worst control available there.
  const board = fsForGuard.readFileSync("src/components/dashboard/service/KitchenBoard.js", "utf8");
  assert.doesNotMatch(board, /window\.prompt/, "the kitchen is back to a browser prompt");
  assert.match(board, /SET_ASIDE_REASONS\.map/, "the common answers are no longer one tap");
  assert.ok(SET_ASIDE_REASONS.length >= 3 && SET_ASIDE_REASONS.every((row) => row.length > 3));

  // And it lands somewhere a person will see it rather than in a bin.
  const overview = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/page.js", "utf8");
  assert.match(overview, /<SetAsideTickets/, "nothing surfaces the set-aside pile");
  assert.match(overview, /hasPermission\(viewer\.permissions, "orders\.update_status"\)/, "shown to people who cannot act on it");
});

check("clearing the kitchen's screen is not the same power as voiding a sale", () => {
  /*
   * The split is the point: a cook can take a ticket off their board without
   * being able to cancel somebody's order. Cancelling stays a till decision
   * behind its own permission.
   */
  const perms = fsForGuard.readFileSync("prisma/seeds/permissions.js", "utf8");
  assert.match(perms, /\["set_aside", "Take a stuck ticket off the board/);

  const route = fsForGuard.readFileSync("src/app/api/v1/admin/orders/[id]/set-aside/route.js", "utf8");
  assert.match(route, /permissions: "kds\.set_aside"/);
  assert.doesNotMatch(route, /orders\.cancel/, "setting aside has been given the power to cancel");
  // Recall is held by the kitchen too: the commonest recall is undoing a
  // set-aside from ten seconds ago.
  assert.match(route, /permissions: \["kds\.set_aside", "orders\.update_status"\]/);
  assert.match(route, /anyPermission: true/);
});

check("a kitchen home screen leads with the board, not with order counts", () => {
  /*
   * The overview offered quick actions only to somebody who could create an
   * order, so a cook got a list of status counts and no way into the board at
   * all — the one screen their entire job happens on was reachable only
   * through the sidebar, with their hands already dirty.
   *
   * It sits above the stat tiles because for them it is not a shortcut, it is
   * the page.
   */
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/page.js", "utf8");
  assert.match(page, /hasPermission\(viewer\.permissions, "kds\.read"\)/, "the kitchen block is gated on something else");
  // The condition, not just a mention: a block behind a dead guard is the same
  // blank screen as no block at all.
  assert.match(page, /\{kitchen \? \(\s*<KitchenShortcuts/, "the kitchen block is never rendered");

  const banner = page.indexOf("<QueueHealth");
  const kitchen = page.indexOf("<KitchenShortcuts");
  const tiles = page.indexOf('label="Sales today"');
  assert.ok(kitchen > banner && kitchen < tiles, "the kitchen block is no longer the first thing on the page");

  const block = fsForGuard.readFileSync("src/components/dashboard/KitchenShortcuts.js", "utf8");
  assert.match(block, /Open the board/);
  // One tap to a station, so a fryer cook never opens the board and filters it.
  assert.match(block, /station=\$\{station\.id\}/);
  assert.match(block, /past the time promised/, "lateness is the one number worth a colour");
});

check("a wastage reason is named even when nothing has a cost yet", () => {
  /*
   * The tile was gated on money: `Number(top.value) > 0`. A shop that has not
   * received any goods has no cost basis for anything, so a kitchen that threw
   * away a kilo and a half of chicken got a dash under "Biggest reason" — on
   * the one screen whose entire subject is why food is thrown away. The cost
   * is the part that can be unknown; the reason never is.
   */
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/wastage/page.js", "utf8");
  assert.match(page, /const byCost = summary\.byReason\.filter/, "the reason is ranked by money again");
  assert.match(page, /sort\(\(a, b\) => b\.count - a\.count\)/, "no fallback to how often");
  assert.match(page, /value=\{top \? wastageReasonLabel\(top\.reason\) : "—"\}/, "the tile hides a known reason again");
});

check("the unfiltered board says where each line is made", () => {
  // Four lines across four stations, and nothing on the ticket said which of
  // them were yours — on the view a small kitchen actually leaves up.
  const service = fsForGuard.readFileSync("src/server/services/kds.service.js", "utf8");
  assert.match(service, /station: \{ select: \{ name: true \} \}/, "the board is no longer told the station name");
  const board = fsForGuard.readFileSync("src/components/dashboard/service/KitchenBoard.js", "utf8");
  assert.match(board, /!stationId && item\.station\?\.name/);
});

check("the kitchen board draws the note the counter wrote for the kitchen", () => {
  /*
   * The counter's field is labelled "For the kitchen". The board fetched
   * `kitchenNote` and rendered only the per-line notes, so "no onions —
   * allergy" reached the order screen and stopped there, which is the one
   * place nobody cooking ever looks.
   */
  const service = fsForGuard.readFileSync("src/server/services/kds.service.js", "utf8");
  assert.match(service, /kitchenNote: true/, "the board is no longer served the note");
  const board = fsForGuard.readFileSync("src/components/dashboard/service/KitchenBoard.js", "utf8");
  // The condition, not just a mention: a render left behind a dead guard is
  // the same blank ticket as no render at all.
  assert.match(board, /\{ticket\.kitchenNote \? \(/, "the board fetches the note and never draws it");
  assert.match(board, /\{ticket\.kitchenNote\}/, "the note is tested for and then not printed");
});

check("every order action has words for what it did, not verb plus d", () => {
  /*
   * The confirmation was built as `verb.toLowerCase() + "d"`, which is correct
   * for "Accept" and for nothing else: closing an order announced "close the
   * orderd", and a cashier saw that on almost every tap.
   */
  for (const [status, action] of Object.entries(STATUS_ACTIONS)) {
    assert.ok(action.done, `no confirmation wording for ${status}`);
    assert.notEqual(action.done, `${action.verb.toLowerCase()}d`, `${status} is still verb + d`);
  }
  assert.equal(STATUS_ACTIONS.COMPLETED.done, "is closed");
  assert.ok(statusAction("SOMETHING_NEW").done, "an unknown status still needs words");
});

check("the order total is made of lines a cashier can point at", () => {
  /*
   * Every charge the schema can put between subtotal and total has to be on
   * the screen, or the column does not add up. Packaging and the service
   * charge were missing, so a takeaway read "subtotal 120, tax 0, total 150"
   * and the cashier had no answer for where the 30 came from.
   */
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/[id]/page.js", "utf8");
  for (const field of ["discountTotal", "deliveryFee", "packagingFee", "serviceCharge", "taxTotal", "tipAmount", "roundOff"]) {
    assert.match(page, new RegExp(`order\\.${field}`), `the total hides ${field}`);
  }
});

check("cash can no longer be taken outside every drawer", () => {
  /*
   * The permission and the endpoint for opening a drawer existed from the
   * first day and no screen ever called them, so the only honest thing the
   * till could do was warn that the money would not be counted — and point at
   * a button that did not exist. Now there is a button, and the server opens
   * one anyway rather than letting the money fall outside the count.
   */
  const registers = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/registers/page.js", "utf8");
  assert.match(registers, /<OpenDrawer/, "no way to start a shift again");

  const payments = fsForGuard.readFileSync("src/server/services/payment.service.js", "utf8");
  const collected = payments.slice(payments.indexOf("export async function markCollected"));
  assert.match(collected, /openDrawerFor\(/, "cash with no session open is untracked cash again");
  // Named after the cashier, because the branch default may be open in
  // somebody else's hands and two people on one drawer is nobody on it.
  assert.match(payments, /registerName = String\(actor\.name/);
});

check("an open drawer shows what is in it, not what it started with", () => {
  // `expectedCash` is only written at close, so the list fell back to the
  // opening float — "there is 5,000 in that till" after four thousand had gone
  // through it.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/registers/page.js", "utf8");
  assert.match(page, /running\[session\.id\]/);
  const helper = fsForGuard.readFileSync("src/server/content/finance-admin.js", "utf8");
  assert.match(helper, /export async function runningCash/);
});

check("the figure a cashier is about to count is not printed above the box", () => {
  /*
   * The close form hides the expected total until a number is typed, on the
   * grounds that somebody shown the answer reconciles to the answer. That only
   * holds if it is not also sitting in plain sight further up the same page.
   */
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/registers/[id]/page.js", "utf8");
  assert.match(page, /const hideExpected = session\.status === "OPEN" && canClose/);
  assert.match(page, /\{hideExpected \? \(/);
});

check("the queue runs by itself where there is no scheduler to run it", () => {
  /*
   * On Vercel a cron hits the drain endpoint every minute; on a long-lived
   * server the in-process worker does it. Local development is the third case
   * and had neither, so for months every side effect of every order — the
   * ledger, stock depletion, every notification — silently never happened
   * while anybody was testing. Twenty events had been sitting pending.
   */
  // The example is what a fresh clone copies, so it ships with the worker on.
  const envFile = fsForGuard.readFileSync(".env.example", "utf8");
  assert.match(envFile, /WORKER_IN_PROCESS="true"/, "a new checkout starts with no scheduler again");

  const vercel = JSON.parse(fsForGuard.readFileSync("vercel.json", "utf8"));
  const outboxCron = vercel.crons?.find((row) => row.path === "/api/internal/jobs/outbox");
  assert.ok(outboxCron, "serverless has no scheduler for the outbox");
  assert.equal(outboxCron.schedule, "* * * * *");

  // The e2e harness drives the drain itself, so it pins the worker off rather
  // than inheriting whatever the developer's .env happens to say.
  const pkg = JSON.parse(fsForGuard.readFileSync("package.json", "utf8"));
  assert.match(pkg.scripts["test:e2e:server"], /WORKER_IN_PROCESS=false/);
});

check("the board is one page, not a copy inside the overview", () => {
  /*
   * The tempting shortcut is to draw the board on the dashboard as well. It
   * would be a second implementation of the same screen, and it would lose the
   * thing that makes a station screen work: `?station=` in the address bar. A
   * fryer screen that cannot be pinned to the fryer is not a fryer screen.
   */
  const overview = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/page.js", "utf8");
  assert.doesNotMatch(overview, /<KitchenBoard/, "the board has been copied onto the overview");
  assert.match(overview, /if \(home !== HOME_PATHS\.overview\) redirect\(home\)/);

  const board = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/kitchen/page.js", "utf8");
  assert.match(board, /params\.station/, "the board no longer reads a station from the URL");
});

check("a modal has something behind it", () => {
  // `bg-scrim/60` was written with no `scrim` token to resolve, so it computed
  // to transparent and every dialog opened over an undimmed, still-readable
  // page.
  const css = fsForGuard.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /--color-scrim: var\(--scrim\)/, "the scrim utility resolves to nothing again");
  assert.match(css, /--scrim: #000000;/);
});

check("the room says who is sitting in it", () => {
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/tables/page.js", "utf8");
  assert.match(page, /tableOccupancy\(/, "the seating chart is back to showing twenty identical tables");
  const editor = fsForGuard.readFileSync("src/components/dashboard/service/TablesEditor.js", "utf8");
  assert.match(editor, /seated\[table\.id\]/);
});

check("a dropped connection is not the same answer as \"no such order\"", () => {
  /*
   * The order page read `catch(() => null)` and showed "Not here" for any
   * failure at all, so a database timeout told a cashier the order they had
   * just taken did not exist. Only a real 404 is a 404; everything else
   * belongs to the error boundary, which says the screen failed to load.
   */
  assert.equal(isNotFound(ApiError.notFound("Order not found")), true);
  assert.equal(isNotFound(ApiError.conflict("Already paid")), false);
  assert.equal(isNotFound(Object.assign(new Error("socket"), { code: "ETIMEDOUT" })), false);
  assert.equal(isNotFound(null), false);

  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/[id]/page.js", "utf8");
  assert.match(page, /if \(isNotFound\(error\)\) return null;/);
  assert.match(page, /throw error;/);
});

check("a receipt and an invoice are both reachable as paper", () => {
  /*
   * The Receipt button opened raw JSON, and nothing in the whole dashboard
   * ever called the invoice endpoint — so the Invoices list could only ever be
   * empty while its own empty state explained that invoices are issued from
   * the order.
   */
  for (const file of [
    "src/app/(dashboard)/dashboard/orders/[id]/receipt/page.js",
    "src/app/(dashboard)/dashboard/orders/[id]/invoice/page.js",
    "src/components/dashboard/service/InvoiceActions.js",
  ]) {
    assert.ok(fsForGuard.existsSync(file), `${file} is missing`);
  }

  const order = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/[id]/page.js", "utf8");
  assert.match(order, /\/dashboard\/orders\/\$\{id\}\/receipt/, "the Receipt button points at the API again");
  assert.match(order, /<InvoiceActions/);

  const invoiceUi = fsForGuard.readFileSync("src/components/dashboard/service/InvoiceActions.js", "utf8");
  assert.match(invoiceUi, /admin\/orders\/\$\{orderId\}\/invoice/);

  // And the chrome stays off the paper.
  const css = fsForGuard.readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /@media print/);
  const shell = fsForGuard.readFileSync("src/components/dashboard/DashboardShell.js", "utf8");
  assert.match(shell, /data-print="hide"/);
});

check("a lapsed access token is not a logout, and does not lose your place", () => {
  /*
   * Access tokens last fifteen minutes and the session behind them thirty
   * days. A server-rendered page read the cookie, found nothing and redirected
   * to the login form — and the layout redirected with a hardcoded /dashboard,
   * so even signing back in did not return you to the page you asked for.
   */
  const proxy = fsForGuard.readFileSync("src/proxy.js", "utf8");
  assert.match(proxy, /"\/dashboard\/:path\*"/, "the workspace is outside the proxy again");
  assert.match(proxy, /\/session\/resume/);
  assert.match(proxy, /x-fz-path/);
  // The proxy runs in a restricted runtime, so it must not pull in the module
  // that reaches next/headers and the JWT library.
  assert.doesNotMatch(proxy, /api\/cookies/);

  const layout = fsForGuard.readFileSync("src/app/(dashboard)/layout.js", "utf8");
  assert.match(layout, /x-fz-path/);
  assert.match(layout, /redirect\(loginHref\(asked\)\)/);

  assert.ok(fsForGuard.existsSync("src/app/session/resume/page.js"));
});

check("an order row names its table instead of only flagging that it has one", () => {
  /*
   * The row printed the bare word "table" off `order.tableId` while the name
   * was sitting unused in the same record, so a cashier looking for table
   * seven read "Dine-in · table · Counter" on every dine-in order.
   */
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/orders/page.js", "utf8");
  assert.match(page, /order\.table\?\.name/, "the row is back to flagging a table without naming it");
});

check("laying out a room is previewed before it is done", () => {
  assert.deepEqual(bulkTablePreview({ prefix: "T-", from: 1, to: 20, padTo: 2 }), {
    count: 20,
    sample: ["T-01", "T-02", "…", "T-20"],
  });
  assert.deepEqual(bulkTablePreview({ prefix: "T-", from: 1, to: 2 }).sample, ["T-1", "T-2"]);
  assert.equal(bulkTablePreview({ from: 5, to: 1 }).count, 0);
});

check("a mistyped table range is caught before it creates anything", () => {
  // `to: 20000` is a typo, and a typo that creates twenty thousand rows is
  // tedious to undo.
  assert.match(bulkTablePayload({ branchId: "b", from: "1", to: "20000" }).errors.to, /at most 200/);
  assert.match(bulkTablePayload({ branchId: "b", from: "20", to: "1" }).errors.to, /backwards/);
  assert.deepEqual(bulkTablePayload({ branchId: "b", from: "1", to: "20", seats: "4" }).errors, {});
});

check("a table needs a name and a sensible number of seats", () => {
  assert.ok(tablePayload({ name: "", seats: "4", branchId: "b" }).errors.name);
  assert.ok(tablePayload({ name: "T-1", seats: "0", branchId: "b" }).errors.seats);
  assert.ok(tablePayload({ name: "T-1", seats: "4" }).errors.branchId);
  const { body, errors } = tablePayload({ name: " T-1 ", seats: "4", area: " Terrace ", branchId: "b" });
  assert.deepEqual(errors, {});
  assert.equal(body.name, "T-1");
  assert.equal(body.area, "Terrace");
});

check("changing what a QR code points at clears the old target", () => {
  // A stale tableId on a code that now opens the menu is how a sticker starts
  // seating people at a table that was deleted last year.
  const { body } = qrPayload({ branchId: "b", targetType: "MENU", tableId: "tb_old", productId: "p_old" });
  assert.equal(body.tableId, null);
  assert.equal(body.productId, null);
  assert.equal(body.targetType, "MENU");
});

check("a QR code that points nowhere valid is refused", () => {
  assert.ok(qrPayload({ branchId: "b", targetType: "TABLE" }).errors.tableId);
  assert.ok(qrPayload({ branchId: "b", targetType: "PRODUCT" }).errors.productId);
  // A sticker is scanned by a stranger's phone, so other schemes are refused.
  assert.match(qrPayload({ branchId: "b", targetType: "CUSTOM_URL", customUrl: "javascript:alert(1)" }).errors.customUrl, /http/);
  assert.deepEqual(qrPayload({ branchId: "b", targetType: "CUSTOM_URL", customUrl: "https://example.test/f" }).errors, {});
});

check("a basket stops being a customer and becomes a lost sale", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(cartState({ updatedAt: "2026-10-03T11:59:00Z" }, { now }).label, "Shopping now");
  assert.equal(cartState({ updatedAt: "2026-10-03T11:45:00Z" }, { now }).label, "Idle 15 min");
  assert.equal(cartState({ updatedAt: "2026-10-03T10:30:00Z" }, { now }).label, "Abandoned 1h ago");
});

check("every order status the server can return has words for it", () => {
  for (const state of ["DRAFT", "PENDING", "CONFIRMED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "CANCELLED", "REJECTED", "REFUNDED"]) {
    assert.ok(ORDER_STATES[state]?.label, `no words for order status ${state}`);
  }
  // Every tab filters on a status the enum really has, or on nothing at all.
  for (const tab of ORDER_FILTERS) {
    assert.ok(tab.value === "" || ORDER_STATES[tab.value], `tab ${tab.label} filters on an unknown status`);
  }
});

check("all-branches order access lifts the wall rather than widening it", () => {
  // A regional role's outlets change without their grants being rewritten, so
  // "all branches" has to mean all, not a list that goes stale.
  const regional = scopedPrincipal({ allow: [["orders.read", "b1"], ["orders.read_all_branches", null]] });
  assert.deepEqual(orderScope(regional), { all: true, except: [] });

  const cashier = scopedPrincipal({ allow: [["orders.read", "b1"]] });
  assert.deepEqual(orderScope(cashier), { all: false, ids: ["b1"] });
});

check("every service list applies the caller's branch scope", () => {
  // An order carries a customer's name, their phone number and what they
  // spent. An unfiltered list hands every outlet's customers to anyone holding
  // `orders.read` anywhere.
  const scoped = [
    ["src/server/services/order.service.js", "listOrders"],
    ["src/server/services/table.service.js", "listTables"],
    ["src/server/services/qr.service.js", "listQrCodes"],
    ["src/server/services/cart-admin.service.js", "listCarts"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1600);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("the service lists pass the caller's own scope, not a fixed one", () => {
  const lists = [
    ["src/app/api/v1/admin/orders/route.js", "orderScope(auth)"],
    ["src/app/api/v1/admin/tables/route.js", 'branchScope(auth, "tables.read")'],
    ["src/app/api/v1/admin/qr-codes/route.js", 'branchScope(auth, "qr_codes.read")'],
    ["src/app/api/v1/admin/carts/route.js", 'branchScope(auth, "carts.read")'],
  ];

  for (const [file, expected] of lists) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.ok(text.includes(`scope: ${expected}`), `${file} does not scope its list to the caller`);
  }
});

check("a service record named by id is checked against one non-disclosing rule", () => {
  // All three delegate rather than each rolling its own 403, which is how the
  // disclosure crept back in last time.
  for (const [file, fn] of [
    ["src/server/services/order.service.js", "assertOrderAccess"],
    ["src/server/services/table.service.js", "assertTableAccess"],
    ["src/server/services/qr.service.js", "assertQrAccess"],
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 500);
    assert.match(body, /@\/server\/ordering\/access/, `${fn} does not use the shared rule`);
    assert.doesNotMatch(body, /assertBranchAccess\(/, `${fn} still refuses out-of-scope records with a 403`);
  }
});

// --- delivery ---------------------------------------------------------------

check("a payout is shown as parts that reconstruct the total", () => {
  // Four numbers that reconcile can be checked by the driver querying their
  // pay; one net figure can only be taken on trust.
  const parts = payoutBreakdown({
    earningsAmount: "1500",
    tipsAmount: "300.50",
    adjustmentAmount: "-100",
    codDeduction: "700",
    netAmount: "1000.50",
  });
  assert.equal(parts.earned, "1800.50");
  assert.equal(parts.expected, "1000.50");
  assert.equal(parts.disagrees, false);
});

check("a driver holding more cash than they earned shows a debt, not zero", () => {
  // Clamping this at zero would hide that the driver owes the restaurant
  // money — the one thing the figure exists to surface.
  const parts = payoutBreakdown({ earningsAmount: "1000", tipsAmount: "0", adjustmentAmount: "0", codDeduction: "1200", netAmount: "-200" });
  assert.equal(parts.expected, "-200.00");
  assert.equal(parts.disagrees, false);
});

check("a payout whose lines no longer add up says so", () => {
  const parts = payoutBreakdown({ earningsAmount: "1000", tipsAmount: "0", adjustmentAmount: "0", codDeduction: "0", netAmount: "900" });
  assert.equal(parts.disagrees, true);
});

check("a job already in a driver's bag cannot be moved to someone else", () => {
  // Reassigning after pickup does not move the food — it just makes the
  // system disagree with the street about who has the customer's dinner.
  for (const status of ["PICKED_UP", "ON_THE_WAY", "ARRIVED"]) {
    assert.equal(canReassign({ driverId: "d1", status }), false, `${status} should not be reassignable`);
  }
  assert.equal(canReassign({ driverId: "d1", status: "ASSIGNED" }), true);
  assert.equal(canReassign({ driverId: "d1", status: "ACCEPTED" }), true);
  assert.equal(canReassign({ driverId: null, status: "PENDING" }), false, "nothing to reassign");
  assert.equal(canReassign({ driverId: "d1", status: "DELIVERED" }), false);
});

check("whether a driver can take another job, and why not", () => {
  assert.deepEqual(availability({ isActive: true, status: "AVAILABLE", activeDeliveries: 0, maxActiveOrders: 3 }), {
    canTake: true,
    reason: null,
    active: 0,
    max: 3,
  });
  // Full is a different answer from off-shift, and a dispatcher acts on each
  // differently — so the reason is carried, not just a boolean.
  assert.equal(availability({ isActive: true, status: "AVAILABLE", activeDeliveries: 3, maxActiveOrders: 3 }).reason, "Already carrying 3");
  assert.equal(availability({ isActive: true, status: "ON_BREAK" }).reason, "On a break");
  assert.equal(availability({ isActive: false, status: "AVAILABLE" }).reason, "Not an active driver");
  // Already carrying one is still assignable: a rider heading that way with
  // room is often the right answer.
  assert.equal(availability({ isActive: true, status: "ON_DELIVERY", activeDeliveries: 1, maxActiveOrders: 3 }).canTake, true);
});

check("a stale driver position is reported as when we last heard, not where they are", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(lastSeen("2026-10-03T11:58:00Z", { now }).stale, false);
  assert.equal(lastSeen("2026-10-03T11:40:00Z", { now }).stale, true);
  assert.equal(lastSeen("2026-10-03T11:40:00Z", { now }).label, "20 min ago");
  assert.equal(lastSeen(null, { now }).label, "Never reported");
  assert.equal(lastSeen(null, { now }).stale, true);
});

check("an unassigned job escalates sooner than an order in a kitchen", () => {
  // Food goes cold on a counter while a rider is found.
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(waitingSince("2026-10-03T11:55:00Z", { now }).tone, "text-on-surface-variant");
  assert.equal(waitingSince("2026-10-03T11:50:00Z", { now }).tone, "text-warning");
  assert.equal(waitingSince("2026-10-03T11:35:00Z", { now }).tone, "text-error");
});

check("an expiring licence is flagged before it expires", () => {
  // Counted in whole calendar days: a licence valid until the 20th is valid
  // all of the 20th, and counting elapsed hours expires it half a day early.
  const now = new Date("2026-10-03T12:00:00Z");
  assert.equal(licenceState(null, { now }), null);
  assert.equal(licenceState("2027-06-01", { now }), null, "a licence a year out is not a warning");
  assert.match(licenceState("2026-10-20", { now }).label, /expires in 17 days/);
  assert.match(licenceState("2026-09-20", { now }).label, /expired 13 days ago/);
  // The last day it is valid is not yet an expiry.
  assert.match(licenceState("2026-10-03", { now }).label, /expires in 0 days/);
});

check("a driver needs an account to sign in with", () => {
  // A driver record with nobody behind it is a row that can never be given a
  // job, because the driver app has no one to let in.
  assert.ok(driverPayload({ vehicleType: "MOTORCYCLE" }).errors.userId);
  assert.ok(driverPayload({ userId: "u1", vehicleType: "SPACESHIP" }).errors.vehicleType);
  assert.ok(driverPayload({ userId: "u1", vehicleType: "CAR", maxActiveOrders: "0" }).errors.maxActiveOrders);
  const { body, errors } = driverPayload({ userId: "u1", vehicleType: "CAR", maxActiveOrders: "3", payoutPerDelivery: "150" });
  assert.deepEqual(errors, {});
  assert.equal(body.payoutPerDelivery, 150);
  // An edit does not resend the account: it cannot be changed.
  assert.equal(driverPayload({ vehicleType: "CAR" }, { isNew: false }).body.userId, undefined);
});

check("a payout period cannot run backwards", () => {
  assert.ok(generatePayoutPayload({ periodStart: "", periodEnd: "" }).errors.periodStart);
  assert.match(generatePayoutPayload({ periodStart: "2026-10-01", periodEnd: "2026-09-01" }).errors.periodEnd, /backwards/);
  // Negative is allowed here and nowhere else: a deduction is a real thing.
  const { body, errors } = generatePayoutPayload({ periodStart: "2026-09-26", periodEnd: "2026-10-02", adjustmentAmount: "-250" });
  assert.deepEqual(errors, {});
  assert.equal(body.adjustmentAmount, -250);
});

check("a payout run opens on the week just gone", () => {
  assert.deepEqual(lastWeek(new Date("2026-10-03T10:00:00Z")), { periodStart: "2026-09-26", periodEnd: "2026-10-02" });
});

check("every delivery and driver state the server can return has words for it", () => {
  for (const state of Object.keys(DELIVERY_TRANSITIONS)) {
    assert.ok(DELIVERY_STATES[state]?.label, `no words for delivery state ${state}`);
  }
  for (const state of ["OFFLINE", "AVAILABLE", "ON_DELIVERY", "ON_BREAK", "SUSPENDED"]) {
    assert.ok(DRIVER_STATES[state]?.label, `no words for driver status ${state}`);
  }
  for (const state of ["DRAFT", "APPROVED", "PAID", "CANCELLED"]) {
    assert.ok(PAYOUT_STATES[state]?.label, `no words for payout status ${state}`);
  }
});

check("the client's view of reassignability matches the server's graph", () => {
  // The screen hides the button; the server refuses the request. They have to
  // agree, or the screen is lying about something it cannot do.
  for (const status of ["PICKED_UP", "ON_THE_WAY", "ARRIVED"]) {
    assert.equal(
      allowedDeliveryTransitions(status).includes("PENDING"),
      false,
      `${status} must not be returnable to the pool on the server either`,
    );
  }
  for (const status of ["ASSIGNED", "ACCEPTED", "ARRIVED_AT_STORE"]) {
    assert.equal(allowedDeliveryTransitions(status).includes("PENDING"), true, `${status} should return to the pool`);
  }
});

check("every delivery list applies the caller's branch scope", () => {
  // A delivery carries the customer's home address and phone number. None of
  // these three tables reaches a branch the same way, so each path is checked.
  const scoped = [
    ["src/server/services/delivery.service.js", "listDeliveries"],
    ["src/server/services/driver.service.js", "listDrivers"],
    ["src/server/services/driver-payout.service.js", "listPayouts"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1600);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("a delivery is scoped through its order and a payout through its driver", () => {
  // Guessing `branchId` on a table that has not got one fails open: the
  // filter silently matches nothing and the scope is never applied.
  const text = fsForGuard.readFileSync("src/server/services/delivery.service.js", "utf8");
  const start = text.indexOf("export async function listDeliveries(");
  assert.match(text.slice(start, start + 900), /order: \{ branchId: filter \}/);

  const payouts = fsForGuard.readFileSync("src/server/services/driver-payout.service.js", "utf8");
  const payoutStart = payouts.indexOf("export async function listPayouts(");
  assert.match(payouts.slice(payoutStart, payoutStart + 900), /driver: \{ branchId: filter \}/);
});

check("every delivery route that names a record checks the caller may reach it", () => {
  const guarded = [
    "src/app/api/v1/admin/deliveries/[id]/route.js",
    "src/app/api/v1/admin/deliveries/[id]/assign/route.js",
    "src/app/api/v1/admin/deliveries/[id]/unassign/route.js",
    "src/app/api/v1/admin/deliveries/[id]/status/route.js",
    "src/app/api/v1/admin/deliveries/[id]/track/route.js",
    "src/app/api/v1/admin/drivers/[id]/route.js",
    "src/app/api/v1/admin/drivers/[id]/status/route.js",
    "src/app/api/v1/admin/drivers/[id]/earnings/route.js",
    "src/app/api/v1/admin/driver-payouts/[id]/route.js",
    "src/app/api/v1/admin/driver-payouts/[id]/approve/route.js",
    "src/app/api/v1/admin/driver-payouts/[id]/cancel/route.js",
    "src/app/api/v1/admin/driver-payouts/[id]/paid/route.js",
  ];

  for (const file of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(
      text,
      /assertRecordAccess\(auth, "(delivery|driver|driverPayout)"/,
      `${file} names a record without checking whose it is`,
    );
  }
});

check("the delivery lists pass the caller's own scope, not a fixed one", () => {
  const lists = [
    ["src/app/api/v1/admin/deliveries/route.js", "deliveries.read"],
    ["src/app/api/v1/admin/drivers/route.js", "drivers.read"],
    ["src/app/api/v1/admin/driver-payouts/route.js", "driver_payouts.read"],
  ];

  for (const [file, key] of lists) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.ok(text.includes(`scope: branchScope(auth, "${key}")`), `${file} does not scope its list to the caller`);
  }
});

check("the printed QR URL has a page behind it", () => {
  // `qrUrl` prints `/m/{code}` on a sticker. That path not existing made every
  // scan a 404 — invisible from any admin screen, because the admin screen is
  // not what a customer opens.
  const qr = fsForGuard.readFileSync("src/server/services/qr.service.js", "utf8");
  const match = /return `\$\{env\(\)\.APP_URL\.replace\(\/\\\/\$\/, ""\)\}\/([a-z]+)\//.exec(qr);
  assert.ok(match, "could not read the printed URL shape out of qrUrl");
  assert.ok(
    fsForGuard.existsSync(`src/app/${match[1]}/[code]/route.js`),
    `qrUrl prints /${match[1]}/{code} but no route handler exists there`,
  );
});

// --- finance ----------------------------------------------------------------

const {
  PAYMENT_STATES,
  REFUND_STATES,
  SESSION_STATES,
  EXPENSE_STATES,
  JOURNAL_STATES,
  JOURNAL_SOURCES,
  PERIOD_STATES,
  ACCOUNT_TYPES,
  MOVEMENT_TYPES,
  cashVariance,
  combinedRate,
  entryBalance,
  lineProblem,
  accountTree: financeAccountTree,
  flattenAccounts,
  refundableAmount,
  paymentActions,
  expenseTotal,
  expenseNet,
  expenseIsLocked,
  periodAction,
  coverageLabel,
  statementHealth,
  marginPercent,
  defaultNormalBalance,
  balanceReads,
  expectedCash,
  lastMonth,
  monthToDate,
  isCash,
  providerNote,
  invoicePayload,
  addressLines,
  drawerPayload,
} = await import("@/lib/finance");

check("a combined tax rate compounds rather than adding up", () => {
  const rate = (over) => ({ isActive: true, isCompound: false, sortOrder: 0, ...over });
  assert.equal(combinedRate([rate({ rate: 5 }), rate({ rate: 12, sortOrder: 1 })]), "17.0000");
  // 10% then 10% compound is 21%, not 20% — charged on the net plus the first.
  assert.equal(combinedRate([rate({ rate: 10 }), rate({ rate: 10, sortOrder: 1, isCompound: true })]), "21.0000");
  // Four decimal places survive: 2.5 then 2.5 compound is 5.0625, and the
  // two-decimal money helpers would round that to 5.06 on every order.
  assert.equal(combinedRate([rate({ rate: 2.5 }), rate({ rate: 2.5, sortOrder: 1, isCompound: true })]), "5.0625");
  assert.equal(combinedRate([rate({ rate: 5 }), rate({ rate: 99, sortOrder: 1, isActive: false })]), "5.0000");
  assert.equal(combinedRate([]), "0.0000");
});

check("a short drawer and an over drawer are named, not averaged into a variance", () => {
  const short = cashVariance({ expected: "1000.00", counted: "800.00" });
  assert.equal(short.direction, "short");
  assert.equal(short.amount, "200.00");
  // The size is unsigned; the direction is carried in the word, because a
  // minus sign is easy to miss on a printed close sheet.
  assert.ok(!short.amount.startsWith("-"));

  const over = cashVariance({ expected: "1000.00", counted: "1000.50" });
  assert.equal(over.direction, "over");
  assert.equal(over.amount, "0.50");

  assert.equal(cashVariance({ expected: "1000.00", counted: "1000.00" }).direction, "square");
  // Not counted is not the same as agreeing exactly.
  assert.equal(cashVariance({ expected: "1000.00", counted: null }).known, false);
  assert.equal(cashVariance({ expected: "1000.00", counted: "" }).known, false);
});

check("expected cash is the float plus everything that moved, signed", () => {
  assert.equal(
    expectedCash({ openingFloat: "500.00", movements: [{ amount: "1200.50" }, { amount: "-200.00" }, { amount: "-50.25" }] }),
    "1450.25",
  );
  assert.equal(expectedCash({ openingFloat: "500", movements: [] }), "500.00");
});

check("an entry balances only when both sides agree and neither is empty", () => {
  assert.equal(entryBalance([{ debit: "100" }, { credit: "100" }]).balanced, true);
  assert.equal(entryBalance([{ debit: "100" }, { credit: "60" }]).balanced, false);
  assert.equal(entryBalance([{ debit: "100" }, { credit: "60" }]).difference, "40.00");
  // Two empty lines are not a balanced entry, they are an unwritten one.
  assert.equal(entryBalance([{ debit: "0" }, { credit: "0" }]).balanced, false);
  assert.equal(entryBalance([{ debit: "0" }, { credit: "0" }]).empty, true);
});

check("a journal line must carry money on exactly one side", () => {
  assert.equal(lineProblem({ accountId: "a", debit: "100", credit: "" }), null);
  assert.equal(lineProblem({ accountId: "a", debit: "", credit: "100" }), null);
  assert.ok(lineProblem({ accountId: "", debit: "100", credit: "" }));
  assert.ok(lineProblem({ accountId: "a", debit: "100", credit: "50" }));
  assert.ok(lineProblem({ accountId: "a", debit: "", credit: "" }));
  // A negative belongs in the other column; the side is the meaning.
  assert.ok(lineProblem({ accountId: "a", debit: "-100", credit: "" }));
});

check("the chart of accounts nests and flattens in code order", () => {
  const tree = financeAccountTree([
    { id: "b", code: "1100", parentId: "a" },
    { id: "a", code: "1000", parentId: null },
    { id: "c", code: "1050", parentId: "a" },
    { id: "d", code: "4000", parentId: null },
  ]);
  assert.deepEqual(
    flattenAccounts(tree).map((row) => `${row.code}@${row.depth}`),
    ["1000@0", "1050@1", "1100@1", "4000@0"],
  );
});

check("only money that was actually taken can be refunded", () => {
  assert.equal(refundableAmount({ status: "CAPTURED", amount: "500.00", refundedAmount: "120.00" }), "380.00");
  assert.equal(refundableAmount({ status: "CAPTURED", amount: "500.00", refundedAmount: "500.00" }), "0.00");
  // An authorisation is reserved, not taken, so there is nothing to give back.
  assert.equal(refundableAmount({ status: "AUTHORIZED", amount: "500.00" }), "0.00");
  assert.equal(refundableAmount({ status: "PENDING", amount: "500.00" }), "0.00");
  assert.equal(refundableAmount({ status: "FAILED", amount: "500.00" }), "0.00");
});

check("a payment only offers the actions that would work", () => {
  const keys = (payment) => paymentActions(payment).map((action) => action.key);
  assert.deepEqual(keys({ status: "AUTHORIZED", method: "CARD" }), ["capture", "void"]);
  // Cash is collected, never captured, and only while it is still pending.
  assert.deepEqual(keys({ status: "PENDING", method: "CASH_ON_DELIVERY" }), ["collect", "void"]);
  assert.deepEqual(keys({ status: "PENDING", method: "CARD" }), ["void"]);
  assert.deepEqual(keys({ status: "CAPTURED", method: "CARD" }), []);
  assert.deepEqual(keys({ status: "FAILED", method: "CARD" }), []);
  assert.equal(isCash("CASH"), true);
  assert.equal(isCash("CARD"), false);
});

check("an expense's tax is inside its total, not added to it", () => {
  // `expenseLines` books `amount - taxAmount` as the cost, so `amount` is the
  // gross off the receipt. Reading the two as net-plus-tax overstates every
  // receipt by its own tax and understates every cost by the same.
  assert.equal(expenseTotal({ amount: "1200.50", taxAmount: "204.09" }), "1200.50");
  assert.equal(expenseNet({ amount: "1200.50", taxAmount: "204.09" }), "996.41");
  assert.equal(expenseTotal({ amount: "100" }), "100.00");
  assert.equal(expenseNet({ amount: "100" }), "100.00");
  assert.equal(expenseIsLocked({ status: "APPROVED" }), true);
  assert.equal(expenseIsLocked({ status: "DRAFT" }), false);
});

check("the expense screens agree with the posting rule about what tax is", () => {
  // Read out of the rule itself rather than restated here, so changing one
  // without the other fails rather than silently disagreeing about money.
  const rule = fsForGuard.readFileSync("src/server/accounting/posting-rules.js", "utf8");
  const start = rule.indexOf("export function expenseLines(");
  assert.notEqual(start, -1);
  assert.match(rule.slice(start, start + 400), /const net = D\(amount\)\.minus\(tax\)/);
});

check("a period cannot be closed out of order or over a draft", () => {
  assert.equal(periodAction({ status: "OPEN" }, { drafts: 0, earlierOpen: 0 }).can, true);
  assert.equal(periodAction({ status: "OPEN" }, { drafts: 2, earlierOpen: 0 }).can, false);
  // The subtle one: a closed month in front of an open one can still move.
  assert.equal(periodAction({ status: "OPEN" }, { drafts: 0, earlierOpen: 1 }).can, false);
  assert.match(periodAction({ status: "OPEN" }, { drafts: 0, earlierOpen: 1 }).reason, /earlier period/i);
  assert.equal(periodAction({ status: "CLOSED" }).verb, "reopen");
  assert.equal(periodAction({ status: "LOCKED" }).can, false);
});

check("a statement says what it covers, so a branch view is never read as the company's", () => {
  assert.equal(coverageLabel({ branchName: "Pizza Master" }), "Pizza Master");
  assert.equal(coverageLabel({ allBranches: true }), "All branches");
  assert.equal(coverageLabel({ scopedBranches: ["One"] }), "One");
  assert.equal(coverageLabel({ scopedBranches: ["One", "Two"] }), "2 branches you can see");
  assert.equal(coverageLabel({ scopedBranches: [] }), "No branches");
});

check("books that do not balance are called out before the figures, not after", () => {
  assert.equal(statementHealth({ balanced: true }), null);
  const bad = statementHealth({ balanced: false, kind: "balance sheet" });
  assert.match(bad.body, /balance sheet/);
  assert.match(bad.body, /unreliable/);
});

check("a margin needs revenue to be a percentage of", () => {
  assert.equal(marginPercent("250", "1000"), 25);
  assert.equal(marginPercent("1", "0"), null);
  assert.equal(marginPercent("0", "0"), null);
});

check("an account's normal side follows its type, and a wrong-side balance is flagged", () => {
  assert.equal(defaultNormalBalance("ASSET"), "DEBIT");
  assert.equal(defaultNormalBalance("EXPENSE"), "DEBIT");
  assert.equal(defaultNormalBalance("INCOME"), "CREDIT");
  assert.equal(defaultNormalBalance("LIABILITY"), "CREDIT");
  assert.equal(defaultNormalBalance("EQUITY"), "CREDIT");
  assert.equal(balanceReads({ normalBalance: "DEBIT" }, "100.00").unusual, false);
  assert.equal(balanceReads({ normalBalance: "DEBIT" }, "-100.00").unusual, true);
});

check("every finance state the server can return has words for it", () => {
  for (const state of ["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "EXPIRED", "REFUNDED", "PARTIALLY_REFUNDED"]) {
    assert.ok(PAYMENT_STATES[state]?.label, `no words for payment status ${state}`);
  }
  for (const state of ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "FAILED", "REJECTED"]) {
    assert.ok(REFUND_STATES[state]?.label, `no words for refund status ${state}`);
  }
  for (const state of ["OPEN", "CLOSED", "RECONCILED"]) {
    assert.ok(SESSION_STATES[state]?.label, `no words for session status ${state}`);
  }
  for (const state of ["DRAFT", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "CANCELLED"]) {
    assert.ok(EXPENSE_STATES[state]?.label, `no words for expense status ${state}`);
  }
  for (const state of ["DRAFT", "POSTED", "VOID"]) {
    assert.ok(JOURNAL_STATES[state]?.label, `no words for journal status ${state}`);
  }
  for (const state of ["OPEN", "CLOSED", "LOCKED"]) {
    assert.ok(PERIOD_STATES[state]?.label, `no words for period status ${state}`);
  }
  for (const state of ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]) {
    assert.ok(ACCOUNT_TYPES[state]?.label, `no words for account type ${state}`);
  }
  for (const state of ["SALE", "REFUND", "PAY_IN", "PAY_OUT", "DROP", "TIP_OUT", "ADJUSTMENT"]) {
    assert.ok(MOVEMENT_TYPES[state]?.label, `no words for cash movement ${state}`);
  }
});

check("a provider is only named when it is somewhere the money went", () => {
  // Cash is stored with the provider "cash", so printing both read "Cash ·
  // cash" on every counter payment — a stutter that tells nobody anything.
  assert.equal(providerNote("CASH", "cash"), null);
  assert.equal(providerNote("BANK_TRANSFER", "bank transfer"), null);
  assert.equal(providerNote("CARD", "stripe"), "stripe");
  assert.equal(providerNote("CARD", null), null);
});

check("an address prints whatever shape it was stored in", () => {
  assert.deepEqual(addressLines({ line1: "Shop 14", city: "Karachi", postalCode: "75400" }), ["Shop 14", "Karachi", "75400"]);
  // A branch record spells it differently from an order's address snapshot,
  // and reading only one of the two left the street off the invoice.
  assert.deepEqual(
    addressLines({ addressLine1: "Shop 14, Tariq Road", addressLine2: "Near Dolmen Mall", city: "Karachi" }),
    ["Shop 14, Tariq Road", "Near Dolmen Mall", "Karachi"],
  );
  assert.deepEqual(addressLines({ street: "Shop 14" }), ["Shop 14"], "an unfamiliar shape is still better shown than dropped");
  assert.deepEqual(addressLines(null), []);
  assert.deepEqual(addressLines({ line1: "   " }), []);
});

check("a tax number on an invoice needs the name it belongs to", () => {
  /*
   * The whole reason somebody asks for an invoice rather than a receipt is the
   * company details on it, and a registration number with no company against
   * it is not a tax document — it is the mistake you make pasting a number
   * into the first box on the form.
   */
  assert.match(invoicePayload({ taxId: "NTN-123" }).errors.name, /belongs to/);
  assert.deepEqual(invoicePayload({ name: "Acme (Pvt) Ltd", taxId: "NTN-123" }).errors, {});

  // Everything optional: the service falls back to the name already on the order.
  const { body, errors } = invoicePayload({});
  assert.deepEqual(errors, {});
  assert.deepEqual(body, {});

  const full = invoicePayload({ name: "Acme", line1: "Shop 14", city: "Karachi", line2: " " }).body;
  assert.deepEqual(full, { name: "Acme", address: { line1: "Shop 14", city: "Karachi" } });
});

check("opening a drawer insists on a float, and zero is a float", () => {
  /*
   * Blank and zero are different claims. Zero says the till was empty and
   * somebody looked; blank says nobody counted, and a variance measured from a
   * figure nobody counted is not a variance.
   */
  assert.match(drawerPayload({ branchId: "b1", registerName: "Counter 1" }).errors.openingFloat, /Count the float/);
  assert.deepEqual(drawerPayload({ branchId: "b1", registerName: "Counter 1", openingFloat: "0" }).errors, {});
  assert.equal(drawerPayload({ branchId: "b1", registerName: "Counter 1", openingFloat: "5,000" }).body.openingFloat, 5000);
  assert.match(drawerPayload({ branchId: "b1", registerName: "", openingFloat: "0" }).errors.registerName, /Name the drawer/);
  assert.match(drawerPayload({ registerName: "Counter 1", openingFloat: "0" }).errors.branchId, /branch/);
});

check("every journal source the schema can write has words for it", () => {
  // Read out of the schema rather than restated, so a new source added to the
  // enum fails here instead of rendering as a raw constant on the page.
  const schema = fsForGuard.readFileSync("prisma/schema/11-finance.prisma", "utf8");
  const block = /enum JournalSource \{([\s\S]*?)\}/.exec(schema)[1];
  const sources = block.split("\n").map((line) => line.trim()).filter((line) => /^[A-Z_]+$/.test(line));
  assert.ok(sources.length >= 10, "could not read the journal sources out of the schema");
  for (const source of sources) assert.ok(JOURNAL_SOURCES[source], `no words for journal source ${source}`);
});

check("a report range defaults to a whole month, not a partial one", () => {
  // `lastMonth` on 3 October must be the whole of September, not 3 Sept–3 Oct.
  assert.deepEqual(lastMonth(new Date("2026-10-03T10:00:00Z")), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(lastMonth(new Date("2026-01-15T10:00:00Z")), { from: "2025-12-01", to: "2025-12-31" });
  assert.equal(monthToDate(new Date("2026-10-03T10:00:00Z")).from, "2026-10-01");
});

check("every finance list applies the caller's branch scope", () => {
  // Payments carry what a customer paid and how; expenses and the journal
  // carry what the business spends. None of it belongs to another branch.
  const scoped = [
    ["src/server/services/payment.service.js", "listPayments"],
    ["src/server/services/refund.service.js", "listRefunds"],
    ["src/server/services/expense.service.js", "listExpenses"],
    ["src/server/services/register.service.js", "listSessions"],
    ["src/server/services/journal.service.js", "listJournalEntries"],
    ["src/server/services/invoice-admin.service.js", "listInvoices"],
  ];

  for (const [file, fn] of scoped) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 2000);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("a refund is scoped through its payment and an invoice through its order", () => {
  // Neither table has a branch column. Guessing one fails open.
  const refunds = fsForGuard.readFileSync("src/server/services/refund.service.js", "utf8");
  const refundStart = refunds.indexOf("export async function listRefunds(");
  assert.match(refunds.slice(refundStart, refundStart + 900), /payment: \{ branchId: filter \}/);

  const invoices = fsForGuard.readFileSync("src/server/services/invoice-admin.service.js", "utf8");
  const invoiceStart = invoices.indexOf("export async function listInvoices(");
  assert.match(invoices.slice(invoiceStart, invoiceStart + 900), /order: \{ branchId: filter \}/);
});

check("every financial statement is cut to the caller's branches", () => {
  // The sharpest version of this leak: naming a branch you may not see is
  // refused, so the way through was to name none at all and be handed the
  // company. Each statement takes a scope and passes it down.
  const statements = [
    ["src/server/services/financial-report.service.js", "trialBalanceReport"],
    ["src/server/services/financial-report.service.js", "profitAndLossReport"],
    ["src/server/services/financial-report.service.js", "balanceSheetReport"],
    ["src/server/services/financial-report.service.js", "cashFlowReport"],
    ["src/server/services/financial-report.service.js", "financialSummary"],
    ["src/server/services/journal.service.js", "accountBalances"],
    ["src/server/services/account.service.js", "accountLedger"],
    ["src/server/services/operational-report.service.js", "salesReport"],
    ["src/server/services/operational-report.service.js", "productMixReport"],
    ["src/server/services/operational-report.service.js", "inventoryReport"],
    ["src/server/services/operational-report.service.js", "deliveryReport"],
  ];

  for (const [file, fn] of statements) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    assert.match(text.slice(start, start + 700), /scope/, `${fn} ignores the caller's scope`);
  }
});

check("every finance route that names a record checks the caller may reach it", () => {
  const guarded = [
    "src/app/api/v1/admin/payments/[id]/route.js",
    "src/app/api/v1/admin/payments/[id]/capture/route.js",
    "src/app/api/v1/admin/payments/[id]/collect/route.js",
    "src/app/api/v1/admin/payments/[id]/void/route.js",
    "src/app/api/v1/admin/refunds/[id]/route.js",
    "src/app/api/v1/admin/refunds/[id]/approve/route.js",
    "src/app/api/v1/admin/refunds/[id]/reject/route.js",
    "src/app/api/v1/admin/expenses/[id]/route.js",
    "src/app/api/v1/admin/expenses/[id]/submit/route.js",
    "src/app/api/v1/admin/expenses/[id]/approve/route.js",
    "src/app/api/v1/admin/expenses/[id]/reject/route.js",
    "src/app/api/v1/admin/registers/[id]/route.js",
    "src/app/api/v1/admin/registers/[id]/close/route.js",
    "src/app/api/v1/admin/registers/[id]/reconcile/route.js",
    "src/app/api/v1/admin/registers/[id]/movements/route.js",
    "src/app/api/v1/admin/journal-entries/[id]/route.js",
    "src/app/api/v1/admin/journal-entries/[id]/post/route.js",
    "src/app/api/v1/admin/journal-entries/[id]/reverse/route.js",
    "src/app/api/v1/admin/journal-entries/[id]/void/route.js",
  ];

  for (const file of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(
      text,
      /assertRecordAccess\(auth, "(payment|refund|expense|registerSession|journalEntry)"/,
      `${file} names a record without checking whose it is`,
    );
  }
});

check("changing something every branch uses takes a company-wide grant", () => {
  // `can()` with no branch accepts any branch-pinned grant, so without this a
  // finance role at one outlet could close the books, or change the VAT rate,
  // for every other outlet.
  const companyWide = [
    "src/app/api/v1/admin/accounting-periods/[id]/close/route.js",
    "src/app/api/v1/admin/accounting-periods/[id]/lock/route.js",
    "src/app/api/v1/admin/accounting-periods/[id]/reopen/route.js",
    "src/app/api/v1/admin/tax-groups/route.js",
    "src/app/api/v1/admin/tax-groups/[id]/route.js",
    "src/app/api/v1/admin/tax-groups/[id]/rates/route.js",
    "src/app/api/v1/admin/tax-rates/[rateId]/route.js",
  ];

  for (const file of companyWide) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /assertCompanyWide|assertTaxAccess/, `${file} lets a branch-pinned grant change company data`);
  }

  // An account is the mixed case: shared ones are company data, a till is not.
  for (const file of [
    "src/app/api/v1/admin/accounts/route.js",
    "src/app/api/v1/admin/accounts/[id]/route.js",
    "src/app/api/v1/admin/accounts/[id]/active/route.js",
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /assertAccountAccess|assertAccountBranch/, `${file} does not decide who owns the account`);
  }
});

check("the finance lists pass the caller's own scope, not a fixed one", () => {
  const lists = [
    ["src/app/api/v1/admin/payments/route.js", "payments.read"],
    ["src/app/api/v1/admin/refunds/route.js", "refunds.read"],
    ["src/app/api/v1/admin/expenses/route.js", "expenses.read"],
    ["src/app/api/v1/admin/registers/route.js", "cash_registers.read"],
    ["src/app/api/v1/admin/journal-entries/route.js", "journal_entries.read"],
    ["src/app/api/v1/admin/invoices/route.js", "invoices.read"],
    ["src/app/api/v1/admin/reports/profit-and-loss/route.js", "financial_reports.view_pnl"],
    ["src/app/api/v1/admin/reports/balance-sheet/route.js", "financial_reports.view_balance_sheet"],
    ["src/app/api/v1/admin/reports/trial-balance/route.js", "financial_reports.view_trial_balance"],
    ["src/app/api/v1/admin/reports/cash-flow/route.js", "financial_reports.view_cash_flow"],
    ["src/app/api/v1/admin/reports/sales/route.js", "reports.view_sales"],
    ["src/app/api/v1/admin/accounts/[id]/ledger/route.js", "accounts.read"],
  ];

  for (const [file, key] of lists) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.ok(
      text.includes(`branchScope(auth, "${key}")`),
      `${file} does not scope the caller to their own branches for ${key}`,
    );
  }
});

// --- insights ---------------------------------------------------------------

const {
  REPORTS: INSIGHT_REPORTS,
  reportByKey,
  GROUPINGS,
  isGrouping,
  bucketLabel,
  fillDays,
  rateIsMeaningful,
  shareOf,
  onTimeTone,
  topRows,
  actionSentence,
  actionGroups,
  isWeighty,
  changeLines,
  actorName,
  typeLabel,
  channelLabel,
  lastWeek: insightsLastWeek,
} = await import("@/lib/insights");

check("a bucket label is read off the key's own shape", () => {
  // The granularity travels with the data instead of alongside it, so a
  // series and its axis cannot drift apart.
  assert.match(bucketLabel("2026-10"), /2026/);
  assert.match(bucketLabel("2026-10-03"), /3/);
  assert.match(bucketLabel("2026-10-03T14"), /\d/);
  assert.equal(bucketLabel(""), "—");
  assert.equal(bucketLabel(null), "—");
  // The long form is what a tooltip shows; it must differ from the tick.
  assert.notEqual(bucketLabel("2026-10-03"), bucketLabel("2026-10-03", { long: true }));
});

check("a quiet day is drawn as zero rather than skipped", () => {
  // A series built only from days with data draws a straight line across a
  // closed Monday, which reads as "steady" when the truth is "shut".
  const filled = fillDays([{ period: "2026-10-02", orders: 3, revenue: "100.00" }], { from: "2026-10-01", to: "2026-10-04" });
  assert.deepEqual(filled.map((row) => row.period), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
  assert.equal(filled[0].orders, 0);
  assert.equal(filled[1].orders, 3);
});

check("filling days refuses to invent a decade of them", () => {
  const huge = fillDays([{ period: "2020-01-01" }], { from: "2000-01-01", to: "2026-01-01" });
  assert.equal(huge.length, 1, "a 26-year range must be left alone, not expanded to 9,000 rows");
  assert.deepEqual(fillDays([{ period: "x" }], {}), [{ period: "x" }]);
  // A backwards range is a typo, not an instruction.
  assert.equal(fillDays([{ period: "x" }], { from: "2026-10-04", to: "2026-10-01" }).length, 1);
});

check("a rate is withheld when there is too little behind it", () => {
  // "100% on time" off two deliveries is the figure most likely to be quoted
  // in a meeting and least likely to mean anything.
  assert.equal(rateIsMeaningful(2), false);
  assert.equal(rateIsMeaningful(5), true);
  assert.match(onTimeTone(100, { count: 2 }).note, /too few/i);
  assert.equal(onTimeTone(100, { count: 2 }).tone, "text-on-surface-variant");
  assert.equal(onTimeTone(95, { count: 50 }).tone, "text-on-surface");
  assert.equal(onTimeTone(80, { count: 50 }).tone, "text-warning");
  assert.equal(onTimeTone(60, { count: 50 }).tone, "text-error");
  assert.match(onTimeTone(null, { count: 50 }).note, /too few/i);
});

check("a share needs something to be a share of", () => {
  assert.equal(shareOf(25, 100), 25);
  assert.equal(shareOf(1, 3), 33.3);
  assert.equal(shareOf(1, 0), null);
  assert.equal(shareOf(1, null), null);
});

check("a long tail folds into one labelled row rather than growing hues", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ name: `Item ${i}`, value: i }));
  const top = topRows(rows, { limit: 8, label: (row) => row.name, value: (row) => row.value });
  assert.equal(top.length, 9, "eight bars plus one fold");
  assert.match(top[8].label, /^Other \(4\)$/);
  // 0+1+2+3 — the fold has to carry the tail's value, not drop it.
  assert.equal(top[8].value, 6);
  // Largest first, so the comparison reads top to bottom.
  assert.equal(top[0].value, 11);
  // Under the limit, nothing is folded.
  assert.equal(topRows(rows.slice(0, 3), { limit: 8, label: (r) => r.name, value: (r) => r.value }).length, 3);
});

check("an action key reads as a sentence", () => {
  assert.equal(actionSentence("supplier_bill.approve"), "approved a supplier bill");
  assert.equal(actionSentence("payment.capture"), "captured a payment");
  assert.equal(actionSentence("journal_entry.reverse"), "reversed a journal entry");
  // An unknown verb falls through to itself rather than to nothing.
  assert.equal(actionSentence("order.frobnicate"), "frobnicate a order");
  assert.equal(actionSentence("weird"), "weird");
  assert.equal(actionSentence(""), "did something");
});

check("only the irreversible actions are marked", () => {
  // A log where everything is ranked is a log nobody reads.
  for (const action of ["expense.delete", "journal_entry.void", "payment.refund", "period.lock", "refund.approve"]) {
    assert.equal(isWeighty(action), true, `${action} should be marked`);
  }
  for (const action of ["order.create", "product.update", "user.login", "menu.publish"]) {
    assert.equal(isWeighty(action), false, `${action} should not be marked`);
  }
});

check("a secret never reaches the audit screen", () => {
  // An audit log is read by more people than the record it describes, and a
  // token in a log is a token in a screenshot.
  const lines = changeLines({
    orderNumber: "A-1",
    passwordHash: "$2b$10$abc",
    apiToken: "sk_live_x",
    otpHash: "zzz",
    providerSignature: "sig",
    secretKey: "k",
  });
  assert.deepEqual(lines.map((line) => line.field), ["order number"]);
});

check("what changed is flattened, bounded and never crashes on shape", () => {
  assert.deepEqual(changeLines(null), []);
  assert.deepEqual(changeLines("a string"), []);
  assert.deepEqual(changeLines(undefined), []);
  assert.equal(changeLines({ nested: { a: 1 } })[0].value, '{"a":1}');
  assert.equal(changeLines({ gone: null })[0].value, "—");
  // A runaway `changes` blob must not render a thousand rows.
  assert.equal(changeLines(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, i]))).length, 12);
  // Long values are clipped rather than allowed to break the layout.
  assert.equal(changeLines({ long: "x".repeat(500) })[0].value.length, 160);
});

check("an entry with no account still names who did it", () => {
  assert.equal(actorName({ actor: { name: "Sara" } }), "Sara");
  // The account was deleted but the trail must still say a person did it.
  assert.equal(actorName({ actorId: "u1", actor: null }), "A deleted account");
  assert.equal(actorName({ actorId: null }), "The system");
  assert.equal(actorName(null), "The system");
});

check("actions group by their module", () => {
  assert.deepEqual(actionGroups(["order.create", "order.void", "user.update"]), [
    { key: "order", label: "order", count: 2 },
    { key: "user", label: "user", count: 1 },
  ]);
  assert.deepEqual(actionGroups([]), []);
});

check("the report registry is coherent and leaves the deferred one out", () => {
  for (const report of INSIGHT_REPORTS) {
    assert.ok(report.key && report.label && report.permission && report.blurb, `${report.key} is missing a field`);
    // Every report says what it leaves out — the part people get wrong.
    assert.ok(report.excludes, `${report.key} does not say what it excludes`);
    assert.equal(reportByKey(report.key), report);
  }
  assert.equal(reportByKey("nope"), null);
  // The creator programme is deferred; a card that leads nowhere is worse
  // than no card.
  assert.equal(INSIGHT_REPORTS.some((report) => report.permission === "reports.view_creator"), false);
});

check("every report's permission is one the catalogue really defines", () => {
  // A key with a typo hides the report from everybody and raises no error.
  const seed = fsForGuard.readFileSync("prisma/seeds/permissions.js", "utf8");
  for (const report of INSIGHT_REPORTS) {
    const [module, action] = report.permission.split(".");
    const block = new RegExp(`module: "${module}"[\\s\\S]*?\\n  \\}`).exec(seed);
    assert.ok(block, `no permission module "${module}"`);
    assert.ok(block[0].includes(`["${action}"`), `"${report.permission}" is not in the catalogue`);
  }
});

check("the groupings offered are the ones the server understands", () => {
  const service = fsForGuard.readFileSync("src/server/services/operational-report.service.js", "utf8");
  const start = service.indexOf("const bucketKey");
  const body = service.slice(start, start + 320);
  for (const row of GROUPINGS) {
    assert.ok(isGrouping(row.value));
    if (row.value !== "day") assert.ok(body.includes(`"${row.value}"`), `the server has no bucket for ${row.value}`);
  }
  assert.equal(isGrouping("fortnight"), false);
});

check("every order type and channel the schema defines has words", () => {
  // Read out of the schema rather than restated. The first version of this
  // test listed "APP" — a value the enum has never had — so it asserted
  // against its own typo and passed while a real MOBILE_APP order rendered
  // as a raw constant on the sales chart.
  const schema = fsForGuard.readFileSync("prisma/schema/04-ordering.prisma", "utf8");
  const values = (name) =>
    new RegExp(`enum ${name} \\{([\\s\\S]*?)\\}`)
      .exec(schema)[1]
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^[A-Z_]+$/.test(line));

  const types = values("OrderType");
  const channels = values("OrderChannel");
  assert.ok(types.length >= 3 && channels.length >= 5, "could not read the enums out of the schema");
  for (const value of types) assert.notEqual(typeLabel(value), value, `no words for order type ${value}`);
  for (const value of channels) assert.notEqual(channelLabel(value), value, `no words for channel ${value}`);

  // An unknown value falls back to itself rather than to "undefined".
  assert.equal(typeLabel("SOMETHING_NEW"), "SOMETHING_NEW");
  assert.equal(channelLabel(null), "Unknown");
});

check("the last-seven-days range is seven whole past days", () => {
  // Not "today minus 7", which includes a part-day and makes today's quiet
  // morning look like a collapse.
  assert.deepEqual(insightsLastWeek(new Date("2026-10-03T10:00:00Z")), { from: "2026-09-26", to: "2026-10-02" });
});

check("the audit log applies the caller's branch scope", () => {
  // An audit entry names a person, a record and an outlet. Unfiltered it is
  // every branch's activity handed to whoever can read one branch's.
  const text = fsForGuard.readFileSync("src/server/services/audit.service.js", "utf8");
  for (const fn of ["listAuditLogs", "listAuditActions"]) {
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing`);
    const body = text.slice(start, start + 1800);
    assert.match(body, /scope = null/, `${fn} takes no scope`);
    assert.match(body, /branchFilter\(scope\)/, `${fn} never turns the scope into a filter`);
    // Company-level entries stay visible, matching every other
    // company-wide record in the system.
    assert.match(body, /branchId: null/, `${fn} drops company-level entries`);
  }

  for (const file of ["src/app/api/v1/admin/audit-logs/route.js", "src/app/api/v1/admin/audit-logs/actions/route.js"]) {
    const route = fsForGuard.readFileSync(file, "utf8");
    assert.ok(route.includes('branchScope(auth, "audit_logs.read")'), `${file} does not scope the caller`);
  }
});

check("every nav item in Insights has a page behind it", () => {
  // The one mistake that is invisible until somebody clicks: a nav entry
  // pointing at a route that was never built.
  const insights = DASHBOARD_NAV.find((section) => section.id === "insights");
  assert.ok(insights, "the Insights section is gone from the nav");
  for (const item of insights.items) {
    const route = item.href.replace("/dashboard", "src/app/(dashboard)/dashboard");
    assert.ok(fsForGuard.existsSync(`${route}/page.js`), `${item.href} has no page`);
  }
});

// --- marketing --------------------------------------------------------------

const {
  DISCOUNT_TYPES,
  DISCOUNT_TYPE_ORDER,
  usesField,
  discountSummary,
  conditionList,
  minuteLabel,
  minuteFromInput,
  minuteToInput,
  scheduleSummary,
  reachSummary,
  promotionState,
  couponState,
  usageSummary,
  coherenceProblems,
  wouldNeverFire,
  promotionPayload,
  normaliseCode,
  isHardToRead,
  codeExample,
} = await import("@/lib/marketing");
const { assertPromotionIsCoherent: serverCoherence } = await import("@/server/services/promotion.service");

const asMoney = (value) => `PKR ${Number(value).toFixed(2)}`;
const mk = { formatMoney: asMoney };

check("an offer says what it does in words, not a row of numbers", () => {
  assert.equal(discountSummary({ type: "PERCENTAGE", value: 20, maxDiscountAmount: 100 }, mk), "20% off, up to PKR 100.00");
  assert.equal(discountSummary({ type: "PERCENTAGE", value: 20 }, mk), "20% off");
  assert.equal(discountSummary({ type: "FIXED_AMOUNT", value: 300 }, mk), "PKR 300.00 off");
  assert.equal(discountSummary({ type: "FREE_DELIVERY" }, mk), "Free delivery");
  assert.equal(discountSummary({ type: "BUY_X_GET_Y", buyQuantity: 2, getQuantity: 1 }, mk), "Buy 2, get 1 free");
  assert.match(discountSummary({ type: "BUNDLE_PRICE", value: 999 }, mk), /Bundle price/);
});

check("only the inputs a discount type uses are offered or sent", () => {
  assert.equal(usesField("PERCENTAGE", "value"), true);
  assert.equal(usesField("PERCENTAGE", "buyQuantity"), false);
  assert.equal(usesField("BUY_X_GET_Y", "buyQuantity"), true);
  assert.equal(usesField("FREE_DELIVERY", "value"), false);

  // A leftover quantity on a percentage offer is noise the next reader has
  // to interpret, so the payload drops it rather than storing it.
  const payload = promotionPayload({ name: "x", type: "PERCENTAGE", value: 20, buyQuantity: 5, getQuantity: 3, everyDay: true });
  assert.equal(payload.buyQuantity, null);
  assert.equal(payload.getQuantity, null);
  assert.equal(payload.value, 20);
  // "Every day" is stored as an empty list, which is what the server reads
  // as "no day restriction".
  assert.deepEqual(payload.daysOfWeek, []);
});

check("every discount type the schema defines has words and a field list", () => {
  const schema = fsForGuard.readFileSync("prisma/schema/05-promotions.prisma", "utf8");
  const values = /enum DiscountType \{([\s\S]*?)\}/
    .exec(schema)[1]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z_]+$/.test(line));
  assert.ok(values.length >= 5, "could not read DiscountType out of the schema");
  for (const value of values) {
    assert.ok(DISCOUNT_TYPES[value]?.label, `no words for discount type ${value}`);
    assert.ok(Array.isArray(DISCOUNT_TYPES[value].fields), `no field list for ${value}`);
    assert.ok(DISCOUNT_TYPE_ORDER.includes(value), `${value} is missing from the ordered list`);
  }
});

check("a time window past midnight is read and written as the next day", () => {
  assert.equal(minuteLabel(870), "14:30");
  assert.equal(minuteLabel(1530), "01:30 next day");
  assert.equal(minuteLabel(null), "");
  assert.equal(minuteFromInput("14:30"), 870);
  assert.equal(minuteFromInput("02:00", { nextDay: true }), 1560);
  // Round trip: an overnight end comes back as a real clock time.
  assert.equal(minuteToInput(1560), "02:00");
  assert.equal(minuteFromInput("nope"), null);
  assert.equal(minuteFromInput("99:99"), null);
});

check("a schedule reads as a sentence, and an unrestricted one says so", () => {
  assert.equal(scheduleSummary({}), "Any time");
  assert.match(scheduleSummary({ daysOfWeek: [1, 2, 3] }), /Mon, Tue, Wed/);
  assert.match(scheduleSummary({ startMinute: 870, endMinute: 1020 }), /14:30–17:00/);
  // All seven days is the same as no restriction, so it is not restated.
  assert.equal(scheduleSummary({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }), "Any time");
});

check("an offer pinned to a deleted branch is called dead, not blank", () => {
  // The case this exists for: the promotion looks completely normal in a
  // list and can never fire, because the outlet it names is gone.
  assert.equal(reachSummary({ branchIds: [] }).label, "Every branch");
  assert.equal(reachSummary({ branchIds: ["a"] }, { a: "Pizza Master" }).label, "Pizza Master");
  const dead = reachSummary({ branchIds: ["gone"] }, { a: "Pizza Master" });
  assert.equal(dead.dead, true);
  assert.match(dead.note, /can never apply/);
  // Partly dead still names the live ones rather than hiding them.
  const partial = reachSummary({ branchIds: ["a", "gone"] }, { a: "Pizza Master" });
  assert.equal(partial.dead, false);
  assert.match(partial.label, /Pizza Master/);
  assert.match(partial.label, /since deleted/);
});

check("not running has five different reasons, and they are told apart", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(promotionState({ isActive: true }, now).key, "live");
  assert.equal(promotionState({ isActive: false }, now).key, "paused");
  assert.equal(promotionState({ isActive: true, usageLimit: 5, usageCount: 5 }, now).key, "used-up");
  assert.equal(promotionState({ isActive: true, startsAt: "2026-11-01" }, now).key, "scheduled");
  assert.equal(promotionState({ isActive: true, endsAt: "2026-01-01" }, now).key, "expired");
  // Switched off beats every other reason: it is the one the operator chose.
  assert.equal(promotionState({ isActive: false, endsAt: "2026-01-01" }, now).key, "paused");
});

check("a coupon's state distinguishes revoked, spent and expired", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(couponState({ isActive: true }, now).key, "live");
  assert.equal(couponState({ isActive: false }, now).key, "revoked");
  assert.equal(couponState({ isActive: true, maxRedemptions: 1, redemptionCount: 1 }, now).key, "used-up");
  assert.equal(couponState({ isActive: true, expiresAt: "2026-01-01" }, now).key, "expired");
  assert.equal(couponState({ isActive: true, startsAt: "2026-12-01" }, now).key, "scheduled");
});

check("usage reads as a fraction only when there is a limit", () => {
  assert.deepEqual(usageSummary({ used: 3 }), { label: "3 used", percent: null, exhausted: false });
  assert.deepEqual(usageSummary({ used: 3, limit: 10 }), { label: "3 of 10 used", percent: 30, exhausted: false });
  assert.equal(usageSummary({ used: 10, limit: 10 }).exhausted, true);
  // Over the cap cannot report more than full.
  assert.equal(usageSummary({ used: 99, limit: 10 }).percent, 100);
});

check("the form's rules are exactly the server's rules", () => {
  // A form that accepts what the API refuses teaches people to distrust the
  // form; one that refuses what the API accepts silently removes a feature.
  // Both sides are run over the same matrix and must agree every time.
  const cases = [
    { type: "PERCENTAGE", value: 20 },
    { type: "PERCENTAGE", value: 150 },
    { type: "PERCENTAGE", value: 0 },
    { type: "PERCENTAGE", value: 20, maxDiscountAmount: 100 },
    { type: "FIXED_AMOUNT", value: 300 },
    { type: "FIXED_AMOUNT", value: 0 },
    { type: "FIXED_AMOUNT", value: 300, maxDiscountAmount: 50 },
    { type: "BUNDLE_PRICE", value: 999 },
    { type: "BUNDLE_PRICE", value: 999, maxDiscountAmount: 10 },
    { type: "BUY_X_GET_Y", buyQuantity: 2, getQuantity: 1 },
    { type: "BUY_X_GET_Y", buyQuantity: 2 },
    { type: "BUY_X_GET_Y", getQuantity: 1 },
    { type: "BUY_X_GET_Y", buyQuantity: 1, getQuantity: 1, maxDiscountAmount: 50 },
    { type: "FREE_ITEM", getQuantity: 1 },
    { type: "FREE_ITEM" },
    { type: "FREE_DELIVERY" },
    { type: "FREE_DELIVERY", startMinute: 600 },
    { type: "FREE_DELIVERY", endMinute: 600 },
    { type: "FREE_DELIVERY", startMinute: 600, endMinute: 900 },
    { type: "FREE_DELIVERY", startMinute: 900, endMinute: 600 },
    { type: "FREE_DELIVERY", startMinute: 1380, endMinute: 1560 },
    { type: "PERCENTAGE", value: 10, startsAt: "2026-10-01", endsAt: "2026-09-01" },
    { type: "PERCENTAGE", value: 10, startsAt: "2026-09-01", endsAt: "2026-10-01" },
  ];

  for (const form of cases) {
    const clientRefused = Object.keys(coherenceProblems(form)).length > 0;

    let serverRefused = false;
    try {
      serverCoherence(form);
    } catch {
      serverRefused = true;
    }

    assert.equal(
      clientRefused,
      serverRefused,
      `the form and the API disagree about ${JSON.stringify(form)} — form ${clientRefused ? "refused" : "accepted"}, API ${serverRefused ? "refused" : "accepted"}`,
    );
  }
});

check("offers that would save and do nothing are called out", () => {
  // Legal, saveable and pointless. The server is right not to refuse these;
  // none of them produces any visible symptom afterwards either.
  assert.match(wouldNeverFire({ type: "FREE_DELIVERY", orderTypes: ["PICKUP"] })[0], /never take anything off/);
  assert.match(wouldNeverFire({ type: "BUY_X_GET_Y", targets: [] })[0], /needs at least one target/);
  assert.match(wouldNeverFire({ type: "PERCENTAGE", targets: [{ isExcluded: true }] })[0], /excludes everything/);
  assert.match(wouldNeverFire({ type: "PERCENTAGE", endsAt: "2020-01-01" })[0], /end date is in the past/);
  // A sound offer raises nothing.
  assert.deepEqual(wouldNeverFire({ type: "PERCENTAGE", value: 10, orderTypes: [], targets: [] }), []);
});

check("a code is normalised the way the server stores it", () => {
  assert.equal(normaliseCode(" save 20 "), "SAVE20");
  assert.equal(normaliseCode("save-20"), "SAVE-20");
  assert.equal(normaliseCode(null), "");
  // Characters that look alike on a printed flyer, flagged rather than banned.
  assert.equal(isHardToRead("SAVE10"), true);
  assert.equal(isHardToRead("SAVE0"), true);
  assert.equal(isHardToRead("SAVE23"), false);
  assert.equal(codeExample("SUMMER", 4), "SUMMERXXXX");
});

check("the marketing lists apply the caller's branch scope", () => {
  // A promotion carries `branchIds` — a list — so the usual single-branch
  // helper cannot express this, and a coupon code is a bearer token.
  for (const [file, fn] of [
    ["src/server/services/promotion.service.js", "listPromotions"],
    ["src/server/services/coupon.service.js", "listCoupons"],
    ["src/server/services/coupon.service.js", "revokeCampaign"],
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const body = text.slice(start, start + 1400);
    assert.match(body, /scope/, `${fn} ignores the caller's scope`);
    assert.match(body, /ScopeWhere\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("a chain-wide offer cannot be written from one branch", () => {
  // `can()` with no branch accepts any branch-pinned grant, so without this
  // a manager at one outlet could put money off at every other one.
  const access = fsForGuard.readFileSync("src/server/marketing/access.js", "utf8");
  assert.match(access, /assertCompanyWide/, "a chain-wide offer does not take a company-wide grant");

  for (const file of [
    "src/app/api/v1/admin/promotions/route.js",
    "src/app/api/v1/admin/promotions/[id]/route.js",
    "src/app/api/v1/admin/promotions/[id]/active/route.js",
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /assertPromotionReach/, `${file} does not check which branches the offer would run at`);
  }
});

check("every marketing route that names a record checks whose it is", () => {
  const guarded = [
    ["src/app/api/v1/admin/promotions/[id]/route.js", /assertPromotionAccess/],
    ["src/app/api/v1/admin/promotions/[id]/active/route.js", /assertPromotionAccess/],
    ["src/app/api/v1/admin/coupons/[id]/route.js", /assertCouponAccess/],
    ["src/app/api/v1/admin/coupons/[id]/redemptions/route.js", /assertCouponAccess/],
    ["src/app/api/v1/admin/coupons/route.js", /assertPromotionAccess/],
    ["src/app/api/v1/admin/coupons/generate/route.js", /assertPromotionAccess/],
  ];
  for (const [file, pattern] of guarded) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, pattern, `${file} names a record without checking whose it is`);
  }
});

check("every nav item in Marketing that is built has a page behind it", () => {
  const marketing = DASHBOARD_NAV.find((section) => section.id === "marketing");
  assert.ok(marketing, "the Marketing section is gone from the nav");
  for (const item of marketing.items.filter((row) => ["Promotions", "Coupons"].includes(row.label))) {
    const route = item.href.replace("/dashboard", "src/app/(dashboard)/dashboard");
    assert.ok(fsForGuard.existsSync(`${route}/page.js`), `${item.href} has no page`);
  }
});

// --- decimal places: the column's precision, not a float's -------------------

const { fitsScale } = await import("@/lib/money-math");
const { moneySchema, deltaSchema } = await import("@/server/validation/catalog.schemas");
const { amountSchema } = await import("@/server/validation/finance.schemas");
const { quantitySchema: inventoryQuantitySchema } = await import("@/server/validation/inventory.schemas");

check("ordinary two-decimal prices are accepted, every one of them", () => {
  // The whole grid, not a handful of samples. The old check multiplied by
  // 10_000 in floating point and rejected 112,605 of these — 11% of every
  // price a restaurant can type, including 0.07 and 2499.99.
  const rejected = [];
  for (let i = 0; i < 1_000_000; i++) {
    const price = i / 100;
    if (!fitsScale(price, 4)) rejected.push(price);
    if (rejected.length > 4) break;
  }
  assert.deepEqual(rejected, [], "a plain two-decimal price was rejected as having too many decimals");
});

check("four-decimal values are accepted and a fifth place is refused", () => {
  for (let i = 0; i < 100_000; i++) assert.ok(fitsScale(i / 10_000, 4));
  assert.equal(fitsScale(1.00001, 4), false);
  assert.equal(fitsScale(0.000001, 4), false);
  assert.equal(fitsScale(1.2345678, 6), false);
  assert.equal(fitsScale(1.234567, 6), true);
});

check("a value with no honest decimal representation is refused", () => {
  assert.equal(fitsScale(Number.NaN, 4), false);
  assert.equal(fitsScale(Number.POSITIVE_INFINITY, 4), false);
  // 1e-7 is below the column's last digit; rounding it to 4 places loses it
  // entirely, so it is a bad price rather than a small one.
  assert.equal(fitsScale(1e-7, 4), false);
  assert.equal(fitsScale(0.1 + 0.2, 4), false);
});

check("the price schemas themselves take the prices that were being refused", () => {
  for (const price of [0.07, 0.14, 0.17, 0.28, 2499.99, 56.03]) {
    assert.ok(moneySchema.safeParse(price).success, `moneySchema refused ${price}`);
    assert.ok(deltaSchema.safeParse(-price).success, `deltaSchema refused -${price}`);
  }
  assert.equal(moneySchema.safeParse(1.00001).success, false);
  assert.equal(moneySchema.safeParse(-1).success, false);
});

check("the amount schemas still refuse what they are there to refuse", () => {
  // These two read `Number.isInteger(Math.round(value * 10_000))`, which is
  // true for every finite number — a validator that validated nothing, and
  // let a fifth decimal place through to be silently rounded by Postgres.
  assert.equal(amountSchema.safeParse(1.23456789).success, false);
  assert.equal(amountSchema.safeParse(1.2345).success, true);
  assert.equal(inventoryQuantitySchema.safeParse(0.1234567).success, false);
  assert.equal(inventoryQuantitySchema.safeParse(0.123456).success, true);
});


// ===========================================================================
// The creator programme
// ===========================================================================

const {
  strikeOutlook,
  attemptsLeft,
  rejectionCost,
  videoActions,
  conversionRate,
  engagementRate,
  earningActions,
  holdProgress,
  costVerdict,
  rewardSummary,
  conditionList: ruleConditions,
  reachSummary: ruleReach,
  ruleState,
  budgetUse,
  specificityLabel,
  ruleProblems,
  ruleWarnings,
  rulePayload,
  disqualificationHint,
} = await import("@/lib/creator");
const { assertRuleIsCoherent: serverRuleCoherence } = await import("@/server/services/creator-commission.service");
const { earningScopeWhere } = await import("@/server/creator/access");
const { createRuleSchema } = await import("@/server/validation/creator.schemas");
const { addCartItemSchema } = await import("@/server/validation/ordering.schemas");
const { productScopeWhere, reachesProduct } = await import("@/server/catalog/access");
const { videoScopeWhere, creatorScopeWhere } = await import("@/server/creator/access");
const { addressProblems, addressPayload, orderProgress, needsAction, canCancel } = await import("@/lib/account");
const { addressSchema } = await import("@/server/validation/schemas");
const { standingFor: serverStanding } = await import("@/server/creator/strikes");

const payout = { formatMoney: (value) => `PKR ${Number(value).toFixed(2)}` };

check("the form's rule errors mirror the commission engine's", () => {
  // Same contract as the promotions mirror above, and it matters more here:
  // this form writes a rule that pays real money on every matching order.
  const cases = [
    { rewardType: "PERCENTAGE", rewardValue: 10 },
    { rewardType: "PERCENTAGE", rewardValue: 0 },
    { rewardType: "PERCENTAGE", rewardValue: 100 },
    { rewardType: "PERCENTAGE", rewardValue: 100.5 },
    { rewardType: "PERCENTAGE", rewardValue: -5 },
    { rewardType: "PERCENTAGE", rewardValue: 10, basis: "ORDER_TOTAL" },
    { rewardType: "PERCENTAGE", rewardValue: 10, maxRewardAmount: 500 },
    { rewardType: "PERCENTAGE", rewardValue: 10, maxRewardAmount: 0 },
    { rewardType: "FIXED", rewardValue: 200 },
    { rewardType: "FIXED", rewardValue: 0 },
    { rewardType: "FIXED", rewardValue: 200, basis: "ATTRIBUTED_LINE" },
    { rewardType: "FIXED", rewardValue: 200, basis: "ORDER_TOTAL" },
    { rewardType: "FIXED", rewardValue: 200, basis: "ORDER_SUBTOTAL" },
    { rewardType: "PERCENTAGE", rewardValue: 10, totalBudget: 10000 },
    { rewardType: "PERCENTAGE", rewardValue: 10, totalBudget: 0 },
    { rewardType: "PERCENTAGE", rewardValue: 10, startsAt: "2026-10-01", endsAt: "2026-09-01" },
    { rewardType: "PERCENTAGE", rewardValue: 10, startsAt: "2026-09-01", endsAt: "2026-10-01" },
  ];

  for (const form of cases) {
    const clientRefused = ruleProblems(form).length > 0;

    let serverRefused = false;
    try {
      serverRuleCoherence(form);
    } catch {
      serverRefused = true;
    }

    assert.equal(
      clientRefused,
      serverRefused,
      `the form and the commission engine disagree about ${JSON.stringify(form)} — form ${clientRefused ? "refused" : "accepted"}, engine ${serverRefused ? "refused" : "accepted"}`,
    );
  }
});

check("what the next strike would do matches the engine that does it", () => {
  // The screen warns "one more point bans them"; the server decides whether
  // it actually does. Run both over the same thresholds.
  const thresholds = { suspendAtStrikePoints: 3, banAtStrikePoints: 5 };
  for (let points = 0; points <= 7; points++) {
    const shown = strikeOutlook({ points, ...thresholds });
    const actual = serverStanding({ points, ...thresholds }).status;
    assert.equal(shown.standing, actual, `at ${points} points the screen says ${shown.standing}, the engine says ${actual}`);
  }
});

check("a moderator is told what rejecting costs before they do it", () => {
  // Four of five used: one left, and rejecting it is final.
  assert.match(rejectionCost({ rejectionCount: 4 }, { maxUploadAttempts: 5 }).sentence, /last attempt/);
  assert.equal(rejectionCost({ rejectionCount: 4 }, { maxUploadAttempts: 5 }).tone, "bad");
  // Plenty left: say how many would remain, not how many are used.
  assert.match(rejectionCost({ rejectionCount: 1 }, { maxUploadAttempts: 5 }).sentence, /3 attempts left/);
  // Already locked.
  assert.match(rejectionCost({ rejectionCount: 5, isLocked: true }).sentence, /already locked/);
  assert.equal(attemptsLeft({ rejectionCount: 2, maxUploadAttempts: 5 }), 3);
  assert.equal(attemptsLeft({ rejectionCount: 9, maxUploadAttempts: 5 }), 0);
  assert.equal(attemptsLeft({ rejectionCount: 0, isLocked: true }), 0);
});

check("only the actions a video's state allows are offered", () => {
  assert.deepEqual(videoActions({ status: "PENDING_REVIEW" }), {
    canApprove: true, canReject: true, canTakeDown: false, canReinstate: false, canFeature: false,
  });
  // A live video cannot be approved again, but can still be pulled.
  assert.deepEqual(videoActions({ status: "APPROVED" }), {
    canApprove: false, canReject: true, canTakeDown: true, canReinstate: false, canFeature: true,
  });
  assert.deepEqual(videoActions({ status: "TAKEN_DOWN" }), {
    canApprove: false, canReject: false, canTakeDown: false, canReinstate: true, canFeature: false,
  });
  // Locked is terminal in every direction.
  const locked = videoActions({ status: "LOCKED" });
  assert.equal(Object.values(locked).some(Boolean), false);
});

check("a rate needs enough views to mean anything", () => {
  // One view and one add-to-cart is not a 100% conversion rate, and treating
  // it as one puts every brand-new video at the top of the sort.
  assert.equal(conversionRate({ viewCount: 1, addToCartCount: 1 }), null);
  assert.equal(engagementRate({ viewCount: 3, likeCount: 3 }), null);
  assert.equal(conversionRate({ viewCount: 100, addToCartCount: 12 }), 12);
  assert.equal(engagementRate({ viewCount: 200, likeCount: 10, shareCount: 10 }), 10);
});

check("an earning can only be acted on from the states that allow it", () => {
  assert.deepEqual(earningActions({ status: "CREDITED" }), { canReverse: true, canReject: false });
  assert.deepEqual(earningActions({ status: "PENDING" }), { canReverse: false, canReject: true });
  assert.deepEqual(earningActions({ status: "APPROVED" }), { canReverse: false, canReject: true });
  // Nothing to do to a sale that never paid, or one already clawed back.
  assert.deepEqual(earningActions({ status: "NOT_QUALIFIED" }), { canReverse: false, canReject: false });
  assert.deepEqual(earningActions({ status: "REVERSED" }), { canReverse: false, canReject: false });
});

check("the refund hold is described only while there is one", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  assert.equal(holdProgress({ status: "CREDITED", availableAt: "2026-10-01" }, now), null);
  assert.equal(holdProgress({ status: "PENDING" }, now), null);
  assert.equal(holdProgress({ status: "PENDING", availableAt: "2026-10-07T00:00:00Z" }, now).daysLeft, 3);
  // Past its date but not yet credited: the job has not run, and saying
  // "0 days left" would read as though something is stuck.
  assert.match(holdProgress({ status: "PENDING", availableAt: "2026-10-01" }, now).sentence, /Hold is over/);
});

check("the programme's cost is given a verdict, not just a number", () => {
  assert.equal(costVerdict(null).tone, "quiet");
  assert.equal(costVerdict(3).tone, "good");
  assert.equal(costVerdict(10).tone, "live");
  assert.equal(costVerdict(15).tone, "warn");
  assert.equal(costVerdict(45).tone, "bad");
});

check("a rule says what it pays in words", () => {
  assert.equal(rewardSummary({ rewardType: "PERCENTAGE", rewardValue: 10, basis: "ATTRIBUTED_LINE" }, payout),
    "10% of the attributed line");
  assert.equal(rewardSummary({ rewardType: "PERCENTAGE", rewardValue: 5, basis: "ORDER_TOTAL", maxRewardAmount: 500 }, payout),
    "5% of the order total, capped at PKR 500.00");
  assert.equal(rewardSummary({ rewardType: "FIXED", rewardValue: 200 }, payout), "PKR 200.00 per attributed line");
});

check("a rule's conditions are listed, including the ones that are easy to miss", () => {
  const list = ruleConditions(
    { minOrderAmount: 2000, conditionBasis: "ORDER_TOTAL", minLineQuantity: 2, channels: ["WEB"], creatorId: "c1" },
    payout,
  );
  assert.match(list[0], /order total is at least PKR 2000.00/);
  assert.match(list[1], /at least 2 of the item/);
  assert.match(list[2], /web/);
  assert.match(list[3], /one named creator/);
  assert.deepEqual(ruleConditions({}, payout), []);
});

check("an empty branch list on a rule is called what it is", () => {
  // The dangerous default: empty means everywhere, and it pays money.
  const everywhere = ruleReach({ branchIds: [] }, { b1: "Gulberg" });
  assert.equal(everywhere.label, "Every branch");
  assert.equal(everywhere.tone, "warn");
  assert.match(everywhere.note, /opened later/);
  // A rule pinned to a branch that is gone can never match.
  const dead = ruleReach({ branchIds: ["gone"] }, { b1: "Gulberg" });
  assert.equal(dead.tone, "bad");
  assert.match(dead.note, /never match/);
  // Partly dead is still usable, but say so.
  const partial = ruleReach({ branchIds: ["b1", "gone"] }, { b1: "Gulberg" });
  assert.equal(partial.label, "Gulberg");
  assert.match(partial.note, /no longer exist/);
  assert.equal(ruleReach({ branchIds: ["b1"] }, { b1: "Gulberg" }).tone, "quiet");
});

check("a rule that has spent its budget is not shown as live", () => {
  const now = new Date("2026-10-04T00:00:00Z");
  assert.equal(ruleState({ isActive: false }, now).label, "Off");
  assert.equal(ruleState({ isActive: true, startsAt: "2026-11-01" }, now).label, "Scheduled");
  assert.equal(ruleState({ isActive: true, endsAt: "2026-09-01" }, now).label, "Ended");
  assert.equal(ruleState({ isActive: true, totalBudget: 1000, budgetSpent: 1000 }, now).label, "Budget spent");
  assert.equal(ruleState({ isActive: true }, now).label, "Live");

  assert.equal(budgetUse({ totalBudget: null }), null);
  assert.equal(budgetUse({ totalBudget: 1000, budgetSpent: 250 }).percent, 25);
  assert.equal(budgetUse({ totalBudget: 1000, budgetSpent: 2000 }).percent, 100);
  assert.equal(budgetUse({ totalBudget: 1000, budgetSpent: 1000 }).exhausted, true);
});

check("why one rule beats another is visible on the rule", () => {
  assert.equal(specificityLabel({ creatorId: "c1" }), "One creator");
  assert.equal(specificityLabel({ targets: [{ targetType: "PRODUCT" }] }), "Product");
  assert.equal(specificityLabel({ targets: [{ targetType: "CATEGORY" }] }), "Category");
  // An exclusion is not what the rule targets.
  assert.equal(specificityLabel({ targets: [{ targetType: "PRODUCT", isExcluded: true }] }), "Everything");
  assert.equal(specificityLabel({ targets: [] }), "Everything");
});

check("rules that are legal but probably a mistake are warned about, not blocked", () => {
  const warnings = ruleWarnings({ rewardType: "PERCENTAGE", rewardValue: 30, branchIds: [] });
  assert.ok(warnings.some((w) => /large share of a food margin/.test(w)));
  assert.ok(warnings.some((w) => /No ceiling/.test(w)));
  assert.ok(warnings.some((w) => /every branch/.test(w)));
  assert.ok(warnings.some((w) => /until somebody switches it off/.test(w)));
  // None of these is a validation error.
  assert.deepEqual(ruleProblems({ rewardType: "PERCENTAGE", rewardValue: 30, branchIds: [] }), []);
});

check("the payload drops what the reward type does not use", () => {
  // A fixed reward with a basis is exactly what the server rejects, so the
  // form must not be able to send one even if the field kept an old value.
  const body = rulePayload({
    name: "  Flat 200  ", rewardType: "FIXED", rewardValue: 200, basis: "ORDER_TOTAL",
    maxRewardAmount: 500, conditionBasis: "ORDER_TOTAL", minOrderAmount: "", minLineQuantity: "",
    branchIds: [], channels: [], orderTypes: [], priority: 0, isActive: true, totalBudget: "",
  });
  assert.equal(body.name, "Flat 200");
  assert.equal(body.basis, "ATTRIBUTED_LINE");
  assert.equal("maxRewardAmount" in body, false, "a ceiling means nothing on a fixed reward");
  assert.equal("minOrderAmount" in body, false, "an empty box is not a zero threshold");
  assert.equal("totalBudget" in body, false);
  // And the server agrees with what we built.
  serverRuleCoherence(body);
});

// Every schema a route validates a *query* with, loaded once so the sync
// check below can scan them.
const querySchemaNames = new Set();
{
  const walk = (dir) => {
    for (const entry of fsForGuard.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "route.js") {
        for (const m of fsForGuard.readFileSync(full, "utf8").matchAll(/query:\s*([A-Za-z0-9_]+)/g)) {
          if (m[1] !== "z") querySchemaNames.add(m[1]);
        }
      }
    }
  };
  walk("src/app/api");
}

const loadedQuerySchemas = new Map();
for (const file of fsForGuard.readdirSync("src/server/validation")) {
  if (!file.endsWith(".js")) continue;
  const mod = await import(`@/server/validation/${file.replace(/\.js$/, "")}`);
  for (const [name, value] of Object.entries(mod)) {
    if (querySchemaNames.has(name) && value?.safeParse) loadedQuerySchemas.set(name, value);
  }
}

check("no query schema demands a number, because a query is always strings", () => {
  // A query parameter arrives as a string. A schema built on the shared
  // body-side `z.number()` therefore rejects *every* call the endpoint can
  // receive — not some, every one. `redeemQuoteSchema` did exactly that, so
  // store credit could never be quoted at checkout, and nothing failed
  // loudly enough for anybody to notice.
  assert.ok(loadedQuerySchemas.size > 50, `only resolved ${loadedQuerySchemas.size} query schemas — the scan is not finding them`);

  const broken = [];
  for (const [name, schema] of loadedQuerySchemas) {
    const raw = schema._def?.shape ?? schema.shape;
    const shape = typeof raw === "function" ? raw() : raw;
    if (!shape) continue;
    for (const [field, sub] of Object.entries(shape)) {
      if (!sub?.safeParse) continue;
      // Only a field that takes the number but refuses its string form.
      if (sub.safeParse(5).success && !sub.safeParse("5").success) broken.push(`${name}.${field}`);
    }
  }
  assert.deepEqual(broken, [], `these query fields can never be satisfied by a real request: ${broken.join(", ")}`);
});

check("the address form's rules are the server's rules", () => {
  // The same contract as the promotions and commission-rule mirrors. This one
  // was already wrong when written: the form treated state and postal code as
  // optional and sent a null label, all three of which `addressSchema`
  // refuses — so every save would have failed after the person filled the
  // whole form in.
  const base = {
    recipientName: "Ayesha",
    phone: "+923001234567",
    line1: "12 Jinnah Road",
    city: "Karachi",
    state: "Sindh",
    postalCode: "75500",
  };
  const cases = [
    base,
    { ...base, label: "Home" },
    { ...base, label: "" },
    { ...base, state: "" },
    { ...base, postalCode: "" },
    { ...base, postalCode: "12" },
    { ...base, line1: "abc" },
    { ...base, city: "" },
    { ...base, phone: "" },
    { ...base, recipientName: "A" },
    { ...base, line2: "Flat 4", landmark: "By the mosque", deliveryNote: "Ring twice" },
  ];

  for (const form of cases) {
    const clientRefused = addressProblems(form).length > 0;
    const serverRefused = !addressSchema.safeParse(addressPayload(form)).success;
    assert.equal(
      clientRefused,
      serverRefused,
      `the form and the API disagree about ${JSON.stringify(form)} — form ${clientRefused ? "refused" : "accepted"}, API ${serverRefused ? "refused" : "accepted"}`,
    );
  }
});

check("a customer is told what is happening, not what the kitchen calls it", () => {
  // The staff vocabulary is right for a dashboard and wrong for the person
  // waiting: they want to know whether anything is expected of them.
  assert.match(orderProgress({ status: "PREPARING" }).label, /cooked/i);
  assert.match(orderProgress({ status: "READY", type: "DELIVERY" }).label, /rider/i);
  assert.match(orderProgress({ status: "READY", type: "PICKUP" }).label, /collect/i);
  assert.match(orderProgress({ status: "REJECTED" }).label, /could not take it/i);
  assert.equal(orderProgress({ status: "COMPLETED" }).tone, "good");

  // An unpaid order the restaurant is waiting on is the one thing on the
  // screen that costs somebody a meal if they miss it.
  assert.equal(needsAction({ paymentState: "UNPAID", status: "CONFIRMED" })?.action, "pay");
  assert.equal(needsAction({ paymentState: "FAILED", status: "PENDING" })?.action, "pay");
  // Nothing outstanding on a finished or already-paid order.
  assert.equal(needsAction({ paymentState: "PAID", status: "COMPLETED" }), null);
  assert.equal(needsAction({ paymentState: "UNPAID", status: "CANCELLED" }), null);

  // Cancelling is offered only while it could actually work.
  assert.equal(canCancel({ status: "PENDING" }), true);
  assert.equal(canCancel({ status: "PREPARING" }), false);
});

check("a creator can actually upload the video they are allowed to make", () => {
  // `self.manage_own_videos` lets a creator create the record and submit it,
  // but attaching the file goes through the media endpoints, which take
  // `media.upload`. Without it the record can never get a video on it — the
  // one step the whole programme depends on. Phase 13 did not catch this
  // because it fabricates the asset URL and calls attachAsset directly.
  const roles = fsForGuard.readFileSync("prisma/seeds/roles.js", "utf8");
  const start = roles.indexOf('key: "creator"');
  assert.notEqual(start, -1, "the creator role is gone");
  const body = roles.slice(start, roles.indexOf("},", roles.indexOf("permissions:", start)));
  assert.match(body, /self\.manage_own_videos/, "a creator cannot manage their own videos");
  assert.match(body, /media\.upload/, "a creator may make a video but not upload one");
});

check("a customer can find the creator programme before they join it", () => {
  // The invitation lived behind `self.view_creator_dashboard`, which only a
  // creator holds — so the page that asks you to join was reachable only once
  // you had joined, and the programme was invisible to everybody it is for.
  const studio = ACCOUNT_NAV.flatMap((section) => section.items).find(
    (item) => item.href === "/account/creator",
  );
  assert.ok(studio, "the creator studio link is gone from the account nav");

  const customerKeys = new Set([
    "self.view_profile", "self.update_profile", "self.manage_addresses",
    "self.manage_notifications", "self.manage_devices", "self.place_order",
    "self.view_own_orders", "self.cancel_own_order", "self.review_own_order",
    "self.become_creator",
  ]);
  assert.equal(canSeeItem(studio, customerKeys), true, "a plain customer cannot see the creator studio link");

  const creatorKeys = new Set([...customerKeys, "self.view_creator_dashboard", "self.manage_own_videos"]);
  assert.equal(canSeeItem(studio, creatorKeys), true, "a creator cannot see their own studio link");

  // And somebody with neither — staff who are not customers — still does not.
  assert.equal(canSeeItem(studio, new Set(["orders.read"])), false);
});

check("every account nav item has a page behind it", () => {
  for (const section of ACCOUNT_NAV) {
    for (const item of section.items) {
      const route = item.href.replace("/account", "src/app/(account)/account");
      assert.ok(fsForGuard.existsSync(`${route}/page.js`), `${item.href} has no page`);
    }
  }
});

check("a product with no branch is the chain's, and one with a branch is not", () => {
  // The whole design rests on null meaning "every outlet", not "unset". Get
  // that backwards and either the chain's menu vanishes from every branch or
  // one outlet's private item appears on all of them.
  const scope = { all: false, ids: ["mine"] };

  // Scoped: own branch plus the chain's.
  assert.deepEqual(productScopeWhere(scope), {
    OR: [{ branchId: { in: ["mine"] } }, { branchId: null }],
  });
  // Unrestricted: no clause at all, so a single-branch install pays nothing.
  assert.deepEqual(productScopeWhere({ all: true }), {});
  assert.deepEqual(productScopeWhere(null), {});
  // A carve-out is still a restriction.
  assert.deepEqual(productScopeWhere({ all: true, except: ["gone"] }), {
    OR: [{ branchId: { notIn: ["gone"] } }, { branchId: null }],
  });
});

check("reaching a product follows who owns it", () => {
  // Chain-wide items are readable by anyone holding the permission anywhere:
  // what the company sells is not a secret from its own managers, and the
  // answer is settled before their scope is even consulted.
  assert.equal(reachesProduct({ isSuperAdmin: false }, null, "products.read"), true);
  assert.equal(reachesProduct({ isSuperAdmin: true }, "anything", "products.read"), true);
});

check("writing a chain-wide product takes a company-wide grant", () => {
  // Same test a chain-wide promotion gets, and for the same reason: it
  // changes what every outlet sells, including outlets opened later.
  const access = fsForGuard.readFileSync("src/server/catalog/access.js", "utf8");
  assert.match(access, /assertCompanyWide/, "a chain-wide product does not take a company-wide grant");

  const service = fsForGuard.readFileSync("src/server/services/product.service.js", "utf8");
  for (const fn of ["createProduct", "updateProduct"]) {
    const start = service.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing`);
    const after = service.indexOf("\nexport ", start + 1);
    const body = service.slice(start, after === -1 ? service.length : after);
    assert.match(body, /assertProductReach/, `${fn} does not check which branch the product would belong to`);
  }
});

check("the catalogue lists apply the caller's branch scope", () => {
  for (const [file, fn] of [
    ["src/server/services/product.service.js", "listProducts"],
    ["src/server/services/product.service.js", "getProduct"],
    ["src/server/services/creator-video.service.js", "listVideos"],
    ["src/server/services/creator-video.service.js", "reviewQueue"],
    ["src/server/services/creator.service.js", "listCreators"],
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    const after = text.indexOf("\nexport ", start + 1);
    const body = text.slice(start, after === -1 ? text.length : after);
    assert.match(body, /scope/, `${fn} ignores the caller's scope`);
    assert.match(body, /ScopeWhere\(scope\)/, `${fn} never turns the scope into a filter`);
  }
});

check("a video reaches exactly as far as the outlet it was filmed at", () => {
  // Reversed twice, and this is the end of it. Videos were first treated as
  // chain-wide because Product carried no branch; then they followed the
  // product, which made a chain-wide item's video chain-wide again. A video is
  // one person's meal at one outlet, so it carries its own branch and a
  // manager moderates only what was filmed at theirs.
  const scope = { all: false, ids: ["mine"] };
  assert.deepEqual(videoScopeWhere(scope), { branchId: { in: ["mine"] } });
  assert.deepEqual(videoScopeWhere({ all: true }), {});
  assert.deepEqual(videoScopeWhere(null), {});
  // A creator is visible once they have filmed something at your outlet.
  assert.deepEqual(creatorScopeWhere(scope), { videos: { some: videoScopeWhere(scope) } });
  assert.deepEqual(creatorScopeWhere(null), {});
});

check("a single-restaurant installation is never asked which branch", () => {
  // The question has one possible answer, so the field is left out rather
  // than shown pre-filled on every product anybody ever creates.
  const admin = fsForGuard.readFileSync("src/server/content/product-admin.js", "utf8");
  assert.match(admin, /branches\.length > 1/, "the product form offers a branch even with one outlet");

  const form = fsForGuard.readFileSync("src/components/dashboard/products/ProductDetailsForm.js", "utf8");
  assert.match(form, /options\.branches\?\.length \?/, "the form renders the branch field unconditionally");
});

check("the cart carries what the attribution engine reads off it", () => {
  // Pressing add-to-cart on a video is the only thing that creates an
  // attribution; watching one never does. `addItem` has always read
  // `creatorVideoId` off its input, but the schema did not declare it — and
  // an undeclared field is stripped before the service sees it, so that
  // branch was unreachable and the programme earned nothing from the web or
  // the app. Read off the service rather than restated, so the two cannot
  // drift apart again.
  const service = fsForGuard.readFileSync("src/server/services/cart.service.js", "utf8");
  const start = service.indexOf("export async function addItem(");
  assert.notEqual(start, -1, "addItem is gone");
  const after = service.indexOf("\nexport ", start + 1);
  const body = service.slice(start, after === -1 ? service.length : after);

  const read = [...body.matchAll(/input\.(creator[A-Za-z]+)/g)].map((match) => match[1]);
  assert.ok(read.length, "addItem no longer reads any creator field");

  for (const field of new Set(read)) {
    assert.ok(
      addCartItemSchema.shape[field],
      `addItem reads input.${field} but the cart schema does not accept it, so it is stripped before arriving`,
    );
  }
});

check("a commission rule's channels and order types are the database's", () => {
  // Read out of the schema rather than written down here, because a plausible
  // copy is exactly what went wrong: the rule validator accepted `APP`,
  // `QR_TABLE`, `KIOSK`, `THIRD_PARTY` and `TAKEAWAY`, none of which exist,
  // and rejected `MOBILE_APP`, `QR` and `AGGREGATOR`, which do. `channels` is
  // a real Postgres enum column, so a rule naming the mobile app could not be
  // saved at all and four of the accepted values failed against the column.
  const prismaSchema = fsForGuard.readFileSync("prisma/schema/04-ordering.prisma", "utf8");
  const valuesOf = (name) => {
    const match = prismaSchema.match(new RegExp(`enum ${name} \\{([^}]*)\\}`));
    assert.ok(match, `${name} is gone from the schema`);
    return match[1]
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, "").trim())
      .filter(Boolean)
      .sort();
  };

  const accepts = (schema, value) => schema.safeParse([value]).success;
  for (const channel of valuesOf("OrderChannel")) {
    assert.ok(accepts(createRuleSchema.shape.channels, channel), `a rule cannot be restricted to ${channel}`);
  }
  for (const type of valuesOf("OrderType")) {
    assert.ok(accepts(createRuleSchema.shape.orderTypes, type), `a rule cannot be restricted to ${type}`);
  }
  // And nothing that is not in the database is accepted.
  for (const fake of ["APP", "QR_TABLE", "KIOSK", "THIRD_PARTY"]) {
    assert.equal(accepts(createRuleSchema.shape.channels, fake), false, `${fake} is not an order channel`);
  }
  assert.equal(accepts(createRuleSchema.shape.orderTypes, "TAKEAWAY"), false, "TAKEAWAY is not an order type");
});

check("the creator money lists apply the caller's branch scope", () => {
  // An earning is a cost booked against one branch's completed order, and
  // `creator_earnings.read` sits on the accountant role — precisely the one
  // an operator pins to a single outlet.
  for (const [file, fn] of [
    ["src/server/services/creator-earning.service.js", "listEarnings"],
    ["src/server/services/creator-earning.service.js", "earningsSummary"],
    ["src/server/services/creator-commission.service.js", "listRules"],
    ["src/server/services/creator-dashboard.service.js", "programOverview"],
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    const start = text.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing from ${file}`);
    // Cut at the next top-level declaration, not at a character count. A
    // fixed-size window runs past the end of a short function into the next
    // one — which here also applies the scope, so deleting the filter from
    // this function left the check passing. Found by deleting it.
    const after = text.indexOf("\nexport ", start + 1);
    const body = text.slice(start, after === -1 ? text.length : after);
    assert.match(body, /scope/, `${fn} ignores the caller's scope`);
    assert.match(body, /ScopeWhere\(scope/, `${fn} never turns the scope into a filter`);
  }
});

check("a branch filter cannot widen what the scope allows", () => {
  // Both the scope clause and a requested branch key on `order`, so spreading
  // one over the other drops the scope entirely and the "filter" returns the
  // whole company. The two are resolved together in one helper for exactly
  // this reason; this pins the behaviour rather than the shape.
  const scope = { all: false, ids: ["mine"] };

  // In scope: narrows to that branch.
  assert.deepEqual(earningScopeWhere(scope, "mine"), { order: { branchId: "mine" } });
  // Out of scope: matches nothing, rather than silently dropping the scope.
  assert.deepEqual(earningScopeWhere(scope, "theirs"), { order: { branchId: { in: [] } } });
  // No filter asked for: the scope still applies.
  assert.deepEqual(earningScopeWhere(scope), { order: { branchId: { in: ["mine"] } } });
  // Unrestricted caller, no filter: no clause at all.
  assert.deepEqual(earningScopeWhere({ all: true }), {});
  // Unrestricted caller with a carve-out may not reach the carved-out branch.
  assert.deepEqual(earningScopeWhere({ all: true, except: ["gone"] }, "gone"), { order: { branchId: { in: [] } } });
});

check("a chain-wide commission rule cannot be written from one branch", () => {
  // The sharpest case in the programme: a rule saved with an empty branch
  // list pays out on every order in the company, for ever. `can()` with no
  // branch accepts any branch-pinned grant, so without this a manager at one
  // outlet could write it.
  const access = fsForGuard.readFileSync("src/server/creator/access.js", "utf8");
  assert.match(access, /assertCompanyWide/, "a chain-wide rule does not take a company-wide grant");

  const service = fsForGuard.readFileSync("src/server/services/creator-commission.service.js", "utf8");
  for (const fn of ["createRule", "updateRule", "deleteRule"]) {
    const start = service.indexOf(`export async function ${fn}(`);
    assert.notEqual(start, -1, `${fn} is missing`);
    assert.match(
      service.slice(start, start + 900),
      /assertRuleReach/,
      `${fn} does not check which branches the rule would pay at`,
    );
  }
});

check("publishing a video is gated by the branch it was filmed at", () => {
  // Reversed deliberately. This used to follow the *product*, which made a
  // video of a chain-wide item a chain-wide decision — and, on the storefront,
  // a chain-wide video. A video is one person's meal at one outlet, so it now
  // carries that outlet and reaches exactly as far as it does.
  // Rejecting and taking down are still not gated this way — both only ever
  // make the storefront smaller.
  const video = fsForGuard.readFileSync("src/server/services/creator-video.service.js", "utf8");
  const review = video.indexOf("export async function reviewVideo(");
  assert.notEqual(review, -1);
  assert.match(
    video.slice(review, review + 1200),
    /if \(decision === "APPROVED"\) await assertPublishReach/,
    "approving a video is not gated on the product's reach",
  );

  const reinstate = video.indexOf("export async function reinstateVideo(");
  assert.match(video.slice(reinstate, reinstate + 400), /assertPublishReach/, "reinstating republishes");

  const engagement = fsForGuard.readFileSync("src/server/services/creator-engagement.service.js", "utf8");
  const feature = engagement.indexOf("export async function setFeaturedRank(");
  assert.match(engagement.slice(feature, feature + 400), /assertPublishReach/, "pinning a video republishes too");

  // And the gate reads the video's own branch rather than its product's.
  const access = fsForGuard.readFileSync("src/server/creator/access.js", "utf8");
  const gate = access.indexOf("export async function assertPublishReach(");
  assert.notEqual(gate, -1, "assertPublishReach is gone");
  const body = access.slice(gate, access.indexOf("\nexport ", gate + 1));
  assert.match(body, /select: \{ id: true, branchId: true \}/, "the publish gate no longer reads the video's branch");
  assert.doesNotMatch(body, /assertProductReach/, "the publish gate is back on the product's reach");
});

check("a video is shown at the outlet it was filmed at and nowhere else", () => {
  // The feed had no branch condition at all, so every approved video in the
  // business went to every visitor: a clip filmed in one city on the storefront
  // of an outlet in another, for an item that outlet may not even sell.
  const feed = fsForGuard.readFileSync("src/server/services/creator-engagement.service.js", "utf8");
  const start = feed.indexOf("export async function videoFeed(");
  assert.notEqual(start, -1, "videoFeed is gone");
  const body = feed.slice(start, feed.indexOf("\nexport ", start + 1));
  assert.match(body, /branchId: branch,/, "the public feed is not filtered by branch");
  assert.match(body, /resolveFeedBranch\(branchId\)/, "the feed no longer resolves a branch");

  // One resolver for both public surfaces, so they cannot drift.
  const resolver = feed.indexOf("async function resolveFeedBranch(");
  const resolverBody = feed.slice(resolver, feed.indexOf("\n}", resolver));
  assert.match(resolverBody, /soleBranchId\(\)/, "a single-restaurant install should not be asked which branch");

  // No outlet chosen means an empty shelf, never the whole company. The
  // storefront can be browsed before a branch is picked, and that is exactly
  // the path the original leak came down.
  assert.match(body, /if \(!branch\) return toPage\(\[\], limit\);/, "the browse feed serves everything with no branch");

  // The product page is the surface the whole rule exists for, and it had the
  // same hole: an outlet that does not even sell the item still carried a
  // stranger's video of it.
  const forProduct = feed.indexOf("export async function videosForProduct(");
  const productBody = feed.slice(forProduct, feed.indexOf("\nexport ", forProduct + 1));
  assert.match(productBody, /branchId: branch,/, "the product page feed is not filtered by branch");
  assert.match(productBody, /resolveFeedBranch/);
  assert.match(productBody, /if \(!branch\) return \[\];/, "the product page serves everything with no branch");

  // A creator's own page is about a person rather than a shelf, so it narrows
  // by branch when the caller knows one and does not demand it otherwise.
  assert.match(feed, /export async function videosByCreator\(/);

  // The column is the source of truth, and it is required: there is no
  // "the whole chain filmed this" the way there is for a product.
  const schema = fsForGuard.readFileSync("prisma/schema/13-creator-program.prisma", "utf8");
  const model = schema.slice(schema.indexOf("model CreatorVideo {"));
  assert.match(model.slice(0, model.indexOf("}")), /branchId {2,}String\n/, "CreatorVideo.branchId is missing or nullable");

  // Creation copies it off the order, never off the product.
  const service = fsForGuard.readFileSync("src/server/services/creator-video.service.js", "utf8");
  assert.match(service, /branchId: orderItem\.order\.branchId/);

  // And the scope cut reads that column rather than reaching through a product.
  const access = fsForGuard.readFileSync("src/server/creator/access.js", "utf8");
  const scope = access.indexOf("export function videoScopeWhere(");
  const scopeBody = access.slice(scope, access.indexOf("\nexport ", scope + 1));
  assert.match(scopeBody, /scopeWhere\(scope\)/);
  assert.doesNotMatch(scopeBody, /productScopeWhere/, "video scope is back on the product");
});

check("a moderator is shown the video they are vouching for", () => {
  // Approving asks whether the clip shows the item and whether it is good
  // enough for a product page. The screen used to show a thumbnail at most.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/creator-videos/page.js", "utf8");
  assert.match(page, /<video\n?\s+src=\{video\.videoUrl\}/, "the moderation queue has no player");
  assert.match(page, /controls/, "the player cannot be played");
  assert.match(page, /preload="metadata"/, "a queue of twenty would pull twenty videos down");

  // And it no longer promises something the system does not do.
  const moderation = fsForGuard.readFileSync("src/components/dashboard/creator/VideoModeration.js", "utf8");
  assert.doesNotMatch(moderation, /every branch/, "the approval copy still claims chain-wide reach");
  assert.match(moderation, /and nowhere else/);
});

check("the programme overview does not hand money to someone who may not see it", () => {
  // Reached with `creators.read`, which a content moderator holds and which
  // does not imply `creator_earnings.read`.
  const route = fsForGuard.readFileSync("src/app/api/v1/admin/creator-program/overview/route.js", "utf8");
  assert.match(route, /includeMoney/, "the overview route does not gate its money separately");
  assert.match(route, /creator_earnings\.read/, "the overview route does not check the earnings permission");
});

check("every nav item in the creator programme has a page behind it", () => {
  const marketing = DASHBOARD_NAV.find((section) => section.id === "marketing");
  assert.ok(marketing, "the Marketing section is gone from the nav");
  const creatorItems = marketing.items.filter((row) =>
    ["Creators", "Creator videos", "Commission rules", "Creator earnings"].includes(row.label),
  );
  assert.equal(creatorItems.length, 4, "the creator nav entries have moved or been renamed");
  for (const item of creatorItems) {
    const route = item.href.replace("/dashboard", "src/app/(dashboard)/dashboard");
    assert.ok(fsForGuard.existsSync(`${route}/page.js`), `${item.href} has no page`);
  }
});

check("a sale that earned nothing says why in a way somebody can act on", () => {
  assert.match(disqualificationHint("SELF_PURCHASE"), /buyer was the creator/);
  assert.match(disqualificationHint("RULE_BUDGET_EXHAUSTED"), /spent its budget/);
  assert.match(disqualificationHint("BELOW_MINIMUM"), /below the rule's minimum/);
  assert.match(disqualificationHint(null), /No commission rule covered/);
});

check("one order asked for its food twice is one meal, by one list", () => {
  // Four files carried their own copy of this pair and one of them drifted:
  // creator eligibility asked for COMPLETED alone, so a delivery customer whose
  // food had arrived was told to order something first until a member of staff
  // closed the order out by hand. Pickup and dine-in, which never pass through
  // DELIVERED, were let in straight away for exactly the same meal.
  assert.deepEqual(FULFILLED_STATUSES, ["DELIVERED", "COMPLETED"]);

  const consumers = [
    "src/server/services/creator.service.js",
    "src/server/services/review.service.js",
    "src/server/services/creator-earning.service.js",
    "src/server/content/account.js",
    "src/server/services/creator-video.service.js",
  ];
  for (const file of consumers) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /FULFILLED_STATUSES/, `${file} no longer uses the shared list`);
    assert.doesNotMatch(
      text,
      /\[\s*"(?:DELIVERED|COMPLETED)"\s*,\s*"(?:DELIVERED|COMPLETED)"\s*\]/,
      `${file} has grown its own copy of the fulfilled statuses again`,
    );
  }
});

check("joining the programme asks about the status the customer actually reaches", () => {
  const text = fsForGuard.readFileSync("src/server/services/creator.service.js", "utf8");
  const start = text.indexOf("export async function creatorEligibility");
  assert.ok(start > -1, "creatorEligibility has been renamed");
  const body = text.slice(start, text.indexOf("\nexport ", start + 1));
  assert.match(body, /status:\s*\{\s*in:\s*FULFILLED_STATUSES\s*\}/);
  assert.doesNotMatch(body, /status:\s*"COMPLETED"/, "eligibility is back to COMPLETED only");
});

check("filming starts from an order that arrived, not one closed out by hand", () => {
  // Both ends of the same journey: the list of things you could film, and the
  // check run when you pick one. Either left on COMPLETED alone leaves a
  // delivery creator on a page with no upload control and no explanation.
  const text = fsForGuard.readFileSync("src/server/services/creator-video.service.js", "utf8");
  assert.match(text, /order:\s*\{\s*userId,\s*status:\s*\{\s*in:\s*FULFILLED_STATUSES\s*\}/);
  assert.match(text, /!FULFILLED_STATUSES\.includes\(orderItem\.order\.status\)/);
  assert.doesNotMatch(text, /order\.status\s*!==\s*"COMPLETED"/);
});

check("a studio with nothing to film says so instead of going blank", () => {
  // Every upload control on the page hangs off a filmable order line, so an
  // empty list used to render the section away entirely — leaving a creator
  // unable to tell a shut window from a broken feature.
  const text = fsForGuard.readFileSync("src/components/account/VideoStudio.js", "utf8");
  const start = text.indexOf("{filmable.length ? (");
  assert.ok(start > -1, "the filmable section has been restructured");
  const tail = text.slice(start, start + 2400);
  assert.doesNotMatch(tail.split("</section>")[1] ?? "", /^\s*\)\s*:\s*null\}/);
  assert.match(text, /Nothing to film at the moment/);
});

check("withdrawing a video is not the same as destroying the order line", () => {
  // An order line can be filmed exactly once — `filmableOrderItems` drops any
  // line that already has a video row, archived ones included. So a withdrawal
  // the creator could not undo threw away the clip and the only chance that
  // line ever had, while the server had been willing to take it back all along.
  const service = fsForGuard.readFileSync("src/server/services/creator-video.service.js", "utf8");
  assert.match(service, /const SUBMITTABLE = \["DRAFT", "REJECTED", "ARCHIVED"\];/);

  const studio = fsForGuard.readFileSync("src/components/account/VideoStudio.js", "utf8");
  for (const name of ["canUpload", "canSubmit"]) {
    const line = studio.split("\n").find((row) => row.includes(`const ${name} =`));
    assert.ok(line, `${name} is gone from the studio`);
    assert.match(line, /ARCHIVED/, `${name} still treats a withdrawn video as a dead end`);
  }
});

check("the only list whose default is a filter can still ask for everything", () => {
  // `href()` drops falsy values, so an All tab whose value is "" linked to a
  // URL carrying no status — indistinguishable from a first visit, which falls
  // through to the default. The tab showed a count it could never display.
  const text = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/creator-videos/page.js", "utf8");
  assert.match(text, /const ALL = "all";/);
  assert.match(text, /asked === ALL \? ""/);
  assert.match(text, /status: status \|\| ALL/);
  assert.match(text, /href=\{href\(\{ status: tab\.value \|\| ALL/);

  // Every other list defaults to everything, so none of them can hit this.
  const dir = "src/app/(dashboard)/dashboard";
  for (const name of fsForGuard.readdirSync(dir)) {
    const file = `${dir}/${name}/page.js`;
    if (name === "creator-videos" || !fsForGuard.existsSync(file)) continue;
    const body = fsForGuard.readFileSync(file, "utf8");
    for (const line of body.split("\n")) {
      if (!/FILTERS\.some\(\(row\) => row\.value === one\(params\./.test(line)) continue;
      assert.match(line, /:\s*""/, `${file} defaults a filter to something other than "all" and needs the ALL sentinel too`);
    }
  }
});

check("the storefront only ever asks for its own branch's videos", () => {
  // The whole branch rule is worthless if the pages that render videos forget
  // to say which outlet they are. Both reads take a branch and both pages
  // resolve one from the cookie before calling them.
  const content = fsForGuard.readFileSync("src/server/content/creator-videos.js", "utf8");
  assert.match(content, /videosForProduct\(\{ productId, branchId, limit \}\)/);
  assert.match(content, /videoFeed\(\{ branchId, limit \}\)/);

  const product = fsForGuard.readFileSync("src/app/(site)/menu/[slug]/page.js", "utf8");
  assert.match(product, /productVideos\(\{ productId: product\.id, branchId: branch\?\.id \?\? null \}\)/);

  const feed = fsForGuard.readFileSync("src/app/(immersive)/videos/page.js", "utf8");
  assert.match(feed, /resolveBranch\(branches/, "the feed page does not resolve a branch");
  assert.match(feed, /branch \? serialize\(await feedVideos/, "the feed page reads videos without a branch");
});

check("a sale a video caused is credited to it on both surfaces", () => {
  // Adding to the basket is the only thing that creates an attribution, so
  // every add-to-basket a video can reach has to carry the video's id. The
  // feed sends it directly; the product page sends it when a video handed the
  // visitor over, which is what `?v=` is for.
  const viewer = fsForGuard.readFileSync("src/components/videos/VideoViewer.js", "utf8");
  assert.match(viewer, /creatorVideoId: video\.id/);
  assert.match(viewer, /creatorSurface: surface/);

  const form = fsForGuard.readFileSync("src/components/products/ProductOrderForm.js", "utf8");
  assert.match(form, /creatorVideoId, creatorSurface: "PRODUCT_PAGE"/);

  // And the id is checked against the videos actually on the page, so the
  // parameter cannot be used to credit an arbitrary video.
  const page = fsForGuard.readFileSync("src/app/(site)/menu/[slug]/page.js", "utf8");
  assert.match(page, /videos\.some\(\(video\) => video\.id === fromVideo\) \? fromVideo : null/);
});

check("a product needing choices is handed over rather than refused", () => {
  // A clip of something with a required modifier group cannot be added in one
  // tap, because the choices genuinely have not been made. Sending them to the
  // product page with the video id keeps the credit across the detour.
  const viewer = fsForGuard.readFileSync("src/components/videos/VideoViewer.js", "utf8");
  assert.match(viewer, /needsChoices\(error\) && video\.product\?\.slug/);
  assert.match(viewer, /router\.push\(`\/menu\/\$\{video\.product\.slug\}\?v=\$\{video\.id\}`\)/);
  // Keyed to what the cart service actually throws for a missing choice.
  const cart = fsForGuard.readFileSync("src/server/services/cart.service.js", "utf8");
  assert.match(cart, /modifiers: \[/, "the cart no longer reports missing modifiers under `modifiers`");
  assert.match(cart, /comboSelections: \[/, "the cart no longer reports missing combo picks under `comboSelections`");
  assert.match(viewer, /details\.modifiers \|\| details\.comboSelections/);
});

check("a phone clip keeps its shape on a desktop", () => {
  // These are filmed upright. Stretched across a wide screen the picture is a
  // sliver between two black margins, with the caption and the buttons at
  // opposite edges of a 27-inch monitor. The card is pinned to 9:16 from `lg`
  // up and height drives the width, so the clip is the same shape everywhere.
  const viewer = fsForGuard.readFileSync("src/components/videos/VideoViewer.js", "utf8");
  assert.match(viewer, /lg:aspect-9\/16/, "the desktop card is no longer 9:16");
  assert.match(viewer, /lg:w-auto/, "width is no longer driven by height");

  // `contain`, never `cover`: the card is 9:16 but nothing makes the clip 9:16,
  // and filling the card would crop whatever was filmed in another shape.
  assert.match(viewer, /className="h-full w-full object-contain"/);
  assert.doesNotMatch(viewer, /object-cover/, "the player crops the clip to fill the card");

  // Every control is rendered once and restyled by breakpoint. A second copy
  // behind `lg:hidden` is how the two layouts stop behaving alike — one gets a
  // fix the other does not, or the like state goes out of step.
  assert.equal(viewer.split("<Action").length - 1, 2, "the actions have been duplicated or dropped");
  assert.equal(viewer.split("<video").length - 1, 1, "there is more than one player per clip");
  assert.doesNotMatch(viewer, /lg:hidden/, "a control is being hidden rather than restyled");

  // The desktop skin is a restyle of the same element, not a different one.
  // Scoped to `Action` itself: the close button carries the same classes, so
  // a file-wide match passed even with the skin stripped off the actions.
  const action = viewer.slice(viewer.indexOf("function Action("));
  assert.ok(action, "the Action control is gone");
  assert.match(action, /bg-black\/45 text-white/, "the action has no over-the-picture skin");
  assert.match(action, /lg:bg-surface-container-high lg:text-on-surface/, "the action has no on-page skin");
});

check("a clip with no poster still shows something", () => {
  // Nothing ever set `thumbnailUrl`: the column and the API accepted one, but
  // no caller produced it, so every tile would have been a grey box. New
  // uploads capture a still, and clips uploaded before that fall back to their
  // own first frame rather than nothing.
  const studio = fsForGuard.readFileSync("src/components/account/VideoStudio.js", "utf8");
  assert.match(studio, /function posterOf\(file, seconds\)/);
  assert.match(studio, /thumbnailUrl: posterMedia\.url/);

  const rail = fsForGuard.readFileSync("src/components/videos/VideoRail.js", "utf8");
  assert.match(rail, /preload="metadata"/, "the rail has no fallback for a clip with no poster");
});

check("a heading does not swallow the paragraph under it", () => {
  // The bug this was written for. Splitting on blank lines first looks simpler
  // and is wrong: a heading typed with the sentence on the very next line —
  // which is how everybody writes one — came out as a single block, and the
  // whole paragraph was rendered inside the <h2>. Caught by reading the actual
  // seeded privacy policy off a running server, not by reading the code.
  const blocks = parseProse("## What we collect\nYour name and address.\n\n## Why\nTo cook.");
  assert.deepEqual(blocks, [
    { type: "heading", text: "What we collect" },
    { type: "paragraph", text: "Your name and address." },
    { type: "heading", text: "Why" },
    { type: "paragraph", text: "To cook." },
  ]);

  // A wrapped line is still one paragraph.
  assert.deepEqual(parseProse("One line\nand its wrap."), [
    { type: "paragraph", text: "One line and its wrap." },
  ]);

  // Nothing an editor types produces markup, which is the whole reason this
  // is not HTML: the worst case is a paragraph that wanted to be a heading.
  const hostile = parseProse("<script>alert(1)</script>\n\n## <b>x</b>");
  assert.equal(hostile[0].text, "<script>alert(1)</script>");
  assert.equal(hostile[1].type, "heading");
  for (const block of hostile) assert.equal(typeof block.text, "string");

  assert.deepEqual(parseProse(""), []);
  assert.deepEqual(parseProse(null), []);
  assert.equal(firstParagraph("## Heading only"), "");
});

check("a public page is seeded, edited and never invented", () => {
  // A slug is half of a route. Creating one at runtime is a page that 404s
  // because of a typo nobody can see, and renaming one breaks every link
  // already printed on a menu or sitting in an email footer.
  const service = fsForGuard.readFileSync("src/server/services/content-page.service.js", "utf8");
  assert.doesNotMatch(service, /contentPage\.create\(/, "pages can be created through the service");
  assert.doesNotMatch(service, /contentPage\.delete/, "pages can be deleted through the service");

  const schema = fsForGuard.readFileSync("src/server/validation/content.schemas.js", "utf8");
  assert.doesNotMatch(schema, /slug:/, "the edit schema accepts a slug");

  const routes = "src/app/api/v1/admin/content-pages";
  assert.ok(!fsForGuard.existsSync(`${routes}/route.js`) ||
    !/export const POST/.test(fsForGuard.readFileSync(`${routes}/route.js`, "utf8")), "pages can be created over HTTP");
  assert.doesNotMatch(
    fsForGuard.readFileSync(`${routes}/[id]/route.js`, "utf8"),
    /export const DELETE/,
    "pages can be deleted over HTTP",
  );

  // Every seeded slug the footer or header links to has to resolve, and the
  // route that serves them is a single dynamic segment.
  assert.ok(fsForGuard.existsSync("src/app/(site)/[slug]/page.js"), "the public page route is gone");
  const footer = fsForGuard.readFileSync("src/components/layout/Footer.js", "utf8");
  const seeded = new Set(CONTENT_PAGES.map((page) => page.slug));
  for (const href of footer.match(/href: "\/[a-z-]+"/g) ?? []) {
    const slug = href.slice(8, -1);
    assert.ok(seeded.has(slug), `the footer links /${slug}, which no seeded page serves`);
  }
});

check("the feed does not carry a footer it hides", () => {
  // A full-bleed feed is one viewport tall and fixed, so the newsletter form
  // and five columns of links sat underneath it unreachable. Its own route
  // group, because a nested layout adds to its parent and there is no way to
  // subtract a footer from inside `(site)`.
  assert.ok(fsForGuard.existsSync("src/app/(immersive)/videos/page.js"), "the feed is not in the immersive group");
  assert.ok(!fsForGuard.existsSync("src/app/(site)/videos/page.js"), "the feed is still under the site layout");

  const layout = fsForGuard.readFileSync("src/app/(immersive)/layout.js", "utf8");
  assert.match(layout, /Header/, "the immersive layout has no header");
  assert.doesNotMatch(layout, /Footer/, "the immersive layout still renders the footer");
});

check("a creator's own page crosses branches, and says so on every clip", () => {
  // The one deliberate exception to the branch rule. Everywhere else a video
  // is pinned to the outlet it was filmed at, because everywhere else the
  // outlet is the context. This page is about a person, reached by following
  // their name off a clip — hiding the rest of their work because it was
  // filmed across town would make the page a lie about what they have made.
  const content = fsForGuard.readFileSync("src/server/content/creator-videos.js", "utf8");
  const start = content.indexOf("export async function creatorProfile(");
  assert.notEqual(start, -1, "creatorProfile is gone");
  const body = content.slice(start, content.indexOf("\nexport ", start + 1));
  assert.doesNotMatch(body, /branchId/, "the creator page has been branch-scoped");

  // Which is only defensible because each clip names where it came from.
  const service = fsForGuard.readFileSync("src/server/services/creator-engagement.service.js", "utf8");
  const byCreator = service.indexOf("export async function videosByCreator(");
  const byCreatorBody = service.slice(byCreator, service.indexOf("\nexport ", byCreator + 1));
  assert.match(byCreatorBody, /branch: \{ select: \{ id: true, name: true, city: true \} \}/);
  const grid = fsForGuard.readFileSync("src/components/videos/VideoGrid.js", "utf8");
  assert.match(grid, /video\.branch\?\.name/, "the grid does not say which outlet a clip came from");

  // A suspended creator is a plain 404: the storefront is not where a
  // moderation outcome gets published.
  const creator = fsForGuard.readFileSync("src/server/services/creator.service.js", "utf8");
  const publicFn = creator.indexOf("export async function publicCreator(");
  assert.match(
    creator.slice(publicFn, creator.indexOf("\nexport ", publicFn + 1)),
    /creator\.status !== "ACTIVE"[\s\S]{0,80}notFound/,
    "a suspended creator no longer 404s",
  );
});

check("a creator page is its own surface in the numbers", () => {
  // Folding it into VIDEO_FEED would have cost nothing to build and quietly
  // corrupted the breakdown a programme manager actually reads: sales from
  // people who came looking for a creator, versus people browsing.
  const schema = fsForGuard.readFileSync("prisma/schema/13-creator-program.prisma", "utf8");
  const surfaces = schema.slice(schema.indexOf("enum CreatorVideoSurface {"));
  assert.match(surfaces.slice(0, surfaces.indexOf("}")), /CREATOR_PROFILE/);

  // The API has to accept what the page sends, or every view and every
  // attribution from this page is rejected at the door.
  const zod = fsForGuard.readFileSync("src/server/validation/creator.schemas.js", "utf8");
  assert.match(zod, /surfaceSchema = z\.enum\(\[[^\]]*"CREATOR_PROFILE"/);

  const page = fsForGuard.readFileSync("src/app/(site)/creators/[handle]/page.js", "utf8");
  assert.match(page, /surface="CREATOR_PROFILE"/);

  // And the handle on a clip is the way to the page at all.
  const viewer = fsForGuard.readFileSync("src/components/videos/VideoViewer.js", "utf8");
  assert.match(viewer, /href=\{`\/creators\/\$\{video\.creator\.handle\}`\}/, "the handle is a dead end");
});

check("a broken page still looks like the shop", () => {
  // There was no not-found, no error boundary and no global-error anywhere, so
  // every 404 and every unhandled throw rendered Next's stock black-and-white
  // page: no header, no footer, no way back, and nothing saying whose site it
  // was. The storefront one matters most — it is the only one an ordinary
  // customer reaches on an ordinary day.
  for (const file of [
    "src/app/(site)/not-found.js",
    "src/app/(site)/error.js",
    "src/app/(dashboard)/not-found.js",
    "src/app/(dashboard)/error.js",
    "src/app/(account)/error.js",
    "src/app/not-found.js",
    "src/app/global-error.js",
  ]) {
    assert.ok(fsForGuard.existsSync(file), `${file} is gone`);
  }

  // This Next passes `retry`, not `reset`. A boundary wired to `reset` renders
  // a button that throws on click, which is a worse failure than the one it
  // was put there to handle.
  for (const file of [
    "src/app/(site)/error.js",
    "src/app/(dashboard)/error.js",
    "src/app/(account)/error.js",
    "src/app/global-error.js",
  ]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.match(text, /^"use client";/, `${file} is not a client component`);
    assert.match(text, /\{ error, retry \}/, `${file} does not take retry`);
    assert.match(text, /retry\(\)/, `${file} never calls retry`);
  }

  // `global-error` replaces the root layout, so it gets none of the app's CSS
  // and the theme attribute never reaches it. Every style has to be inline,
  // and its own <html>/<body> is mandatory rather than stylistic.
  const global = fsForGuard.readFileSync("src/app/global-error.js", "utf8");
  assert.match(global, /<html/, "global-error does not render its own document");
  assert.match(global, /<body/, "global-error does not render its own body");
  assert.doesNotMatch(global, /className=/, "global-error uses classes it will not have the stylesheet for");
});

check("every admin capability with a permission has somewhere to use it", () => {
  // These six endpoints existed with nothing calling them. The two that
  // mattered: a financial year could be read but never created — the periods
  // page literally says one "has to be created" with nothing behind the
  // sentence — and a payment callback could not be replayed, which is the
  // recovery for a customer who has paid for an order that still reads unpaid.
  const callers = [
    ["admin/fiscal-years", "src/components/dashboard/finance/FiscalYearForm.js"],
    ["admin/payment-webhooks", "src/components/dashboard/payments/WebhookReplay.js"],
    ["admin/creator-strikes", "src/components/dashboard/creator/StrikeActions.js"],
    ["admin/creator-attributions", "src/components/dashboard/creator/EarningActions.js"],
    ["admin/leave-balances", "src/components/dashboard/people/LeaveBalances.js"],
  ];
  for (const [endpoint, file] of callers) {
    assert.ok(fsForGuard.existsSync(file), `${file} is gone`);
    assert.match(fsForGuard.readFileSync(file, "utf8"), new RegExp(endpoint), `${file} no longer calls ${endpoint}`);
  }

  // And a screen nothing links to is the same as no screen.
  const creators = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/creators/page.js", "utf8");
  assert.match(creators, /\/dashboard\/creators\/\$\{creator\.id\}/, "the creator list does not link to the detail page");
  assert.ok(fsForGuard.existsSync("src/app/(dashboard)/dashboard/creators/[id]/page.js"));
  assert.ok(fsForGuard.existsSync("src/app/(dashboard)/dashboard/payment-webhooks/page.js"));
});

check("video reporting is gone, not half-gone", () => {
  // Removed on request: a customer could report a video and a moderator saw a
  // count, but there was never a screen to read one or resolve it. Half a
  // feature left behind — a dangling endpoint, an orphan table, a constant
  // nothing reads — is what the next person trips over.
  for (const path of [
    "src/app/api/v1/creator-videos/[id]/report",
    "src/app/api/v1/admin/creator-reports",
  ]) {
    assert.ok(!fsForGuard.existsSync(path), `${path} is still there`);
  }

  const schema = fsForGuard.readFileSync("prisma/schema/13-creator-program.prisma", "utf8");
  assert.doesNotMatch(schema, /CreatorVideoReport/, "the report model is still in the schema");
  assert.doesNotMatch(schema, /CreatorReportReason/, "the report enum is still in the schema");

  // Including the two that only bite later: a suite's cleanup and the purge
  // script both deleted from the dropped table, and neither is exercised by a
  // build. The suite failed its teardown on the next run; the purge script
  // would have thrown on the line, for the one person running it by hand on a
  // database they care about.
  for (const [file, name] of [
    ["src/lib/creator.js", "REPORT_REASONS"],
    ["src/server/validation/creator.schemas.js", "reportVideoSchema"],
    ["src/server/services/creator-video.service.js", "reportVideo"],
    ["src/server/content/creator-admin.js", "openReportCounts"],
    ["tests/phase13.e2e.mjs", "creatorVideoReport"],
    ["scripts/maintenance/purge-e2e-debris.mjs", "creatorVideoReport"],
  ]) {
    assert.doesNotMatch(fsForGuard.readFileSync(file, "utf8"), new RegExp(name), `${name} survives in ${file}`);
  }
});

check("the newsletter is gone, not just switched off", () => {
  // Both halves: the footer form and the home page's Bold Club banner were the
  // same unbuilt feature wearing two hats. Neither had an endpoint, a
  // subscriber model, or a decision about where addresses would live.
  for (const path of ["src/components/layout/NewsletterForm.js", "src/components/home/BoldClub.js"]) {
    assert.ok(!fsForGuard.existsSync(path), `${path} is still there`);
  }
  for (const file of ["src/components/layout/Footer.js", "src/app/(site)/page.js"]) {
    const text = fsForGuard.readFileSync(file, "utf8");
    assert.doesNotMatch(text, /NewsletterForm|BoldClub/, `${file} still references it`);
  }
});

check("search answers as you type, and cannot answer with a stale reply", () => {
  // The bug this is written against is the one that does not reproduce on a
  // fast connection: typing "burger" fires several requests, they return out
  // of order, and the answer for "bur" lands last and overwrites the right
  // one. A sequence counter is the fix; a debounce alone is not.
  const text = fsForGuard.readFileSync("src/components/layout/SiteSearch.js", "utf8");
  assert.match(text, /sequence = useRef\(0\)/, "there is no request sequence");
  assert.match(text, /if \(mine !== sequence\.current\) return;/, "a stale reply is not dropped");
  assert.match(text, /setTimeout\(/, "there is no debounce");

  // No form submit and no button to press: that is what "instant" means here.
  assert.doesNotMatch(text, /<form/, "search went back to being a form submit");
  assert.match(text, /role="combobox"/, "the box is not a combobox");
  assert.match(text, /aria-expanded/);
  assert.match(text, /ArrowDown/, "the results cannot be reached from the keyboard");

  // And the place it hands over to has to read what it sends.
  const menu = fsForGuard.readFileSync("src/app/(site)/menu/page.js", "utf8");
  assert.match(menu, /one\(params\?\.q\)/, "the menu page ignores ?q=");

  // It is in both chromes, or it is missing on whichever one it is not in.
  for (const file of ["src/components/layout/Header.js", "src/components/layout/MobileNav.js"]) {
    assert.match(fsForGuard.readFileSync(file, "utf8"), /SiteSearch/, `${file} has no search`);
  }

  /*
   * And it must be able to give way.
   *
   * This went wrong twice. `flex-1` with a zero basis got only the row's
   * leftover space and rendered an 85px box — a magnifier and nothing else.
   * Replacing it with a fixed `shrink-0` width fixed that and broke something
   * worse: the row could no longer yield, so it overflowed by a few pixels and
   * put a horizontal scrollbar under every page on the site. A real width that
   * is still allowed to shrink is the only version that is both.
   */
  const header = fsForGuard.readFileSync("src/components/layout/Header.js", "utf8");
  const slot = header.split("\n").find((line) => line.includes("<div") && line.includes("lg:block") && line.includes("w-"));
  assert.ok(slot, "the header search slot is gone");
  assert.doesNotMatch(slot, /shrink-0/, "the search cannot give way, so the row overflows instead");
  assert.doesNotMatch(slot, /flex-1/, "a zero-basis search collapses to an icon");
  assert.match(slot, /min-w-0/, "the search cannot shrink below its content");
});

check("an invited member of staff has a page to accept on", () => {
  /*
   * The invitation email has always said "Accept at <site>/invite" and nothing
   * served that address. Everything else was in place — the account was
   * created, the code was valid, `POST /auth/invitations/accept` worked — so
   * every invited cashier got a 404 and the one step they needed was missing.
   */
  assert.ok(fsForGuard.existsSync("src/app/(site)/invite/page.js"), "the address the email points at is still a 404");

  const template = fsForGuard.readFileSync("src/server/mail/templates.js", "utf8");
  const invite = template.slice(template.indexOf("export function staffInviteEmail"));
  assert.match(invite.slice(0, invite.indexOf("\n}")), /\$\{APP_URL\}\/invite\?email=\$\{encodeURIComponent\(email\)\}/);

  const form = fsForGuard.readFileSync("src/components/auth/AcceptInviteForm.js", "utf8");
  assert.match(form, /api\.post\("\/auth\/invitations\/accept"/);

  /*
   * It signs them in rather than returning them to the login form. A reset
   * ends at /login on purpose — the point there is to evict whoever took the
   * account over — but this is a new account whose owner has just proved
   * control of the address, and the endpoint already returns a session.
   */
  assert.match(form, /setSessionUser\(session\.user/);

  /*
   * And where they land is read from the permissions that came back, not
   * assumed. A cashier is not an administrator: a hardcoded `/dashboard`
   * drops somebody on a page they can open only by luck.
   */
  assert.match(form, /workspaceLinks\(session\.user\?\.permissions \?\? \[\]\)/);
  assert.doesNotMatch(form, /isStaff/, "the session user has no isStaff field, so this is always false");

  // The page is prefilled from the link but the address stays editable: a typo
  // there is the likeliest reason a code does not match.
  const page = fsForGuard.readFileSync("src/app/(site)/invite/page.js", "utf8");
  assert.match(page, /searchParams/);
  assert.match(page, /<AcceptInviteForm email=/);
  assert.doesNotMatch(page, /redirect\(/, "a stale session bounces the person holding the code");
});

check("a query flag left out is false, not the string \"false\"", () => {
  /*
   * `.default("false")` after a transform sets the *input* default, so an
   * absent flag came back as the string "false" — which is truthy. Every flag
   * written this way was permanently on: `/me/notifications` filtered to
   * unread for ever, so an inbox emptied itself the moment you read it.
   */
  assert.equal(notificationQuerySchema.parse({}).unreadOnly, false);
  assert.equal(notificationQuerySchema.parse({ unreadOnly: "true" }).unreadOnly, true);
  assert.equal(notificationQuerySchema.parse({ unreadOnly: "false" }).unreadOnly, false);
  assert.equal(branchQuerySchema.parse({}).includeState, false);
  assert.equal(branchQuerySchema.parse({ includeState: "true" }).includeState, true);

  // A tri-state filter is a different thing and must stay undefined when
  // absent: defaulting it to false would hide every active branch.
  assert.equal(branchQuerySchema.parse({}).isActive, undefined);
  assert.equal(branchQuerySchema.parse({ isActive: "false" }).isActive, false);

  const schemas = fsForGuard.readFileSync("src/server/validation/schemas.js", "utf8");
  assert.doesNotMatch(schemas, /\.transform\(\(value\) => value === "true"\)\s*\n\s*\.default\(/, "the trap is back");
});

check("a new notification shows in the header and makes a sound", () => {
  /*
   * A notification that only exists on its own page is one nobody reads. The
   * badge says how many, the panel says what they are, and a chime says one
   * arrived while somebody was looking at something else.
   */
  const bell = fsForGuard.readFileSync("src/components/layout/NotificationBell.js", "utf8");
  const header = fsForGuard.readFileSync("src/components/layout/Header.js", "utf8");
  const shell = fsForGuard.readFileSync("src/components/dashboard/DashboardShell.js", "utf8");
  assert.match(header, /<HeaderNotifications \/>/);
  assert.match(shell, /<NotificationBell href="\/dashboard\/notifications" \/>/, "staff are sent to the storefront inbox");

  /*
   * Shown to somebody signed in, and keyed on the user rather than on a status
   * string: this store reports `authenticated`, and a guard written against a
   * status of "ready" hid the bell from everybody while reading correctly.
   */
  const gate = fsForGuard.readFileSync("src/components/layout/HeaderNotifications.js", "utf8");
  assert.match(gate, /const \{ user \} = useSession\(\);/);
  assert.doesNotMatch(gate, /status !== "ready"/);

  /*
   * The chime fires on a rise and nothing else. Opening a session with four
   * unread is not four new ones, and marking them read lowers the count — a
   * page that makes a noise about either is a page people mute.
   */
  const store = fsForGuard.readFileSync("src/hooks/useNotifications.js", "utf8");
  assert.match(store, /if \(lastSeen !== null && unread > lastSeen\) playChime\(\);/);
  assert.match(store, /let lastSeen = null;/, "the first count would chime for mail already read");

  // Polling stops when nothing is watching: a background tab asking every
  // thirty seconds for hours is somebody's battery.
  assert.match(store, /if \(subscribers === 0\) stop\(\);/);

  /*
   * And the panel says it is fetching. Its empty state reads "Nothing new.",
   * which is the one thing it must not say to somebody who has unread mail
   * while the request is still in flight.
   */
  assert.match(bell, /listStatus === "loading" && items\.length === 0/);

  // Sound can always be refused by the browser, and that is not a fault worth
  // throwing from a polling loop.
  const chime = fsForGuard.readFileSync("src/lib/chime.js", "utf8");
  assert.match(chime, /catch \{\s*\n\s*return false;/);
  assert.match(chime, /export function setMuted/, "there is no way to turn it off");
});

check("the cart in the header says what is in it", () => {
  // The store, the count helper and every Add button were all written around
  // a badge that was never rendered — `useCart`'s comment names "the header
  // badge" and `cartItemCount` is documented as being for one — so adding
  // something to the basket changed nothing visible and read as a dead button.
  const button = fsForGuard.readFileSync("src/components/layout/CartButton.js", "utf8");
  assert.match(button, /cartItemCount/, "the badge does not read the cart");
  assert.match(button, /status === "ready"/, "a loading cart would render a zero, which is a lie");
  assert.match(button, /aria-label=\{count \?/, "the count is invisible to a screen reader");

  const header = fsForGuard.readFileSync("src/components/layout/Header.js", "utf8");
  assert.match(header, /<CartButton \/>/, "the header is back to a bare cart icon");

  /*
   * And it opens the basket in place.
   *
   * The icon used to be a plain link: a whole navigation to answer "did that
   * go in?", losing whatever was being read. The panel answers it where it was
   * asked and keeps both onward moves — see it, or go and pay — one press away.
   */
  assert.match(button, /role="dialog"/);
  assert.match(button, /aria-expanded=\{open\}/, "the panel's state is invisible to a screen reader");
  assert.match(button, /href="\/cart"/);
  assert.match(button, /href="\/checkout"/);

  // Dismissable without a mouse, and without hunting for a close button.
  assert.match(button, /event\.key === "Escape"/);
  assert.match(button, /boxRef\.current\?\.contains\(event\.target\)/, "clicking away leaves it open");

  /*
   * Still no arithmetic. The panel shows what the server last priced —
   * discounts, branch pricing, modifier deltas and tax all land server-side,
   * and a sum computed here would disagree with checkout.
   */
  assert.match(button, /cart\?\.totals\?\.grandTotal/);
  assert.doesNotMatch(button, /reduce\(/, "the panel adds the basket up itself");

  // A line the kitchen can no longer serve is flagged, not quietly hidden.
  assert.match(button, /line\.problem/);
});

check("the home page shows real clips, not placeholder artwork", () => {
  // What stood here was an Instagram grid fed by a hardcoded list, flagged
  // `isPlaceholder: true`, waiting on an API token that never arrived: four
  // tiles that were not posts, by nobody, linking nowhere.
  assert.ok(!fsForGuard.existsSync("src/components/home/SocialSnap.js"), "the placeholder grid is still there");
  for (const file of ["src/server/content/home.js", "src/server/content/placeholders.js"]) {
    assert.doesNotMatch(fsForGuard.readFileSync(file, "utf8"), /PLACEHOLDER_SOCIAL/, `${file} still has the fake data`);
  }

  const shorts = fsForGuard.readFileSync("src/components/home/CustomerShorts.js", "utf8");
  assert.match(shorts, /^"use client";/, "the section is not a client component");
  assert.match(shorts, /useSelectedBranchId/, "it does not know which outlet it is showing");
  assert.match(shorts, /surface="HOME"/, "a sale starting here is reported as starting elsewhere");

  /*
   * And the page it sits on stays static.
   *
   * The home page is cached for five minutes and the site layout is written
   * to keep it that way — its own comment says so, and the revalidate export
   * is checked against the cache entry at build time. Reading the branch
   * cookie on the server would make it dynamic for every visitor to save one
   * fetch for some of them, so this section fills itself in instead.
   */
  const page = fsForGuard.readFileSync("src/app/(site)/page.js", "utf8");
  assert.match(page, /export const revalidate = 300;/, "the home page is no longer statically cached");
  assert.doesNotMatch(page, /cookies\(\)/, "the home page reads cookies and is now dynamic for everyone");
});

check("the hero is authored, and its link cannot leave the site", () => {
  // The hero is the most prominent link in the shop. An arbitrary URL settable
  // from the dashboard is a phishing link wearing the shop's own branding, and
  // `//evil.test` is the one that slips through a naive check: a browser reads
  // it as another host while it looks like a path.
  const schemas = fsForGuard.readFileSync("src/server/validation/hero.schemas.js", "utf8");
  assert.match(schemas, /startsWith\("\/"\) && !value\.startsWith\("\/\/"\)/, "the CTA accepts off-site links");

  // Chain-wide on purpose: a branch-pinned banner means reading the branch
  // cookie on the server, which makes the whole home page dynamic.
  const schema = fsForGuard.readFileSync("prisma/schema/12-system.prisma", "utf8");
  const model = schema.slice(schema.indexOf("model HeroSlide {"));
  assert.doesNotMatch(model.slice(0, model.indexOf("\n}")), /branchId/, "a banner is branch-scoped and the page is now dynamic");

  // The storefront sees live slides; the dashboard sees all of them, or a
  // campaign scheduled for next week is invisible to whoever scheduled it.
  const service = fsForGuard.readFileSync("src/server/services/hero.service.js", "utf8");
  assert.match(service, /export async function liveHeroSlides/);
  assert.match(service, /export async function listHeroSlides/);

  // With nothing scheduled the page keeps its designed opening rather than
  // inventing a campaign the shop is not running.
  const hero = fsForGuard.readFileSync("src/components/home/Hero.js", "utf8");
  assert.match(hero, /if \(slides\.length\) return <HeroCarousel/);
  assert.match(hero, /SIZZLE/, "the fallback opening is gone");

  /*
   * And the banner stays server-rendered.
   *
   * It is the largest contentful paint on the site. The reorder prompt takes
   * the hero as `children` and returns it untouched when there is no order, so
   * the banner is in the initial HTML either way — rendering the hero inside a
   * client component that fetches first would measure as a blank rectangle.
   */
  const page = fsForGuard.readFileSync("src/app/(site)/page.js", "utf8");
  assert.match(page, /<HomeHero currency=\{data\.currency\}[^>]*>[\s\S]*<Hero slides=\{data\.heroSlides\} \/>/);
  const home = fsForGuard.readFileSync("src/components/home/HomeHero.js", "utf8");
  assert.match(home, /if \(!order\) return children;/, "the server-rendered hero is no longer the fallback");

  /*
   * And the photograph and its scrim live in one place.
   *
   * Both heroes once carried their own copy, so tuning the contrast meant
   * tuning it twice. The scrim is also unconditional on purpose: whatever
   * marketing uploads, including a bright photo, the headline has to stay
   * readable, so the darkening is never sampled from the image.
   */
  const carousel = fsForGuard.readFileSync("src/components/home/HeroCarousel.js", "utf8");
  for (const [name, source] of [["Hero", hero], ["HeroCarousel", carousel]]) {
    assert.match(source, /HeroBackdrop, \{ HERO_BODY, HERO_FRAME \}/, `${name} does not share the backdrop`);
    assert.doesNotMatch(source, /bg-gradient-to-r from-black/, `${name} carries its own copy of the scrim`);
  }

  // The band is as tall as what it says. A minimum height was tried and taken
  // back out: it left a short banner floating in a half-empty rectangle.
  const backdrop = fsForGuard.readFileSync("src/components/home/HeroBackdrop.js", "utf8");
  assert.doesNotMatch(backdrop, /min-h-/, "the hero has a height floor again");
});

check("a slot is judged in portions, not in rows", () => {
  /*
   * A combo that orders perfectly well was marked "cannot be ordered" on the
   * dashboard: `"Burgers" needs 2 but only 1 of its choices can be sold`. The
   * check counted rows. One row worth two portions is two.
   */
  const sellable = (quantity) => ({
    quantity,
    product: { name: "Smash burger", isActive: true, deletedAt: null },
    variant: { isActive: true },
  });
  const withdrawn = { quantity: 1, product: { name: "Old burger", isActive: false, deletedAt: null }, variant: null };

  const burgers = { name: "Burgers", minSelect: 2, maxSelect: 2, options: [sellable(2)] };
  assert.equal(slotFillable(burgers), true, "one choice worth two cannot fill a two-portion slot");
  assert.deepEqual(comboHealth([burgers]), []);

  /*
   * And a choice can be taken again, so one drink fills a four-drink slot —
   * which is exactly what the storefront's stepper now offers.
   */
  assert.equal(slotFillable({ name: "Drinks", minSelect: 4, maxSelect: 4, options: [sellable(1)] }), true);

  /*
   * It can still genuinely fail, and that is the point of keeping the check:
   * a slot needing three, offering only two-portion choices, reaches two or
   * four and never three.
   */
  const impossible = { name: "Wings", minSelect: 3, maxSelect: 3, options: [sellable(2)] };
  assert.equal(slotFillable(impossible), false);
  assert.match(comboHealth([impossible])[0].message, /come in 2s, which cannot add up/);
  assert.equal(comboHealth([impossible])[0].level, "blocking");

  // The three failure shapes say three different things.
  assert.match(
    comboHealth([{ name: "Drinks", minSelect: 1, maxSelect: 1, options: [] }])[0].message,
    /has no choices, so/,
  );
  assert.match(
    comboHealth([{ name: "Drinks", minSelect: 1, maxSelect: 1, options: [withdrawn] }])[0].message,
    /has no choices that can be sold/,
  );
  // An optional slot with nothing in it is not a blocker: nobody has to fill it.
  assert.deepEqual(comboHealth([{ name: "Extras", minSelect: 0, maxSelect: 2, options: [] }]), []);

  // A withdrawn choice beside a usable one is a warning, not a blocker.
  const mixed = comboHealth([{ name: "Drinks", minSelect: 1, maxSelect: 2, options: [sellable(1), withdrawn] }]);
  assert.equal(mixed[0].level, "warning");
  assert.match(mixed[0].message, /Old burger is not on sale/);

  /*
   * "Pick 2 · 1 choice" reads like a mistake unless the line says why one
   * choice is enough.
   */
  assert.equal(describeSlotChoices(burgers), "1 choice worth 2");
  assert.equal(describeSlotChoices({ options: [sellable(1)] }), "1 choice");
  assert.equal(describeSlotChoices({ options: [sellable(1), sellable(1)] }), "2 choices");
});

check("the same drink can be taken more than once", () => {
  /*
   * Four drinks and two flavours on the list means somebody wants two of one
   * of them. The slot was tick-boxes, so a customer could only ever pick four
   * different drinks — the server accepted repeats all along, the form simply
   * had no way to ask for them.
   */
  const drinks = {
    id: "g-drinks",
    name: "Cold drinks",
    minSelect: 4,
    maxSelect: 4,
    options: [
      { id: "o-pepsi", quantity: 1, priceDelta: 0, product: { id: "p-pepsi" }, variant: { id: "v-pepsi" } },
      { id: "o-juice", quantity: 1, priceDelta: 80, product: { id: "p-juice" }, variant: { id: "v-juice" } },
    ],
  };
  // A slot option worth two of itself, in a slot that holds two.
  const burgers = {
    id: "g-burgers",
    name: "Burgers",
    minSelect: 2,
    maxSelect: 2,
    options: [{ id: "o-smash", quantity: 2, priceDelta: 0, product: { id: "p-smash" }, variant: { id: "v-smash" } }],
  };

  // Both multipliers count: how many times it was taken, and what one is worth.
  assert.equal(comboSelectedCount(drinks, { "o-pepsi": 3 }), 3);
  assert.equal(comboSelectedCount(burgers, { "o-smash": 1 }), 2);
  assert.equal(comboGroupError(drinks, { "o-pepsi": 4 }), null, "four of one drink does not fill a four-drink slot");
  assert.equal(comboGroupError(drinks, { "o-pepsi": 5 }), "Choose up to 4");

  // Room is asked per option, because options are not all worth the same.
  assert.equal(hasRoomFor(drinks, { "o-pepsi": 3 }, drinks.options[1]), true);
  assert.equal(hasRoomFor(drinks, { "o-pepsi": 4 }, drinks.options[1]), false);
  assert.equal(hasRoomFor(burgers, { "o-smash": 1 }, burgers.options[0]), false, "a filled slot has room for 2 more");

  // Repeats are priced per helping.
  assert.equal(comboSurcharge([drinks], { "g-drinks": { "o-juice": 3 } }, {}), 240);

  /*
   * Quantity is sent only as an override, and then it has to carry the whole
   * answer — repeats times portion size — because the server reads it as the
   * quantity, not as a multiplier on the option's own.
   */
  assert.deepEqual(toComboPayload([drinks], { "g-drinks": { "o-pepsi": 2 } }, {}), [
    { groupId: "g-drinks", productId: "p-pepsi", variantId: "v-pepsi", quantity: 2 },
  ]);
  assert.deepEqual(toComboPayload([drinks], { "g-drinks": { "o-pepsi": 1 } }, {}), [
    { groupId: "g-drinks", productId: "p-pepsi", variantId: "v-pepsi" },
  ]);
  // Taken once, the catalog still owns the portion size and nothing is sent.
  assert.deepEqual(toComboPayload([burgers], { "g-burgers": { "o-smash": 1 } }, {}), [
    { groupId: "g-burgers", productId: "p-smash", variantId: "v-smash" },
  ]);

  /*
   * The case that tells the two apart: a two-bottle option taken twice is
   * four bottles, not two. Sending the repeat count alone would halve it and
   * the slot would be refused as half empty.
   */
  const fourPack = {
    id: "g-four",
    name: "Drinks",
    minSelect: 4,
    maxSelect: 4,
    options: [{ id: "o-pair", quantity: 2, priceDelta: 30, product: { id: "p-pair" }, variant: null }],
  };
  assert.deepEqual(toComboPayload([fourPack], { "g-four": { "o-pair": 2 } }, {}), [
    { groupId: "g-four", productId: "p-pair", quantity: 4 },
  ]);
  assert.equal(comboSelectedCount(fourPack, { "o-pair": 2 }), 4);
  assert.equal(comboSurcharge([fourPack], { "g-four": { "o-pair": 2 } }, {}), 120);

  /*
   * And the control only appears where it can do something. On a "2 burgers"
   * option that fills its slot alone, a stepper reading "1" looks like one
   * burger.
   */
  const slots = fsForGuard.readFileSync("src/components/products/ComboSlots.js", "utf8");
  assert.match(slots, /const repeatable = picked && !single && \(room \|\| taken > 1\);/);
  // Inside a label: without this the click reaches the input and unticks it.
  assert.match(slots, /onAdjust\(group, option, 1\)/);
  assert.match(slots, /event\.preventDefault\(\);\s*\n\s*onAdjust/);
});

check("a combo slot worth two portions counts as two", () => {
  /*
   * "1 pizza, 2 burgers, 2 drinks" is the ordinary shape of a family deal, and
   * the burgers are one option worth two — `quantity: 2` on the slot option.
   *
   * It was refused as `Choose at least 2 from "Burgers"`, which reads like the
   * customer got it wrong. The cause was here: the schema defaulted `quantity`
   * to 1, so `requested.quantity ?? option.quantity ?? 1` never reached the
   * catalog's answer. A field with a default is never absent.
   */
  const parsed = comboSelectionSchema.parse({
    groupId: "cmv3edrth000ox6i3mysszs01",
    productId: "cmu4igz8q0008yzi3yukohj42",
  });
  assert.equal(parsed.quantity, undefined, "the schema answers for the catalog");
  assert.equal(comboSelectionSchema.parse({
    groupId: "cmv3edrth000ox6i3mysszs01",
    productId: "cmu4igz8q0008yzi3yukohj42",
    quantity: 2,
  }).quantity, 2, "an explicit quantity is still honoured");

  const cart = fsForGuard.readFileSync("src/server/services/cart.service.js", "utf8");
  assert.match(cart, /const quantity = requested\.quantity \?\? option\.quantity \?\? 1;/);

  /*
   * And the same trap one layer down: writing `1` into the stored line would
   * make every later read of that cart resolve two portions as one and refuse
   * a basket that was accepted when it was filled.
   */
  assert.match(cart, /\.\.\.\(c\.quantity \? \{ quantity: c\.quantity \} : \{\}\)/);
  assert.doesNotMatch(cart, /quantity: c\.quantity \?\? 1/, "the stored line fixes the portion count at one");
});

check("the item inside a combo can be customised, like every chain does it", () => {
  /*
   * A meal deal let you choose the burger but not how it was made, so anybody
   * who wanted it without onions had to abandon the combo and order à la
   * carte. Every chain's app does this: the combo is a container, and each
   * component keeps its own options.
   */
  const sauce = {
    id: "mg-sauce",
    name: "Sauce",
    selectionType: "SINGLE",
    isRequired: true,
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "mo-garlic", name: "Garlic", priceDelta: 50, isDefault: false },
      { id: "mo-plain", name: "None", priceDelta: 0, isDefault: true },
    ],
  };
  const burgerSlot = {
    id: "g-burger",
    name: "Burger",
    minSelect: 1,
    maxSelect: 1,
    options: [
      {
        id: "o-zinger",
        quantity: 1,
        priceDelta: 0,
        isDefault: true,
        product: { id: "p-zinger", modifierGroups: [sauce] },
        variant: { id: "v-zinger" },
      },
    ],
  };
  // Two pieces in one tick, to prove the surcharge is not multiplied by them.
  const wingsSlot = {
    id: "g-wings",
    name: "Wings",
    minSelect: 1,
    maxSelect: 2,
    options: [
      {
        id: "o-wings2",
        quantity: 2,
        priceDelta: 100,
        isDefault: false,
        product: { id: "p-wings", modifierGroups: [{ ...sauce, id: "mg-dip", name: "Dip", isRequired: false, minSelect: 0 }] },
        variant: null,
      },
    ],
  };
  const groups = [burgerSlot, wingsSlot];

  // Each item opens with whatever it was built to include.
  assert.deepEqual(comboModifierDefaults(groups), {
    "o-zinger": { "mg-sauce": { "mo-plain": 1 } },
    "o-wings2": { "mg-dip": { "mo-plain": 1 } },
  });

  const picked = { "g-burger": { "o-zinger": 1 }, "g-wings": {} };
  const garlic = { "o-zinger": { "mg-sauce": { "mo-garlic": 1 } } };

  /*
   * Charged once per choice, not once per portion: a "2 pieces" option made
   * garlic is still one decision, and the server prices it the same way.
   */
  assert.equal(comboSurcharge(groups, picked, garlic), 50);
  assert.equal(
    comboSurcharge(groups, { "g-burger": {}, "g-wings": { "o-wings2": 1 } }, { "o-wings2": { "mg-dip": { "mo-garlic": 1 } } }),
    // 100 x 2 portions for the wings themselves, and the dip once.
    200 + 50,
    "the sauce inside a 2-piece option is charged twice",
  );

  /*
   * Only the items somebody actually chose are questions. A required sauce on
   * a burger nobody picked is not an error yet — marking it red would be
   * nagging about a path not taken.
   */
  assert.deepEqual(validateComboModifiers(groups, picked, { "o-zinger": {} }), {
    "o-zinger": { "mg-sauce": "Choose 1 option" },
  });
  assert.deepEqual(validateComboModifiers(groups, { "g-burger": {}, "g-wings": {} }, {}), {});
  assert.deepEqual(validateComboModifiers(groups, picked, garlic), {});

  // The choices nest under the slot they belong to, and an untouched combo
  // sends exactly what it sent before this existed.
  assert.deepEqual(toComboPayload(groups, picked, garlic), [
    {
      groupId: "g-burger",
      productId: "p-zinger",
      variantId: "v-zinger",
      modifiers: [{ optionId: "mo-garlic", quantity: 1 }],
    },
  ]);
  assert.deepEqual(toComboPayload(groups, picked, { "o-zinger": {} }), [
    { groupId: "g-burger", productId: "p-zinger", variantId: "v-zinger" },
  ]);

  /*
   * Keyed by the slot option, not by product: the same burger can sit in two
   * slots of one combo, and keying by product would make "no onions" on one of
   * them silently change both.
   */
  const form = fsForGuard.readFileSync("src/components/products/ProductOrderForm.js", "utf8");
  assert.match(form, /setComboMods\(\(current\) => \{[\s\S]*?current\[slotOption\.id\]/);

  /*
   * Undeclared, the field would be stripped before it reached the service —
   * the order would look accepted and the kitchen would never hear about it.
   */
  const schemas = fsForGuard.readFileSync("src/server/validation/ordering.schemas.js", "utf8");
  const comboSchema = schemas.slice(schemas.indexOf("export const comboSelectionSchema"));
  assert.match(comboSchema.slice(0, comboSchema.indexOf("});")), /modifiers: z\.array\(modifierSelectionSchema\)/);

  // One resolver for both: a combo choice is a product, so its options are
  // checked against the same rules, including groups the client omitted.
  const cart = fsForGuard.readFileSync("src/server/services/cart.service.js", "utf8");
  assert.match(cart, /const childModifiers = resolveModifiers\(\{[\s\S]*?within: option\.product\.name,/);
  assert.match(cart, /Number\(choice\.priceDelta\) \+ Number\(choice\.modifierTotal \?\? 0\)/);

  /*
   * And it reaches the person cooking it. The child line carries the
   * instruction at zero price — the customer was charged on the parent, and
   * repeating the money here would double it in every total built from rows.
   */
  const checkout = fsForGuard.readFileSync("src/server/services/checkout.service.js", "utf8");
  const childBlock = checkout.slice(checkout.indexOf("const child = await tx.orderItem.create"));
  assert.match(childBlock, /orderItemId: child\.id/);
  assert.match(childBlock, /groupNameSnapshot: modifier\.groupName/);
  assert.match(childBlock, /priceDelta: 0/, "the child line charges for the modifier a second time");
});

check("a combo can be built and bought from the website", () => {
  /*
   * The storefront had no way to choose a combo's slots, so the cart refused
   * every combo line — `Choose at least 1 from "Zinger Burger"` — and the
   * dashboard said in as many words that combos were staff-channel only.
   *
   * These rules mirror the server's exactly. They exist so a customer finds
   * out before pressing Add, never to decide anything the server decides.
   */
  const drink = {
    id: "g-drink",
    name: "Choose a Drink",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { id: "o-pepsi", quantity: 1, priceDelta: 0, isDefault: true, product: { id: "p-pepsi" }, variant: { id: "v-pepsi" } },
      { id: "o-juice", quantity: 1, priceDelta: 50, isDefault: false, product: { id: "p-juice" }, variant: { id: "v-juice" } },
    ],
  };
  // A slot that takes two, holding an option worth two of itself.
  const sides = {
    id: "g-sides",
    name: "Sides",
    minSelect: 1,
    maxSelect: 2,
    options: [
      { id: "o-fries", quantity: 1, priceDelta: 0, isDefault: false, product: { id: "p-fries" }, variant: null },
      { id: "o-wings2", quantity: 2, priceDelta: 100, isDefault: false, product: { id: "p-wings" }, variant: null },
    ],
  };
  const groups = [drink, sides];

  // Whatever the combo was built to include is already chosen.
  assert.deepEqual(comboDefaults(groups), { "g-drink": { "o-pepsi": 1 }, "g-sides": {} });

  /*
   * Counting follows the option, not the click. A "2 pieces" option fills two
   * of the slot's places — a client that counted ticks would offer a third
   * portion the server then refuses at the till.
   */
  assert.equal(comboSelectedCount(sides, { "o-wings2": 1 }), 2);
  assert.equal(canPickMore(sides, { "o-wings2": 1 }, sides.options[0]), false, "a full slot still takes more");
  assert.equal(canPickMore(sides, { "o-fries": 1 }, sides.options[1]), false, "2 pieces squeeze into 1 free place");
  assert.equal(canPickMore(drink, {}, drink.options[0]), true);

  // The messages name the customer's next move, not the rule that broke.
  assert.equal(comboGroupError(drink, {}), "Make a choice here");
  assert.equal(comboGroupError(sides, { "o-fries": 1, "o-wings2": 1 }), "Choose up to 2");
  assert.equal(comboGroupError(drink, { "o-pepsi": 1 }), null);
  assert.deepEqual(Object.keys(validateComboGroups(groups, comboDefaults(groups))), ["g-sides"]);

  // Upgrades are priced per portion, the same way the server prices them.
  assert.equal(comboSurcharge(groups, { "g-drink": { "o-juice": 1 }, "g-sides": { "o-wings2": 1 } }), 50 + 200);

  /*
   * The payload is keyed by product and variant because that is what the
   * server matches on — a size is part of the answer, since one product can be
   * two options in a slot.
   */
  assert.deepEqual(toComboPayload(groups, { "g-drink": { "o-juice": 1 }, "g-sides": { "o-fries": 1 } }), [
    { groupId: "g-drink", productId: "p-juice", variantId: "v-juice" },
    { groupId: "g-sides", productId: "p-fries" },
  ]);
  // No quantity: the catalog decides what one portion is, not this file.
  assert.ok(
    toComboPayload(groups, { "g-sides": { "o-wings2": 1 } }).every((row) => !("quantity" in row)),
    "the client sends a portion size the catalog already owns",
  );

  const form = fsForGuard.readFileSync("src/components/products/ProductOrderForm.js", "utf8");
  assert.match(form, /comboSelections: toComboPayload\(comboGroups, comboPicks, comboMods\)/);
  // The slot surcharge is part of what ONE costs, so it is added before the
  // quantity multiplies rather than once at the end.
  const options = fsForGuard.readFileSync("src/lib/product-options.js", "utf8");
  assert.match(options, /let unit = \(Number\(basePrice\) \|\| 0\) \+ \(Number\(extra\) \|\| 0\);/);

  /*
   * A combo is built, not added. Its slots are answered on the product page,
   * so a one-tap Add on a card could only ever be refused.
   */
  const card = fsForGuard.readFileSync("src/components/menu/MenuItemCard.js", "utf8");
  assert.match(card, /const buildable = Boolean\(item\.isCombo\);/);
  assert.match(card, /Build it/);

  // And the dashboard no longer tells staff this is impossible.
  const workspace = fsForGuard.readFileSync("src/components/dashboard/products/ProductWorkspace.js", "utf8");
  assert.doesNotMatch(workspace, /cannot yet ask customers to choose/, "the dashboard still says combos are staff-only");
});

check("a branch's trading week can be edited, past midnight included", () => {
  /*
   * There was no screen for this at all. The endpoint always existed and the
   * branch page had a panel headed "Opening hours" that said "No hours set." —
   * so a new branch traded on an empty schedule and nothing in the dashboard
   * could give it one.
   *
   * The arithmetic is the part worth testing. "11:00 until 02:00" is not 11:00
   * to 02:00: it is 660 to 1560, minutes past the *same* midnight. Read it as
   * 120 and the shop shuts nine hours early.
   */
  const week = hoursToForm([{ dayOfWeek: 1, opensAt: 660, closesAt: 1560 }]);
  assert.equal(week.length, 7, "a week is seven rows whatever the API returned");
  assert.equal(week[1].open, true);
  assert.equal(week[1].opensAt, "11:00");
  assert.equal(week[1].closesAt, "02:00", "a past-midnight close is shown on the next day's clock");
  assert.equal(week[1].overnight, true);
  assert.equal(week[0].open, false, "a day with no window is open");
  assert.equal(describeRow(week[1]), "11:00–02:00 (next day)");
  assert.equal(describeRow(week[0]), "Closed");

  // And back out again, unchanged.
  const { hours, errors } = hoursPayload(week);
  assert.deepEqual(errors, {});
  assert.deepEqual(hours, [{ dayOfWeek: 1, opensAt: 660, closesAt: 1560, channel: null }]);

  /*
   * A day that cannot be understood is named, never dropped: a silently
   * dropped day is a day the shop is shut and nobody meant it.
   */
  const bad = hoursPayload([{ dayOfWeek: 3, open: true, opensAt: "20:00", closesAt: "02:00", overnight: false }]);
  assert.deepEqual(bad.hours, []);
  assert.match(bad.errors[3], /past midnight/);
  assert.match(hoursPayload([{ dayOfWeek: 4, open: true, opensAt: "nonsense", closesAt: "23:00" }]).errors[4], /24-hour time/);

  // Closed days send nothing rather than a zero-length window.
  assert.deepEqual(hoursPayload([{ dayOfWeek: 2, open: false, opensAt: "11:00", closesAt: "23:00" }]).hours, []);

  const editor = fsForGuard.readFileSync("src/components/dashboard/branches/BranchHoursEditor.js", "utf8");
  // The endpoint replaces the week, so the form has to send all of it.
  assert.match(editor, /api\.put\(`\/admin\/branches\/\$\{branchId\}\/hours`, \{ hours: body \}\)/);
});

check("a dropped connection after a write does not say \"try again\"", () => {
  /*
   * A serverless pooler drops connections routinely, and the drop can land
   * after the statement committed — the request fails while the row exists.
   * These carry a POSIX code, not a Prisma `P` one, so they fell past the
   * mapper to a flat "Something went wrong". Creating a modifier group showed
   * exactly that, had created it, and answered the retry with a duplicate
   * error.
   */
  const dropped = Object.assign(new Error(""), { code: "ETIMEDOUT" });

  const onWrite = fromPrismaError(dropped, { method: "POST" });
  assert.equal(onWrite.code, "SERVICE_UNAVAILABLE");
  assert.match(onWrite.message, /may still have been saved/, "a write is told to retry, which creates duplicates");

  const onRead = fromPrismaError(dropped, { method: "GET" });
  assert.match(onRead.message, /Please try again/);
  assert.doesNotMatch(onRead.message, /may still have been saved/, "a read claims it might have written something");

  // The default is the safe one for a caller that does not say.
  assert.match(fromPrismaError(dropped).message, /Please try again/);

  // Ordinary Prisma errors are untouched.
  assert.equal(fromPrismaError({ code: "P2002", meta: { target: ["email"] } }).code, "CONFLICT");
  assert.equal(fromPrismaError({ code: "P1017" }).code, "SERVICE_UNAVAILABLE");
  assert.equal(fromPrismaError(new Error("plain")), null, "a non-database error is dressed up as one");

  const handler = fsForGuard.readFileSync("src/lib/api/handler.js", "utf8");
  assert.match(handler, /fromPrismaError\(error, \{ method: request\.method \}\)/);
});

check("a menu goes live on creation unless it would replace a live one", () => {
  /*
   * Menus were created switched off, with no control on the form and no
   * warning after: the storefront quietly fell back to catalogue prices and
   * said "no menu running right now". That is right for a trading shop — a
   * new menu is empty, and an empty menu that wins the pick leaves a branch
   * with nothing to sell — and wrong for the first menu a branch ever has,
   * which is every setup.
   *
   * So the rule is displacement, not novelty.
   */
  const service = fsForGuard.readFileSync("src/server/services/menu.service.js", "utf8");
  assert.match(service, /const displaces = await tx\.menu\.count\(\{[\s\S]*?isActive: true,/);
  assert.match(service, /isActive: data\.isActive \?\? displaces === 0/);
  assert.doesNotMatch(service, /isActive: data\.isActive \?\? false/, "menus are created switched off again");

  // And the form says which it will be, before the button is pressed.
  const form = fsForGuard.readFileSync("src/components/dashboard/menus/MenuForm.js", "utf8");
  assert.match(form, /already has a live \$\{typeLabel\} menu/);
  assert.match(form, /first menu of its kind here, so it goes live/);
});

check("a menu with nothing under a heading says so", () => {
  /*
   * Sections are the easiest step in the setup to skip: nothing asks for them,
   * and a menu without them is not broken — it arrives on the storefront as a
   * single heading called "More" with the whole menu under it, which reads as
   * a styling fault rather than a missing step.
   */
  const editor = fsForGuard.readFileSync("src/components/dashboard/menus/MenuSectionsEditor.js", "utf8");
  assert.match(editor, /\{unsectioned > 0 \? \(/, "the notice shows on a menu that is properly filed");
  assert.match(editor, /one group called/);

  // Counted per product: three sizes of one pizza are one thing in the wrong
  // place, not three.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/menus/[id]/page.js", "utf8");
  assert.match(page, /new Set\(items\.filter\(\(row\) => !row\.sectionId\)\.map\(\(row\) => row\.productId\)\)\.size/);
});

check("a new product can be put on a menu without leaving the form", () => {
  /*
   * Creating a product left it sold nowhere: it had to be added to a branch
   * menu from a different page, and the form said so rather than offering it.
   * The question "where does this sell" belongs with the product.
   */
  const form = fsForGuard.readFileSync("src/components/dashboard/products/ProductDetailsForm.js", "utf8");
  assert.match(form, /api\.post\(`\/admin\/menus\/\$\{menu\.value\}\/items`, \{ productId: created\.id \}\)/);

  /*
   * Placement runs after the product exists and never undoes it. The product
   * is saved by that point: a thrown error over work that succeeded is how
   * somebody fills the whole form in a second time.
   */
  const placement = form.slice(form.indexOf("const refused = []"), form.indexOf("router.push"));
  assert.match(placement, /catch \(failure\) \{/, "one failed menu loses the product");
  assert.match(placement, /refused\.push/);
  assert.doesNotMatch(placement, /throw/, "a failed placement throws away a created product");

  // Create only: on an existing product this is still the Menus page's job,
  // where a price override and a section can be set at the same time.
  assert.match(form, /\{!editing && options\.menus\?\.length \? \(/);

  /*
   * Offered menus follow where the product is sold. A branch-scoped product on
   * another branch's menu is a placement the storefront refuses to show, which
   * reads as "I added it and nothing happened".
   */
  const menus = [
    { value: "m1", branchId: "b1", branchName: "Karachi" },
    { value: "m2", branchId: "b2", branchName: "Lahore" },
  ];
  assert.deepEqual(menusForBranch(menus, "b1"), [menus[0]]);
  assert.deepEqual(menusForBranch(menus, ""), menus, "a chain-wide product is offered nothing");
  assert.deepEqual(menusForBranch(undefined, "b1"), [], "missing options throw instead of offering nothing");

  /*
   * Scoped by `menus.update`, not by `products.create`: being allowed to write
   * a product says nothing about being allowed to change what a branch sells.
   */
  const admin = fsForGuard.readFileSync("src/server/content/product-admin.js", "utf8");
  assert.match(admin, /actionableBranches\(principal, "menus\.update"\)/);
  assert.match(admin, /menus,/, "the form options never carry the menus");
});

check("the home page sells: categories to browse, dishes to order", () => {
  /*
   * The page had a banner, one deal and three pieces of marketing. No way in
   * to the menu, and nothing on it you could actually buy.
   */
  const page = fsForGuard.readFileSync("src/app/(site)/page.js", "utf8");
  assert.match(page, /<CategoryRail categories=\{data\.categories\.items\}/);
  assert.match(page, /<MenuHighlights items=\{data\.products\}/);
  // Browsing above persuasion: "do you do pizza" is asked before "what is the offer".
  assert.ok(page.indexOf("<CategoryRail") < page.indexOf("<DealOfTheDay"), "the categories sit below the deal");

  /*
   * The grid uses the menu's own card, so Add writes to the real server cart —
   * which prices the line against the branch's live menu and refuses an item
   * that has been 86'd. A decorative copy would have to grow all of that.
   */
  const highlights = fsForGuard.readFileSync("src/components/home/MenuHighlights.js", "utf8");
  assert.match(highlights, /import MenuItemCard from "@\/components\/menu\/MenuItemCard"/);
  assert.match(highlights, /if \(!items\?\.length\) return null;/, "an empty catalog renders invented dishes");

  /*
   * And no placeholder behind it, unlike every other section. Fake dishes would
   * be a shop window of things nobody can buy, each linking to a product page
   * that does not exist.
   */
  const home = fsForGuard.readFileSync("src/server/content/home.js", "utf8");
  assert.doesNotMatch(home, /products: [\s\S]{0,80}isPlaceholder/, "the orderable grid falls back to placeholders");
  // Nothing appears twice: the deal and the cards beside it are taken out.
  assert.match(home, /const spokenFor = new Set\(\[deal\?\.id, \.\.\.rail\.map/);

  /*
   * One mapper, not one per caller. The card is drawn in three places and each
   * was flattening the row inline, which is how one of them ends up missing a
   * field — the related-products copy was already dropping `compareAtPrice`.
   */
  const related = fsForGuard.readFileSync("src/components/products/RelatedProducts.js", "utf8");
  assert.match(related, /item=\{toMenuCard\(item\)\}/);

  const card = toMenuCard({
    id: "p1",
    name: "Zinger",
    slug: "zinger",
    isFeatured: true,
    defaultVariant: { compareAtPrice: "1899.00" },
    variants: [{ id: "v1", name: "Regular", price: "1299.00", compareAtPrice: "1899.00" }],
  });
  // Decimals are strings off Prisma and would render as "1299.00" or compare
  // wrongly against a number.
  assert.equal(card.variants[0].price, 1299);
  assert.equal(card.compareAtPrice, 1899);
  assert.equal(card.variants[0].variantId, "v1", "the card reads variantId, not id");
  assert.equal(card.isRecommended, true);
  assert.deepEqual(toMenuCard({ id: "p2", name: "Chips", slug: "chips" }).variants, [], "a product with no variants throws");
});

check("picking an image starts at the library, not the file manager", () => {
  /*
   * Every form that wanted a picture opened the file manager directly, so the
   * same logo arrived four times under four names and the Media tab could only
   * watch it happen. Choosing comes first now; uploading is a button inside.
   */
  const field = fsForGuard.readFileSync("src/components/ui/ImageField.js", "utf8");
  assert.match(field, /<MediaPicker/);
  assert.doesNotMatch(field, /type="file"/, "the field still opens the file manager itself");

  const picker = fsForGuard.readFileSync("src/components/ui/MediaPicker.js", "utf8");
  // A video re-encoded through a canvas is destroyed; only images are compressed.
  assert.match(picker, /kind === "video" \? await uploadFile\(/);
  assert.match(picker, /Escape/, "the dialog cannot be dismissed with the keyboard");

  /*
   * `meta` sits beside `data` in the envelope and the client unwrapped to
   * `data`, so the pagination cursor was unreachable from the browser — which
   * is why every paginated list until now was server-rendered. Opt-in, so no
   * existing caller changes shape.
   */
  const client = fsForGuard.readFileSync("src/lib/api-client.js", "utf8");
  assert.match(client, /return withMeta \? \{ data: payload\.data, meta: payload\.meta \?\? null \} : payload\.data;/);
  assert.match(picker, /api\.get\(`\/media\?\$\{query\}`, \{ withMeta: true \}\)/);
  // This client sends options, not params: a query object would be ignored and
  // the filter would silently not apply.
  assert.match(picker, /new URLSearchParams\(\{ mimeType: mime/);
});

check("a banner says how its artwork will be cropped, and which edge to keep", () => {
  /*
   * The band is about two to one; photography is not. A 1200×1800 portrait
   * uploaded as a banner shows its middle third blown up three times, and the
   * only way anybody found that out was by looking at the live home page.
   *
   * So: say how much survives, and let the editor pick the edge that does.
   */
  // The three real uploads this was built against.
  assert.deepEqual(cropReport(1200, 1800), { axis: "vertical", visible: 32 });
  assert.deepEqual(cropReport(1024, 830), { axis: "vertical", visible: 59 });
  assert.deepEqual(cropReport(1260, 709), { axis: "vertical", visible: 85 });

  // A photo wider than the band loses its sides instead, and one that matches
  // loses nothing — a crop report that always cried "cropped" would be noise.
  assert.deepEqual(cropReport(4000, 1000), { axis: "horizontal", visible: 53 });
  assert.deepEqual(cropReport(2100, 1000), { axis: null, visible: 100 });
  assert.equal(cropReport(0, 0), null, "a missing size is reported as a crop");
  assert.ok(HERO_BAND_RATIO > 2 && TIGHT_CROP > 0);

  const field = fsForGuard.readFileSync("src/components/dashboard/hero/ArtworkField.js", "utf8");
  // Top and bottom mean nothing when the cut is at the sides, and a control
  // that silently ignores you is worse than no control.
  assert.match(field, /const choosable = !crop \|\| crop\.axis === "vertical";/);

  /*
   * The class names are written out, not assembled.
   *
   * `object-${focalPoint.toLowerCase()}` is a class the compiler never sees, so
   * it is never emitted, and the hero silently keeps centring on the most
   * visited page of the site.
   */
  const backdrop = fsForGuard.readFileSync("src/components/home/HeroBackdrop.js", "utf8");
  assert.match(backdrop, /TOP: "object-top"/);
  assert.doesNotMatch(backdrop, /`object-\$\{/, "the focal class is built at runtime and will not ship");

  // And the choice reaches the page: stored, selected, carried, applied.
  const prisma = fsForGuard.readFileSync("prisma/schema/12-system.prisma", "utf8");
  assert.match(prisma, /focalPoint HeroFocus @default\(CENTER\)/);
  const service = fsForGuard.readFileSync("src/server/services/hero.service.js", "utf8");
  assert.match(service, /focalPoint: true/, "the loader drops the field before it reaches the page");
  const carousel = fsForGuard.readFileSync("src/components/home/HeroCarousel.js", "utf8");
  assert.match(carousel, /focalPoint=\{slide\.focalPoint\}/);
  const schemas = fsForGuard.readFileSync("src/server/validation/hero.schemas.js", "utf8");
  assert.match(schemas, /focalPoint: z\.enum\(\["TOP", "CENTER", "BOTTOM"\]\)/, "a free string lands in a class name");
});

check("a banner can be rewritten, not only written and deleted", () => {
  /*
   * The first version of this screen could add, reorder, switch off and delete
   * a banner but never change one, so fixing a typo in the headline meant
   * deleting the campaign and building it again — losing its place in the
   * order and its schedule with it.
   *
   * One form serves both jobs. A second copy for the edit case is how the two
   * drift until a field can be set on creation and never changed again, so the
   * test holds the shared component rather than the button.
   */
  const slides = fsForGuard.readFileSync("src/components/dashboard/hero/HeroSlides.js", "utf8");
  assert.match(slides, /function SlideForm\(/);
  assert.match(slides, /idPrefix="hero-new"/, "the create case no longer uses the shared form");
  assert.match(slides, /idPrefix="hero-edit"/, "there is no edit case");
  assert.match(
    slides,
    /api\.patch\(`\/admin\/hero-slides\/\$\{slide\.id\}`, body\)/,
    "saving an edit does not send the whole slide",
  );

  // `datetime-local` holds wall-clock time. Seeding it with the ISO string the
  // API returns shows an editor in Karachi a time nobody chose, and saving it
  // back then moves the campaign by the offset.
  assert.match(slides, /function localInput\(/);
  assert.doesNotMatch(slides, /startsAt: slide\.startsAt/, "the form is seeded with a UTC string");
  assert.match(slides, /startsAt: localInput\(slide\.startsAt\)/);
});

check("reordering rebuilds what it can and says what it could not", () => {
  // A past order is a receipt, not a template: the kitchen moves on. Refusing
  // the whole reorder because one drink was discontinued is worse than
  // rebuilding the meal and saying the drink is unavailable.
  const service = fsForGuard.readFileSync("src/server/services/reorder.service.js", "utf8");
  assert.match(service, /unavailable\.push/, "a missing line kills the whole reorder");
  assert.match(service, /if \(!added\.length\)/, "an entirely unavailable order reports success");

  // Prices come from today's menu, not the old row. Honouring a three-week-old
  // price because it is written on a receipt is selling at a loss by accident.
  assert.doesNotMatch(service, /unitPrice|lineTotal/, "the old order's prices are being carried over");

  // Somebody else's order is a 404, not a 403: a 403 confirms the id is real.
  assert.match(service, /order\.userId !== userId\) throw ApiError\.notFound/);

  // The cart returned by `addItem` is threaded through the loop — handed a
  // stale one it cannot see the line added a moment ago, and two identical
  // lines land side by side instead of merging into a quantity.
  assert.match(service, /current = await addItem\(\{\s*cart: current/);
});

check("a manual punch asks the roster which day it is correcting", () => {
  // The lock check guards a paid day. Keyed off `startOfDay(at)` it reads the
  // instant's UTC calendar date, which for a night shift is the day after the
  // one the punch belongs to — and east of Greenwich is the day before, for
  // every evening punch. Either way it consults a different row than the one
  // derivation will write, so a correction to an open day is refused and one
  // into a locked day goes through.
  const source = fsForGuard.readFileSync("src/server/services/punch.service.js", "utf8");
  const manual = source.slice(source.indexOf("export async function addManualPunch"));

  assert.match(manual, /const workDate = await rosteredWorkDate\(/, "the work date comes from the roster");
  assert.match(manual, /employeeId_workDate: \{ employeeId, workDate \}/, "and the lock is looked up under it");
  assert.doesNotMatch(manual, /workDate: startOfDay\(at\)/, "not the UTC calendar date of the instant");

  // And the resolver hands `workDateForPunch` the branch's own timezone —
  // without it the helper falls back to UTC and nothing has been fixed.
  const resolver = source.slice(
    source.indexOf("async function rosteredWorkDate"),
    source.indexOf("export async function addManualPunch"),
  );
  assert.match(resolver, /workDateForPunch\(\{ punchedAt: at, assignments, timezone \}\)/);
  assert.match(manual, /timezone: employee\.branch\?\.timezone \?\? "UTC"/);
});

check("a receipt is gated on the same allow-list the Receive button is", () => {
  // The order page shows Receive only when `poReceivable`; the service asked
  // a deny-list of its own — DRAFT, PENDING_APPROVAL, CANCELLED — so CLOSED
  // and RECEIVED fell through it. A short close says the rest is no longer
  // expected, and a delivery against one revived an order the business had
  // written off; a second delivery against a RECEIVED order doubled both the
  // stock and the payable. The UI and the API disagreed, and the API wins.
  const source = fsForGuard.readFileSync("src/server/services/goods-receipt.service.js", "utf8");

  assert.match(source, /import \{ poReceivable \} from "@\/lib\/purchasing"/);
  assert.match(source, /if \(!poReceivable\(order\.status\)\)/, "the allow-list decides");
  assert.doesNotMatch(
    source,
    /\["DRAFT", "PENDING_APPROVAL", "CANCELLED"\]\.includes\(order\.status\)/,
    "the hand-rolled deny-list is gone",
  );

  // And the list itself still says what it should, since the guard is only as
  // good as the predicate it defers to.
  assert.equal(poReceivable("APPROVED"), true);
  assert.equal(poReceivable("SENT"), true);
  assert.equal(poReceivable("PARTIALLY_RECEIVED"), true);
  for (const status of ["DRAFT", "PENDING_APPROVAL", "RECEIVED", "CLOSED", "CANCELLED"]) {
    assert.equal(poReceivable(status), false, `${status} is not receivable`);
  }
});

check("an instant is dated in the store's timezone, a plain date in UTC", () => {
  // A delivery checked in at 03:30 in Karachi is 22:30 the day before in UTC.
  // Dated in UTC it appeared on screen under the 27th against a docket the
  // manager was holding that said the 28th.
  const earlyMorning = "2026-10-27T22:30:00Z";
  assert.equal(dateLabel(earlyMorning, "Asia/Karachi"), "28 Oct 2026");
  assert.equal(dateLabel(earlyMorning), "27 Oct 2026", "UTC stays the default");

  // West of Greenwich it moves the other way, which is why a `@db.Date`
  // column — handed back as UTC midnight with no time of day — must keep
  // being read in UTC and keeps passing no zone.
  const plainDate = "2026-11-01T00:00:00.000Z";
  assert.equal(dateLabel(plainDate), "1 Nov 2026");
  assert.equal(dateLabel(plainDate, "America/New_York"), "31 Oct 2026", "why a bill date passes no zone");

  assert.equal(dateLabel(null), "—");
  assert.equal(dateLabel("not a date", "Asia/Karachi"), "—");
});

check("the store's timezone is a setting that something actually reads", () => {
  // `store.timezone` was declared in the registry from the beginning,
  // defaulted to Asia/Karachi, shown in the settings screen — and read by
  // nothing, which is how every instant on the dashboard came to be dated in
  // UTC while the setting sat there looking honoured.
  const registry = fsForGuard.readFileSync("src/server/settings/registry.js", "utf8");
  assert.match(registry, /key: "store\.timezone"/);

  const site = fsForGuard.readFileSync("src/server/content/site.js", "utf8");
  assert.match(site, /timeZone: settings\["store\.timezone"\] \|\| "UTC"/, "the identity carries it");
  // The fallback identity is returned when the settings read fails, and a
  // missing key there would read as `undefined` at every call site.
  const fallback = site.slice(site.indexOf("export async function getSiteIdentity"));
  assert.match(fallback, /timeZone: "UTC"/, "the fallback carries it too");
});

check("a detail page says 'not here' only about records that are not here", () => {
  // `getGoodsReceipt(id).catch(() => null)` in front of `notFound()` told a
  // manager his delivery note "does not exist or is not one you can open"
  // when Neon had merely dropped the connection — the receipt was fine, he
  // had posted it minutes earlier. Every detail page in the dashboard did
  // this, so a wobble read as the records having vanished, and the real
  // failure never reached a log or the error boundary.
  const { readdirSync, readFileSync, statSync } = fsForGuard;

  const pages = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = `${dir}/${entry}`;
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === "page.js") pages.push(full);
    }
  };
  walk("src/app");

  const offenders = [];
  for (const file of pages) {
    const text = readFileSync(file, "utf8");
    if (!/\bnotFound\(\)/.test(text)) continue;
    // Only the body: `generateMetadata` falls back to a plain title when a
    // lookup fails, which is a kindness rather than a lie.
    const body = text.slice(text.search(/^export default async function/m));
    if (/\.catch\(\(\) => null\)/.test(body) || /\.catch\(\(\) => notFound\(\)\)/.test(body)) {
      offenders.push(file);
    }
  }

  // The optional side-loads are allowed to swallow: a panel that cannot be
  // drawn should not take the page down with it.
  const allowed = new Set([
    "src/app/(dashboard)/dashboard/qr-codes/[id]/page.js",
    "src/app/(dashboard)/dashboard/drivers/[id]/page.js",
    "src/app/(dashboard)/dashboard/recipes/[id]/edit/page.js",
  ]);
  const unexpected = offenders.filter((file) => !allowed.has(file));
  assert.deepEqual(unexpected, [], `these pages turn any failure into "not here": ${unexpected.join(", ")}`);

  // And the helper narrows rather than swallows.
  const errors = readFileSync("src/lib/api/errors.js", "utf8");
  assert.match(errors, /export async function nullIfMissing/);
  assert.match(errors, /if \(isNotFound\(error\)\) return null;\s*\n\s*throw error;/);
  assert.match(errors, /if \(isNotFound\(error\) \|\| isForbidden\(error\)\) return null;\s*\n\s*throw error;/);
});

check("a receipt does not claim to be unbilled at somebody who cannot see bills", () => {
  // `billForReceipt` returns null both when there is no bill and when the
  // viewer may not see one — the scoping is deliberate, the conflation was
  // not. A branch manager holding a paid invoice was told the delivery was
  // still sitting in goods received not invoiced.
  const page = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/goods-receipts/[id]/page.js", "utf8");
  assert.match(page, /const seesBills = can\(principal, "supplier_bills\.read", \{ branchId \}\)/);
  // The accounting claim is made only to somebody who would have been shown
  // the bill if there were one.
  const clause = page.slice(page.indexOf("{bill ? ("), page.indexOf("Nothing can be billed"));
  assert.match(clause, /!seesBills \?[\s\S]*?\) : posted \?[\s\S]*Not yet invoiced/);
});

check("deriving a range reads once per employee, not once per day", () => {
  // A month for ten people was close to two thousand round-trips — the
  // employee, the roster, the holidays, the leave and the punches re-asked
  // for every single day, when only the day itself changes. It took longer
  // than an HTTP client waits: the request timed out, the loop stopped
  // halfway, and the month sat half derived with nothing on screen to say so.
  const source = fsForGuard.readFileSync("src/server/services/attendance.service.js", "utf8");
  const range = source.slice(source.indexOf("export async function deriveRange"));

  assert.match(range, /const loaded = await loadRange\(\{ employee, start, end, holidays \}\)/, "loaded once per employee");
  assert.match(range, /deriveAttendanceDay\(\{ employeeId: employee\.id, workDate, force, loaded \}\)/, "and handed to each day");

  // The holiday calendar belongs to the dates, not the people, so it is read
  // before the loop over employees rather than inside it.
  const holidayQuery = range.indexOf("prisma.holiday.findMany");
  const employeeLoop = range.indexOf("for (const employee of employees)");
  assert.ok(holidayQuery > 0 && holidayQuery < employeeLoop, "holidays are read once, outside the loop");

  // "Mark these punches processed" is the same statement every day.
  assert.match(range, /if \(loaded\.processed\.size\)[\s\S]*?attendancePunch\.updateMany/, "punches are flushed once per employee");

  // And the single-day entry point still stands on its own, because leave
  // approval re-derives one day at a time.
  const day = source.slice(source.indexOf("export async function deriveAttendanceDay"));
  assert.match(day, /loaded\?\.employee \?\?/, "no bundle, it still loads the employee itself");
  assert.match(day, /loaded\s*\?\s*loaded\.context\(day\)\s*:\s*await contextFor/, "and its own context");
});

check("the workspace shell is at least a screen tall", () => {
  // `min-h-full` is a percentage against <body>, whose height is auto, so it
  // resolved to nothing and the sidebar's border stopped wherever the content
  // did. Invisible on a long staff table, obvious on a short account page.
  const text = fsForGuard.readFileSync("src/components/dashboard/DashboardShell.js", "utf8");
  assert.match(text, /<div className="flex min-h-dvh">/);
  assert.doesNotMatch(text, /className="flex min-h-full"/);
});

check("a role that can raise a document can also send it for approval", () => {
  // The dead end this catches: `submit` gated on a permission the raiser does
  // not hold. Four seeded roles could raise a purchase order and none could
  // send it on, so every one of their orders sat in DRAFT where no approver
  // ever looked — a buy request that silently never happened. Written against
  // the routes rather than a list of modules, so the next document with a
  // submit step is covered the day it is added.
  const { readdirSync, readFileSync, existsSync } = fsForGuard;
  const root = "src/app/api/v1/admin";
  const permissionOf = (text, method) => {
    const block = text.split(`export const ${method} =`)[1] ?? "";
    return block.match(/permissions:\s*"([^"]+)"/)?.[1] ?? null;
  };

  const pairs = [];
  for (const resource of readdirSync(root)) {
    const submit = `${root}/${resource}/[id]/submit/route.js`;
    const collection = `${root}/${resource}/route.js`;
    if (!existsSync(submit) || !existsSync(collection)) continue;
    const create = permissionOf(readFileSync(collection, "utf8"), "POST");
    const send = permissionOf(readFileSync(submit, "utf8"), "POST");
    if (create && send) pairs.push({ resource, create, send });
  }

  assert.ok(pairs.length >= 2, "found the submit routes to check");
  assert.ok(pairs.some((pair) => pair.resource === "purchase-orders"));

  for (const role of SYSTEM_ROLES) {
    const held = new Set(resolvePermissionKeys(role, [...EVERY_PERMISSION_KEY]));
    for (const { resource, create, send } of pairs) {
      if (!held.has(create)) continue;
      assert.ok(
        held.has(send),
        `${role.key} can raise a ${resource} document (${create}) but cannot send it on (${send})`,
      );
    }
  }
});

// --- cash that moves must reach the ledger ---------------------------------

check("every path that captures a payment announces it, or the receipt never posts", () => {
  // `postPaymentReceipt` is driven by the `payment.captured` event and nothing
  // else. A capture written straight to the row leaves the sale sitting in
  // accounts receivable for money that is already in the till — and nothing
  // anywhere reports a problem, because as far as the order is concerned it is
  // paid. Two of the three capture paths had this bug: cash collected at the
  // door, and every gateway webhook.
  const captureFiles = [
    "src/server/services/payment.service.js",
    "src/server/services/delivery.service.js",
    "src/server/services/payment-webhook.service.js",
  ];

  for (const file of captureFiles) {
    const source = fsForGuard.readFileSync(file, "utf8");
    if (!source.includes('status: "CAPTURED"')) continue;
    assert.match(
      source,
      /eventType: "payment\.captured"/,
      `${file} sets a payment to CAPTURED but never enqueues payment.captured`,
    );
  }
});

check("nothing is left of the handover code", () => {
  // Removed outright rather than defaulted off. The code was generated by a
  // dispatch-only button and returned once, to dispatch — nothing ever put it
  // in front of the customer who was supposed to read it out. A setting that
  // can only ever block a delivery is not a setting, and a half-wired feature
  // left in the tree is one someone switches on later.
  const files = [
    "src/server/services/delivery.service.js",
    "src/server/delivery/state.js",
    "src/server/settings/registry.js",
    "src/server/content/delivery-admin.js",
    "src/server/validation/delivery.schemas.js",
    "src/app/(dashboard)/dashboard/deliveries/[id]/page.js",
    "scripts/openapi/taxonomy.js",
  ];

  for (const file of files) {
    const source = fsForGuard.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /handover/i, `${file} still mentions the handover code`);
    assert.doesNotMatch(source, /otpHash/, `${file} still reads the delivery OTP hash`);
  }

  assert.ok(!fsForGuard.existsSync("src/components/dashboard/delivery/HandoverCode.js"), "the dispatch button is gone");
  assert.ok(
    !fsForGuard.existsSync("src/app/api/v1/admin/deliveries/[id]/handover-code/route.js"),
    "the endpoint that issued it is gone",
  );

});

check("cash cannot be captured around the drawer", () => {
  // `collect` attaches money to a register session; `capture` does not. They
  // sit one route apart with the same permissions on the Cashier role, so the
  // wrong one was reachable: the order read PAID, the notes were in the till,
  // no movement was written, and the drawer closed short by the sale.
  const source = fsForGuard.readFileSync("src/server/services/payment.service.js", "utf8");
  const start = source.indexOf("export async function capturePayment");
  assert.ok(start > 0, "found capturePayment");
  const body = source.slice(start, source.indexOf("\nexport async function markCollected"));

  // Matched as the whole condition, not just its parts: `MANUAL_METHODS` and
  // `viaDrawer` both appear elsewhere in this function, so a looser pattern
  // passes while the guard itself is gone.
  assert.match(
    body,
    /if \(!viaDrawer && MANUAL_METHODS\.includes\(payment\.method\)\) \{\s*\n\s*throw ApiError\.conflict\(/,
    "cash-like money has to be refused here, and refused by throwing",
  );
  assert.match(body, /marked collected, not captured/, "and told where to go instead");

  // `markCollected` is the one caller allowed past the guard.
  const collect = source.slice(source.indexOf("export async function markCollected"));
  assert.match(collect, /viaDrawer: true/);

  // Money already captured with no drawer is adoptable, or the only repair is a
  // hand-written adjustment that hides what happened.
  assert.match(collect, /payment\.registerSessionId != null/);
});

check("a cash refund leaves the till that took the money", () => {
  // The drawer was chosen by `openedAt desc`, so with a second register running
  // the refund came out of whichever till opened last: the one that sold closed
  // over, an unrelated one closed short — two false variances from one correct
  // refund.
  const source = fsForGuard.readFileSync("src/server/services/refund.service.js", "utf8");
  const start = source.indexOf("async function drawerToRefundFrom");
  assert.ok(start > 0, "the drawer is chosen deliberately, not inline");
  const body = source.slice(start, source.indexOf("\n/**", start));

  // The whole lookup, not a mention of the field: it appears twice in two
  // lines, so matching the name alone survives the lookup being gutted.
  assert.match(
    body,
    /const original = refund\.payment\.registerSessionId\s*\n\s*\? await open\(\{ id: refund\.payment\.registerSessionId \}\)\s*\n\s*: null;\s*\n\s*if \(original\) return original;/,
    "the till that took the money is looked up first and returned before any fallback",
  );
  assert.doesNotMatch(body, /openedAt/, "never 'whichever opened last'");
  // Several open and nothing to tie the refund to one of them: guess nothing.
  assert.match(body, /length === 1/);
});

check("nothing stands between a driver and marking a drop delivered", () => {
  // The proof photo went the same way as the door-step code. A rider at the
  // kerb with the customer already walking back inside should not be held up
  // by an upload, and the order is paid for either way. `signatureUrl` went
  // with it: a column nothing has ever written to or read.
  const files = [
    "src/server/services/delivery.service.js",
    "src/server/settings/registry.js",
    "src/server/validation/delivery.schemas.js",
    "src/app/(dashboard)/dashboard/deliveries/[id]/page.js",
    "prisma/schema/07-delivery.prisma",
  ];

  for (const file of files) {
    const source = fsForGuard.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /proofImage/i, `${file} still carries the proof photo`);
    assert.doesNotMatch(source, /require_proof_photo/, `${file} still reads the proof-photo setting`);
    assert.doesNotMatch(source, /signatureUrl/, `${file} still carries the unused signature column`);
  }

  // DELIVERED now turns on the sequence alone. Nothing else may refuse it.
  const service = fsForGuard.readFileSync("src/server/services/delivery.service.js", "utf8");
  assert.doesNotMatch(service, /assertProofIsValid|assertHandoverIsValid/, "no gate is left on the doorstep");

  // What the driver reports is still recorded — it asks nothing of anyone.
  assert.match(service, /recipientName/);
});

check("the COD settlement announces the capture it just made", () => {
  // Scoped to the function rather than the file: an enqueue somewhere else in
  // delivery.service.js would satisfy a file-wide check while the door-step
  // capture still posted nothing.
  const source = fsForGuard.readFileSync("src/server/services/delivery.service.js", "utf8");
  const start = source.indexOf("async function settleCod");
  assert.ok(start > 0, "found settleCod");
  const body = source.slice(start, source.indexOf("\n// --- reads"));

  assert.match(body, /status: "CAPTURED"/, "this is the function that captures the cash");
  assert.match(body, /eventType: "payment\.captured"/, "and it has to say so");
  assert.match(body, /db: tx/, "enqueued in the same transaction as the capture, or a crash loses one of them");
});

check("every setting is reachable on the settings screen", () => {
  // The screen groups settings by key prefix from a hard-coded list, so a
  // setting whose prefix has no group is stored, validated, honoured by the
  // service — and invisible. `payroll.require_separate_approver` landed exactly
  // there: the override existed and nobody could find it. A setting nobody can
  // reach is a setting that gets worked around.
  const groups = fsForGuard.readFileSync("src/app/(dashboard)/dashboard/settings/page.js", "utf8");
  const grouped = new Set([...groups.matchAll(/prefix: "([a-z_]+)"/g)].map((m) => m[1]));

  const prefixes = new Set(Object.keys(defaultSettings()).map((key) => key.split(".")[0]));
  const orphans = [...prefixes].filter((prefix) => !grouped.has(prefix));

  assert.deepEqual(orphans, [], `these settings have no group on the screen: ${orphans.join(", ")}`);
});

check("the account reaches the payslip from end to end", () => {
  // Three places have to agree, and each one of them silently nulls the account
  // if it forgets: the query payroll reads components with, the payslip line it
  // writes, and the query the posting rule reads back. Selecting a field is not
  // the same as writing it, and writing it is not the same as reading it — the
  // first version of this fix set it on the employee screen's query and not on
  // the one payroll actually calls.
  const employees = fsForGuard.readFileSync("src/server/services/employee.service.js", "utf8");
  const active = employees.slice(employees.indexOf("export async function activeComponents"));
  assert.match(active, /accountId: true/, "payroll's own component query has to ask for the account");

  const payroll = fsForGuard.readFileSync("src/server/services/payroll.service.js", "utf8");
  assert.match(payroll, /accountId: line\.accountId \?\? null/, "and generation has to write it onto the line");

  const posting = fsForGuard.readFileSync("src/server/services/posting.service.js", "utf8");
  const post = posting.slice(posting.indexOf("export async function postPayroll"));
  assert.match(post, /isEarning: false/, "the entry is built from the deduction lines");
  assert.match(post, /account: \{ select: \{ code: true \} \}/, "read back with their account codes");

  const builder = fsForGuard.readFileSync("src/server/attendance/payroll.js", "utf8");
  assert.match(builder, /accountId: component\.isEarning \? null : component\.accountId \?\? null/);
});

check("payroll deductions post where they belong, not all into tax", () => {
  // A provident fund is not tax, and an advance being recovered is an asset
  // coming back, not a liability going up. Crediting the lot to 2200 left the
  // tax account overstated by everything withheld for any other reason — and
  // the real balances only surface when somebody is asked to remit it.
  const { payrollLines } = postingRulesForPayout;
  const A = ACCOUNTS_FOR_PAYOUT;

  const lines = payrollLines({
    grossAmount: 50000,
    netAmount: 45000,
    deductions: [
      { accountCode: A.TAX_PAYABLE, amount: 2000 },
      { accountCode: "2340", amount: 2500 },
      // No account named: it still has to land somewhere deliberate.
      { accountCode: null, amount: 500 },
    ],
    periodName: "September 2026",
  });

  const credit = (code) => lines.filter((l) => l.accountCode === code).reduce((sum, l) => sum + Number(l.credit ?? 0), 0);

  assert.equal(credit(A.SALARIES_PAYABLE), 45000, "net pay is owed to staff");
  assert.equal(credit(A.TAX_PAYABLE), 2000, "only the tax is tax");
  assert.equal(credit("2340"), 2500, "the fund gets its own account");
  assert.equal(credit(A.EMPLOYEE_DEDUCTIONS_PAYABLE), 500, "and an unassigned deduction has a home of its own");

  const debits = lines.reduce((sum, l) => sum + Number(l.debit ?? 0), 0);
  const credits = lines.reduce((sum, l) => sum + Number(l.credit ?? 0), 0);
  assert.equal(debits, 50000, "salaries are expensed gross");
  assert.equal(debits, credits, "and the entry balances");
});

check("two deductions into one account post as one line", () => {
  // Otherwise a payslip with several components pointing at the same account
  // produces a journal entry with repeated lines saying the same thing.
  const { payrollLines } = postingRulesForPayout;
  const A = ACCOUNTS_FOR_PAYOUT;

  const lines = payrollLines({
    grossAmount: 10000,
    netAmount: 9000,
    deductions: [
      { accountCode: A.TAX_PAYABLE, amount: 600 },
      { accountCode: A.TAX_PAYABLE, amount: 400 },
    ],
    periodName: "September 2026",
  });

  const tax = lines.filter((l) => l.accountCode === A.TAX_PAYABLE);
  assert.equal(tax.length, 1, "one line per account");
  assert.equal(Number(tax[0].credit), 1000);
});

check("payroll with nothing withheld posts no deduction line", () => {
  const { payrollLines } = postingRulesForPayout;
  const lines = payrollLines({ grossAmount: 10000, netAmount: 10000, deductions: [], periodName: "September 2026" });
  assert.equal(lines.length, 2, "salaries expense and what is owed to staff, nothing else");
});

check("a driver who owes more cash than they earned still posts", () => {
  // A rider who hands in less than they collected ends the period owing money.
  // The payout nets to a negative number, and a negative number on a journal
  // line is rejected outright — so the entry never posted, the outbox retried
  // until it gave up, and the dashboard showed the payout as paid. The debt has
  // to land as a receivable against the driver, not as a negative credit.
  const { driverPayoutLines } = postingRulesForPayout;

  const owing = driverPayoutLines({ grossAmount: 300, codDeducted: 990, driverId: "d1", payoutNumber: "P-1" });
  for (const line of owing) {
    assert.ok(Number(line.debit) >= 0 && Number(line.credit) >= 0, "no line may carry a negative amount");
  }
  const debits = owing.reduce((sum, line) => sum + Number(line.debit), 0);
  const credits = owing.reduce((sum, line) => sum + Number(line.credit), 0);
  assert.equal(debits, credits, "the entry balances");

  const payable = owing.find((line) => line.accountCode === ACCOUNTS_FOR_PAYOUT.DRIVER_PAYABLE);
  assert.ok(payable, "the driver's balance is on the entry");
  assert.equal(Number(payable.debit), 690, "690 owed by the driver sits on the debit side");
  assert.equal(Number(payable.credit), 0);

  // The ordinary direction must keep working.
  const owed = driverPayoutLines({ grossAmount: 300, codDeducted: 0, driverId: "d1", payoutNumber: "P-2" });
  const owedPayable = owed.find((line) => line.accountCode === ACCOUNTS_FOR_PAYOUT.DRIVER_PAYABLE);
  assert.equal(Number(owedPayable.credit), 300, "money owed to the driver is still a credit");
  assert.equal(Number(owedPayable.debit), 0);
});

check("a driver on shift is offerable even before their phone has reported a position", () => {
  // The dispatch board's driver column is the only place a job can be handed
  // out, and it is fed by `driverPositions`. Requiring a location fix there
  // means a rider who has clocked on but whose phone has not pinged yet — GPS
  // denied, indoors, app backgrounded — is simply absent from the board, with
  // no row and no explanation. The component already greys out drivers who are
  // full rather than hiding them, for exactly this reason.
  const source = fsForGuard.readFileSync("src/server/services/driver.service.js", "utf8");
  const start = source.indexOf("export async function driverPositions");
  assert.ok(start > 0, "found driverPositions");
  const body = source.slice(start, source.indexOf("// --- shifts", start));

  assert.match(body, /status: \{ in: \["AVAILABLE", "ON_DELIVERY"\] \}/, "still only drivers who are on shift");
  assert.equal(
    /lastLocationAt: \{ not: null \}/.test(body),
    false,
    "a missing GPS fix must not remove a driver from the board",
  );
});

check("the dispatch board is sent the fields it judges a rider by", () => {
  // `availability()` reads isActive, maxActiveOrders and activeDeliveries, and
  // the riders column prints cashInHand. driverPositions filtered on isActive
  // but did not select it, so every rider arrived with it undefined and the
  // board greyed all of them out as "Not an active driver" — while the API
  // would happily have assigned the job. Absent is not the same as false.
  const source = fsForGuard.readFileSync("src/server/services/driver.service.js", "utf8");
  const start = source.indexOf("export async function driverPositions");
  const body = source.slice(start, source.indexOf("// --- shifts", start));
  const selected = body.slice(body.indexOf("select: {"));

  for (const field of ["isActive", "maxActiveOrders", "cashInHand"]) {
    assert.match(selected, new RegExp(`\\b${field}: true`), `the board reads ${field}, so it has to be selected`);
  }

  // And what it reads has to survive the mapping step.
  assert.match(body, /activeDeliveries: _count\.deliveries/);
});

check("a rider the board cannot read is not silently treated as inactive", () => {
  const { availability } = deliveryLibForBoard;
  const full = { isActive: true, status: "AVAILABLE", activeDeliveries: 3, maxActiveOrders: 3 };
  assert.equal(availability(full).canTake, false);
  assert.match(availability(full).reason, /Already carrying 3/);

  const free = { isActive: true, status: "AVAILABLE", activeDeliveries: 0, maxActiveOrders: 3 };
  assert.equal(availability(free).canTake, true);

  // The shape driverPositions used to return: every flag missing.
  const starved = { status: "AVAILABLE", activeDeliveries: 0 };
  assert.equal(availability(starved).canTake, false, "which is why the fields must be sent");
});

// --- gateway credentials at rest -------------------------------------------
//
// Every other secret this system holds is hashed, because nothing ever needs it
// back. A payment gateway credential is the opposite: we must hand the real
// Integrity Salt or API secret to the gateway, so it has to be decryptable.
// That makes this the one place where plaintext can be recovered from the
// database, and the only thing standing between a dumped table and a
// restaurant's live gateway is this envelope.

check("a gateway secret survives a round trip", () => {
  const secret = "sec_1a2b3c-live-key";
  const sealed = encryptSecret(secret, { aad: "branch-1:safepay:apiKey" });
  assert.notEqual(sealed, secret, "it must not be stored as itself");
  assert.ok(!sealed.includes(secret), "nor contain itself anywhere in the envelope");
  assert.equal(decryptSecret(sealed, { aad: "branch-1:safepay:apiKey" }), secret);
});

check("the same secret encrypts differently every time", () => {
  // A deterministic ciphertext leaks equality: two branches that pasted the
  // same key, or a key that never changed across a rotation, would be visible
  // in the table without decrypting anything.
  const aad = "branch-1:safepay:apiKey";
  const a = encryptSecret("same-secret", { aad });
  const b = encryptSecret("same-secret", { aad });
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a, { aad }), decryptSecret(b, { aad }));
});

check("a tampered ciphertext is refused, not silently wrong", () => {
  const aad = "branch-1:safepay:apiKey";
  const sealed = encryptSecret("sec_live_abcdef", { aad });
  const parts = sealed.split(".");
  // Flip one bit of the ciphertext. Without an authentication tag this would
  // decrypt to garbage and get sent to the gateway as if it were a key.
  const bytes = Buffer.from(parts[3], "base64url");
  bytes[0] ^= 0x01;
  parts[3] = bytes.toString("base64url");
  assert.throws(() => decryptSecret(parts.join("."), { aad }), /could not be decrypted/i);
});

check("a secret cannot be moved to another branch's row", () => {
  // Binding the ciphertext to branch + provider + field means a stolen envelope
  // cannot be pasted into a different branch's credentials to make that branch
  // charge through someone else's gateway account.
  const sealed = encryptSecret("sec_live_abcdef", { aad: "branch-1:safepay:apiKey" });
  assert.throws(() => decryptSecret(sealed, { aad: "branch-2:safepay:apiKey" }), /could not be decrypted/i);
  assert.throws(() => decryptSecret(sealed, { aad: "branch-1:jazzcash:apiKey" }), /could not be decrypted/i);
  assert.throws(() => decryptSecret(sealed, { aad: "branch-1:safepay:webhookSecret" }), /could not be decrypted/i);
});

check("an envelope names the key that sealed it, so keys can be rotated", () => {
  const sealed = encryptSecret("sec_live_abcdef", { aad: "a" });
  const envelope = parseEnvelope(sealed);
  assert.equal(envelope.version, "v1");
  assert.equal(envelope.keyId, "k2", "the newest key is the active one");
  assert.equal(activeKeyId(), "k2");
});

check("a secret sealed with a retired key still opens", () => {
  // Rotation has to be possible without rewriting every row in one transaction,
  // so older keys stay readable while only the newest one writes.
  const aad = "branch-1:safepay:apiKey";
  const withOldKey = (fn) => {
    const saved = process.env.CREDENTIAL_ENCRYPTION_KEYS;
    process.env.CREDENTIAL_ENCRYPTION_KEYS = "k1:" + Buffer.alloc(32, 3).toString("base64");
    try {
      return fn();
    } finally {
      process.env.CREDENTIAL_ENCRYPTION_KEYS = saved;
    }
  };

  const sealedBefore = withOldKey(() => encryptSecret("old-era-secret", { aad }));
  assert.equal(parseEnvelope(sealedBefore).keyId, "k1");
  // k1 is still listed, just no longer first, so it must decrypt.
  assert.equal(decryptSecret(sealedBefore, { aad }), "old-era-secret");
});

check("a secret sealed with a key that is gone fails loudly", () => {
  const aad = "branch-1:safepay:apiKey";
  const sealed = encryptSecret("sec_live_abcdef", { aad });
  const saved = process.env.CREDENTIAL_ENCRYPTION_KEYS;
  process.env.CREDENTIAL_ENCRYPTION_KEYS = "k9:" + Buffer.alloc(32, 9).toString("base64");
  try {
    assert.throws(() => decryptSecret(sealed, { aad }), /k2/, "the error must name the missing key");
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEYS = saved;
  }
});

check("a key that is not 32 bytes is refused at the door", () => {
  const saved = process.env.CREDENTIAL_ENCRYPTION_KEYS;
  const tooShort = "k1:" + Buffer.alloc(16, 1).toString("base64");
  process.env.CREDENTIAL_ENCRYPTION_KEYS = tooShort;
  try {
    // AES-256 needs exactly 32 bytes. Node would throw something obscure at
    // call time; a short key is a configuration mistake and should say so.
    assert.throws(() => encryptSecret("x", { aad: "a" }), /32 bytes/);
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEYS = saved;
  }
});

check("no keys configured is a loud failure, never a plaintext fallback", () => {
  const saved = process.env.CREDENTIAL_ENCRYPTION_KEYS;
  delete process.env.CREDENTIAL_ENCRYPTION_KEYS;
  try {
    assert.throws(() => encryptSecret("x", { aad: "a" }), /CREDENTIAL_ENCRYPTION_KEYS/);
  } finally {
    process.env.CREDENTIAL_ENCRYPTION_KEYS = saved;
  }
});

check("a decrypt failure never echoes the secret", () => {
  const sealed = encryptSecret("super-secret-value", { aad: "branch-1:safepay:apiKey" });
  try {
    decryptSecret(sealed, { aad: "branch-2:safepay:apiKey" });
    assert.fail("should have thrown");
  } catch (error) {
    // Error messages reach logs, Sentry and sometimes the user. A credential
    // that leaks through an error message is still leaked.
    assert.ok(!error.message.includes("super-secret-value"));
    assert.ok(!error.message.includes(sealed));
  }
});

check("a malformed envelope is refused rather than guessed at", () => {
  for (const bad of ["", "not-an-envelope", "v1.k2.only-three", "v2.k2.aa.bb.cc", "v1..aa.bb.cc"]) {
    assert.throws(() => decryptSecret(bad, { aad: "a" }), /envelope/i, `accepted: ${JSON.stringify(bad)}`);
  }
});

// --- bring-your-own gateway credentials ------------------------------------
//
// Each restaurant holds its own merchant account, so the credentials belong to
// the branch, not to the deployment. Three consequences are tested here: a
// gateway declares which fields it needs (they differ in *shape*, not just
// value — three for Safepay, four for Easypaisa, and a fourth JazzCash field
// that only refunds use), the secret ones are sealed before they are stored,
// and nothing that leaves the server ever carries one back out.

check("every payment provider declares the credentials it needs", () => {
  for (const provider of listPaymentProviders()) {
    const fields = credentialFields(provider.name);
    assert.ok(Array.isArray(fields), `${provider.name} declares no credential fields`);

    for (const field of fields) {
      assert.ok(field.key, `${provider.name} has a credential field with no key`);
      assert.ok(field.label, `${provider.name}.${field.key} has no label to put on the form`);
      assert.equal(typeof field.secret, "boolean", `${provider.name}.${field.key} must say if it is a secret`);
      assert.ok(field.schema, `${provider.name}.${field.key} has no schema, so anything would be accepted`);
    }

    const keys = fields.map((field) => field.key);
    assert.deepEqual([...new Set(keys)], keys, `${provider.name} declares a credential field twice`);
  }
});

check("a gateway settled outside the system asks for no credentials", () => {
  // Cash has nothing to authenticate against. It must not grow a form.
  assert.deepEqual(credentialFields("cash"), []);
});

check("a credential set is checked against that gateway's own fields", () => {
  // A typo'd field name silently doing nothing is how a gateway ends up
  // half-configured and failing only for real customers at the till.
  assert.throws(
    () => validateCredentials("mock", { webhookSecret: "s3cret", apiKey: "nope" }),
    /apiKey/,
    "an unknown field must be refused, not ignored",
  );

  // Checked against a gateway that genuinely requires its fields. The fake one
  // marks its secret optional, because it falls back to the environment.
  assert.throws(
    () => validateCredentials("safepay", { publicKey: "sec_abc12345" }),
    /secretKey|webhookSecret/,
    "a required field cannot be left out",
  );

  const ok = validateCredentials("mock", { webhookSecret: "s3cret-value" });
  assert.deepEqual(ok, { webhookSecret: "s3cret-value" });
});

check("a blank value is refused rather than stored as an empty credential", () => {
  assert.throws(() => validateCredentials("mock", { webhookSecret: "" }), /webhookSecret/);
  assert.throws(() => validateCredentials("mock", { webhookSecret: "   " }), /webhookSecret/);
});

check("secret credentials are sealed and public ones are left readable", () => {
  const fields = credentialFields("mock");
  const sealed = sealCredentials({ branchId: "br_1", provider: "mock", values: { webhookSecret: "s3cret-value" } });

  for (const field of fields) {
    const stored = sealed[field.key];
    if (stored == null) continue;
    if (field.secret) {
      assert.ok(!stored.includes("s3cret-value"), `${field.key} was stored in the clear`);
      assert.equal(parseEnvelope(stored).version, "v1", `${field.key} is not a sealed envelope`);
    } else {
      // A key the checkout page hands to the browser is already public. Sealing
      // it would only stop the dashboard showing the operator what they pasted.
      assert.doesNotThrow(() => String(stored));
    }
  }
});

check("sealed credentials cannot be lifted into another branch or gateway", () => {
  const sealed = sealCredentials({ branchId: "br_1", provider: "mock", values: { webhookSecret: "s3cret-value" } });

  assert.deepEqual(openCredentials({ branchId: "br_1", provider: "mock", stored: sealed }), {
    webhookSecret: "s3cret-value",
  });

  // Same row, moved to another branch. Must fail, or a branch could be pointed
  // at another restaurant's gateway account and collect their takings.
  assert.throws(() => openCredentials({ branchId: "br_2", provider: "mock", stored: sealed }), /could not be decrypted/i);

  // Same branch, moved to a different gateway that happens to name its field
  // the same way. Registering a double rather than naming a real gateway keeps
  // the test honest: an unregistered name would fail on "unknown provider"
  // and prove nothing about the binding.
  registerPaymentProvider({
    name: "test-twin",
    supportsOnline: true,
    methods: ["CARD"],
    credentials: credentialFields("mock"),
  });
  assert.throws(
    () => openCredentials({ branchId: "br_1", provider: "test-twin", stored: sealed }),
    /could not be decrypted/i,
  );
});

check("the view that leaves the server never carries a secret", () => {
  const sealed = sealCredentials({ branchId: "br_1", provider: "mock", values: { webhookSecret: "s3cret-value" } });
  const masked = maskCredentials({ provider: "mock", stored: sealed });
  const asText = JSON.stringify(masked);

  assert.ok(!asText.includes("s3cret-value"), "the plaintext reached the API");
  assert.ok(!asText.includes(sealed.webhookSecret), "the envelope reached the API");

  // It still has to say whether a value is there, or the screen cannot tell
  // "not configured yet" from "configured and hidden".
  const entry = masked.find((row) => row.key === "webhookSecret");
  assert.equal(entry.isSet, true);
  assert.equal(entry.secret, true);

  const empty = maskCredentials({ provider: "mock", stored: {} });
  assert.equal(empty.find((row) => row.key === "webhookSecret").isSet, false);
});

check("a secret left blank keeps the one already stored", () => {
  // The form cannot show a secret, so it renders an empty box over a value
  // that is already set. If an empty box meant "clear it", saving an unrelated
  // change on that screen would silently break the gateway.
  const fields = credentialFields("mock");
  const existing = { webhookSecret: "sealed-envelope-here" };

  const untouched = mergeCredentialUpdate({ fields, existing, submitted: {} });
  assert.deepEqual(untouched.values, existing);
  assert.deepEqual(untouched.changed, []);

  const blanked = mergeCredentialUpdate({ fields, existing, submitted: { webhookSecret: "" } });
  assert.deepEqual(blanked.values, existing, "an empty box must not wipe a stored secret");
  assert.deepEqual(blanked.changed, []);

  const whitespace = mergeCredentialUpdate({ fields, existing, submitted: { webhookSecret: "   " } });
  assert.deepEqual(whitespace.values, existing);
});

check("a credential is replaced when a new one is actually typed", () => {
  const fields = credentialFields("mock");
  const result = mergeCredentialUpdate({
    fields,
    existing: { webhookSecret: "old-envelope" },
    submitted: { webhookSecret: "a-brand-new-secret" },
  });
  assert.equal(result.values.webhookSecret, "a-brand-new-secret");
  assert.deepEqual(result.changed, ["webhookSecret"]);
});

check("clearing a credential takes an explicit null, not a blank box", () => {
  const fields = credentialFields("mock");
  const result = mergeCredentialUpdate({
    fields,
    existing: { webhookSecret: "old-envelope" },
    submitted: { webhookSecret: null },
  });
  assert.equal(result.values.webhookSecret, undefined);
  assert.deepEqual(result.changed, ["webhookSecret"]);
});

check("what changed is reported without reporting what it changed to", () => {
  const fields = credentialFields("mock");
  const result = mergeCredentialUpdate({
    fields,
    existing: {},
    submitted: { webhookSecret: "a-brand-new-secret" },
  });
  // `changed` is what the audit log records. Field names only: an audit trail
  // that quotes the credential is a second copy of it, in a table more people
  // can read than the one it came from.
  assert.deepEqual(result.changed, ["webhookSecret"]);
  assert.ok(!JSON.stringify(result.changed).includes("a-brand-new-secret"));
});

check("a gateway cannot be switched on with a required credential missing", () => {
  // Otherwise the first customer to pick it at checkout is the one who finds
  // out, and the order fails after they have chosen their food.
  assert.throws(() => assertReadyToEnable({ provider: "safepay", values: {} }), /publicKey/);
  assert.throws(
    () => assertReadyToEnable({ provider: "safepay", values: { publicKey: "sec_abc", secretKey: "", webhookSecret: "x" } }),
    /secretKey/,
  );
  assert.doesNotThrow(() =>
    assertReadyToEnable({
      provider: "safepay",
      values: { publicKey: "sec_abc", secretKey: "sealed", webhookSecret: "sealed" },
    }),
  );

  // The fake gateway requires nothing, so it can always be switched on.
  assert.doesNotThrow(() => assertReadyToEnable({ provider: "mock", values: {} }));
});

check("a gateway that needs no credentials can always be switched on", () => {
  assert.doesNotThrow(() => assertReadyToEnable({ provider: "cash", values: {} }));
});

check("nothing that answers a request can open a gateway credential", () => {
  // `openCredentials` and `resolveProviderConfig` return live plaintext keys.
  // They belong to the three services that are about to call a gateway, and
  // nowhere else: a route that imports one is a route that can be made to
  // print it. This is a cheap guard against an expensive mistake.
  const allowed = new Set([
    "src/server/services/payment.service.js",
    "src/server/services/refund.service.js",
    "src/server/services/payment-webhook.service.js",
    "src/server/services/payment-provider.service.js",
    "src/server/payments/credentials.js",
    "src/server/utils/secret-box.js", // where they are defined
  ]);

  const walk = (dir) =>
    fsForGuard
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name.endsWith(".js") ? [`${dir}/${entry.name}`] : [],
      );

  const offenders = walk("src")
    .filter((file) => !allowed.has(file))
    .filter((file) => /\b(openCredentials|resolveProviderConfig|decryptSecret)\b/.test(fsForGuard.readFileSync(file, "utf8")));

  assert.deepEqual(offenders, [], `these files can decrypt a gateway credential: ${offenders.join(", ")}`);
});

check("a branch's webhook URL names the branch", () => {
  // The signature has to be checked before the body is parsed, so the only
  // place the branch can come from is the URL itself. Without it there is no
  // way to know whose signing secret to verify against.
  const url = webhookUrlFor({ branchId: "br_abc", provider: "safepay" });
  assert.match(url, /\/api\/v1\/webhooks\/payments\/safepay\/br_abc$/);
});

// --- Safepay, verified against a real callback ------------------------------
//
// The fixture is an actual sandbox delivery, captured through a tunnel and
// re-signed with a throwaway secret. It is here because Safepay's published
// payload does not match what they send: the real envelope nests everything
// under `data`, event types use a colon, the state is PAID rather than
// TRACKER_ENDED, and money arrives as decimal strings in major units.
//
// Every assertion below describes the delivery we actually received, not the
// documentation. If Safepay changes the shape, these fail — which is the point.
const safepayFixture = JSON.parse(fsForGuard.readFileSync("tests/fixtures/safepay-payment-created.json", "utf8"));
const safepayHeaders = (signature) => ({ "x-sfpy-signature": signature, "content-type": "application/json" });

check("a genuine Safepay callback verifies", () => {
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: safepayFixture.bodyText,
      headers: safepayHeaders(safepayFixture.signature),
      config: { webhookSecret: safepayFixture.secret },
    }),
    true,
  );
});

check("a tampered Safepay callback is rejected", () => {
  // The amount is the field worth forging, so that is the one to flip.
  const tampered = safepayFixture.bodyText.replace('"amount":"150"', '"amount":"1"');
  assert.notEqual(tampered, safepayFixture.bodyText, "the test must actually change the body");
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: tampered,
      headers: safepayHeaders(safepayFixture.signature),
      config: { webhookSecret: safepayFixture.secret },
    }),
    false,
  );
});

check("another restaurant's signing secret does not verify our callback", () => {
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: safepayFixture.bodyText,
      headers: safepayHeaders(safepayFixture.signature),
      config: { webhookSecret: "a-different-merchants-secret" },
    }),
    false,
  );
});

check("a Safepay callback with no signature is rejected", () => {
  for (const headers of [{}, { "x-sfpy-signature": "" }, { "content-type": "application/json" }]) {
    assert.equal(
      safepayProvider.verifySignature({ rawBody: safepayFixture.bodyText, headers, config: { webhookSecret: safepayFixture.secret } }),
      false,
    );
  }
});

check("a Safepay callback verifies even if the body arrives re-spaced", () => {
  // Safepay signs a re-serialised `data`, so a proxy that reformats the JSON
  // would still produce a verifiable payload. Accepting both encodings costs
  // nothing — each one still requires the secret — and refusing it would mean
  // real money stuck in an unknown state because of someone else's whitespace.
  const parsed = JSON.parse(safepayFixture.bodyText);
  const spaced = JSON.stringify(parsed, null, 2);
  assert.notEqual(spaced, safepayFixture.bodyText);
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: spaced,
      headers: safepayHeaders(safepayFixture.signature),
      config: { webhookSecret: safepayFixture.secret },
    }),
    true,
  );
});

check("a Safepay callback is read the way Safepay actually sends it", () => {
  const event = safepayProvider.parseEvent({ payload: JSON.parse(safepayFixture.bodyText) });

  // `data.token` is the per-delivery id. The docs promised `evt_…` at the top
  // level; this is what arrives, and it is what makes redelivery idempotent.
  assert.equal(event.eventId, "DBKVUO58D4IS73A9VQJG");
  assert.equal(event.type, "payment:created");
  assert.equal(event.providerOrderId, "tracker_dbkvunt8d4is73d3b84g");
  assert.equal(event.orderReference, "XG102312");
});

check("a 150 rupee sale is not recorded as one rupee fifty", () => {
  // The documented payload says the amount is an integer in the lowest
  // denomination, so dividing by 100 would be the obvious reading. The real
  // payload sends "150" as a decimal string in major units, and treating it
  // the documented way would under-record every single sale by a hundredfold.
  const event = safepayProvider.parseEvent({ payload: JSON.parse(safepayFixture.bodyText) });
  assert.equal(String(event.amount), "150");
  assert.equal(String(event.feeAmount), "4.92");
});

check("only a state Safepay calls paid is treated as paid", () => {
  const body = JSON.parse(safepayFixture.bodyText);
  assert.equal(safepayProvider.parseEvent({ payload: body }).outcome, "CAPTURED");

  // Anything we have not seen must not be guessed at. A state we do not
  // recognise leaves the payment alone rather than marking it collected.
  for (const state of ["FAILED", "PENDING", "SOMETHING_NEW", ""]) {
    const other = JSON.parse(safepayFixture.bodyText);
    other.data.notification.state = state;
    const event = safepayProvider.parseEvent({ payload: other });
    assert.notEqual(event.outcome, "CAPTURED", `state ${JSON.stringify(state)} must not read as paid`);
  }
});

check("a Safepay payload that is not a notification is ignored, not misread", () => {
  for (const payload of [{}, { data: {} }, { data: { token: "x" } }, null]) {
    const event = safepayProvider.parseEvent({ payload });
    assert.ok(event === null || !event.eventId || event.outcome !== "CAPTURED");
  }
});

check("rupees become paisa without a float anywhere near them", () => {
  // Safepay's checkout takes an integer in the lowest denomination while its
  // webhook returns major units, so this conversion runs on every charge. The
  // amount arrives as a Prisma Decimal; `Number(x) * 100` is how 1.15 becomes
  // 114.99999999999999 and a bill is charged a paisa short.
  assert.equal(toMinorUnits("150"), 15000);
  assert.equal(toMinorUnits("1.15"), 115);
  assert.equal(toMinorUnits("0.05"), 5);
  assert.equal(toMinorUnits("1234.5"), 123450);
  assert.equal(toMinorUnits("0"), 0);
  assert.equal(toMinorUnits("999999.99"), 99999999);

  // A third decimal place cannot be charged, and must truncate rather than
  // round up: billing more than the order says is the worse failure.
  assert.equal(toMinorUnits("1.159"), 115);

  // The real shape it is called with.
  assert.equal(toMinorUnits("150.0000"), 15000);
});

// --- Safepay: the envelope a REAL payment produces --------------------------
//
// Safepay sends two different shapes, and only one of them is what a customer
// paying produces. The dashboard's test button sends a legacy envelope
// (`data.token`, `payment:created`, state PAID, money as decimal strings in
// major units) signed over `data` alone. An actual card payment sends a
// v2.0.0 envelope (top-level `evt_` token, `payment.succeeded`, state
// TRACKER_ENDED, money as INTEGERS IN MINOR UNITS) signed over the whole body.
//
// Both fixtures are real captures. Building for either one alone silently
// misprices every payment by a factor of a hundred, in opposite directions.
const permissionCatalogue = await import("../prisma/seeds/permissions.js");
const cryptoForGuard = (await import("node:crypto")).default;
const safepayReal = JSON.parse(fsForGuard.readFileSync("tests/fixtures/safepay-payment-succeeded.json", "utf8"));

check("a real Safepay payment callback verifies", () => {
  // The genuine event signs the WHOLE payload; the test event signs only
  // `data`. Both have to be accepted, and each still needs the secret.
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: safepayReal.bodyText,
      headers: { "x-sfpy-signature": safepayReal.signature },
      config: { webhookSecret: safepayReal.secret },
    }),
    true,
  );
});

check("a tampered real callback is rejected", () => {
  const tampered = safepayReal.bodyText.replace('"amount":15000', '"amount":1');
  assert.notEqual(tampered, safepayReal.bodyText);
  assert.equal(
    safepayProvider.verifySignature({
      rawBody: tampered,
      headers: { "x-sfpy-signature": safepayReal.signature },
      config: { webhookSecret: safepayReal.secret },
    }),
    false,
  );
});

check("a real payment of PKR 150 is recorded as 150, not 15000", () => {
  // THE trap. A genuine payment reports amount 15000 — paisa. The dashboard's
  // test event reports "150" — rupees. Passing either straight through records
  // the sale a hundredfold wrong, and in opposite directions depending on which
  // envelope happened to arrive.
  const event = safepayProvider.parseEvent({ payload: JSON.parse(safepayReal.bodyText) });
  assert.equal(String(event.amount), "150");
  assert.equal(String(event.feeAmount), "9.5");
  assert.equal(String(event.netAmount), "140.5");
  assert.equal(event.currency, "PKR");
});

check("a real callback is identified by its own event token", () => {
  const event = safepayProvider.parseEvent({ payload: JSON.parse(safepayReal.bodyText) });
  // Top-level `token`, not `data.token` — the legacy envelope puts it inside.
  assert.equal(event.eventId, "evt_d83ef6a9-3ca6-4f5d-a29d-2584eb89ba76");
  assert.equal(event.type, "payment.succeeded");
  assert.equal(event.providerOrderId, "track_22610780-f2ec-442c-b6f7-d9b9c9f397a0");
  assert.equal(event.orderReference, "FZ-LIVE-TEST-001");
  assert.equal(event.outcome, "CAPTURED");
});

check("the two envelopes never collide on an event id", () => {
  // Both land in the same PaymentWebhookEvent table under a unique
  // (provider, eventId). If one shape's id were read off the other's field,
  // two unrelated events could collide and the second would be dropped as a
  // duplicate — losing a real payment.
  const real = safepayProvider.parseEvent({ payload: JSON.parse(safepayReal.bodyText) });
  const legacy = safepayProvider.parseEvent({ payload: JSON.parse(safepayFixture.bodyText) });
  assert.notEqual(real.eventId, legacy.eventId);
  assert.ok(real.eventId.startsWith("evt_"));
});

check("only TRACKER_ENDED counts as paid on a real callback", () => {
  for (const state of ["TRACKER_STARTED", "TRACKER_AUTHORIZED", "TRACKER_CANCELLED", "TRACKER_EXPIRED", ""]) {
    const body = JSON.parse(safepayReal.bodyText);
    body.data.state = state;
    const event = safepayProvider.parseEvent({ payload: body });
    assert.notEqual(event.outcome, "CAPTURED", `state ${JSON.stringify(state)} must not read as paid`);
  }
});

check("a refunded real callback is not read as a fresh payment", () => {
  for (const [state, expected] of [["TRACKER_REFUNDED", "REFUNDED"], ["TRACKER_PARTIAL_REFUND", "PARTIALLY_REFUNDED"]]) {
    const body = JSON.parse(safepayReal.bodyText);
    body.data.state = state;
    body.type = "payment.refunded";
    const event = safepayProvider.parseEvent({ payload: body });
    assert.equal(event.outcome, expected);
  }
});

check("a callback is verified against the bytes that arrived", () => {
  // The claim worth pinning: we verify what was *received*, not a re-encoding
  // of it. Re-serialising is the classic webhook bug — a signature checked
  // against re-encoded JSON can pass when it should fail — so the raw bytes
  // must be a candidate in their own right.
  //
  // This body is pretty-printed, so JSON.stringify(parse(body)) does NOT
  // reproduce it. Signing the raw form means only a verifier that considers
  // the received bytes can accept it.
  const pretty = JSON.stringify(JSON.parse(safepayReal.bodyText), null, 2);
  assert.notEqual(pretty, JSON.stringify(JSON.parse(safepayReal.bodyText)), "the test body must not be compact");

  const signature = cryptoForGuard
    .createHmac("sha512", safepayReal.secret)
    .update(Buffer.from(pretty, "utf8"))
    .digest("hex");

  assert.equal(
    safepayProvider.verifySignature({
      rawBody: pretty,
      headers: { "x-sfpy-signature": signature },
      config: { webhookSecret: safepayReal.secret },
    }),
    true,
    "a body signed as received must verify",
  );
});

check("a gateway only demands setup when it actually needs a credential", () => {
  // Resolving a branch's gateway config throws when the branch has not been
  // configured — correct for a real gateway, and wrong for one that does not
  // need configuring. Getting this backwards made every existing online
  // payment fail with "mock is not set up for this branch".
  assert.equal(requiresConfiguration("safepay"), true, "a real gateway must be configured before use");
  assert.equal(requiresConfiguration("cash"), false, "cash has nothing to authenticate against");
  assert.equal(
    requiresConfiguration("mock"),
    false,
    "the fake gateway falls back to the deployment's secret, so it must work unconfigured",
  );
});

check("a gateway with a required field is never usable unconfigured", () => {
  // The property that matters, stated over the registry rather than a list:
  // anything declaring a required credential must demand configuration.
  for (const provider of listPaymentProviders()) {
    const hasRequired = credentialFields(provider.name).some((field) => field.required !== false);
    assert.equal(
      requiresConfiguration(provider.name),
      hasRequired,
      `${provider.name} disagrees with its own declaration`,
    );
  }
});

check("editing one credential does not require retyping the others", () => {
  // The form shows empty boxes over secrets it cannot display, so a save that
  // changes only the public key arrives carrying that field alone. Validating
  // it as a complete set rejects the edit with "secretKey is required" — and
  // the only way to satisfy that would be to retype both secrets every time,
  // which is exactly what the blank-means-unchanged rule exists to avoid.
  assert.throws(
    () => validateCredentials("safepay", { publicKey: "sec_abc12345" }),
    /secretKey|webhookSecret/,
    "a complete set must still demand every field",
  );

  const partial = validateCredentials("safepay", { publicKey: "sec_abc12345" }, { partial: true });
  assert.deepEqual(partial, { publicKey: "sec_abc12345" });
});

check("a partial edit still checks the field it does carry", () => {
  // Partial must not mean unvalidated: a too-short key is still refused.
  assert.throws(() => validateCredentials("safepay", { secretKey: "x" }, { partial: true }), /secretKey/);
  assert.throws(() => validateCredentials("safepay", { nonsense: "x" }, { partial: true }), /nonsense/);
});

check("sealing an empty box produces nothing to store", () => {
  // The bug this exists to stop: sealing runs over the whole submitted form,
  // so a blank secret box became an envelope encrypting the empty string.
  // That envelope is a non-empty string, so the merge read it as a new value
  // and overwrote the live credential — the exact failure the blank rule was
  // written to prevent, reintroduced one layer down.
  const sealed = sealCredentials({
    branchId: "br_1",
    provider: "safepay",
    values: { publicKey: "sec_pub_1", secretKey: "", webhookSecret: "   " },
  });
  assert.deepEqual(Object.keys(sealed), ["publicKey"], "only a value someone typed may be sealed");
});

check("a blank box cannot overwrite a live credential end to end", () => {
  // The two steps composed the way the service composes them.
  const existing = sealCredentials({
    branchId: "br_1",
    provider: "safepay",
    values: { publicKey: "sec_old", secretKey: "the-live-secret", webhookSecret: "the-live-hook" },
  });

  const { values, changed } = mergeCredentialUpdate({
    fields: credentialFields("safepay"),
    existing,
    submitted: sealCredentials({
      branchId: "br_1",
      provider: "safepay",
      values: { publicKey: "sec_new", secretKey: "", webhookSecret: "" },
    }),
  });

  assert.equal(values.secretKey, existing.secretKey, "the live secret must survive an empty box");
  assert.equal(values.webhookSecret, existing.webhookSecret);
  assert.deepEqual(changed, ["publicKey"]);
  assert.equal(
    openCredentials({ branchId: "br_1", provider: "safepay", stored: values }).secretKey,
    "the-live-secret",
  );
});

// --- which gateway takes an online payment ----------------------------------

check("a gateway the caller named is used as asked", () => {
  assert.equal(chooseProvider({ requested: "safepay", method: "CARD", enabled: [] }), "safepay");
});

check("anything settled by hand goes to cash, whatever is configured", () => {
  for (const method of ["CASH", "CASH_ON_DELIVERY", "BANK_TRANSFER", "AGGREGATOR", "OTHER"]) {
    assert.equal(chooseProvider({ method, enabled: [{ provider: "safepay", sortOrder: 0 }] }), "cash");
  }
});

check("an online payment goes to whichever gateway the branch switched on", () => {
  const enabled = [
    { provider: "safepay", sortOrder: 1 },
    { provider: "mock", sortOrder: 0 },
  ];
  // Lowest sortOrder first: the order the branch chose to offer them in.
  assert.equal(chooseProvider({ method: "CARD", enabled }), "mock");
  assert.equal(chooseProvider({ method: "CARD", enabled: [{ provider: "safepay", sortOrder: 3 }] }), "safepay");
});

check("a branch with no gateway cannot quietly take a card payment", () => {
  // The old fallback sent online payments to the fake gateway, which reports
  // success without moving money. Where the fake gateway is not permitted,
  // that is free food — and it would look like a working integration right up
  // until somebody read the bank statement.
  assert.throws(() => chooseProvider({ method: "CARD", enabled: [], allowMock: false }), /no online payment/i);
});

check("but where the fake gateway is permitted, it still stands in", () => {
  // Whether it is permitted is the mock provider's own long-standing rule —
  // outside production, or in production only when somebody deliberately set
  // MOCK_PAYMENT_SECRET. Reusing that decision rather than sniffing the
  // environment again keeps one answer to "may we fake a payment here".
  assert.equal(chooseProvider({ method: "CARD", enabled: [], allowMock: true }), "mock");
});

check("a configured gateway always beats the fake one", () => {
  assert.equal(
    chooseProvider({ method: "CARD", enabled: [{ provider: "safepay", sortOrder: 0 }], allowMock: true }),
    "safepay",
  );
});

check("every permission an API route demands exists in the catalogue", () => {
  // The sidebar is already guarded this way. Routes are the layer that
  // actually enforces access, and a route checking a key nobody was ever
  // granted is not an error anywhere — it just silently refuses everyone,
  // including the people who should have it.
  const { PERMISSION_MODULES } = permissionCatalogue;
  const known = new Set(
    PERMISSION_MODULES.flatMap((mod) => mod.actions.map(([action]) => `${mod.module}.${action}`)),
  );

  const walk = (dir) =>
    fsForGuard
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory() ? walk(`${dir}/${entry.name}`) : entry.name === "route.js" ? [`${dir}/${entry.name}`] : [],
      );

  const missing = [];
  for (const file of walk("src/app/api")) {
    const source = fsForGuard.readFileSync(file, "utf8");
    for (const match of source.matchAll(/permissions:\s*(\[[^\]]*\]|"[^"]+")/g)) {
      for (const key of match[1].matchAll(/"([a-z_]+\.[a-z_*]+)"/g)) {
        const name = key[1];
        if (name.endsWith(".*")) continue;
        if (!known.has(name)) missing.push(`${file}: ${name}`);
      }
    }
  }

  assert.deepEqual(missing, [], `these routes demand a permission that is not seeded:\n  ${missing.join("\n  ")}`);
});

// --- what a gateway is called -----------------------------------------------

check("a gateway has a presentable name of its own", () => {
  // Two enabled gateways both reading "Pay now by card or wallet" is a choice
  // the customer cannot make. The registry key is not it either: "safepay" in
  // lower case on a checkout page looks like a bug.
  assert.equal(providerLabel("safepay"), "Safepay");
  assert.equal(providerLabel("cash"), "Cash");
  for (const provider of listPaymentProviders()) {
    const label = providerLabel(provider.name);
    assert.ok(label && label !== provider.name, `${provider.name} has no presentable label`);
    assert.equal(label, label.trim());
  }
});

check("a restaurant may call a gateway whatever its customers call it", () => {
  // "Safepay" means nothing to most diners; "Card or wallet" does. The
  // override is per branch because the wording that works in one place is not
  // the wording that works in another.
  assert.equal(providerLabel("safepay", "Card / Easypaisa / JazzCash"), "Card / Easypaisa / JazzCash");

  // An override of nothing is not an override.
  assert.equal(providerLabel("safepay", ""), "Safepay");
  assert.equal(providerLabel("safepay", "   "), "Safepay");
  assert.equal(providerLabel("safepay", null), "Safepay");
});

check("an unknown gateway still reads as something", () => {
  // A row left behind by a provider that has since been removed must not
  // render as blank on a settings screen.
  assert.ok(providerLabel("retired-gateway").length > 0);
});

// --- how long a gateway will still take a refund ----------------------------
//
// Safepay: "card refunds are only applicable for up to 90 days after the
// transaction has completed." Past that the gateway refuses, and without this
// check a manager approves a refund, the customer is told it is on its way,
// and the only evidence otherwise is a FAILED row nobody is watching.

const DAY = 24 * 60 * 60 * 1000;
const captured = (daysAgo) => new Date(Date.UTC(2026, 0, 100) - daysAgo * DAY);
const now = new Date(Date.UTC(2026, 0, 100));

check("a fresh card payment can be refunded", () => {
  const verdict = refundability({ capturedAt: captured(1), now, maxAgeDays: 90 });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.reason, null);
});

check("a payment past the gateway's window cannot", () => {
  const verdict = refundability({ capturedAt: captured(91), now, maxAgeDays: 90 });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /90 days/);
  // The date it lapsed, so the message can say when rather than just "too old".
  assert.ok(verdict.lapsesAt instanceof Date);
});

check("the boundary day itself is still allowed", () => {
  // Exactly on the limit is inside it. Refusing a refund the gateway would
  // have accepted is the worse error: the customer is owed the money either
  // way, and we would be inventing a reason not to send it.
  assert.equal(refundability({ capturedAt: captured(90), now, maxAgeDays: 90 }).allowed, true);
  assert.equal(refundability({ capturedAt: captured(90.5), now, maxAgeDays: 90 }).allowed, false);
});

check("a gateway with no window refuses nothing", () => {
  // Cash has no gateway to say no. Neither does a provider that never
  // declared a limit — absence of a rule is not a rule.
  assert.equal(refundability({ capturedAt: captured(5000), now, maxAgeDays: null }).allowed, true);
  assert.equal(refundability({ capturedAt: captured(5000), now }).allowed, true);
});

check("money that was never captured cannot be sent back", () => {
  const verdict = refundability({ capturedAt: null, now, maxAgeDays: 90 });
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /never captured|not been captured/i);
});

check("the verdict says how long is left, so a screen can warn before it lapses", () => {
  // Counted the way people count days: nine and a half days to go is "ten
  // days left". Rounding down was literally true and read as though a day had
  // been stolen — eighty days after capture reported nine of ninety left.
  assert.equal(refundability({ capturedAt: captured(80), now, maxAgeDays: 90 }).daysLeft, 10);
  assert.equal(refundability({ capturedAt: captured(80.01), now, maxAgeDays: 90 }).daysLeft, 10);

  // The last, partial day is 1 and never 0: while a refund is still possible
  // the count must not say zero.
  assert.equal(refundability({ capturedAt: captured(89.5), now, maxAgeDays: 90 }).daysLeft, 1);
  assert.equal(refundability({ capturedAt: captured(89.99), now, maxAgeDays: 90 }).daysLeft, 1);

  // Zero means lapsed, and nothing else does.
  assert.equal(refundability({ capturedAt: captured(95), now, maxAgeDays: 90 }).daysLeft, 0);
  assert.equal(refundability({ capturedAt: captured(10), now, maxAgeDays: null }).daysLeft, null);
});

// --- Orphaned upload sweep ---------------------------------------------------
//
// The sweep deletes files out of a bucket with no transaction to roll back and
// no undo, so every rule here exists to make it refuse rather than guess.

const key = (name) => `product/2026/11/${name.padEnd(32, "0")}.jpg`;
const minutesAgo = (now, minutes) => new Date(now.getTime() - minutes * 60_000);

check("only keys this system generated are ever sweepable", () => {
  /*
   * A bucket is shared. Somebody's export, a logo uploaded by hand, a folder
   * from another app — none of it was written by `buildStorageKey`, and a
   * sweep that cannot prove it wrote a file must leave it alone.
   */
  assert.equal(isSweepableKey("product/2026/11/0123456789abcdef0123456789abcdef.jpg"), true);
  assert.equal(isSweepableKey("misc/2026/01/ffffffffffffffffffffffffffffffff.webp"), true);

  assert.equal(isSweepableKey("logo.png"), false);
  assert.equal(isSweepableKey("backups/foodzone-2026-11-07T02-00-00Z.dump"), false);
  assert.equal(isSweepableKey("product/2026/11/not-a-hex-id.jpg"), false);
  assert.equal(isSweepableKey("product/26/11/0123456789abcdef0123456789abcdef.jpg"), false);
  assert.equal(isSweepableKey("../../etc/passwd"), false);
  assert.equal(isSweepableKey(""), false);
  assert.equal(isSweepableKey(null), false);
});

check("a confirmed upload is never swept", () => {
  // The whole point of confirm is that the row and the object belong together.
  const now = new Date("2026-11-08T12:00:00Z");
  const confirmed = key("aa");
  const plan = planUploadSweep({
    objects: [{ storageKey: confirmed, uploadedAt: minutesAgo(now, 10_000), sizeBytes: 500 }],
    knownKeys: new Set([confirmed]),
    now,
  });

  assert.deepEqual(plan.remove, []);
  assert.equal(plan.counts.confirmed, 1);
});

check("an upload still inside its window is left alone", () => {
  /*
   * The failure this prevents: sweeping an upload that is mid-flight. The
   * client asked for a ticket, the bytes are landing now, and confirm has not
   * run yet — deleting it here breaks a working upload.
   */
  const now = new Date("2026-11-08T12:00:00Z");
  const plan = planUploadSweep({
    objects: [{ storageKey: key("bb"), uploadedAt: minutesAgo(now, SWEEP_GRACE_MINUTES - 1), sizeBytes: 500 }],
    knownKeys: new Set(),
    now,
  });

  assert.deepEqual(plan.remove, []);
  assert.equal(plan.counts.tooNew, 1);
});

check("an object the provider cannot date is never swept", () => {
  // No timestamp means no evidence of abandonment. Keep it and say so.
  const now = new Date("2026-11-08T12:00:00Z");
  const plan = planUploadSweep({
    objects: [{ storageKey: key("cc"), uploadedAt: null, sizeBytes: 500 }],
    knownKeys: new Set(),
    now,
  });

  assert.deepEqual(plan.remove, []);
  assert.equal(plan.counts.undated, 1);
});

check("an upload abandoned past the window is swept", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const abandoned = key("dd");
  const plan = planUploadSweep({
    objects: [{ storageKey: abandoned, uploadedAt: minutesAgo(now, SWEEP_GRACE_MINUTES + 1), sizeBytes: 2048 }],
    knownKeys: new Set(),
    now,
  });

  assert.deepEqual(plan.remove, [abandoned]);
  assert.equal(plan.bytes, 2048);
});

check("the sweep is capped, and spends its budget on the oldest first", () => {
  /*
   * A bucket that has never been swept can hold thousands of orphans, and
   * deleting all of them in one job is a long-running request against a
   * provider that rate-limits. Capping means the next run continues; taking
   * the oldest first means the cap cannot starve anything forever.
   */
  const now = new Date("2026-11-08T12:00:00Z");
  // Hex, because a generated key is hex — "oldest" would be refused as a key
  // this system could not have written, which is a different test.
  const [newest, oldest, middle] = [key("ace0"), key("ace1"), key("ace2")];
  const objects = [
    { storageKey: newest, uploadedAt: minutesAgo(now, 100), sizeBytes: 1 },
    { storageKey: oldest, uploadedAt: minutesAgo(now, 10_000), sizeBytes: 1 },
    { storageKey: middle, uploadedAt: minutesAgo(now, 5_000), sizeBytes: 1 },
  ];
  const plan = planUploadSweep({ objects, knownKeys: new Set(), now, limit: 2 });

  assert.deepEqual(plan.remove, [oldest, middle]);
  assert.equal(plan.deferred, 1);
});

check("a sweep of an empty bucket is a no-op, not an error", () => {
  const plan = planUploadSweep({ objects: [], knownKeys: new Set(), now: new Date() });
  assert.deepEqual(plan.remove, []);
  assert.equal(plan.bytes, 0);
  assert.equal(plan.deferred, 0);
});

check("a foreign key in the bucket is counted as ignored, never removed", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  const plan = planUploadSweep({
    objects: [
      { storageKey: "someone-elses-report.pdf", uploadedAt: minutesAgo(now, 100_000), sizeBytes: 9_000 },
      { storageKey: key("ee"), uploadedAt: minutesAgo(now, 100_000), sizeBytes: 10 },
    ],
    knownKeys: new Set(),
    now,
  });

  assert.deepEqual(plan.remove, [key("ee")]);
  assert.equal(plan.counts.ignored, 1);
  // The bytes figure is what the sweep frees, so a file it refuses to touch
  // must not be counted into it.
  assert.equal(plan.bytes, 10);
});

// --- printable documents -----------------------------------------------------
//
// The models are pure, so everything that could be *wrong* about an invoice or
// a payslip is asserted here rather than by reading bytes out of a PDF.

check("a currency symbol the font cannot print becomes its code", () => {
  /*
   * The documents use Helvetica, which has no rupee sign. Handed one, pdfkit
   * writes a byte that means something else and the customer gets mojibake
   * where the total should be. PKR already formats as a code, so this only
   * ever bites a deployment in another currency — which is exactly the kind of
   * thing nobody tests until a customer finds it.
   */
  assert.equal(safeText("\u20B91,234"), "INR1,234");
  assert.equal(safeText("\u20A8500"), "PKR500");
  // In WinAnsi, so left exactly as Intl wrote it.
  assert.equal(safeText("$1,234"), "$1,234");
  assert.equal(safeText("\u00A31,234"), "\u00A31,234");
});

check("typography that turns up in product names is folded, not mangled", () => {
  assert.equal(safeText("Chef\u2019s \u201CSpecial\u201D \u2013 today\u2026"), "Chef's \"Special\" - today...");
  // A non-breaking space is what Intl puts between "PKR" and the number.
  assert.equal(safeText("PKR\u00A01,234"), "PKR 1,234");
});

check("text the font cannot write is marked, not silently dropped", () => {
  /*
   * A name quietly shortened is worse than a name with a visible gap: nobody
   * notices the first one, and a payslip goes out addressed to somebody else.
   */
  // Seven Arabic letters across two words; the space between them survives.
  const urdu = toWinAnsi("\u0645\u062D\u0645\u062F \u0639\u0645\u0631");
  assert.equal(urdu.substitutions, 7);
  assert.equal(urdu.text, "? ?");
  // A run collapses to one marker rather than a row of them.
  assert.equal(toWinAnsi("\u0645\u062D\u0645\u062F").text, "?");
});

const receiptFixture = {
  branch: { name: "FoodZone", legalName: "FoodZone (Pvt) Ltd", timezone: "Asia/Karachi", city: "Lahore" },
  order: { orderNumber: "FZ-1", type: "DINE_IN", table: { name: "T-1" }, placedAt: new Date("2026-11-08T07:00:00Z") },
  customer: { name: "A Customer" },
  lines: [{ name: "Naan", quantity: 2, unitPrice: 90, lineTotal: 180, modifiers: [] }],
  discounts: [],
  taxLines: [],
  totals: { currency: "PKR", subtotal: 180, grandTotal: 180, paidTotal: 180 },
};

check("an invoice states the legal entity, not the trading name", () => {
  // The invoice is from whoever owes the tax, not the brand over the door.
  const doc = invoiceDocument({ invoice: { invoiceNumber: "INV-1" }, receipt: receiptFixture });
  assert.equal(doc.issuer.name, "FoodZone (Pvt) Ltd");
});

check("an order type is written the way a customer reads it", () => {
  const doc = invoiceDocument({ invoice: { invoiceNumber: "INV-1" }, receipt: receiptFixture });
  const against = doc.parties.find((party) => party.title === "Against");
  assert.ok(against.lines.some((line) => line.startsWith("Dine-in")), against.lines);
  assert.ok(!against.lines.some((line) => line.includes("DINE_IN")), against.lines);
});

check("a voided invoice renders, and says so unmissably", () => {
  /*
   * It has to render: somebody reconciling a gap in the number series needs to
   * see what the number was spent on. What must never happen is a voided copy
   * passing for a live one on a desk.
   */
  const doc = invoiceDocument({
    invoice: { invoiceNumber: "INV-2", isVoid: true, voidReason: "Wrong tax number" },
    receipt: receiptFixture,
  });
  assert.equal(doc.banner, "VOID - Wrong tax number");
  assert.equal(doc.table.rows.length, 1);
});

check("a void with no reason recorded still says it is void", () => {
  const doc = invoiceDocument({ invoice: { invoiceNumber: "INV-3", isVoid: true }, receipt: receiptFixture });
  assert.ok(doc.banner.startsWith("VOID"), doc.banner);
});

check("charges that did not happen are left off the invoice", () => {
  // "Delivery: PKR 0" on a dine-in bill is noise, and noise is what stops
  // people reading the figures that matter.
  const doc = invoiceDocument({ invoice: { invoiceNumber: "INV-4" }, receipt: receiptFixture });
  const labels = doc.totals.map((total) => total.label);
  assert.ok(!labels.includes("Delivery"), labels);
  assert.ok(!labels.includes("Tip"), labels);
  assert.ok(labels.includes("Subtotal") && labels.includes("Total"));
});

check("a rounding adjustment is shown even though it is tiny", () => {
  /*
   * The one charge that is *more* confusing when hidden: an unexplained
   * difference between the lines and the total reads as an arithmetic error.
   */
  const doc = invoiceDocument({
    invoice: { invoiceNumber: "INV-5" },
    receipt: { ...receiptFixture, totals: { ...receiptFixture.totals, roundOff: -0.4, grandTotal: 179.6 } },
  });
  assert.ok(doc.totals.some((total) => total.label === "Rounding"), doc.totals);
});

check("tax is broken down per rate when the lines are there", () => {
  // "Tax: 240" tells a filer nothing; a return is built from rate and base.
  const doc = invoiceDocument({
    invoice: { invoiceNumber: "INV-6" },
    receipt: {
      ...receiptFixture,
      taxLines: [{ name: "GST", rate: 16, taxableAmount: 180, amount: 28.8 }],
      totals: { ...receiptFixture.totals, taxTotal: 28.8, grandTotal: 208.8 },
    },
  });
  assert.ok(doc.totals.some((total) => total.label === "GST (16%) on PKR 180"), doc.totals);
});

check("an unpaid invoice shows what is owed, an overpaid one does not", () => {
  const owed = invoiceDocument({
    invoice: { invoiceNumber: "INV-7" },
    receipt: { ...receiptFixture, totals: { ...receiptFixture.totals, paidTotal: 100 } },
  });
  assert.ok(owed.totals.some((total) => total.label === "Balance due"), owed.totals);

  // An overpayment is a refund to arrange, not a negative balance to print.
  const over = invoiceDocument({
    invoice: { invoiceNumber: "INV-8" },
    receipt: { ...receiptFixture, totals: { ...receiptFixture.totals, paidTotal: 300 } },
  });
  assert.ok(!over.totals.some((total) => total.label === "Balance due"), over.totals);
});

const payslipFixture = {
  branch: { name: "FoodZone", legalName: "FoodZone (Pvt) Ltd", timezone: "Asia/Karachi" },
  period: { name: "October 2026", startDate: new Date("2026-10-01"), endDate: new Date("2026-10-31"), payDate: new Date("2026-11-05") },
  payslip: {
    status: "APPROVED",
    payableDays: 27, presentDays: 25, leaveDays: 2, absentDays: 2,
    workedMinutes: 12_240, overtimeMinutes: 430,
    grossAmount: 74_500, deductionAmount: 9_320, netAmount: 65_180,
    employee: { firstName: "A", lastName: "Worker", employeeCode: "EMP-1", currency: "PKR", salaryType: "MONTHLY" },
    lines: [
      { code: "BASIC", label: "Basic salary", isEarning: true, quantity: 27, rate: 2200, amount: 59_400 },
      { code: "PF", label: "Provident fund", isEarning: false, quantity: 1, rate: 4455, amount: 4_455 },
    ],
  },
};

check("a deduction is drawn as a negative", () => {
  // A column of positive numbers that happen to be subtracted is how somebody
  // reads their own net pay wrongly.
  const doc = payslipDocument(payslipFixture);
  const pf = doc.table.rows.find((row) => row.component === "Provident fund");
  assert.ok(pf.amount.startsWith("-"), pf);
  assert.ok(doc.totals.find((total) => total.label === "Deductions").value.startsWith("-"));
});

check("a payslip shows the arithmetic, not just the answer", () => {
  const doc = payslipDocument(payslipFixture);
  const basic = doc.table.rows.find((row) => row.component === "Basic salary");
  assert.equal(basic.basis, "27 x 2,200");
  // A fixed allowance has no basis to show, and inventing one would be a lie.
  const noBasis = payslipDocument({
    ...payslipFixture,
    payslip: { ...payslipFixture.payslip, lines: [{ code: "HRA", label: "House rent", isEarning: true, amount: 9000 }] },
  });
  assert.equal(noBasis.table.rows[0].basis, "");
});

check("attendance is printed beside the pay it explains", () => {
  const doc = payslipDocument(payslipFixture);
  const period = doc.parties.find((party) => party.title === "Period");
  assert.ok(period.lines.some((line) => line.includes("absent 2")), period.lines);
  assert.ok(period.lines.some((line) => line.includes("204h")), period.lines);
  assert.ok(period.lines.some((line) => line.includes("overtime 7h 10m")), period.lines);
});

check("a draft payslip cannot be mistaken for a final one", () => {
  /*
   * A payslip is a statement of fact about money owed. One generated from
   * numbers that may still be regenerated must not circulate as final.
   */
  const draft = payslipDocument({ ...payslipFixture, payslip: { ...payslipFixture.payslip, status: "DRAFT" } });
  assert.ok(draft.banner.startsWith("DRAFT"), draft.banner);

  const approved = payslipDocument(payslipFixture);
  assert.equal(approved.banner, null);

  const cancelled = payslipDocument({ ...payslipFixture, payslip: { ...payslipFixture.payslip, status: "CANCELLED" } });
  assert.equal(cancelled.banner, "CANCELLED");
});

check("a bank account is never printed in full", () => {
  // The last four are enough to recognise the account; the rest is a credential.
  const doc = payslipDocument({
    ...payslipFixture,
    payslip: {
      ...payslipFixture.payslip,
      employee: { ...payslipFixture.payslip.employee, bankAccountNumber: "PK36HABB0000001234567890" },
    },
  });
  const note = doc.notes.find((line) => line.startsWith("Credited"));
  assert.equal(note, "Credited to account ending 7890");
  assert.ok(!doc.notes.some((line) => line.includes("PK36HABB")), doc.notes);
});

// --- scheduled order slots ---------------------------------------------------

const KHI = "Asia/Karachi";
// 11:00 to 23:00 every day, and Friday trades until 02:00.
const WEEK_HOURS = Array.from({ length: 7 }, (_, dayOfWeek) => ({ dayOfWeek, opensAt: 660, closesAt: dayOfWeek === 5 ? 1560 : 1380 }));
// 2026-11-12 is a Thursday; 2026-11-13 is the Friday.
const EARLY = new Date("2026-11-11T04:00:00Z");

check("slots are the branch's own trading hours, in its own clock", () => {
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY });
  assert.equal(grid.slots[0].label, "11:00");
  // 23:00 close, 30-minute slots: the last one a kitchen can finish is 22:30.
  assert.equal(grid.slots.at(-1).label, "22:30");
  // 11:00 in Karachi is 06:00Z.
  assert.equal(grid.slots[0].at.toISOString(), "2026-11-12T06:00:00.000Z");
});

check("the last slot leaves a full slot of kitchen time", () => {
  /*
   * Offering 22:55 to a kitchen that shuts at 23:00 promises food nobody is
   * going to cook.
   */
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY, slotMinutes: 60 });
  assert.equal(grid.slots.at(-1).label, "22:00");

  /*
   * The case that actually proves the rule: a closing time that is not a whole
   * number of slots after opening. 11:00 to 22:50 in half hours must stop at
   * 22:00 — stopping at 22:30 would leave the kitchen twenty minutes, and a
   * window that happens to divide evenly hides the difference entirely.
   */
  const ragged = buildSlots({
    date: "2026-11-12", timeZone: KHI, now: EARLY,
    hours: [{ dayOfWeek: 4, opensAt: 660, closesAt: 1370 }],
  });
  assert.equal(ragged.slots.at(-1).label, "22:00");
});

check("a kitchen that trades past midnight can be booked past midnight", () => {
  // Friday closes at 02:00, written as 1560 minutes past Friday midnight.
  const grid = buildSlots({ date: "2026-11-13", timeZone: KHI, hours: WEEK_HOURS, now: EARLY });
  assert.equal(grid.slots.at(-1).label, "01:30");
  // Which really is Saturday morning.
  assert.equal(grid.slots.at(-1).at.toISOString(), "2026-11-13T20:30:00.000Z");
});

check("a day the branch does not trade has no slots, and says so", () => {
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours: [{ dayOfWeek: 0, opensAt: 660, closesAt: 1380 }], now: EARLY });
  assert.deepEqual(grid.slots, []);
  assert.equal(grid.reason, "CLOSED");
});

check("nothing inside the lead time is offered at all", () => {
  /*
   * Not offered-and-rejected: a slot a customer can pick and then be refused
   * teaches them to try again, which is worse than never showing it.
   */
  const now = new Date("2026-11-12T13:10:00Z"); // 18:10 in Karachi
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now, leadMinutes: 45 });
  assert.equal(grid.slots[0].label, "19:00");
  assert.ok(!grid.slots.some((slot) => slot.label === "18:30"), grid.slots.slice(0, 3));
});

check("a closure takes its slots off the grid", () => {
  // Shut from 18:00 to 20:00 for a private function.
  const grid = buildSlots({
    date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY,
    closures: [{ startsAt: "2026-11-12T13:00:00Z", endsAt: "2026-11-12T15:00:00Z" }],
  });
  const labels = grid.slots.map((slot) => slot.label);
  assert.ok(!labels.includes("18:00") && !labels.includes("19:30"), labels);
  // The boundary belongs to the next slot, not the closure.
  assert.ok(labels.includes("20:00"), labels);
  assert.ok(labels.includes("17:30"), labels);
});

check("a full slot is shown as full rather than hidden", () => {
  /*
   * Hiding it reads as "no slots". Showing it with nothing left reads as
   * "that one is taken, pick another" — and a customer who can see the shape
   * of the evening picks a workable time without being told to.
   */
  const at = new Date("2026-11-12T14:00:00Z").toISOString(); // 19:00 local
  const grid = buildSlots({
    date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY,
    capacity: 10, counts: new Map([[at, 10]]),
  });
  const full = grid.slots.find((slot) => slot.label === "19:00");
  assert.equal(full.available, false);
  assert.equal(full.remaining, 0);
  assert.equal(grid.slots.find((slot) => slot.label === "19:30").remaining, 10);
});

check("no ceiling means every slot is open", () => {
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY, capacity: 0 });
  assert.ok(grid.slots.every((slot) => slot.available && slot.remaining === null));
});

check("two trading windows that touch do not produce the slot twice", () => {
  // A lunch service and a dinner service that meet at 16:00.
  const hours = [
    { dayOfWeek: 4, opensAt: 660, closesAt: 960 },
    { dayOfWeek: 4, opensAt: 960, closesAt: 1380 },
  ];
  const grid = buildSlots({ date: "2026-11-12", timeZone: KHI, hours, now: EARLY });
  const labels = grid.slots.map((slot) => slot.label);
  assert.equal(new Set(labels).size, labels.length);
  assert.ok(labels.includes("16:00"));
  // And they come back in time order, not window order.
  assert.deepEqual([...labels].sort(), labels);
});

check("a channel's own hours win over the all-channel default", () => {
  const hours = [
    { dayOfWeek: 4, opensAt: 660, closesAt: 1380, channel: null },
    { dayOfWeek: 4, opensAt: 720, closesAt: 900, channel: "WEB" },
  ];
  const web = buildSlots({ date: "2026-11-12", timeZone: KHI, hours, now: EARLY, channel: "WEB" });
  // Both windows apply to WEB: the general one and its own.
  assert.equal(web.slots[0].label, "11:00");

  const pos = buildSlots({ date: "2026-11-12", timeZone: KHI, hours, now: EARLY, channel: "POS" });
  // The WEB-only window is not offered to the till.
  assert.equal(pos.slots.at(-1).label, "22:30");
});

check("checkout re-checks the slot rather than trusting the page", () => {
  /*
   * The grid the browser was shown may be an hour old, the slot may have
   * filled since, and a request can arrive without the page ever being
   * loaded. Each refusal names its own reason so the message can be true.
   */
  const at = new Date("2026-11-12T14:00:00Z");
  const grid = buildSlots({
    date: "2026-11-12", timeZone: KHI, hours: WEEK_HOURS, now: EARLY,
    capacity: 2, counts: new Map([[at.toISOString(), 2]]),
  });

  assert.equal(findSlot(at, grid).reason, "SLOT_FULL");
  assert.equal(findSlot(new Date("2026-11-12T14:07:00Z"), grid).reason, "NOT_A_SLOT");
  assert.equal(findSlot("not a date", grid).reason, "INVALID_TIME");
  assert.equal(findSlot(new Date("2026-11-12T14:30:00Z"), grid).ok, true);
});

check("the calendar runs from today to the limit, inclusive", () => {
  const dates = schedulableDates({ now: new Date("2026-11-11T19:00:00Z"), timeZone: KHI, maxDaysAhead: 3 });
  // 19:00Z is already the 12th in Karachi, which is what "today" means here.
  assert.deepEqual(dates, ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
