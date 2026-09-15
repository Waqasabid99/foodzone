import assert from "node:assert/strict";
import "dotenv/config";

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
const { buildTree } = await import("@/server/services/category.service");
const { shortCode, hmacSha256 } = await import("@/server/utils/crypto");
const { qrCodeParamSchema } = await import("@/server/validation/dinein.schemas");
const { priceOrder, priceLine, taxForLine, applyRounding } = await import("@/server/pricing/engine");
const { allowedTransitions, canTransition, TERMINAL_STATUSES } = await import("@/server/services/order.service");
const { canTransitionItem } = await import("@/server/services/kds.service");
const { computeDiscount, eligibleLines, isPromotionEligible, resolvePromotions } = await import(
  "@/server/pricing/promotions"
);
const { assertPromotionIsCoherent } = await import("@/server/services/promotion.service");
const { effectiveRate } = await import("@/server/services/tax.service");
const { toDigits, fromDigits, withDigitAt, withBackspaceAt, digitsFromPaste, firstEmptyIndex } =
  await import("@/lib/otp");
const { safeRedirect, loginHref, registerHref } = await import("@/lib/redirects");
const { resolveBranch } = await import("@/lib/branch");
const { selectedCount, groupError, validateGroups, canSelectMore, previewTotal, defaultSelections, toModifierPayload } =
  await import("@/lib/product-options");
const { toFormErrors } = await import("@/lib/form-errors");
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
const check = (name, fn) => {
  try {
    fn();
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

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failures:\n - " + failures.join("\n - "));
  process.exit(1);
}
