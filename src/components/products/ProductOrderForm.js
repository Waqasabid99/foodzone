"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import { loadCart } from "@/hooks/useCart";
import { openLocationPicker } from "@/hooks/useLocationPicker";
import { isBranchRequired, NO_BRANCHES_MESSAGE } from "@/lib/cart-errors";
import {
  canSelectMore,
  defaultSelections,
  previewTotal,
  selectedCount,
  toModifierPayload,
  validateGroups,
} from "@/lib/product-options";
import {
  canPickMore,
  comboDefaults,
  hasRoomFor,
  comboModifierDefaults,
  comboSurcharge,
  optionGroupsFor,
  toComboPayload,
  validateComboGroups,
  validateComboModifiers,
} from "@/lib/combo-options";
import ComboSlots from "@/components/products/ComboSlots";

const MAX_QUANTITY = 20;

/**
 * Size, options, quantity, notes, and the button that puts it all in the cart.
 *
 * The running total is a preview and nothing more. Every line is repriced by
 * the server against the branch's live menu — modifiers, combos, promotions and
 * tax included — and that answer is what gets charged. Computing it here as
 * well is only so the button can show a number without a round trip on every
 * click; where the two disagree, the server is right and the cart will say so.
 *
 * Validation is duplicated for the same reason: the server rejects a line that
 * breaks a group's min/max rules, and repeating the check here means the
 * customer finds out before pressing Add rather than after.
 */
