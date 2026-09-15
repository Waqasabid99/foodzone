import { Prisma } from "@/generated/prisma";

/**
 * The pricing engine.
 *
 * Every amount the customer is ever shown or charged is computed here, and only
 * here. It is deliberately **pure**: it takes resolved lines and a settings
 * snapshot and returns numbers. No database, no clock, no request. That is what
 * makes it testable against the awkward cases — inclusive tax, compound rates,
 * a rounding increment — which are exactly the cases that silently lose money
 * when they are wrong.
 *
 * Two rules run through all of it:
 *
 *   * **Arithmetic is Decimal, never float.** `0.1 + 0.2` is not `0.3`, and a
 *     restaurant does thousands of these a day. Values only become numbers at
 *     the API boundary, where `serialize()` converts them.
 *   * **The client never sends a price.** Lines arrive with ids and quantities;
 *     the prices come from the menu. A mobile binary is entirely under the
 *     user's control, so anything it claims about money is ignored.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/** Money is stored as Decimal(18,4); round there and nowhere else. */
export function money(value) {
  return D(value).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Prices a single line: the variant, its modifiers, and the quantity.
 *
 * Modifier deltas are **per unit**. Two burgers with extra cheese is two lots
 * of cheese, which is what a kitchen actually makes and what a customer expects
 * to pay for.
 */
export function priceLine({ unitPrice, modifiers = [], quantity = 1 }) {
  const modifierTotal = modifiers.reduce(
    (total, modifier) => total.plus(D(modifier.priceDelta).times(modifier.quantity ?? 1)),
    ZERO,
  );

  const unitWithModifiers = D(unitPrice).plus(modifierTotal);

  return {
    unitPrice: money(unitPrice),
    modifierTotal: money(modifierTotal),
    quantity,
    lineSubtotal: money(unitWithModifiers.times(quantity)),
  };
}

/**
 * Tax for one line, from its product's tax group.
 *
 * `isCompound` rates stack on the running total rather than the base — "tax on
 * the tax" — which is why the rates are folded in `sortOrder` and not summed.
 *
 * When menu prices already include tax the arithmetic runs backwards: the line
 * total is the gross, and the tax inside it is extracted rather than added. Get
 * this the wrong way round and every total is off by the tax rate, so the two
 * paths are kept visibly separate instead of sharing a clever formula.
 */
export function taxForLine({ lineSubtotal, rates = [], pricesIncludeTax }) {
  if (!rates.length) {
    return { taxable: money(lineSubtotal), taxTotal: ZERO, lines: [] };
  }

  const ordered = [...rates].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const gross = D(lineSubtotal);

  if (pricesIncludeTax) {
    // Work out the divisor the compound stack implies, then split the gross.
    let factor = D(1);
    for (const rate of ordered) {
      const fraction = D(rate.rate).dividedBy(100);
      factor = rate.isCompound ? factor.times(D(1).plus(fraction)) : factor.plus(fraction);
    }

    const net = gross.dividedBy(factor);
    // `running` is the net plus every tax applied so far. A compound rate is
    // charged on that; a plain rate is always charged on the net. It has to
    // advance after *every* rate, not only compound ones — otherwise a compound
    // rate that follows a plain one never sees the plain one's tax.
    let running = net;
    const lines = [];

    for (const rate of ordered) {
      const fraction = D(rate.rate).dividedBy(100);
      const base = rate.isCompound ? running : net;
      const amount = base.times(fraction);
      lines.push({ ...rate, taxableAmount: money(base), amount: money(amount) });
      running = running.plus(amount);
    }

    return {
      taxable: money(net),
      // Derived by subtraction so the parts always add back to the gross the
      // customer was quoted, whatever the rounding did to each line.
      taxTotal: money(gross.minus(net)),
      lines,
    };
  }

  // Same rule as the inclusive branch: `running` carries the tax applied so
  // far, and advances after every rate.
  let running = gross;
  let taxTotal = ZERO;
  const lines = [];

  for (const rate of ordered) {
    const fraction = D(rate.rate).dividedBy(100);
    const base = rate.isCompound ? running : gross;
    const amount = base.times(fraction);
    lines.push({ ...rate, taxableAmount: money(base), amount: money(amount) });
    taxTotal = taxTotal.plus(amount);
    running = running.plus(amount);
  }

  return { taxable: money(gross), taxTotal: money(taxTotal), lines };
}

/** Rounds to a multiple, returning both the new total and the adjustment. */
export function applyRounding(total, increment) {
  const step = D(increment);
  if (step.lessThanOrEqualTo(0)) return { total: money(total), roundOff: ZERO };

  const rounded = D(total).dividedBy(step).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP).times(step);
  return { total: money(rounded), roundOff: money(rounded.minus(total)) };
}

