import { Prisma } from "@/generated/prisma";
import { ACCOUNTS } from "@/server/accounting/chart";
import { compact, creditLine, debitLine, money, signedLine } from "@/server/accounting/balance";

/**
 * What each business event does to the books.
 *
 * Pure: every rule takes plain numbers and returns a balanced list of lines
 * with account **codes**, never ids. Resolving codes to accounts and writing
 * rows is the posting service's job next door. Keeping the rules here means the
 * awkward cases — tax-inclusive pricing, a refund that is partly tax, a
 * production run whose waste has to be expensed rather than absorbed — are
 * testable without a database, and a wrong one shows up as a failing assertion
 * rather than as a balance sheet that will not balance three weeks later.
 *
 * The convention throughout: each rule returns lines that already sum to zero.
 * `assertBalanced` still checks on the way in, but a rule that cannot balance
 * on its own is a rule with a bug.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/**
 * Whether an order's prices already contained its tax.
 *
 * Derived from the order's own figures rather than read from the
 * `ordering.prices_include_tax` setting, and that is deliberate. The setting is
 * mutable: flip it next year and every historical order would suddenly post
 * differently, silently moving revenue between sales and tax payable for
 * transactions that closed long ago. The document's own arithmetic cannot
 * change after the fact, so it is the only safe source.
 *
 * When there is no tax the two readings agree and the answer does not matter.
 */
export function pricesIncludedTax(order) {
  const tax = D(order.taxTotal);
  if (tax.isZero()) return false;

  const withoutTax = D(order.subtotal)
    .minus(D(order.discountTotal))
    .plus(D(order.deliveryFee))
    .plus(D(order.packagingFee))
    .plus(D(order.serviceCharge))
    .plus(D(order.tipAmount))
    .plus(D(order.roundOff));

  const exclusive = withoutTax.plus(tax);

  // Whichever reading reproduces the grand total is the one that was used.
  const grand = D(order.grandTotal);
  const inclusiveGap = grand.minus(withoutTax).abs();
  const exclusiveGap = grand.minus(exclusive).abs();

  return inclusiveGap.lessThan(exclusiveGap);
}

/**
 * A completed sale.
 *
 *   Dr Accounts receivable   the whole bill
 *   Dr Discounts given       revenue never earned
 *     Cr Food sales          net of any tax baked into the price
 *     Cr Delivery income
 *     Cr Service & packaging
 *     Cr Tips payable        held for staff, not earned
 *     Cr Tax payable
 *     Cr/Dr Rounding
 *
 * Receivable rather than cash, always — even for a cash sale. The sale and the
 * money are two separate events that can happen in either order and, for an
 * unpaid or partly paid order, may never both happen. Posting straight to cash
 * would mean an order completed today and paid tomorrow shows up as income with
 * no matching money, and a payment for an earlier order would double-count.
 * Settling the receivable is the payment rule's job.
 *
 * When prices include tax, the tax is already inside `subtotal`, so sales are
 * credited net of it. Missing that overstates revenue by the tax on every
 * order and leaves the entry out of balance by the same amount.
 */
export function saleLines(order) {
  const inclusive = pricesIncludedTax(order);
  const tax = D(order.taxTotal);
  const netSales = inclusive ? D(order.subtotal).minus(tax) : D(order.subtotal);

  const party = order.userId ? { partyType: "CUSTOMER", partyId: order.userId } : {};

  return compact([
    debitLine(ACCOUNTS.ACCOUNTS_RECEIVABLE, order.grandTotal, {
      description: `Order ${order.orderNumber}`,
      ...party,
    }),
    debitLine(ACCOUNTS.DISCOUNTS_GIVEN, order.discountTotal, { description: "Discounts and promotions" }),

    creditLine(ACCOUNTS.FOOD_SALES, netSales, { description: `Order ${order.orderNumber}` }),
    creditLine(ACCOUNTS.DELIVERY_INCOME, order.deliveryFee, { description: "Delivery fee" }),
    creditLine(
      ACCOUNTS.SERVICE_INCOME,
      D(order.packagingFee).plus(D(order.serviceCharge)),
      { description: "Packaging and service charge" },
    ),
    creditLine(ACCOUNTS.TIPS_PAYABLE, order.tipAmount, { description: "Tips collected for staff" }),
    creditLine(ACCOUNTS.TAX_PAYABLE, tax, { description: "Tax collected" }),
    signedLine(ACCOUNTS.ROUNDING, order.roundOff, { debitWhenPositive: false, description: "Rounding" }),
  ].filter(Boolean));
}

