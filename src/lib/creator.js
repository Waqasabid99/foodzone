/**
 * The creator-programme screens' vocabulary and rules, with no React and no
 * database in it.
 *
 * Three things in this section are easy to show wrongly, and each one has
 * something here to stop it:
 *
 *   * **A rejection is a message to a person.** Every rejected upload costs a
 *     creator one of a small number of attempts, and the fifth one locks the
 *     line for ever. So reasons are written as the sentence the creator will
 *     read, not as the enum, and the cost of the decision is on screen while
 *     the moderator makes it.
 *   * **An earning that paid nothing still happened.** `NOT_QUALIFIED` is the
 *     most informative row in the table — a video drove a real sale and the
 *     rule missed it — and a UI that renders it as a zero throws that away.
 *   * **A commission rule writes money.** `ruleProblems` mirrors the server's
 *     `assertCoherent`, and a unit test holds the two together: a form that
 *     accepts what the API refuses is worse than no validation at all.
 */

const CHIP = {
  good: "bg-success-container text-on-success-container",
  warn: "bg-warning-container text-on-warning-container",
  bad: "bg-error-container text-on-error-container",
  live: "bg-secondary-container text-on-secondary-container",
  quiet: "bg-surface-container-high text-on-surface-variant",
};

export const chipClass = (tone) => CHIP[tone] ?? CHIP.quiet;

// --- creators ---------------------------------------------------------------

export const CREATOR_STATES = {
  PENDING: { label: "Pending", tone: "warn", note: "Signed up, nothing approved yet." },
  ACTIVE: { label: "Active", tone: "good", note: "Can upload, and their live videos earn." },
  SUSPENDED: { label: "Suspended", tone: "warn", note: "Temporarily stopped. Live videos stay down while suspended." },
  BANNED: { label: "Banned", tone: "bad", note: "Permanent. Their videos no longer appear anywhere." },
};

export const creatorState = (creator) => CREATOR_STATES[creator?.status] ?? { label: creator?.status ?? "Unknown", tone: "quiet", note: "" };

/**
 * What the next strike would do.
 *
 * Mirrors `standingFor` on the server, and uses its vocabulary rather than a
 * second set of names, so the two can be compared directly. Shown next to the
 * strike button
 * because "issue a strike" and "ban this person" are the same click when
 * they are already on four points, and nothing on the screen says so.
 */
export function strikeOutlook({ points = 0, suspendAtStrikePoints = 3, banAtStrikePoints = 5 }) {
  if (points >= banAtStrikePoints) return { standing: "BANNED", tone: "bad", sentence: "Past the ban threshold." };
  if (points >= suspendAtStrikePoints) {
    const left = banAtStrikePoints - points;
    return {
      standing: "SUSPENDED",
      tone: "warn",
      sentence: `Suspended. ${left} more point${left === 1 ? "" : "s"} would ban them.`,
    };
  }
  const toSuspend = suspendAtStrikePoints - points;
  return {
    standing: "ACTIVE",
    tone: "good",
    sentence: `${toSuspend} more point${toSuspend === 1 ? "" : "s"} would suspend them.`,
  };
}

export const STRIKE_REASONS = {
  MISLEADING_CONTENT: { label: "Misleading", points: 2 },
  INAPPROPRIATE_CONTENT: { label: "Inappropriate", points: 3 },
  THIRD_PARTY_CONTENT: { label: "Not their footage", points: 2 },
  FAKE_ORDER: { label: "Fake order", points: 3 },
  ATTRIBUTION_ABUSE: { label: "Attribution abuse", points: 3 },
  REPEATED_REJECTIONS: { label: "Repeated rejections", points: 1 },
  OTHER: { label: "Other", points: 1 },
};

// --- videos -----------------------------------------------------------------

export const VIDEO_STATES = {
  DRAFT: { label: "Draft", tone: "quiet", note: "Uploaded but not sent for review." },
  PROCESSING: { label: "Processing", tone: "quiet", note: "Being checked for length and format." },
  PENDING_REVIEW: { label: "Waiting", tone: "warn", note: "In the queue." },
  APPROVED: { label: "Live", tone: "good", note: "Showing on the product page at the branch it was filmed at." },
  REJECTED: { label: "Sent back", tone: "warn", note: "The creator can try again while attempts remain." },
  LOCKED: { label: "Locked", tone: "bad", note: "Out of attempts. This line can never be filmed again." },
  TAKEN_DOWN: { label: "Taken down", tone: "bad", note: "Was live, pulled by moderation." },
  ARCHIVED: { label: "Withdrawn", tone: "quiet", note: "The creator removed it." },
};

