import { defaultSelections, previewTotal, toModifierPayload, validateGroups } from "@/lib/product-options";

/**
 * The rules behind a combo's slots.
 *
 * A combo is a product whose price buys a shape — a burger, a side, a drink —
 * and the customer fills that shape in. The server already enforces every rule
 * here when the line is added; these exist so somebody finds out before
 * pressing Add rather than after, which is the same bargain `product-options`
 * makes for modifiers.
 *
 * **Counting follows the option, not the click.** A slot option can be worth
 * more than one ("2 pieces"), and the server counts that against the slot's
 * maximum — so a client that counted ticks would let "choose up to 2" through
 * as four pieces and then be refused at the till.
 */

/** What one tick of this option is worth against its slot's limits. */
export function optionWeight(option) {
  return option.quantity ?? 1;
}

/**
 * How much of a slot is filled.
 *
 * Two multipliers, and both matter: how many times this option was taken, and
 * what one of them is worth. A four-drink slot holding two Pepsis is two of
 * four; a two-burger option taken once is two of two.
 */
export function comboSelectedCount(group, selections) {
  return group.options.reduce(
    (total, option) => total + (selections[option.id] ?? 0) * optionWeight(option),
    0,
  );
}

/** Whether one more of this option would still fit in the slot. */
export function hasRoomFor(group, selections, option) {
  const max = group.maxSelect ?? null;
  if (max === null) return true;
  return comboSelectedCount(group, selections) + optionWeight(option) <= max;
}

/**
 * What is wrong with this slot, or null when nothing is.
 *
 * Phrased as the customer's next move rather than as the rule that was broken:
 * "Choose a drink" is actionable where "minSelect not satisfied" is not.
 */
export function comboGroupError(group, selections) {
  const count = comboSelectedCount(group, selections);
  const min = group.minSelect ?? 0;
  const max = group.maxSelect ?? null;

  if (count < min) return min === 1 ? "Make a choice here" : `Choose at least ${min}`;
  if (max !== null && count > max) return max === 1 ? "Choose only 1" : `Choose up to ${max}`;
  return null;
}

/** Every unsatisfied slot, keyed by group id. */
export function validateComboGroups(groups, selectionsByGroup) {
  const errors = {};
  for (const group of groups ?? []) {
    const error = comboGroupError(group, selectionsByGroup[group.id] ?? {});
    if (error) errors[group.id] = error;
  }
  return errors;
}

/**
 * Whether one more of this option fits.
 *
 * A slot that takes one is a radio: the click replaces rather than adds, so it
 * is never full. Beyond that, an option is refused when its own weight would
 * take the slot past its maximum — a 2-piece option cannot go into the one
 * space left of a slot that takes three.
 */
export function canPickMore(group, selections, option) {
  if ((group.maxSelect ?? 1) === 1) return true;
  if (selections[option.id]) return true; // already in; this is a removal
  return hasRoomFor(group, selections, option);
}

/**
 * Pre-filled with whatever the combo was built to include.
 *
 * A combo with no defaults opens empty and every slot has to be answered,
 * which is right — guessing on somebody's behalf is how the wrong drink
 * arrives.
 */
export function comboDefaults(groups) {
  const byGroup = {};

  for (const group of groups ?? []) {
    const selections = {};
    for (const option of group.options) {
      if (!option.isDefault) continue;
      selections[option.id] = 1;
      // One default can be honoured in a slot that takes one, whatever the
      // data says.
      if ((group.maxSelect ?? 1) === 1) break;
    }
    byGroup[group.id] = selections;
  }

  return byGroup;
}

/**
 * What the chosen upgrades add to the combo's price.
 *
 * A preview, like every other number this side of the wire: the server reprices
 * the line and its answer is what gets charged.
 */
export function comboSurcharge(groups, selectionsByGroup, modifiersByOption = {}) {
  let extra = 0;

  for (const group of groups ?? []) {
    const selections = selectionsByGroup[group.id] ?? {};
    for (const option of group.options) {
      const taken = selections[option.id] ?? 0;
      if (!taken) continue;
      extra += Number(option.priceDelta || 0) * optionWeight(option) * taken;

      /*
       * What was changed inside the choice, charged once — not once per
       * portion and not once per repeat. Two Pepsis with extra ice is one
       * decision about ice, and the server prices it the same way: the
       * repeats travel as one selection carrying a quantity.
       */
      const groupsOfOption = option.product?.modifierGroups ?? [];
      extra += previewTotal({
        basePrice: 0,
        groups: groupsOfOption,
        selectionsByGroup: modifiersByOption[option.id] ?? {},
      });
    }
  }

  return extra;
}

/** The option groups a chosen item offers, or nothing when it offers none. */
export function optionGroupsFor(option) {
  return option?.product?.modifierGroups ?? [];
}

/** Every chosen item's own groups pre-filled with their defaults. */
export function comboModifierDefaults(groups) {
  const byOption = {};
  for (const group of groups ?? []) {
    for (const option of group.options) {
      const own = optionGroupsFor(option);
      if (own.length) byOption[option.id] = defaultSelections(own);
    }
  }
  return byOption;
}

/**
 * What is unanswered inside the choices somebody has actually made.
 *
 * Only the picked ones: a required sauce on a burger nobody chose is not a
 * question yet, and marking it red would be nagging about a path not taken.
 */
export function validateComboModifiers(groups, selectionsByGroup, modifiersByOption) {
  const errors = {};

  for (const group of groups ?? []) {
    const picked = selectionsByGroup[group.id] ?? {};
    for (const option of group.options) {
      if (!picked[option.id]) continue;
      const own = optionGroupsFor(option);
      if (!own.length) continue;

      const problems = validateGroups(own, modifiersByOption[option.id] ?? {});
      if (Object.keys(problems).length) errors[option.id] = problems;
    }
  }

  return errors;
}

/**
 * The selection map, as the cart endpoint wants it.
 *
 * Keyed by product and variant rather than by option id — that is what the
 * server matches on, and a size is part of the answer: a combo that offers a
 * regular and a large drink is two options on one product.
 *
 * `quantity` is left off, so the server applies the option's own. Sending a
 * number here would mean this file and the catalog both deciding what "one
 * portion" means, and only one of them is authoritative.
 */
export function toComboPayload(groups, selectionsByGroup, modifiersByOption = {}) {
  const payload = [];

  for (const group of groups ?? []) {
    const selections = selectionsByGroup[group.id] ?? {};
    for (const option of group.options) {
      const taken = selections[option.id] ?? 0;
      if (!taken) continue;

      const modifiers = toModifierPayload(modifiersByOption[option.id] ?? {});

      payload.push({
        groupId: group.id,
        productId: option.product.id,
        ...(option.variant ? { variantId: option.variant.id } : {}),
        /*
         * Sent only when somebody took more than one.
         *
         * Taken once, the field is left off and the catalog decides what a
         * portion is — a "2 burgers" option stays worth two without this file
         * having an opinion. Taken twice, the override has to carry both: the
         * repeats *and* the portion size, because the server reads this number
         * as the whole quantity rather than as a multiplier on the option.
         */
        ...(taken > 1 ? { quantity: taken * optionWeight(option) } : {}),
        // Left off entirely when nothing was changed, so an untouched combo
        // sends exactly what it sent before.
        ...(modifiers.length ? { modifiers } : {}),
      });
    }
  }

  return payload;
}
