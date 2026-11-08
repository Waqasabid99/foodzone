import { documentDate, documentMoney, postalLines, textLines } from "@/server/documents/model";
import { safeText } from "@/server/documents/text";
import { ORDER_TYPE_LABELS } from "@/lib/order-status";

/**
 * A tax invoice, as a document model.
 *
 * Shaped from the same `receiptPayload` the screen uses, so the PDF and the
 * printable page can never drift into saying different things about one order —
 * which is the failure that makes a tax document worthless.
 *
 * Rules worth stating, because each one is a decision rather than a detail:
 *
 *   * **A void invoice still renders, and says so across the top.** Somebody
 *     reconciling a gap in the number series has to be able to see what the
 *     number was spent on. What must never happen is a voided copy passing for
 *     a live one on a desk, so the banner is unmissable and carries the reason.
 *   * **Zero lines are omitted.** A `Delivery: PKR 0` on a dine-in bill is
 *     noise, and noise is what stops people reading the figures that matter.
 *     Rounding is the exception: a round-off of zero is omitted too, but a
 *     negative one is shown, because an unexplained one-rupee difference
 *     between the lines and the total looks like an error.
 *   * **The tax breakdown is per rate when we have it.** "Tax: 240" tells a
 *     filer nothing; "GST (17%) on 1,412 = 240" is what a return is built
 *     from. The single-line fallback exists only for orders predating tax
 *     lines.
 *   * **The legal name wins over the trading name.** An invoice is addressed
 *     from the entity that owes the tax, not the brand above the door.
 */
export function invoiceDocument({ invoice, receipt }) {
  const { branch, order, customer, lines, discounts, taxLines, totals } = receipt;
  const currency = totals?.currency ?? "PKR";
  const timeZone = branch?.timezone ?? undefined;
  const money = (amount) => documentMoney(amount, currency);

  const issuer = {
    name: safeText(branch?.legalName ?? branch?.name ?? "—"),
    lines: textLines([
      ...postalLines(branch),
      branch?.phone,
      branch?.email,
      branch?.taxIdentifier ? `Tax no. ${branch.taxIdentifier}` : null,
    ]),
  };

  const billedTo = textLines([
    invoice?.billingName ?? customer?.name ?? "Walk-in customer",
    ...postalLines(invoice?.billingAddress ?? customer?.address),
    invoice?.billingTaxId ? `Tax no. ${invoice.billingTaxId}` : null,
    customer?.phone,
  ]);

  const against = textLines([
    `Order ${order?.orderNumber ?? "—"}`,
    // The same label the screens use. A customer's copy should not say
    // `DINE_IN`, and a second mapping here would be one more thing to forget.
    [ORDER_TYPE_LABELS[order?.type] ?? order?.type, order?.table?.name ? `table ${order.table.name}` : null]
      .filter(Boolean)
      .join(" · "),
    order?.placedAt ? `Placed ${documentDate(order.placedAt, { timeZone, withTime: true })}` : null,
  ]);

  const rows = (lines ?? []).map((line) => ({
    item: [
      safeText(line.name),
      // Modifiers belong under the line they change, not in a column of their
      // own: they are part of what was sold, and the price is already in the
      // line total.
      line.modifiers?.length ? safeText(line.modifiers.map((modifier) => modifier.nameSnapshot).join(", ")) : null,
    ]
      .filter(Boolean)
      .join("\n"),
    quantity: String(Number(line.quantity ?? 0)),
    unit: money(line.unitPrice),
    amount: money(line.lineTotal),
  }));

  const totalLines = [{ label: "Subtotal", value: money(totals?.subtotal) }];

  for (const discount of discounts ?? []) {
    if (!Number(discount.amount)) continue;
    totalLines.push({ label: safeText(discount.label ?? "Discount"), value: `-${money(discount.amount)}` });
  }

  // Only the ones that happened. A discount already itemised above is not
  // repeated as a lump sum.
  const extras = [
    ...(discounts?.length ? [] : [["Discount", totals?.discountTotal, true]]),
    ["Delivery", totals?.deliveryFee],
    ["Packaging", totals?.packagingFee],
    ["Service charge", totals?.serviceCharge],
    ["Tip", totals?.tipAmount],
    ["Rounding", totals?.roundOff],
  ];
  for (const [label, amount, negative] of extras) {
    if (!Number(amount)) continue;
    totalLines.push({ label, value: `${negative ? "-" : ""}${money(amount)}` });
  }

  if (taxLines?.length) {
    for (const tax of taxLines) {
      const rate = Number(tax.rate) ? ` (${Number(tax.rate)}%)` : "";
      const base = Number(tax.taxableAmount) ? ` on ${money(tax.taxableAmount)}` : "";
      totalLines.push({ label: safeText(`${tax.name}${rate}${base}`), value: money(tax.amount) });
    }
  } else if (Number(totals?.taxTotal)) {
    totalLines.push({ label: "Tax", value: money(totals.taxTotal) });
  }

  totalLines.push({ label: "Total", value: money(totals?.grandTotal), strong: true });
  totalLines.push({ label: "Paid", value: money(totals?.paidTotal) });

  const due = Number(totals?.grandTotal ?? 0) - Number(totals?.paidTotal ?? 0);
  // Shown only when something is actually owed, and only in the direction that
  // is owed: a customer who overpaid is a refund, not a balance due.
  if (due > 0) totalLines.push({ label: "Balance due", value: money(due), strong: true });

  return {
    title: "INVOICE",
    reference: safeText(invoice?.invoiceNumber ?? ""),
    banner: invoice?.isVoid ? safeText(`VOID - ${invoice.voidReason ?? "no reason recorded"}`) : null,
    issuedLabel: invoice?.issuedAt ? `Issued ${documentDate(invoice.issuedAt, { timeZone, withTime: true })}` : "",
    issuer,
    parties: [
      { title: "Billed to", lines: billedTo },
      { title: "Against", lines: against },
    ],
    table: {
      columns: [
        { key: "item", label: "Item", width: 250 },
        { key: "quantity", label: "Qty", width: 50, align: "right" },
        { key: "unit", label: "Unit", width: 95, align: "right" },
        { key: "amount", label: "Amount", width: 95, align: "right" },
      ],
      rows,
    },
    totals: totalLines,
    notes: textLines([order?.note ? `Note: ${order.note}` : null]),
    footer: safeText(
      `${invoice?.invoiceNumber ?? order?.orderNumber ?? ""} · ${branch?.legalName ?? branch?.name ?? ""}`.trim(),
    ),
  };
}
