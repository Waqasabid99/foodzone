/**
 * The rules behind a product's option form.
 *
 * Pure, and separate from the component, because this is where getting it wrong
 * is expensive: a min/max check that is off by one either blocks a valid order
 * or lets an invalid one through to a kitchen. The server enforces the same
 * rules on the way in — these exist so the customer finds out before pressing
 * Add, not after.
 */

/**
 * How many of a group's options are selected, counting quantities.
 *
 * A group with `allowQuantity` lets one option be taken twice ("extra bacon
 * ×2"), and that counts as two against the maximum — otherwise "max 3" would
 * silently permit six.
 */
export function selectedCount(group, selections) {
  return group.options.reduce((total, option) => total + (selections[option.id] ?? 0), 0);
}

/**
 * What is wrong with this group's selection, or null when nothing is.
 *
 * Returned as a message rather than a boolean so the form can say which rule
 * was missed. "Choose at least 1" and "Choose up to 2" are different problems.
 */
export function groupError(group, selections) {
  const count = selectedCount(group, selections);
  const min = group.isRequired ? Math.max(1, group.minSelect ?? 1) : (group.minSelect ?? 0);
  const max = group.maxSelect ?? null;

  if (count < min) {
    return min === 1 ? "Choose 1 option" : `Choose at least ${min} options`;
  }
  if (max !== null && count > max) {
    return max === 1 ? "Choose only 1 option" : `Choose up to ${max} options`;
  }
  return null;
}

/** Every unsatisfied group, keyed by group id. */
export function validateGroups(groups, selectionsByGroup) {
  const errors = {};
  for (const group of groups) {
    const error = groupError(group, selectionsByGroup[group.id] ?? {});
    if (error) errors[group.id] = error;
  }
  return errors;
}

/**
 * Whether one more of this option can be taken.
 *
 * A single-select group always allows the click — it replaces the current
 * choice rather than adding to it, so "full" never applies.
 */
export function canSelectMore(group, selections, optionId) {
  if (group.selectionType === "SINGLE") return true;
  if ((selections[optionId] ?? 0) > 0 && !group.allowQuantity) return true; // toggling off

  const max = group.maxSelect ?? null;
  if (max === null) return true;
  return selectedCount(group, selections) < max;
}

/**
 * The line total to display, in the store's minor-unit-free number form.
 *
 * Explicitly a *preview*. The server reprices every line against the branch
 * menu, applies promotions and tax, and its answer is the one that gets
 * charged — this exists so the button can show a number before the round trip,
 * not so the browser can decide what anything costs.
 */
export function previewTotal({ basePrice, groups, selectionsByGroup, quantity = 1 }) {
  let unit = Number(basePrice) || 0;

  for (const group of groups) {
    const selections = selectionsByGroup[group.id] ?? {};
    for (const option of group.options) {
      const count = selections[option.id] ?? 0;
      if (count > 0) unit += Number(option.priceDelta || 0) * count;
    }
  }

  return unit * Math.max(1, quantity);
}

/** Default selections: every option a group marks as default, pre-ticked. */
export function defaultSelections(groups) {
  const byGroup = {};

  for (const group of groups) {
    const selections = {};
    for (const option of group.options) {
      if (!option.isDefault) continue;
      selections[option.id] = 1;
      // A single-select group can only carry one default, whatever the data says.
      if (group.selectionType === "SINGLE") break;
    }
    byGroup[group.id] = selections;
  }

  return byGroup;
}

/** Flattens the selection map into the array the cart endpoint expects. */
export function toModifierPayload(selectionsByGroup) {
  const payload = [];
  for (const selections of Object.values(selectionsByGroup)) {
    for (const [optionId, quantity] of Object.entries(selections)) {
      if (quantity > 0) payload.push({ optionId, quantity });
    }
  }
  return payload;
}