/**
 * The cost side of a sale.
 *
 *   Dr Cost of goods sold   Cr Inventory
 *
 * A separate entry from the revenue on purpose: the cost is only known once
 * depletion has run and priced what left the shelf, which happens after the
 * sale is recorded. Forcing them into one entry would mean either delaying the
 * revenue or guessing the cost.
 */
export function cogsLines({ amount, orderNumber }) {
  return compact([
    debitLine(ACCOUNTS.COGS, amount, { description: `Cost of order ${orderNumber}` }),
    creditLine(ACCOUNTS.INVENTORY, amount, { description: `Cost of order ${orderNumber}` }),
  ]);
}

/**
 * Money arriving against an order.
 *
 *   Dr Cash / Bank / Card clearing   what the customer paid
 *   Dr Gateway fees                  what the provider kept
 *     Cr Accounts receivable         the whole amount
 *
 * The fee is an expense recognised at the same moment, not a smaller sale. The
 * customer paid the full amount and the receivable clears in full; the provider
 * taking a cut is a cost of collecting it.
 *
 * `settlementCode` says which asset account received it — a till, a bank, or a
 * clearing account for money a provider has taken but not yet settled.
 */
export function paymentLines({ amount, feeAmount = 0, settlementCode, orderNumber, userId = null }) {
  const fee = D(feeAmount);
  const net = D(amount).minus(fee);

  return compact([
    debitLine(settlementCode, net, { description: `Payment for ${orderNumber}` }),
    debitLine(ACCOUNTS.GATEWAY_FEES, fee, { description: `Processing fee on ${orderNumber}` }),
    creditLine(ACCOUNTS.ACCOUNTS_RECEIVABLE, amount, {
      description: `Payment for ${orderNumber}`,
      ...(userId ? { partyType: "CUSTOMER", partyId: userId } : {}),
    }),
  ]);
}

/**
 * Money going back to a customer.
 *
 * Revenue and tax are reversed in the same proportion they were recognised —
 * a refund of half an order gives back half the tax. Refunding the gross
 * against sales alone would leave tax payable overstated for ever, and that is
 * money the restaurant would eventually hand to a tax authority for a sale it
 * did not make.
 */
export function refundLines({ amount, orderNumber, taxPortion = 0, settlementCode, userId = null }) {
  const tax = D(taxPortion);
  const net = D(amount).minus(tax);

  return compact([
    debitLine(ACCOUNTS.FOOD_SALES, net, { description: `Refund on ${orderNumber}` }),
    debitLine(ACCOUNTS.TAX_PAYABLE, tax, { description: `Tax refunded on ${orderNumber}` }),
    creditLine(settlementCode, amount, {
      description: `Refund on ${orderNumber}`,
      ...(userId ? { partyType: "CUSTOMER", partyId: userId } : {}),
    }),
  ]);
}

/**
 * Stock arriving on a goods receipt.
 *
 *   Dr Inventory   at landed cost
 *     Cr Goods received not invoiced
 *
 * Not straight to accounts payable, because the delivery and the invoice are
 * different events that arrive days apart. GRNI holds the obligation in the
 * meantime; the supplier bill moves it to payables. Crediting payables here
 * would mean every unbilled delivery looks like an approved invoice, and the
 * two would double up when the real invoice lands.
 */
export function goodsReceiptLines({ amount, grnNumber, supplierId }) {
  return compact([
    debitLine(ACCOUNTS.INVENTORY, amount, { description: `Received on ${grnNumber}` }),
    creditLine(ACCOUNTS.GOODS_RECEIVED_NOT_INVOICED, amount, {
      description: `Received on ${grnNumber}`,
      partyType: "SUPPLIER",
      partyId: supplierId,
    }),
  ]);
}

/**
 * A supplier's invoice.
 *
 *   Dr Goods received not invoiced   clearing what the delivery accrued
 *   Dr Tax payable                   recoverable input tax
 *     Cr Accounts payable            what is actually owed
 *
 * A bill with no goods receipt behind it — a service, a one-off — has nothing
 * to clear, so it debits an expense instead.
 */
export function supplierBillLines({ subtotal, taxTotal, grandTotal, billNumber, supplierId, hasReceipt }) {
  const party = { partyType: "SUPPLIER", partyId: supplierId };

  return compact([
    hasReceipt
      ? debitLine(ACCOUNTS.GOODS_RECEIVED_NOT_INVOICED, subtotal, { description: `Bill ${billNumber}`, ...party })
      : debitLine(ACCOUNTS.OTHER_EXPENSE, subtotal, { description: `Bill ${billNumber}` }),
    debitLine(ACCOUNTS.TAX_PAYABLE, taxTotal, { description: `Input tax on ${billNumber}` }),
    creditLine(ACCOUNTS.ACCOUNTS_PAYABLE, grandTotal, { description: `Bill ${billNumber}`, ...party }),
  ]);
}

