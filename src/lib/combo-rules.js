/**
 * Combo slot rules and the "can this combo actually be ordered?" check.
 *
 * A combo is only as orderable as its slots. Each slot needs enough choices a
 * customer can really have — published, not deleted, and in a size still on
 * sale — to meet its minimum. Those choices are owned by other screens and
 * change without anyone opening the combo, so the combo screen re-checks them
 * every time it loads rather than trusting that they were fine when added.
 */
import { parseMoneyDelta, parseWhole } from "@/lib/product-form";

export function comboOptionAvailable(option) {
  return Boolean(option.product?.isActive && !option.product?.deletedAt && option.variant?.isActive !== false);
}

/** What one helping of a choice is worth against its slot's numbers. */
export function optionPortions(option) {
  return option.quantity ?? 1;
}

/**
 * Whether a customer could actually fill this slot.
 *
 * **Counted in portions, not in choices.** "2 burgers, no choice" is one choice
 * worth two, and a slot needing two was being called impossible because it
 * could only see one row — a combo that orders perfectly well was marked
 * "cannot be ordered" on the dashboard.
 *
 * **And a choice can be taken more than once.** One drink on the list fills a
 * four-drink slot as four of that drink, which is exactly what the storefront
 * now lets somebody do.
 *
 * So the question is whether any combination of helpings lands between the
 * minimum and the maximum — worth asking properly, because it can genuinely
 * fail: a slot needing three, offering only choices worth two, can reach two
 * or four and never three.
 */
export function slotFillable(group) {
  const min = group.minSelect ?? 0;
  if (min === 0) return true;

  const max = group.maxSelect ?? min;
  const sizes = [...new Set(group.options.filter(comboOptionAvailable).map(optionPortions))].filter((n) => n > 0);
  if (!sizes.length) return false;

  // Reachable totals up to the ceiling. The ceiling is small by construction —
  // the slot form caps it at 20 — so this is exact rather than a heuristic.
  const reachable = new Array(max + 1).fill(false);
  reachable[0] = true;
  for (let total = 1; total <= max; total += 1) {
    reachable[total] = sizes.some((size) => size <= total && reachable[total - size]);
  }

  return reachable.slice(min).some(Boolean);
}

export function describeSlotRule({ minSelect, maxSelect }) {
  if (minSelect === 0) return `Optional · up to ${maxSelect}`;
  if (minSelect === maxSelect) return `Pick ${minSelect}`;
  return `Pick ${minSelect}–${maxSelect}`;
}

/**
 * How many choices a slot offers, in a form that cannot contradict its rule.
 *
 * "Pick 2 · 1 choice" reads like a mistake — and it was reported as one. It is
 * correct, but only if you know the single choice is worth two, so the line
 * says that part out loud.
 */
export function describeSlotChoices(group) {
  const count = group.options.length;
  const base = `${count} ${count === 1 ? "choice" : "choices"}`;
  if (count !== 1) return base;

  const portions = optionPortions(group.options[0]);
  return portions > 1 ? `${base} worth ${portions}` : base;
}

/** `[{ level: "blocking" | "warning", message }]`, blocking first. */
export function comboHealth(groups = []) {
  const issues = [];
  if (!groups.length) {
    issues.push({ level: "warning", message: "No slots yet — customers would get the combo with nothing to choose." });
  }
  for (const group of groups) {
    const available = group.options.filter(comboOptionAvailable);
    const unavailable = group.options.filter((option) => !comboOptionAvailable(option));

    if (!slotFillable(group)) {
      const sizes = [...new Set(available.map(optionPortions))].sort((a, b) => a - b);

      issues.push({
        level: "blocking",
        message: !group.options.length
          ? `"${group.name}" has no choices, so the combo cannot be ordered.`
          : !available.length
            ? `"${group.name}" has no choices that can be sold, so the combo cannot be ordered.`
            : // Everything on offer is sellable and it still cannot add up:
              // the sizes themselves are the problem, so name them.
              `"${group.name}" needs ${describeSlotRule(group).toLowerCase()}, but its choices come in ${sizes.join("s and ")}s, which cannot add up to that. The combo cannot be ordered.`,
      });
    } else if (unavailable.length) {
      issues.push({
        level: "warning",
        message: `In "${group.name}", ${unavailable.map((option) => option.product.name).join(", ")} ${unavailable.length === 1 ? "is" : "are"} not on sale and will be refused if picked.`,
      });
    }
  }
  return issues.sort((a, b) => (a.level === b.level ? 0 : a.level === "blocking" ? -1 : 1));
}

export function comboGroupPayload(form) {
  const errors = {};
  const name = form.name.trim();
  if (!name) errors.name = "Name the slot, e.g. Choose a drink";
  const min = parseWhole(form.minSelect, { max: 20 });
  const max = parseWhole(form.maxSelect, { min: 1, max: 20 });
  if (min.error) errors.minSelect = min.error;
  if (max.error) errors.maxSelect = max.error;
  else if (max.value === null) errors.maxSelect = "Enter the most a customer can pick";
  if (!errors.minSelect && !errors.maxSelect && (min.value ?? 0) > max.value) {
    errors.minSelect = "The minimum cannot be more than the maximum";
  }
  return { body: { name, minSelect: min.value ?? 0, maxSelect: max.value }, errors };
}

export function comboOptionPayload(form) {
  const errors = {};
  if (!form.productId) errors.productId = "Choose a product";
  const delta = parseMoneyDelta(form.priceDelta);
  if (delta.error) errors.priceDelta = delta.error;
  return {
    body: {
      productId: form.productId,
      ...(form.variantId ? { variantId: form.variantId } : {}),
      priceDelta: delta.value ?? 0,
      isDefault: Boolean(form.isDefault),
    },
    errors,
  };
}
