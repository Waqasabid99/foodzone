/**
 * Modifier group rules, stated the way the cart enforces them.
 *
 * The wording matters because the cart's behaviour is subtler than "min/max":
 * a group's minimum only applies once a customer picks *something* from it. A
 * "Choose a sauce" group with a minimum of 1 can still be skipped entirely —
 * only marking the group Required on a product forces a choice. A screen that
 * said "pick 1" would promise a rule the checkout does not keep.
 */
import { parseMoneyDelta, parseWhole } from "@/lib/product-form";

export const MODIFIER_GROUP_FIELDS = ["name", "internalName", "selectionType", "minSelect", "maxSelect", "options"];

export function describeModifierRule({ selectionType, minSelect, maxSelect, allowQuantity }) {
  const parts = [];
  if (selectionType === "SINGLE") parts.push("One choice");
  else if (minSelect > 0 && minSelect === maxSelect) parts.push(`Exactly ${minSelect} if any are picked`);
  else if (minSelect > 0) parts.push(`${minSelect}–${maxSelect} if any are picked`);
  else parts.push(`Up to ${maxSelect}`);
  if (allowQuantity) parts.push("repeats allowed");
  return parts.join(" · ");
}

/** Mirrors `assertRulesAreSatisfiable` in modifier.service, so the form refuses first. */
export function modifierRuleErrors({ selectionType, minSelect, maxSelect, allowQuantity, optionCount }) {
  const errors = {};
  if (selectionType === "SINGLE" && maxSelect > 1) errors.maxSelect = "A one-choice group allows one pick";
  if (minSelect > maxSelect) errors.minSelect = "The minimum cannot be more than the maximum";
  else if (!allowQuantity && optionCount > 0 && minSelect > optionCount) {
    errors.minSelect = `Only ${optionCount} ${optionCount === 1 ? "choice is" : "choices are"} available`;
  }
  return errors;
}

/**
 * Anything that stops this group working at checkout, worst first.
 * Returns an array of `{ level: "blocking" | "warning", message }`.
 */
export function modifierGroupHealth(group) {
  const active = (group.options ?? []).filter((option) => option.isActive);
  const issues = [];
  if (!group.isActive) {
    issues.push({ level: "warning", message: "Switched off — customers do not see it on any product." });
  }
  if (!active.length) {
    issues.push({ level: "blocking", message: "No choices are switched on, so there is nothing to pick." });
  } else if (!group.allowQuantity && group.minSelect > active.length) {
    issues.push({
      level: "blocking",
      message: `Asks for at least ${group.minSelect} but only ${active.length} ${active.length === 1 ? "choice is" : "choices are"} on.`,
    });
  }
  return issues;
}

export function modifierGroupFormValues(group = null) {
  return {
    name: group?.name ?? "",
    internalName: group?.internalName ?? "",
    selectionType: group?.selectionType ?? "SINGLE",
    minSelect: String(group?.minSelect ?? 0),
    maxSelect: String(group?.maxSelect ?? 1),
    allowQuantity: Boolean(group?.allowQuantity),
    isActive: group ? Boolean(group.isActive) : true,
    options: [
      { key: "o1", name: "", priceDelta: "", isDefault: false },
      { key: "o2", name: "", priceDelta: "", isDefault: false },
    ],
  };
}

/** `{ body, errors }` for create (with options) or update (rules only). */
export function modifierGroupPayload(form, { creating = false, optionCount = 0 } = {}) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Name the group, e.g. Choose a sauce";

  const single = form.selectionType === "SINGLE";
  const min = parseWhole(form.minSelect, { max: 50 });
  const max = single ? { value: 1 } : parseWhole(form.maxSelect, { min: 1, max: 50 });
  if (min.error) errors.minSelect = min.error;
  if (max.error) errors.maxSelect = max.error;
  if (!single && max.value === null) errors.maxSelect = "Enter the most a customer can pick";
  if (single && !min.error && (min.value ?? 0) > 1) errors.minSelect = "A one-choice group's minimum is 0 or 1";

  const body = {
    name,
    internalName: form.internalName.trim() || null,
    selectionType: single ? "SINGLE" : "MULTIPLE",
    minSelect: min.value ?? 0,
    maxSelect: max.value ?? 1,
    allowQuantity: single ? false : Boolean(form.allowQuantity),
    isActive: Boolean(form.isActive),
  };

  let count = optionCount;
  if (creating) {
    const rows = form.options.filter((row) => row.name.trim() || row.priceDelta.trim());
    const seen = new Set();
    const options = [];
    for (const [index, row] of rows.entries()) {
      const optionName = row.name.trim();
      const delta = parseMoneyDelta(row.priceDelta);
      if (!optionName) errors.options ??= `Choice ${index + 1} needs a name`;
      else if (seen.has(optionName.toLowerCase())) errors.options ??= `"${optionName}" is listed twice`;
      if (delta.error) errors.options ??= `${optionName || `Choice ${index + 1}`}: ${delta.error}`;
      seen.add(optionName.toLowerCase());
      options.push({ name: optionName, priceDelta: delta.value ?? 0, isDefault: Boolean(row.isDefault), sortOrder: index });
    }
    if (!options.length) errors.options ??= "Add at least one choice";
    if (single && options.filter((option) => option.isDefault).length > 1) {
      errors.options ??= "A one-choice group can pre-select only one";
    }
    body.options = options;
    count = options.length;
  }

  if (!errors.minSelect && !errors.maxSelect) {
    Object.assign(
      errors,
      modifierRuleErrors({ ...body, optionCount: count }),
    );
  }
  // A null internal name on create is simply absent.
  if (creating && body.internalName === null) delete body.internalName;

  return { body, errors };
}

export function modifierOptionPayload(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Name this choice";
  const delta = parseMoneyDelta(form.priceDelta);
  if (delta.error) errors.priceDelta = delta.error;
  return { body: { name, priceDelta: delta.value ?? 0 }, errors };
}