/** Paying a supplier: Dr Accounts payable, Cr wherever the money left from. */
export function billPaymentLines({ amount, billNumber, supplierId, paidFromCode }) {
  return compact([
    debitLine(ACCOUNTS.ACCOUNTS_PAYABLE, amount, {
      description: `Payment of ${billNumber}`,
      partyType: "SUPPLIER",
      partyId: supplierId,
    }),
    creditLine(paidFromCode, amount, { description: `Payment of ${billNumber}` }),
  ]);
}

/**
 * A production run.
 *
 *   Dr Inventory (finished)   what the good output is worth
 *   Dr Wastage                what the run made and threw away
 *     Cr Inventory (raw)      what was consumed
 *     Cr Production labour    absorbed into the output
 *     Cr Production overhead  absorbed into the output
 *
 * Absorption costing. Labour and overhead are **credited** here, not debited:
 * they were already charged to their expense accounts when the wages were run
 * and the utility bill was paid. Production absorbs them into the value of the
 * stock it creates, which is what stops a prep kitchen looking free while
 * leaving the original cost visible in its own account.
 *
 * Debiting them here as well — the intuitive shape — double-counts, because
 * `outputValue` already contains the labour and overhead the production module
 * rolled into the unit cost. The entry then fails to balance by exactly the
 * conversion cost.
 *
 * Yield loss is expensed rather than absorbed, matching how the production
 * module books it: the waste consumed real material, and burying that in the
 * cost of the good output is how a kitchen stops noticing it.
 */
export function productionLines({
  materialCost,
  laborCost = 0,
  overheadCost = 0,
  outputValue,
  wastageValue = 0,
  productionNumber,
}) {
  const labor = D(laborCost);
  const overhead = D(overheadCost);

  return compact([
    debitLine(ACCOUNTS.INVENTORY, outputValue, { description: `Produced on ${productionNumber}` }),
    debitLine(ACCOUNTS.WASTAGE, wastageValue, { description: `Yield loss on ${productionNumber}` }),

    creditLine(ACCOUNTS.INVENTORY, materialCost, { description: `Consumed by ${productionNumber}` }),
    creditLine(ACCOUNTS.PRODUCTION_LABOR, labor, { description: `Absorbed into ${productionNumber}` }),
    creditLine(ACCOUNTS.PRODUCTION_OVERHEAD, overhead, { description: `Absorbed into ${productionNumber}` }),
  ]);
}

/** Stock thrown away: Dr Wastage, Cr Inventory. */
export function wastageLines({ amount, reason, reference }) {
  return compact([
    debitLine(ACCOUNTS.WASTAGE, amount, { description: `Wastage: ${reason ?? "unspecified"}` }),
    creditLine(ACCOUNTS.INVENTORY, amount, { description: reference ?? "Wastage" }),
  ]);
}

/**
 * A stock count or adjustment.
 *
 * Goes both ways: stock found is inventory up and variance down, stock missing
 * is the reverse. `amount` is the change in the value of inventory, so a
 * shortfall is negative.
 */
export function inventoryVarianceLines({ amount, reference }) {
  const value = money(amount);
  if (value.isZero()) return [];

  return compact([
    signedLine(ACCOUNTS.INVENTORY, value, { description: reference ?? "Stock adjustment" }),
    signedLine(ACCOUNTS.INVENTORY_VARIANCE, value, {
      debitWhenPositive: false,
      description: reference ?? "Stock adjustment",
    }),
  ].filter(Boolean));
}

/**
 * A driver payout.
 *
 *   Dr Delivery expense    what the driver earned
 *     Cr Cash on hand      the cash they are keeping from collections
 *     Cr Driver payable    whatever is still owed to them
 *
 * Cash on delivery makes this two-sided: a driver holding takings settles part
 * of their own earnings out of money that is already the restaurant's. Posting
 * only the payable would leave that cash on the books twice.
 */
export function driverPayoutLines({ grossAmount, codDeducted = 0, driverId, payoutNumber }) {
  const cod = D(codDeducted);
  const net = D(grossAmount).minus(cod);
  const party = { partyType: "DRIVER", partyId: driverId };

  return compact([
    debitLine(ACCOUNTS.DELIVERY_EXPENSE, grossAmount, { description: `Payout ${payoutNumber}`, ...party }),
    creditLine(ACCOUNTS.CASH, cod, { description: `Cash retained against ${payoutNumber}`, ...party }),
    creditLine(ACCOUNTS.DRIVER_PAYABLE, net, { description: `Owed on ${payoutNumber}`, ...party }),
  ]);
}