export default function ProductOrderForm({
  product,
  currency,
  branchId,
  canChooseBranch = false,
  onBranchMenu,
  priceSource,
  creatorVideoId = null,
}) {
  const router = useRouter();

  const availableVariants = product.variants.filter((variant) => variant.available);
  const [variantId, setVariantId] = useState(
    (availableVariants[0] ?? product.variants[0])?.id ?? null,
  );
  const [selections, setSelections] = useState(() => defaultSelections(product.modifierGroups));
  // Memoised because it feeds a `useMemo`: a fresh `[]` on every render would
  // re-validate every slot on every keystroke in the notes box.
  const comboGroups = useMemo(() => product.comboGroups ?? [], [product.comboGroups]);
  const [comboPicks, setComboPicks] = useState(() => comboDefaults(comboGroups));
  /*
   * How each chosen item is made, keyed by the slot option it belongs to —
   * not by product. The same burger can appear in two slots of one combo, and
   * keying by product would make "no onions" on one of them change both.
   */
  const [comboMods, setComboMods] = useState(() => comboModifierDefaults(comboGroups));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const variant = product.variants.find((item) => item.id === variantId) ?? null;
  const errors = useMemo(
    () => validateGroups(product.modifierGroups, selections),
    [product.modifierGroups, selections],
  );
  const comboErrors = useMemo(
    () => validateComboGroups(comboGroups, comboPicks),
    [comboGroups, comboPicks],
  );
  const comboModErrors = useMemo(
    () => validateComboModifiers(comboGroups, comboPicks, comboMods),
    [comboGroups, comboPicks, comboMods],
  );
  const hasErrors =
    Object.keys(errors).length + Object.keys(comboErrors).length + Object.keys(comboModErrors).length > 0;

  const total = previewTotal({
    basePrice: variant?.price ?? 0,
    groups: product.modifierGroups,
    selectionsByGroup: selections,
    quantity,
    // The combo's own price is the base; the slots only ever add to it.
    extra: comboSurcharge(comboGroups, comboPicks, comboMods),
  });

  /*
   * A combo slot with nothing left in it cannot be completed — every option in
   * it was unpublished. The line would be refused by the server, so the button
   * says so here instead of letting somebody press it.
   */
  const comboBroken = comboGroups.some(
    (group) => (group.minSelect ?? 0) > 0 && group.options.length === 0,
  );
  const soldOut = availableVariants.length === 0 || comboBroken;

  function toggle(group, option) {
    setSelections((current) => {
      const groupSelections = { ...(current[group.id] ?? {}) };

      if (group.selectionType === "SINGLE") {
        // Radio behaviour: one choice replaces the other, and a required group
        // cannot be emptied by clicking the selected option again.
        const alreadyChosen = (groupSelections[option.id] ?? 0) > 0;
        if (alreadyChosen && !group.isRequired) return { ...current, [group.id]: {} };
        return { ...current, [group.id]: { [option.id]: 1 } };
      }

      const count = groupSelections[option.id] ?? 0;

      if (group.allowQuantity) {
        if (!canSelectMore(group, groupSelections, option.id)) return current;
        groupSelections[option.id] = count + 1;
      } else if (count > 0) {
        delete groupSelections[option.id];
      } else {
        if (!canSelectMore(group, groupSelections, option.id)) return current;
        groupSelections[option.id] = 1;
      }

      return { ...current, [group.id]: groupSelections };
    });
  }

  function toggleCombo(group, option) {
    setComboPicks((current) => {
      const picks = { ...(current[group.id] ?? {}) };

      // A slot that takes one behaves like a radio: the new choice replaces
      // the old, and a required slot cannot be emptied by clicking its own
      // choice again.
      if ((group.maxSelect ?? 1) === 1) {
        if (picks[option.id] && (group.minSelect ?? 0) === 0) return { ...current, [group.id]: {} };
        return { ...current, [group.id]: { [option.id]: 1 } };
      }

      if (picks[option.id]) delete picks[option.id];
      else if (canPickMore(group, picks, option)) picks[option.id] = 1;
      else return current;

      return { ...current, [group.id]: picks };
    });
  }

  /**
   * One option inside a chosen combo item.
   *
   * The same radio/checkbox behaviour the top-level groups have, kept here
   * rather than shared with `toggle` because that one writes a different
   * shape: this is a map per slot option, not per group.
   */
  function toggleComboModifier(slotOption, group, option) {
    setComboMods((current) => {
      const forOption = { ...(current[slotOption.id] ?? {}) };
      const picks = { ...(forOption[group.id] ?? {}) };

      if (group.selectionType === "SINGLE") {
        const alreadyChosen = (picks[option.id] ?? 0) > 0;
        forOption[group.id] = alreadyChosen && !group.isRequired ? {} : { [option.id]: 1 };
        return { ...current, [slotOption.id]: forOption };
      }

      if (picks[option.id]) delete picks[option.id];
      else if (canSelectMore(group, picks, option.id)) picks[option.id] = 1;
      else return current;

      forOption[group.id] = picks;
      return { ...current, [slotOption.id]: forOption };
    });
  }

  /**
   * One more, or one fewer, of a slot option already chosen.
   *
   * Dropping to zero removes it outright rather than leaving a zero sitting in
   * the map, so "is this chosen" stays a question about presence everywhere
   * else.
   */
  function adjustCombo(group, option, delta) {
    setComboPicks((current) => {
      const picks = { ...(current[group.id] ?? {}) };
      const taken = picks[option.id] ?? 0;

      if (delta > 0 && !hasRoomFor(group, picks, option)) return current;

      const next = taken + delta;
      if (next <= 0) delete picks[option.id];
      else picks[option.id] = next;

      return { ...current, [group.id]: picks };
    });
  }

  function decrement(group, option) {
    setSelections((current) => {
      const groupSelections = { ...(current[group.id] ?? {}) };
      const count = groupSelections[option.id] ?? 0;
      if (count <= 1) delete groupSelections[option.id];
      else groupSelections[option.id] = count - 1;
      return { ...current, [group.id]: groupSelections };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending || soldOut) return;

    if (hasErrors) {
      // Revealed on submit rather than while typing: marking a required group
      // red before anyone has had the chance to answer it is just nagging.
      setShowErrors(true);
      // Combo slots are above the modifiers on the page, so an unanswered slot
      // is the first thing to scroll to.
      const firstCombo =
        comboGroups.find((group) => comboErrors[group.id]) ??
        comboGroups.find((group) =>
          group.options.some((option) => comboModErrors[option.id] && optionGroupsFor(option).length),
        );
      const firstGroup = product.modifierGroups.find((group) => errors[group.id]);
      const target = firstCombo ? `combo-${firstCombo.id}` : `group-${firstGroup.id}`;
      document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    setPending(true);

    try {
      await api.post("/cart/items", {
        productId: product.id,
        ...(variantId ? { variantId } : {}),
        quantity,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        modifiers: toModifierPayload(selections),
        ...(comboGroups.length
          ? { comboSelections: toComboPayload(comboGroups, comboPicks, comboMods) }
          : {}),
        ...(branchId ? { branchId } : {}),
        // Set when a customer's video sent them here. The clip did the selling
        // even though the choices were made on this page, so the credit
        // follows them rather than being lost at the hand-over.
        ...(creatorVideoId ? { creatorVideoId, creatorSurface: "PRODUCT_PAGE" } : {}),
      });

      // Refresh the shared cart store so the header badge and the floating
      // summary reflect this without a second request each.
      await loadCart({ force: true });

      toast.success(`${product.name} added to your order.`);
      router.refresh();
    } catch (error) {
      // "Choose a branch" is a question, so ask it rather than reporting it.
      if (isBranchRequired(error)) {
        if (canChooseBranch) {
          openLocationPicker();
          toast.info("Choose a location to order from.");
        } else {
          toast.error(NO_BRANCHES_MESSAGE);
        }
      } else {
        toast.error(error.message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {/* What the combo is made of comes first: it is the reason somebody is on
          this page, and the modifiers below apply to the combo as a whole. */}
      <ComboSlots
        groups={comboGroups}
        selections={comboPicks}
        onToggle={toggleCombo}
        onAdjust={adjustCombo}
        errors={showErrors ? comboErrors : null}
        currency={currency}
        modifiers={comboMods}
        onModifierToggle={toggleComboModifier}
        modifierErrors={showErrors ? comboModErrors : null}
      />

      {/* Size. Rendered only when there is a choice — a lone "Regular" radio is
          a decision nobody is making. */}
      {product.variants.length > 1 ? (
        <fieldset>
          <legend className="font-display text-label-bold uppercase text-on-surface">Choose your size</legend>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {product.variants.map((item) => (
              <label
                key={item.id}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-field border-2 px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                  item.id === variantId ? "border-primary-container bg-surface-container-low" : "border-outline-variant"
                } ${item.available ? "" : "cursor-not-allowed opacity-60"}`}
              >
                <span className="flex items-center gap-3">
                  <input
                    type="radio"
                    name="variant"
                    value={item.id}
                    checked={item.id === variantId}
                    disabled={!item.available}
                    onChange={() => setVariantId(item.id)}
                    className="sr-only"
                  />
                  <span className="text-body-md text-on-surface">{item.name}</span>
                  {item.available ? null : (
                    <span className="text-label-bold text-on-surface-variant">Not served here</span>
                  )}
                </span>
                <span className="font-display text-label-bold text-primary">
                  {formatMoney(item.price, currency)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {product.modifierGroups.map((group) => {
        const groupSelections = selections[group.id] ?? {};
        const error = showErrors ? errors[group.id] : null;

        return (
          <fieldset key={group.id} id={`group-${group.id}`}>
            <legend className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-label-bold uppercase text-on-surface">{group.name}</span>
              {group.isRequired ? (
                <span className="text-label-bold text-primary">Required</span>
              ) : (
                <span className="text-label-bold font-normal text-on-surface-variant">Optional</span>
              )}
              {group.maxSelect ? (
                <span className="text-label-bold font-normal text-on-surface-variant">
                  Select up to {group.maxSelect}
                </span>
              ) : null}
            </legend>

            <div className="mt-3 flex flex-col gap-2">
              {group.options.map((option) => {
                const count = groupSelections[option.id] ?? 0;
                const checked = count > 0;
                const full = !checked && !canSelectMore(group, groupSelections, option.id);

                return (
                  <label
                    key={option.id}
                    className={`flex items-center justify-between gap-3 rounded-field border-2 px-4 py-3 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                      checked ? "border-primary-container bg-surface-container-low" : "border-outline-variant"
                    } ${full ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <input
                        type={group.selectionType === "SINGLE" ? "radio" : "checkbox"}
                        name={`group-${group.id}`}
                        checked={checked}
                        disabled={full}
                        onChange={() => toggle(group, option)}
                        className="sr-only"
                      />
                      <span className="truncate text-body-md text-on-surface">{option.name}</span>
                    </span>

                    <span className="flex shrink-0 items-center gap-3">
                      {option.priceDelta ? (
                        <span className="text-label-bold text-on-surface-variant">
                          +{formatMoney(option.priceDelta, currency)}
                        </span>
                      ) : null}

                      {group.allowQuantity && checked ? (
                        <span className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.preventDefault();
                              decrement(group, option);
                            }}
                            aria-label={`One less ${option.name}`}
                            className="grid size-7 place-items-center rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            <Minus aria-hidden="true" className="size-3" />
                          </button>
                          <span className="min-w-6 text-center text-label-bold text-on-surface">{count}</span>
                        </span>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>

            {group.allowQuantity ? (
              <p className="mt-2 text-label-bold font-normal text-on-surface-variant">
                {selectedCount(group, groupSelections)} selected
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="mt-2 text-label-bold text-error">
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}

      <div>
        <label htmlFor="kitchen-notes" className="font-display text-label-bold uppercase text-on-surface">
          Kitchen notes
        </label>
        <textarea
          id="kitchen-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          rows={2}
          maxLength={300}
          placeholder="Allergies, extra crispy, sauce on the side…"
          className="mt-2 w-full rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
        />
        {/* Free text reaches a kitchen ticket, not an allergen check. Saying so
            is the difference between a preference and a safety guarantee we
            are not in a position to make. */}
        <p className="mt-1 text-label-bold font-normal text-on-surface-variant">
          Notes reach the kitchen but can&apos;t be guaranteed. For allergies, call the restaurant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full bg-surface-container-low p-1">
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.max(1, value - 1))}
            disabled={quantity <= 1}
            aria-label="Decrease quantity"
            className="grid size-9 place-items-center rounded-full text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
          >
            <Minus aria-hidden="true" className="size-4" />
          </button>
          <span aria-live="polite" className="min-w-8 text-center font-display text-label-bold text-on-surface">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((value) => Math.min(MAX_QUANTITY, value + 1))}
            disabled={quantity >= MAX_QUANTITY}
            aria-label="Increase quantity"
            className="grid size-9 place-items-center rounded-full text-on-surface hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
          >
            <Plus aria-hidden="true" className="size-4" />
          </button>
        </div>

        <button
          type="submit"
          disabled={pending || soldOut}
          className="flex min-w-56 flex-1 items-center justify-center gap-3 rounded-full bg-primary-container px-8 py-4 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Adding…
            </>
          ) : comboBroken ? (
            "Part of this combo is unavailable"
          ) : soldOut ? (
            "Sold out here"
          ) : (
            <>
              <ShoppingBag aria-hidden="true" className="size-4" />
              Add to bag
              <span className="ml-auto">{formatMoney(total, currency)}</span>
            </>
          )}
        </button>
      </div>

      {/* Whether the number above is the one that will be charged. */}
      <p className="text-label-bold font-normal text-on-surface-variant">
        {priceSource === "branch" && onBranchMenu
          ? "Prices confirmed against this outlet's live menu."
          : "Indicative prices. Your total is confirmed against the outlet's menu at checkout."}
      </p>
    </form>
  );
}
