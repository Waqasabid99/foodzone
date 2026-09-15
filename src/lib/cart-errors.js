/**
 * The cart's "which outlet?" refusal, recognised.
 *
 * `addItem` rejects a line with no branch, and it is right to: with several
 * outlets the server cannot know whose prices, whose kitchen or whose delivery
 * area the order belongs to, and guessing would quote one branch's menu for
 * another's food. But the refusal is only useful if the visitor is then shown
 * the choice it is asking for.
 */
export function isBranchRequired(error) {
  return Boolean(error?.details?.branchId) || /choose a branch/i.test(error?.message ?? "");
}

/**
 * What to say when no outlet can be chosen because there are none.
 *
 * A restaurant with no active branch has nothing to sell online, and that is a
 * setup state rather than a customer error — so it is worded as the shop being
 * shut, not as something they did wrong.
 */
export const NO_BRANCHES_MESSAGE = "Online ordering isn't available right now. Please check back soon.";