/**
 * Prices a whole order.
 *
 * `lines` carry a resolved `unitPrice`, `modifiers` and `taxRates`; `settings`
 * is the effective settings snapshot for the branch. Returns the order totals,
 * the priced lines, and the tax lines grouped by rate for the invoice.
 */
export function priceOrder({ lines, type = "DELIVERY", settings = {}, discounts = [], tipAmount = 0 }) {
  const pricesIncludeTax = settings["ordering.prices_include_tax"] ?? true;

  const priced = [];
  let subtotal = ZERO;

  for (const line of lines) {
    const base = priceLine(line);
    priced.push({ ...line, ...base });
    subtotal = subtotal.plus(base.lineSubtotal);
  }

  // --- discounts ----------------------------------------------------------
  // A discount either comes off the goods or off the delivery fee, and the two
  // are not interchangeable. A subtotal discount reduces the taxable base — the
  // customer is buying less value — whereas waiving delivery does not make the
  // food cheaper and must not shrink the tax on it. Conflating them silently
  // under-charges tax on every order that used a free-delivery code.
  //
  // A DELIVERY discount with no `amount` means "whatever the fee turns out to
  // be", which is not known until the fee is computed below.
  const itemDiscounts = discounts.filter((discount) => (discount.appliesTo ?? "SUBTOTAL") !== "DELIVERY");
  const deliveryDiscounts = discounts.filter((discount) => discount.appliesTo === "DELIVERY");

  // Clamped cumulatively rather than only in aggregate, so each row carries the
  // amount actually given. Two stacked 60% offers must come to 100% of the
  // subtotal split between them, never 120% with the excess quietly dropped
  // from the total but still printed on the invoice.
  let itemDiscountTotal = ZERO;
  const resolvedItemDiscounts = [];
  for (const discount of itemDiscounts) {
    const remaining = subtotal.minus(itemDiscountTotal);
    const amount = Prisma.Decimal.max(Prisma.Decimal.min(D(discount.amount), remaining), ZERO);
    itemDiscountTotal = itemDiscountTotal.plus(amount);
    resolvedItemDiscounts.push({ ...discount, amount: money(amount) });
  }

  const discountedSubtotal = subtotal.minus(itemDiscountTotal);

  // Discounts reduce the taxable base, so tax is computed on each line's share
  // of what is actually being charged rather than on the pre-discount price.
  const discountRatio = subtotal.greaterThan(0) ? discountedSubtotal.dividedBy(subtotal) : ZERO;

  const taxLineTotals = new Map();
  let taxTotal = ZERO;

  for (const line of priced) {
    const taxableBase = line.lineSubtotal.times(discountRatio);
    const result = taxForLine({
      lineSubtotal: taxableBase,
      rates: line.taxRates ?? [],
      pricesIncludeTax,
    });

    line.taxAmount = result.taxTotal;
    line.taxRate = money((line.taxRates ?? []).reduce((total, rate) => total.plus(D(rate.rate)), ZERO));
    line.lineTotal = line.lineSubtotal;
    taxTotal = taxTotal.plus(result.taxTotal);

    for (const taxLine of result.lines) {
      const key = taxLine.id ?? taxLine.name;
      const existing = taxLineTotals.get(key) ?? {
        taxRateId: taxLine.id ?? null,
        name: taxLine.name,
        rate: money(taxLine.rate),
        taxableAmount: ZERO,
        amount: ZERO,
      };
      existing.taxableAmount = existing.taxableAmount.plus(taxLine.taxableAmount);
      existing.amount = existing.amount.plus(taxLine.amount);
      taxLineTotals.set(key, existing);
    }
  }

  // --- fees ----------------------------------------------------------------
  const packagingApplies = (settings["ordering.packaging_fee_applies_to"] ?? ["DELIVERY", "PICKUP"]).includes(type);
  const serviceApplies = (settings["ordering.service_charge_applies_to"] ?? ["DINE_IN"]).includes(type);

  let deliveryFee = ZERO;
  if (type === "DELIVERY") {
    deliveryFee = D(settings["ordering.delivery_fee"] ?? 0);
    const freeAbove = D(settings["ordering.free_delivery_above"] ?? 0);
    // A threshold of 0 means "no free delivery", not "everything is free".
    if (freeAbove.greaterThan(0) && discountedSubtotal.greaterThanOrEqualTo(freeAbove)) deliveryFee = ZERO;
  }

  const packagingFee = packagingApplies ? D(settings["ordering.packaging_fee"] ?? 0) : ZERO;
  const serviceCharge = serviceApplies
    ? discountedSubtotal.times(D(settings["ordering.service_charge_percent"] ?? 0)).dividedBy(100)
    : ZERO;

  // Now the fee is known, resolve the delivery waivers against it. Capped at
  // the fee: a free-delivery code on an order that already has free delivery is
  // worth nothing, not a credit against the food.
  let deliveryDiscountTotal = ZERO;
  const resolvedDeliveryDiscounts = [];
  for (const discount of deliveryDiscounts) {
    const remaining = deliveryFee.minus(deliveryDiscountTotal);
    const wanted = discount.amount == null ? remaining : D(discount.amount);
    const amount = Prisma.Decimal.max(Prisma.Decimal.min(wanted, remaining), ZERO);
    deliveryDiscountTotal = deliveryDiscountTotal.plus(amount);
    resolvedDeliveryDiscounts.push({ ...discount, amount: money(amount) });
  }

  // The delivery fee stays gross and its waiver sits in `discountTotal`, so the
  // discount rows always add back to the figure printed on the invoice.
  const discountTotal = itemDiscountTotal.plus(deliveryDiscountTotal);

  const appliedDiscounts = [...resolvedItemDiscounts, ...resolvedDeliveryDiscounts].filter((discount) =>
    discount.amount.greaterThan(0),
  );

  // --- total ---------------------------------------------------------------
  // Inclusive tax is already inside the line prices, so adding it again would
  // charge it twice.
  const taxToAdd = pricesIncludeTax ? ZERO : taxTotal;

  const beforeRounding = subtotal
    .minus(discountTotal)
    .plus(taxToAdd)
    .plus(deliveryFee)
    .plus(packagingFee)
    .plus(serviceCharge)
    .plus(D(tipAmount));

  const { total: grandTotal, roundOff } = applyRounding(
    beforeRounding,
    settings["ordering.rounding_increment"] ?? 0,
  );

  return {
    lines: priced,
    subtotal: money(subtotal),
    discountTotal: money(discountTotal),
    itemDiscountTotal: money(itemDiscountTotal),
    deliveryDiscountTotal: money(deliveryDiscountTotal),
    discounts: appliedDiscounts,
    taxTotal: money(taxTotal),
    deliveryFee: money(deliveryFee),
    packagingFee: money(packagingFee),
    serviceCharge: money(serviceCharge),
    tipAmount: money(tipAmount),
    roundOff,
    grandTotal,
    pricesIncludeTax,
    taxLines: [...taxLineTotals.values()].map((line) => ({
      ...line,
      taxableAmount: money(line.taxableAmount),
      amount: money(line.amount),
    })),
  };
}