export const videoState = (video) => VIDEO_STATES[video?.status] ?? { label: video?.status ?? "Unknown", tone: "quiet", note: "" };

/**
 * Rejection reasons, phrased as the creator will read them.
 *
 * `costly` marks the ones that say "you did something wrong" rather than
 * "this file was not usable". The distinction matters because a rejection for
 * bad lighting and a rejection for using somebody else's footage carry the
 * same attempt cost but very different implications, and the second should
 * usually come with a strike rather than just a note.
 */
export const REJECTION_REASONS = {
  ORDER_NOT_VERIFIED: { label: "The order does not back this", costly: true },
  PRODUCT_MISMATCH: { label: "Shows a different item", costly: true },
  DURATION_OUT_OF_RANGE: { label: "Too short or too long", costly: false },
  POOR_VIDEO_QUALITY: { label: "Picture quality", costly: false },
  POOR_AUDIO_QUALITY: { label: "Sound quality", costly: false },
  INAPPROPRIATE_CONTENT: { label: "Inappropriate content", costly: true },
  THIRD_PARTY_CONTENT: { label: "Not filmed by the creator", costly: true },
  PERSONAL_INFO_VISIBLE: { label: "Shows personal information", costly: false },
  DUPLICATE_SUBMISSION: { label: "Already submitted", costly: false },
  BRANDING_VIOLATION: { label: "Branding", costly: false },
  OTHER: { label: "Something else", costly: false },
};


/** Attempts left before the line locks permanently. */
export function attemptsLeft({ rejectionCount = 0, maxUploadAttempts = 5, isLocked = false } = {}) {
  if (isLocked) return 0;
  return Math.max(0, maxUploadAttempts - rejectionCount);
}

/**
 * What rejecting this video would cost the creator, as a sentence.
 *
 * Deliberately phrased in terms of what happens to them, not what the counter
 * reads: "this is their last chance" is actionable, "4 of 5 attempts used" is
 * a number somebody has to do arithmetic on mid-decision.
 */
export function rejectionCost(video, { maxUploadAttempts = 5 } = {}) {
  const left = attemptsLeft({ ...video, maxUploadAttempts });
  if (left <= 0) return { tone: "bad", sentence: "This line is already locked." };
  if (left === 1) {
    return { tone: "bad", sentence: "This is their last attempt — rejecting it locks this item for ever." };
  }
  return { tone: "warn", sentence: `They would have ${left - 1} attempt${left - 1 === 1 ? "" : "s"} left.` };
}

/** Which moderation actions this video is actually in a state for. */
export function videoActions(video) {
  const status = video?.status;
  return {
    canApprove: status === "PENDING_REVIEW",
    canReject: status === "PENDING_REVIEW" || status === "APPROVED",
    canTakeDown: status === "APPROVED",
    canReinstate: status === "TAKEN_DOWN",
    canFeature: status === "APPROVED",
  };
}

export function durationLabel(seconds) {
  if (seconds == null) return "—";
  return `${Number(seconds).toFixed(0)}s`;
}

/**
 * How often the people who watched it then bought it.
 *
 * Returns null rather than 0% below a floor. A single view and a single
 * add-to-cart is not a 100% conversion rate, and showing it as one puts the
 * newest video at the top of every sort.
 */
export function conversionRate(video, { floor = 20 } = {}) {
  const views = Number(video?.viewCount ?? 0);
  if (views < floor) return null;
  return (Number(video?.addToCartCount ?? 0) / views) * 100;
}

export function engagementRate(video, { floor = 20 } = {}) {
  const views = Number(video?.viewCount ?? 0);
  if (views < floor) return null;
  return ((Number(video?.likeCount ?? 0) + Number(video?.shareCount ?? 0)) / views) * 100;
}

// --- earnings ---------------------------------------------------------------