/**
 * A till that did not count out to what it should have.
 *
 * `variance` is counted minus expected, so a positive number is a drawer that
 * was over. Cash over and short is an expense account that legitimately carries
 * a credit balance when the tills run over, which is why it is signed rather
 * than always a debit.
 */
export function cashVarianceLines({ variance, sessionNumber }) {
  const value = money(variance);
  if (value.isZero()) return [];

  return compact([
    signedLine(ACCOUNTS.CASH, value, { description: `Till variance on ${sessionNumber}` }),
    signedLine(ACCOUNTS.CASH_OVER_SHORT, value, {
      debitWhenPositive: false,
      description: `Till variance on ${sessionNumber}`,
    }),
  ].filter(Boolean));
}

/**
 * A payroll run being approved.
 *
 *   Dr Salaries and wages   what was earned, gross
 *     Cr Salaries payable   what is owed to staff
 *
 * Gross, not net: the deductions are not a smaller wage, they are money
 * withheld from a wage that was fully earned. Posting net understates the cost
 * of employing people by exactly the amount deducted, and leaves the eventual
 * remittance of that money with nothing to clear against.
 */
export function payrollLines({ grossAmount, deductionAmount = 0, netAmount, periodName }) {
  const deductions = D(deductionAmount);

  return compact([
    debitLine(ACCOUNTS.SALARIES, grossAmount, { description: `Payroll ${periodName}` }),
    creditLine(ACCOUNTS.SALARIES_PAYABLE, netAmount, { description: `Net pay ${periodName}` }),
    // Withheld and owed to somebody else — a provident fund, a tax authority —
    // until it is remitted.
    creditLine(ACCOUNTS.TAX_PAYABLE, deductions, { description: `Withheld on ${periodName}` }),
  ]);
}

/** Wages actually leaving: Dr Salaries payable, Cr wherever they were paid from. */
export function payrollPaymentLines({ netAmount, periodName, paidFromCode }) {
  return compact([
    debitLine(ACCOUNTS.SALARIES_PAYABLE, netAmount, { description: `Paid ${periodName}` }),
    creditLine(paidFromCode ?? ACCOUNTS.BANK, netAmount, { description: `Paid ${periodName}` }),
  ]);
}

/**
 * Operating spend.
 *
 *   Dr whichever expense account the category points at
 *   Dr Tax payable        recoverable input tax
 *     Cr wherever it was paid from
 */
export function expenseLines({ amount, taxAmount = 0, expenseCode, paidFromCode, expenseNumber, payee }) {
  const tax = D(taxAmount);
  const net = D(amount).minus(tax);

  return compact([
    debitLine(expenseCode ?? ACCOUNTS.OTHER_EXPENSE, net, {
      description: payee ? `${expenseNumber} — ${payee}` : expenseNumber,
    }),
    debitLine(ACCOUNTS.TAX_PAYABLE, tax, { description: `Input tax on ${expenseNumber}` }),
    creditLine(paidFromCode ?? ACCOUNTS.CASH, amount, { description: expenseNumber }),
  ]);
}

/**
 * Where a payment method's money lands.
 *
 * Every value of the `PaymentMethod` enum appears here, and a unit test checks
 * that it still does. A method with no mapping would fall through to the
 * default and quietly book real money into a clearing account that nobody ever
 * reconciles — the kind of drift that only surfaces when the bank does not
 * agree with the books.
 *
 * Two are not asset accounts at all. A gift card or store credit being spent is
 * a liability being settled, not money arriving: the cash came in when the card
 * was sold. Treating it as a receipt would count the same money twice.
 */
export const SETTLEMENT_BY_METHOD = {
  CASH: ACCOUNTS.CASH,
  // The driver holds it until they settle up, but it is the restaurant's cash
  // from the moment it is collected — and the payout rule credits it back.
  CASH_ON_DELIVERY: ACCOUNTS.CASH,
  CARD: ACCOUNTS.CARD_CLEARING,
  UPI: ACCOUNTS.CARD_CLEARING,
  NET_BANKING: ACCOUNTS.BANK,
  WALLET: ACCOUNTS.CARD_CLEARING,
  BANK_TRANSFER: ACCOUNTS.BANK,
  GIFT_CARD: ACCOUNTS.CUSTOMER_CREDIT,
  STORE_CREDIT: ACCOUNTS.CUSTOMER_CREDIT,
  // An aggregator has taken the customer's money and owes it to us.
  AGGREGATOR: ACCOUNTS.CARD_CLEARING,
  OTHER: ACCOUNTS.CARD_CLEARING,
};

export function settlementCodeFor(method) {
  return SETTLEMENT_BY_METHOD[method] ?? ACCOUNTS.CARD_CLEARING;
}
