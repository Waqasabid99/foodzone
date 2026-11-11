"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import {
  COUNTER_TYPES,
  PAYMENT_METHODS,
  basketPreview,
  changeDue,
  counterCatalogue,
  counterOrderPayload,
  methodLabel,
  paymentPayload,
  paysUpFront,
} from "@/lib/service";
import {
  canSelectMore,
  defaultSelections,
  groupError,
  previewTotal,
  selectedCount,
  toModifierPayload,
  validateGroups,
} from "@/lib/product-options";
import {
  comboDefaults,
  comboModifierDefaults,
  comboSurcharge,
  hasRoomFor,
  toComboPayload,
  validateComboGroups,
  validateComboModifiers,
} from "@/lib/combo-options";
import ComboSlots from "@/components/products/ComboSlots";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import TextAreaField from "@/components/ui/TextAreaField";
import FormAlert from "@/components/ui/FormAlert";

let nextKey = 0;

/**
 * Taking an order at the counter.
 *
 * Built for somebody standing up with a queue in front of them, so:
 *
 *   * **The menu is the same one the website sells.** Not a separate admin
 *     list — a counter that can sell what the website has taken off is a
 *     counter that sells food the kitchen has run out of. Items that are
 *     unavailable are shown greyed rather than hidden, because the customer
 *     is standing there asking for one and "we have taken that off today" is
 *     a better answer than a menu that silently lacks it.
 *   * **Nothing here sends a price.** Only product ids and quantities go to
 *     the server, which prices the order from the live menu. The running total
 *     on screen is an estimate and says so — a screen that could set prices is
 *     a screen that can sell a steak for nothing.
 *   * **When the money is taken depends on the order.** Collection is paid
 *     here before it fires — the customer takes the bag and goes, so there is
 *     no later. Dine-in is sent to the kitchen and settled at the table, which
 *     is the only way a second round can join the same bill. Either way the
 *     order is created first and charged second, because an order that exists
 *     unpaid is recoverable where a payment against no order is not.
 *   * **The total on screen is the server's, not a guess.** The basket is
 *     quoted through the same pricing the checkout uses, so packaging, tax and
 *     any offer are in the figure the cashier reads out — counting change
 *     against an estimate that excluded a packaging fee is how a till ends the
 *     day short.
 */