export const EARNING_STATES = {
  PENDING: { label: "Holding", tone: "warn", note: "Waiting out the refund window before it credits." },
  APPROVED: { label: "Cleared", tone: "live", note: "Past the hold, waiting on the credit job." },
  CREDITED: { label: "Paid", tone: "good", note: "In the creator's wallet." },
  NOT_QUALIFIED: { label: "No rule matched", tone: "quiet", note: "The video drove this sale but no rule covered it." },
  REVERSED: { label: "Clawed back", tone: "bad", note: "The order was refunded after the credit went out." },
  REJECTED: { label: "Voided", tone: "bad", note: "Cancelled by an admin." },
};

export const earningState = (earning) => EARNING_STATES[earning?.status] ?? { label: earning?.status ?? "Unknown", tone: "quiet", note: "" };

/** An earning only has somewhere to go from some states. */
export function earningActions(earning) {
  const status = earning?.status;
  return {
    canReverse: status === "CREDITED",
    canReject: status === "PENDING" || status === "APPROVED",
  };
}

/**
 * Where an earning is in its hold window.
 *
 * Returns null when there is no hold to describe, so a caller renders nothing
 * rather than "0 days left" against money that was paid a month ago.
 */
export function holdProgress(earning, now = new Date()) {
  if (earning?.status !== "PENDING" || !earning?.availableAt) return null;
  const due = new Date(earning.availableAt);
  const msLeft = due.getTime() - now.getTime();
  const daysLeft = Math.ceil(msLeft / 86400000);
  if (msLeft <= 0) return { daysLeft: 0, sentence: "Hold is over — due at the next credit run.", tone: "live" };
  return {
    daysLeft,
    sentence: `${daysLeft} day${daysLeft === 1 ? "" : "s"} of refund hold left.`,
    tone: "warn",
  };
}

/**
 * Why a sale earned nothing, in a sentence a human can act on.
 *
 * The server stores a short reason code; this turns it into the thing the
 * admin would actually do about it.
 */
export function disqualificationHint(reason) {
  const text = String(reason ?? "");
  if (!text) return "No commission rule covered this sale.";
  if (/self/i.test(text)) return "The buyer was the creator. Self-purchases earn nothing unless the programme allows it.";
  if (/budget/i.test(text)) return "The rule that matched had already spent its budget.";
  if (/threshold|minimum|min/i.test(text)) return "The order was below the rule's minimum.";
  if (/no rule|unmatched/i.test(text)) return "No rule covered this product, branch or channel.";
  return text;
}

/**
 * How the programme is doing, as a judgement rather than a number.
 *
 * Cost of sales is the figure that decides whether the programme continues,
 * and it is meaningless without a view on what is acceptable — so the view is
 * stated here once instead of being re-invented on each screen.
 */
export function costVerdict(percent) {
  if (percent == null) return { tone: "quiet", sentence: "Not enough attributed revenue to judge yet." };
  if (percent <= 5) return { tone: "good", sentence: "Cheap for the revenue it is driving." };
  if (percent <= 12) return { tone: "live", sentence: "In the range you would expect for paid referral." };
  if (percent <= 20) return { tone: "warn", sentence: "Expensive. Worth checking which rule is doing it." };
  return { tone: "bad", sentence: "The programme is paying out more than most menus can carry." };
}

// --- commission rules -------------------------------------------------------

export const REWARD_TYPES = {
  PERCENTAGE: { label: "Percentage", unit: "%", note: "A share of whatever the basis measures." },
  FIXED: { label: "Fixed amount", unit: "", note: "The same payout whenever it matches." },
};

export const BASIS_LABELS = {
  ATTRIBUTED_LINE: "the attributed line",
  ORDER_SUBTOTAL: "the order subtotal",
  ORDER_TOTAL: "the order total",
};

/** "10% of the attributed line, capped at 500". */
export function rewardSummary(rule, { formatMoney = (value) => String(value) } = {}) {
  if (!rule) return "";
  if (rule.rewardType === "FIXED") return `${formatMoney(rule.rewardValue)} per attributed line`;
  const base = `${Number(rule.rewardValue)}% of ${BASIS_LABELS[rule.basis] ?? "the attributed line"}`;
  return rule.maxRewardAmount != null ? `${base}, capped at ${formatMoney(rule.maxRewardAmount)}` : base;
}

/** The gates a sale has to pass, as a list. */
export function conditionList(rule, { formatMoney = (value) => String(value) } = {}) {
  const out = [];
  if (!rule) return out;
  if (rule.minOrderAmount != null) {
    out.push(`${BASIS_LABELS[rule.conditionBasis] ?? "the order total"} is at least ${formatMoney(rule.minOrderAmount)}`);
  }
  if (rule.minLineQuantity != null) out.push(`at least ${rule.minLineQuantity} of the item`);
  if (rule.channels?.length) out.push(`ordered via ${rule.channels.join(", ").toLowerCase()}`);
  if (rule.orderTypes?.length) out.push(`${rule.orderTypes.join(", ").toLowerCase()} orders`);
  if (rule.creatorId) out.push("one named creator only");
  return out;
}

/**
 * Which outlets a rule pays at, and whether that is a problem.
 *
 * The same three cases as a promotion, because the field is the same shape —
 * including the one that matters most: an empty list is not "nowhere", it is
 * *everywhere*, now and at any branch opened later.
 */
export function reachSummary(rule, branchNames = {}) {
  const ids = rule?.branchIds ?? [];
  if (!ids.length) {
    return { label: "Every branch", tone: "warn", note: "Including any opened later. This pays out company-wide." };
  }
  const known = ids.filter((id) => branchNames[id]);
  const missing = ids.length - known.length;
  if (!known.length) {
    return { label: "A branch that no longer exists", tone: "bad", note: "This rule can never match. Safe to delete." };
  }
  const label = known.map((id) => branchNames[id]).join(", ");
  return missing
    ? { label, tone: "warn", note: `${missing} branch${missing === 1 ? "" : "es"} on this rule no longer exist.` }
    : { label, tone: "quiet", note: "" };
}

/** Live, scheduled, expired, or switched off. */
export function ruleState(rule, now = new Date()) {
  if (!rule?.isActive) return { label: "Off", tone: "quiet" };
  if (rule.startsAt && new Date(rule.startsAt) > now) return { label: "Scheduled", tone: "live" };
  if (rule.endsAt && new Date(rule.endsAt) < now) return { label: "Ended", tone: "quiet" };
  if (rule.totalBudget != null && Number(rule.budgetSpent) >= Number(rule.totalBudget)) {
    return { label: "Budget spent", tone: "warn" };
  }
  return { label: "Live", tone: "good" };
}

/** How much of the budget is gone, or null when there is no budget. */
export function budgetUse(rule) {
  if (rule?.totalBudget == null) return null;
  const total = Number(rule.totalBudget);
  const spent = Number(rule.budgetSpent ?? 0);
  if (!(total > 0)) return null;
  return { spent, total, percent: Math.min(100, (spent / total) * 100), exhausted: spent >= total };
}

/**
 * Specificity, which is how ties are broken when two rules both match.
 *
 * Surfaced because "why did my rule not apply" is almost always this, and the
 * answer is invisible in the rule itself — it is a property of what it
 * targets.
 */
export function specificityLabel(rule) {
  if (rule?.creatorId) return "One creator";
  const types = new Set((rule?.targets ?? []).filter((t) => !t.isExcluded).map((t) => t.targetType));
  if (types.has("VARIANT")) return "Variant";
  if (types.has("PRODUCT")) return "Product";
  if (types.has("CATEGORY")) return "Category";
  return "Everything";
}

/**
 * The rules the server will enforce, checked here first.
 *
 * Mirrors `assertCoherent` in `creator-commission.service.js`. Held to it by
 * a unit test: if the server grows a rule and this does not, the test names
 * the case they disagree on.
 */
export function ruleProblems(form) {
  const problems = [];
  const value = Number(form?.rewardValue);

  if (form?.rewardType === "PERCENTAGE") {
    if (!(value > 0) || value > 100) problems.push("A percentage reward has to be between 0 and 100.");
  }
  if (form?.rewardType === "FIXED") {
    if (!(value > 0)) problems.push("A fixed reward has to be more than nothing.");
    if (form?.basis && form.basis !== "ATTRIBUTED_LINE") {
      problems.push("A fixed reward does not vary with a basis — use the attributed line, or switch to a percentage.");
    }
  }
  if (form?.startsAt && form?.endsAt && new Date(form.startsAt) >= new Date(form.endsAt)) {
    problems.push("The rule ends before it starts.");
  }
  if (form?.maxRewardAmount != null && form.maxRewardAmount !== "" && !(Number(form.maxRewardAmount) > 0)) {
    problems.push("A reward ceiling of zero would pay nothing. Leave it empty for no ceiling.");
  }
  if (form?.totalBudget != null && form.totalBudget !== "" && !(Number(form.totalBudget) > 0)) {
    problems.push("A budget of zero would pay nothing. Leave it empty for no budget.");
  }
  return problems;
}