export default function CounterOrder({
  branches,
  branchId,
  type,
  menu,
  tables,
  seated = {},
  currency,
  canCharge = false,
  canCollect = false,
  /**
   * When set, this screen is adding a round to an order that already exists
   * rather than taking a new one.
   *
   * It is the same screen on purpose. A second round is the same act — find
   * the thing on the menu, choose how it is made, say how many — and building
   * a second picker for it would be two menus, two combo builders and two sets
   * of modifier rules to keep in step. Everything that belongs to *starting* a
   * sale goes away: the type, the table, the customer, the coupon, the money.
   * What is left is the menu and the basket, which is all a second round is.
   */
  addTo = null,
  /** Where to preselect the table, when arriving from the floor plan. */
  initialTableId = "",
}) {
  const router = useRouter();

  const [lines, setLines] = useState([]);
  const [search, setSearch] = useState("");
  const [configuring, setConfiguring] = useState(null);
  const [selections, setSelections] = useState({});
  const [tableId, setTableId] = useState(initialTableId);
  const [guestCount, setGuestCount] = useState("");
  const [customer, setCustomer] = useState({ userId: null, name: "", phone: "", addressId: "" });
  const [matches, setMatches] = useState([]);
  const [addresses, setAddresses] = useState([]);
  const [notes, setNotes] = useState("");
  const [kitchenNote, setKitchenNote] = useState("");
  const [couponCode, setCoupon] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);
  // A combo's slots, and how each chosen item is made. Separate from
  // `selections`, which holds the product's own option groups.
  const [comboPicks, setComboPicks] = useState({});
  const [comboMods, setComboMods] = useState({});
  // What the server says this basket costs, and how the customer is paying for
  // it. Only collection asks for the money here; see the note above.
  const [priced, setPriced] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [payment, setPayment] = useState({ method: "CASH", tender: "" });
  // An addition is never paid for here: it joins a bill that is settled on
  // the order, which is the whole point of one table having one bill.
  const upFront = !addTo && paysUpFront(type) && canCharge;

  /** Every sellable line on the active menu, flattened for searching. */
  const catalogue = useMemo(() => counterCatalogue(menu), [menu]);

  const visible = useMemo(() => {
    const text = search.trim().toLowerCase();
    if (!text) return catalogue.slice(0, 60);
    return catalogue.filter((row) => `${row.name} ${row.variantName ?? ""} ${row.section}`.toLowerCase().includes(text)).slice(0, 60);
  }, [catalogue, search]);

  const estimate = basketPreview(lines);
  // An answer for a basket that has since been emptied is not an answer about
  // anything, so it is dropped on read rather than cleared from inside the
  // effect — React does not want state set synchronously in an effect body,
  // and a derived value needs no effect at all.
  const quote = lines.length ? priced : null;
  // The figure everything else is counted against: the server's when it has
  // answered, the rough one until then.
  const due = quote?.grandTotal ?? estimate;
  const change = upFront && PAYMENT_METHODS[payment.method]?.takesTender && String(payment.tender).trim()
    ? changeDue(payment.tender, due)
    : null;

  /**
   * Prices the basket the way checkout will.
   *
   * Debounced, because it fires on every tap of a plus button, and guarded by
   * a sequence number so a slow answer for a basket of three cannot land after
   * a fast answer for a basket of four.
   */
  const quoteSeq = useRef(0);
  const quoteKey = JSON.stringify(
    lines.map((line) => [line.productId, line.variantId, line.quantity, line.modifiers ?? [], line.comboSelections ?? []]),
  );

  useEffect(() => {
    if (!lines.length) return undefined;

    const seq = (quoteSeq.current += 1);
    const timer = setTimeout(async () => {
      if (seq !== quoteSeq.current) return;
      setQuoting(true);
      try {
        const answer = await api.post("/checkout/quote", {
          branchId,
          type,
          items: lines.map((line) => ({
            productId: line.productId,
            ...(line.variantId ? { variantId: line.variantId } : {}),
            quantity: line.quantity,
            modifiers: line.modifiers ?? [],
            comboSelections: line.comboSelections ?? [],
          })),
          ...(couponCode.trim() ? { couponCode: couponCode.trim().toUpperCase() } : {}),
        });
        if (seq === quoteSeq.current) setPriced(answer);
      } catch {
        // A quote that cannot be had is not an error worth stopping on — the
        // order still prices correctly when it is placed. The panel falls back
        // to saying the number is an estimate.
        if (seq === quoteSeq.current) setPriced(null);
      } finally {
        if (seq === quoteSeq.current) setQuoting(false);
      }
    }, 400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, branchId, type, couponCode]);

  function addLine(entry, { modifiers = [], comboSelections = [], modifierPrices = [], optionLabels = [] } = {}) {
    setLines((current) => {
      // The same item with the same options is a quantity, not a second line —
      // a ticket reading "1× fries, 1× fries" is a ticket somebody misreads.
      // Two combos built differently are two lines, not a quantity of one.
      const signature = `${entry.variantId}:${JSON.stringify(modifiers)}:${JSON.stringify(comboSelections)}`;
      const existing = current.find((line) => line.signature === signature);
      if (existing) {
        return current.map((line) => (line.signature === signature ? { ...line, quantity: line.quantity + 1 } : line));
      }
      return [
        ...current,
        {
          key: `line-${(nextKey += 1)}`,
          signature,
          productId: entry.productId,
          variantId: entry.variantId,
          name: entry.name,
          variantName: entry.variantName,
          unitPrice: entry.price,
          modifierPrices,
          optionLabels,
          modifiers,
          comboSelections,
          quantity: 1,
        },
      ];
    });
  }

  /**
   * Adding something with options.
   *
   * The option rules are fetched from the same public endpoint the storefront
   * uses, so the counter cannot build a combination the website would refuse.
   */
  async function pick(entry) {
    if (!entry.available) return;
    setFormError(null);
    try {
      const product = await api.get(`/products/${entry.slug}`);
      const groups = product?.modifierGroups ?? [];
      // A combo has to be built before it can be sold: the server refuses a
      // line whose slots are unanswered, so the counter could not sell one at
      // all until it asked.
      const comboGroups = product?.comboGroups ?? [];
      if (!groups.length && !comboGroups.length) return addLine(entry);

      setConfiguring({ entry, product, groups, comboGroups });
      setSelections(defaultSelections(groups));
      setComboPicks(comboDefaults(comboGroups));
      setComboMods(comboModifierDefaults(comboGroups));
    } catch {
      // No option data is not a reason to refuse a sale; the server validates
      // the line anyway when the order is placed.
      addLine(entry);
    }
  }

  function confirmOptions() {
    const { entry, groups, comboGroups } = configuring;
    const problems = {
      ...validateGroups(groups, selections),
      ...validateComboGroups(comboGroups, comboPicks),
    };
    const insideCombo = validateComboModifiers(comboGroups, comboPicks, comboMods);
    if (Object.keys(problems).length || Object.keys(insideCombo).length) {
      const first = Object.values(problems)[0] ?? Object.values(Object.values(insideCombo)[0])[0];
      setErrors({ options: first });
      return;
    }

    const chosen = [];
    const prices = [];
    const labels = [];
    for (const group of groups) {
      for (const option of group.options) {
        const quantity = selections[group.id]?.[option.id] ?? 0;
        for (let i = 0; i < quantity; i += 1) prices.push(option.priceDelta ?? 0);
        if (quantity > 0) labels.push(quantity > 1 ? `${quantity}× ${option.name}` : option.name);
      }
    }
    chosen.push(...toModifierPayload(selections));

    // What the combo was built as, for the basket line and the ticket.
    for (const group of comboGroups) {
      for (const option of group.options) {
        const taken = comboPicks[group.id]?.[option.id] ?? 0;
        if (taken > 0) labels.push(taken > 1 ? `${taken}× ${option.product.name}` : option.product.name);
      }
    }
    const comboExtra = comboSurcharge(comboGroups, comboPicks, comboMods);
    if (comboExtra) prices.push(comboExtra);

    addLine(entry, {
      modifiers: chosen,
      comboSelections: toComboPayload(comboGroups, comboPicks, comboMods),
      modifierPrices: prices,
      optionLabels: labels,
    });

    setConfiguring(null);
    setSelections({});
    setComboPicks({});
    setComboMods({});
    setErrors({});
  }

  async function findCustomer(term) {
    setCustomer((c) => ({ ...c, name: term, userId: null, addressId: "" }));
    setAddresses([]);
    if (term.trim().length < 2) return setMatches([]);
    try {
      const found = await api.get(`/admin/customers?search=${encodeURIComponent(term.trim())}&limit=6`);
      setMatches(found?.items ?? found ?? []);
    } catch {
      setMatches([]);
    }
  }

  /**
   * Sends a round to an order that is already on a table.
   *
   * Nothing about who the order is for is touched: the table, the customer,
   * the note and the offers already on it stay exactly as they were. This adds
   * lines and nothing else, which is why it posts only the lines.
   */
  async function sendRound() {
    setPending(true);
    setFormError(null);
    try {
      const result = await api.post(`/admin/orders/${addTo.id}/items`, {
        items: lines.map((line) => ({
          productId: line.productId,
          variantId: line.variantId,
          quantity: line.quantity,
          ...(line.modifiers?.length ? { modifiers: line.modifiers } : {}),
          ...(line.comboSelections?.length ? { comboSelections: line.comboSelections } : {}),
          ...(line.notes ? { notes: line.notes } : {}),
        })),
      });
      toast.success(`Round ${result?.course ?? ""} is with the kitchen.`.replace("  ", " "));
      router.push(`/dashboard/orders/${addTo.id}`);
      router.refresh();
    } catch (failure) {
      setFormError(failure?.message ?? "That round did not reach the kitchen.");
      setPending(false);
    }
  }

  async function attach(match) {
    setCustomer({ userId: match.id, name: match.name ?? match.email ?? "", phone: match.phone ?? "", addressId: "" });
    setMatches([]);
    if (type !== "DELIVERY") return;
    try {
      // The customer record carries its addresses; there is no separate
      // endpoint and inventing one would be a second source of the same truth.
      const detail = await api.get(`/admin/customers/${match.id}`);
      setAddresses(detail?.addresses ?? []);
    } catch {
      setAddresses([]);
    }
  }

  async function place(event) {
    event.preventDefault();
    if (pending) return;

    if (addTo) return sendRound();

    const { body, errors: local } = counterOrderPayload({
      branchId,
      type,
      lines,
      customer,
      tableId,
      guestCount,
      notes,
      kitchenNote,
      couponCode,
    });
    setErrors(local);
    if (Object.keys(local).length) return setFormError(Object.values(local)[0]);

    setPending(true);
    setFormError(null);

    let order;
    try {
      order = await api.post("/admin/orders", body);
    } catch (failure) {
      setFormError(failure?.message ?? "The order could not be placed.");
      setPending(false);
      return;
    }

    if (!upFront) {
      toast.success(`${order.orderNumber} placed. Take the payment next.`);
      router.push(`/dashboard/orders/${order.id}`);
      router.refresh();
      return;
    }

    /*
     * The money, against the figure the server actually priced — never the
     * quote on screen. They agree in every ordinary case, and when they do not
     * it is the server that is right, so charging the screen's number would be
     * charging a price nobody is owed.
     *
     * From here the order exists. Anything that fails below leaves an unpaid
     * order the cashier can settle on its own page, which is why the failure
     * path still navigates there rather than stranding them on the till.
     */
    try {
      const { body: charge } = paymentPayload(
        {
          orderId: order.id,
          method: payment.method,
          amount: order.grandTotal,
          tender: payment.tender,
          idempotencyKey: `pos-${order.id}-0`,
        },
        { outstanding: order.grandTotal },
      );

      const taken = await api.post("/admin/payments", charge);
      const paymentId = taken?.payment?.id ?? taken?.id;

      if (payment.method === "CASH" && paymentId && canCollect) {
        await api.post(`/admin/payments/${paymentId}/collect`, {});
      }

      const settled = PAYMENT_METHODS[payment.method]?.takesTender && String(payment.tender).trim()
        ? changeDue(payment.tender, order.grandTotal)
        : null;

      toast.success(
        settled && !settled.short && Number(settled.change) > 0
          ? `${order.orderNumber} paid. Change ${formatMoney(settled.change, currency)}.`
          : `${order.orderNumber} paid.`,
      );
      router.push(`/dashboard/orders/${order.id}/receipt?print=1`);
      router.refresh();
    } catch (failure) {
      toast.error(`${order.orderNumber} was placed but not paid — take the payment on the order.`);
      setFormError(failure?.message ?? "The payment did not go through.");
      router.push(`/dashboard/orders/${order.id}`);
      router.refresh();
    }
  }

  const switchTo = (next) => {
    const query = new URLSearchParams({ branch: branchId, type: next });
    router.push(`/dashboard/orders/new?${query}`);
  };

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Neither the type nor the branch is this round's to choose: it is
            already a dine-in at a particular table in a particular room, and
            offering to change either would be offering to move somebody's
            meal. */}
        {addTo ? null : (
          <div className="flex flex-wrap gap-2">
            {COUNTER_TYPES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => switchTo(option.value)}
                aria-pressed={type === option.value}
                className={`rounded-field px-4 py-2.5 text-label-bold ${type === option.value ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
              >
                {option.label}
              </button>
            ))}
            {branches.length > 1 ? (
              <SelectField
                id="counter-branch"
                label=""
                value={branchId}
                onChange={(event) => router.push(`/dashboard/orders/new?branch=${event.target.value}&type=${type}`)}
                options={branches.map((row) => ({ value: row.id, label: row.name }))}
              />
            ) : null}
          </div>
        )}

        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search the menu"
            aria-label="Search the menu"
            className="w-full rounded-field border border-outline bg-surface-container-low py-3 pl-9 pr-4 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
        </div>

        {menu ? (
          visible.length ? (
            <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((entry) => (
                <li key={entry.key}>
                  <button
                    type="button"
                    onClick={() => pick(entry)}
                    disabled={!entry.available}
                    className="flex min-h-16 w-full flex-col items-start gap-0.5 rounded-field bg-surface-container-lowest px-4 py-3 text-left hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="text-label-bold text-on-surface">{entry.name}</span>
                    <span className="text-label-bold font-normal text-on-surface-variant">
                      {entry.variantName ? `${entry.variantName} · ` : ""}
                      {formatMoney(entry.price, currency)}
                      {entry.available ? "" : " · off today"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
              Nothing on the menu matches “{search}”.
            </p>
          )
        ) : (
          <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
            No menu is live for {COUNTER_TYPES.find((row) => row.value === type)?.label.toLowerCase()} at this branch
            right now, so there is nothing to sell. Check the menu&rsquo;s schedule.
          </p>
        )}
      </div>

      <form onSubmit={place} noValidate className="flex w-full flex-col gap-4 rounded-card bg-surface-container-lowest p-5 lg:w-96 lg:shrink-0">
        <h2 className="font-display text-headline-md text-on-surface">The order</h2>
        <FormAlert>{formError}</FormAlert>

        {lines.length ? (
          <ul className="flex flex-col gap-2">
            {lines.map((line) => (
              <li key={line.key} className="flex flex-col gap-2 rounded-field bg-surface-container-low p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-body-md text-on-surface">
                    {line.name}
                    {line.variantName ? <span className="text-on-surface-variant"> · {line.variantName}</span> : null}
                    {line.optionLabels?.length ? (
                      <span className="block text-label-bold font-normal text-on-surface-variant">{line.optionLabels.join(", ")}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${line.name}`}
                    onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}
                    className="rounded-field px-2 py-1 text-error hover:bg-surface-container"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="One fewer"
                    onClick={() =>
                      setLines((current) =>
                        current.flatMap((row) =>
                          row.key === line.key ? (row.quantity <= 1 ? [] : [{ ...row, quantity: row.quantity - 1 }]) : [row],
                        ),
                      )
                    }
                    className="size-11 rounded-field bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
                  >
                    <Minus aria-hidden="true" className="mx-auto size-4" />
                  </button>
                  <span className="min-w-8 text-center font-display text-headline-md tabular-nums text-on-surface">{line.quantity}</span>
                  <button
                    type="button"
                    aria-label="One more"
                    onClick={() => setLines((current) => current.map((row) => (row.key === line.key ? { ...row, quantity: row.quantity + 1 } : row)))}
                    className="size-11 rounded-field bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
                  >
                    <Plus aria-hidden="true" className="mx-auto size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Nothing added yet. Tap something on the menu.</p>
        )}

        {quote ? (
          <dl className="flex flex-col gap-1 rounded-field bg-surface-container px-4 py-3 text-body-md text-on-surface">
            {[
              ["Subtotal", quote.subtotal],
              ["Discount", quote.discountTotal, true],
              ["Delivery", quote.deliveryFee],
              ["Packaging", quote.packagingFee],
              ["Service charge", quote.serviceCharge],
              ["Tax", quote.taxTotal],
              ["Rounding", quote.roundOff],
            ]
              .filter(([label, amount]) => label === "Subtotal" || Number(amount))
              .map(([label, amount, negative]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-on-surface-variant">{label}</dt>
                  <dd className="tabular-nums">{`${negative ? "−" : ""}${formatMoney(amount, currency)}`}</dd>
                </div>
              ))}
            <div className="flex justify-between gap-3 border-t border-outline-variant pt-1">
              <dt className="text-label-bold">Total</dt>
              <dd className="font-display text-headline-md tabular-nums">{formatMoney(quote.grandTotal, currency)}</dd>
            </div>
            {quote.rejectedDiscounts?.length ? (
              <p className="text-label-bold font-normal text-on-surface-variant">
                {quote.rejectedDiscounts[0]?.reason ?? "That coupon does not apply to this basket."}
              </p>
            ) : null}
          </dl>
        ) : (
          <p className="rounded-field bg-surface-container px-4 py-3 text-body-md text-on-surface">
            About <strong className="tabular-nums">{formatMoney(estimate, currency)}</strong>
            <span className="block text-label-bold font-normal text-on-surface-variant">
              {quoting
                ? "Pricing it…"
                : "An estimate. Tax, charges and any offer are worked out by the server when the order is placed."}
            </span>
          </p>
        )}

        {type === "DINE_IN" && !addTo ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField
              id="counter-table"
              label="Table"
              value={tableId}
              onChange={(event) => setTableId(event.target.value)}
              options={[
                { value: "", label: "Choose a table" },
                // Occupied tables are listed, not hidden: moving a second
                // round onto the same table is a real thing to do, and a
                // table that silently disappears looks like a missing table.
                ...tables.map((row) => ({
                  value: row.id,
                  label: `${row.area ? `${row.name} — ${row.area}` : row.name}${seated[row.id] ? ` · taken (${seated[row.id].orderNumber})` : ""}`,
                })),
              ]}
              error={errors.tableId}
            />
            <Field id="counter-covers" label="Covers" inputMode="numeric" value={guestCount} onChange={(event) => setGuestCount(event.target.value)} hint="Optional." autoComplete="off" />
          </div>
        ) : null}

        {addTo ? null : (
        <div className="flex flex-col gap-2">
          <Field
            id="counter-customer"
            label={type === "DELIVERY" ? "Customer (account required)" : "Customer"}
            value={customer.name}
            onChange={(event) => findCustomer(event.target.value)}
            error={errors.customer}
            hint={
              type === "DELIVERY"
                ? "A rider needs a saved address, so a delivery needs an account."
                : type === "DINE_IN"
                  ? "Optional — the table is how this order is called out."
                  : "Required for a walk-in: it is how the order is called out."
            }
            autoComplete="off"
          />
          {matches.length ? (
            <ul className="flex flex-col gap-1 rounded-field bg-surface-container-low p-2">
              {matches.map((match) => (
                <li key={match.id}>
                  <button
                    type="button"
                    onClick={() => attach(match)}
                    className="w-full rounded-field px-3 py-2 text-left text-body-md text-on-surface hover:bg-surface-container"
                  >
                    {match.name ?? "Unnamed"}
                    <span className="block text-label-bold font-normal text-on-surface-variant">{match.phone ?? match.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {customer.userId ? (
            <p className="text-label-bold font-normal text-on-surface-variant">
              Attached to their account.{" "}
              <button type="button" onClick={() => setCustomer({ userId: null, name: "", phone: "", addressId: "" })} className="text-primary hover:underline">
                Use a walk-in instead
              </button>
            </p>
          ) : (
            <Field id="counter-phone" label="Phone" type="tel" value={customer.phone} onChange={(event) => setCustomer((c) => ({ ...c, phone: event.target.value }))} hint="Optional." autoComplete="off" />
          )}
          {type === "DELIVERY" && addresses.length ? (
            <SelectField
              id="counter-address"
              label="Deliver to"
              value={customer.addressId}
              onChange={(event) => setCustomer((c) => ({ ...c, addressId: event.target.value }))}
              options={[{ value: "", label: "Choose an address" }, ...addresses.map((row) => ({ value: row.id, label: `${row.label} — ${row.line1}, ${row.city}` }))]}
              error={errors.addressId}
            />
          ) : null}
        </div>
        )}

        {/* The order's own note, customer and coupon are already set and are
            not this round's to change. A kitchen instruction for *these* lines
            rides on the lines, where the cook making them will see it. */}
        {addTo ? null : (
          <>
            <TextAreaField id="counter-kitchen" label="For the kitchen" rows={2} value={kitchenNote} onChange={(event) => setKitchenNote(event.target.value)} placeholder="No onions — allergy" />
            <TextAreaField id="counter-note" label="Note" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
            <Field id="counter-coupon" label="Coupon" value={couponCode} onChange={(event) => setCoupon(event.target.value.toUpperCase())} hint="Optional. Checked against the live rules." autoComplete="off" />
          </>
        )}

        {upFront ? (
          <div className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4">
            <h2 className="text-label-bold text-on-surface">Take the payment</h2>
            <SelectField
              id="counter-method"
              label="How are they paying?"
              value={payment.method}
              onChange={(event) => setPayment({ method: event.target.value, tender: "" })}
              options={Object.keys(PAYMENT_METHODS).map((value) => ({ value, label: methodLabel(value) }))}
            />
            {PAYMENT_METHODS[payment.method]?.takesTender ? (
              <>
                <Field
                  id="counter-tender"
                  label="Handed over"
                  inputMode="decimal"
                  value={payment.tender}
                  onChange={(event) => setPayment((current) => ({ ...current, tender: event.target.value }))}
                  hint="Optional — only so the change can be worked out."
                  autoComplete="off"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPayment((current) => ({ ...current, tender: String(due) }))}
                    className="rounded-field bg-surface-container-high px-3 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest"
                  >
                    Exact
                  </button>
                  {[500, 1000, 5000].map((note) => (
                    <button
                      key={note}
                      type="button"
                      onClick={() => setPayment((current) => ({ ...current, tender: String(note) }))}
                      className="rounded-field bg-surface-container-high px-3 py-2 text-label-bold tabular-nums text-on-surface hover:bg-surface-container-highest"
                    >
                      {note}
                    </button>
                  ))}
                </div>
                {change ? (
                  change.short ? (
                    <p className="text-body-md text-error">
                      {formatMoney(change.shortfall, currency)} short of the total.
                    </p>
                  ) : (
                    <p className="rounded-field bg-primary-container px-4 py-3 text-on-primary-container">
                      Change{" "}
                      <strong className="font-display text-headline-md tabular-nums">
                        {formatMoney(change.change, currency)}
                      </strong>
                    </p>
                  )
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}

        <button
          type="submit"
          disabled={pending || !lines.length || (upFront && quoting)}
          className="rounded-field bg-primary-container px-6 py-3.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {pending
            ? addTo
              ? "Sending…"
              : upFront
                ? "Taking…"
                : "Placing…"
            : addTo
              ? "Send it to the kitchen"
              : upFront
                ? `Place and take ${formatMoney(due, currency)}`
                : "Place the order"}
        </button>
        <p className="text-body-md text-on-surface-variant">
          {addTo
            ? "It joins the same bill and goes to the kitchen as its own ticket, with its own clock — so a round ordered now is not read as an hour-late one."
            : upFront
              ? "One tap: the order is placed, the money is taken against it, and the receipt comes up to print. It reaches the kitchen already accepted."
              : "Placing it sends the order to the kitchen, already accepted. The bill is settled on the order itself, so a second round can join it."}
        </p>
      </form>

      {configuring ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-scrim/60 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" aria-labelledby="options-title" className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-card bg-surface-container-lowest p-5">
            <h2 id="options-title" className="font-display text-headline-md text-on-surface">{configuring.entry.name}</h2>
            {errors.options ? <FormAlert>{errors.options}</FormAlert> : null}

            {/* The same slot builder the website uses, so a counter cannot put
                together a combo the storefront would refuse — and there is one
                place to fix when the rules change. */}
            <ComboSlots
              groups={configuring.comboGroups}
              selections={comboPicks}
              currency={currency}
              errors={errors.options ? validateComboGroups(configuring.comboGroups, comboPicks) : null}
              modifiers={comboMods}
              modifierErrors={errors.options ? validateComboModifiers(configuring.comboGroups, comboPicks, comboMods) : null}
              onToggle={(group, option) =>
                setComboPicks((current) => {
                  const picks = { ...(current[group.id] ?? {}) };
                  if ((group.maxSelect ?? 1) === 1) {
                    if (picks[option.id] && (group.minSelect ?? 0) === 0) return { ...current, [group.id]: {} };
                    return { ...current, [group.id]: { [option.id]: 1 } };
                  }
                  if (picks[option.id]) delete picks[option.id];
                  else if (hasRoomFor(group, picks, option)) picks[option.id] = 1;
                  else return current;
                  return { ...current, [group.id]: picks };
                })
              }
              onAdjust={(group, option, delta) =>
                setComboPicks((current) => {
                  const picks = { ...(current[group.id] ?? {}) };
                  const taken = picks[option.id] ?? 0;
                  if (delta > 0 && !hasRoomFor(group, picks, option)) return current;
                  const next = taken + delta;
                  if (next <= 0) delete picks[option.id];
                  else picks[option.id] = next;
                  return { ...current, [group.id]: picks };
                })
              }
              onModifierToggle={(slotOption, group, option) =>
                setComboMods((current) => {
                  const forOption = { ...(current[slotOption.id] ?? {}) };
                  const picks = { ...(forOption[group.id] ?? {}) };
                  if (group.selectionType === "SINGLE") {
                    const already = (picks[option.id] ?? 0) > 0;
                    forOption[group.id] = already && !group.isRequired ? {} : { [option.id]: 1 };
                    return { ...current, [slotOption.id]: forOption };
                  }
                  if (picks[option.id]) delete picks[option.id];
                  else if (canSelectMore(group, picks, option.id)) picks[option.id] = 1;
                  else return current;
                  forOption[group.id] = picks;
                  return { ...current, [slotOption.id]: forOption };
                })
              }
            />

            {configuring.groups.map((group) => {
              const chosen = selections[group.id] ?? {};
              const problem = groupError(group, chosen);
              return (
                <fieldset key={group.id} className="flex flex-col gap-2">
                  <legend className="text-label-bold text-on-surface">
                    {group.name}
                    <span className="ml-2 font-normal text-on-surface-variant">
                      {group.isRequired ? "Required" : "Optional"}
                      {group.maxSelect ? ` · up to ${group.maxSelect}` : ""}
                    </span>
                  </legend>
                  {group.options.map((option) => {
                    const quantity = chosen[option.id] ?? 0;
                    const blocked = !quantity && !canSelectMore(group, chosen, option.id);
                    return (
                      <label
                        key={option.id}
                        className={`flex items-center justify-between gap-3 rounded-field px-3 py-2.5 text-body-md ${blocked ? "opacity-50" : "hover:bg-surface-container"}`}
                      >
                        <span className="flex items-center gap-3 text-on-surface">
                          <input
                            type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                            name={group.id}
                            checked={quantity > 0}
                            disabled={blocked}
                            onChange={(event) =>
                              setSelections((current) => ({
                                ...current,
                                [group.id]:
                                  group.selectionType === "SINGLE"
                                    ? { [option.id]: event.target.checked ? 1 : 0 }
                                    : { ...(current[group.id] ?? {}), [option.id]: event.target.checked ? 1 : 0 },
                              }))
                            }
                            className="size-4 accent-primary"
                          />
                          {option.name}
                        </span>
                        {option.priceDelta ? (
                          <span className="tabular-nums text-on-surface-variant">+{formatMoney(option.priceDelta, currency)}</span>
                        ) : null}
                      </label>
                    );
                  })}
                  {problem ? <p className="text-label-bold text-error">{problem}</p> : null}
                  {group.maxSelect ? (
                    <p className="text-label-bold font-normal text-on-surface-variant">
                      {selectedCount(group, chosen)} of {group.maxSelect} chosen
                    </p>
                  ) : null}
                </fieldset>
              );
            })}

            <p className="text-body-md text-on-surface">
              {formatMoney(
                previewTotal({
                  basePrice: configuring.entry.price,
                  groups: configuring.groups,
                  selectionsByGroup: selections,
                  extra: comboSurcharge(configuring.comboGroups, comboPicks, comboMods),
                }),
                currency,
              )}
            </p>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={confirmOptions} className="rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2">
                Add to the order
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfiguring(null);
                  setComboPicks({});
                  setComboMods({});
                  setErrors({});
                }}
                className="rounded-field bg-surface-container-high px-5 py-3 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