/**
 * Things that are legal but almost certainly a mistake.
 *
 * Separate from `ruleProblems` because the server will happily save these —
 * they are judgement, not validation, and the admin is allowed to overrule
 * them.
 */
export function ruleWarnings(form) {
  const warnings = [];
  const value = Number(form?.rewardValue);

  if (form?.rewardType === "PERCENTAGE" && value >= 25) {
    warnings.push(`${value}% of every attributed sale is a large share of a food margin.`);
  }
  if (form?.rewardType === "PERCENTAGE" && value > 0 && form?.maxRewardAmount == null) {
    warnings.push("No ceiling. One very large order would pay out proportionally.");
  }
  if (!form?.branchIds?.length) {
    warnings.push("This pays at every branch, including ones opened later.");
  }
  if (form?.totalBudget == null || form.totalBudget === "") {
    warnings.push("No total budget, so this keeps paying until somebody switches it off.");
  }
  return warnings;
}

/** Form state to the API body, dropping what this reward type does not use. */
export function rulePayload(form) {
  const isPercentage = form.rewardType === "PERCENTAGE";
  const num = (value) => (value === "" || value == null ? null : Number(value));

  return {
    name: form.name.trim(),
    ...(form.description?.trim() ? { description: form.description.trim() } : {}),
    rewardType: form.rewardType,
    rewardValue: Number(form.rewardValue),
    // The basis only means anything for a percentage; sending one with a
    // fixed reward is what the server rejects.
    basis: isPercentage ? form.basis : "ATTRIBUTED_LINE",
    ...(isPercentage && num(form.maxRewardAmount) != null ? { maxRewardAmount: num(form.maxRewardAmount) } : {}),
    conditionBasis: form.conditionBasis,
    ...(num(form.minOrderAmount) != null ? { minOrderAmount: num(form.minOrderAmount) } : {}),
    ...(num(form.minLineQuantity) != null ? { minLineQuantity: num(form.minLineQuantity) } : {}),
    branchIds: form.branchIds ?? [],
    channels: form.channels ?? [],
    orderTypes: form.orderTypes ?? [],
    ...(form.creatorId ? { creatorId: form.creatorId } : {}),
    priority: Number(form.priority || 0),
    ...(form.startsAt ? { startsAt: form.startsAt } : {}),
    ...(form.endsAt ? { endsAt: form.endsAt } : {}),
    isActive: Boolean(form.isActive),
    ...(num(form.maxPayoutPerOrder) != null ? { maxPayoutPerOrder: num(form.maxPayoutPerOrder) } : {}),
    ...(num(form.totalBudget) != null ? { totalBudget: num(form.totalBudget) } : {}),
    ...(form.targets?.length ? { targets: form.targets } : {}),
  };
}

export const CREATOR_FILTERS = [
  { value: "", label: "Everyone" },
  { value: "ACTIVE", label: "Active" },
  { value: "PENDING", label: "Pending" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "BANNED", label: "Banned" },
];

export const VIDEO_FILTERS = [
  { value: "", label: "All videos" },
  { value: "PENDING_REVIEW", label: "Waiting for review" },
  { value: "APPROVED", label: "Live" },
  { value: "REJECTED", label: "Sent back" },
  { value: "LOCKED", label: "Locked" },
  { value: "TAKEN_DOWN", label: "Taken down" },
];

export const EARNING_FILTERS = [
  { value: "", label: "All earnings" },
  { value: "PENDING", label: "Holding" },
  { value: "APPROVED", label: "Cleared" },
  { value: "CREDITED", label: "Paid" },
  { value: "NOT_QUALIFIED", label: "No rule matched" },
  { value: "REVERSED", label: "Clawed back" },
  { value: "REJECTED", label: "Voided" },
];
