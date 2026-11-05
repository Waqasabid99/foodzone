"use client";

import { useState } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import { formatMoney } from "@/lib/format";
import {
  canPickMore,
  comboSelectedCount,
  hasRoomFor,
  optionGroupsFor,
  optionWeight,
} from "@/lib/combo-options";
import { canSelectMore } from "@/lib/product-options";

/**
 * Building a combo: one slot at a time, each showing what it holds.
 *
 * Slots are photographed rather than listed. A combo is picked by what the food
 * looks like far more than by its name, and the options are whole products that
 * already have pictures — rendering them as a row of radio labels would throw
 * that away for no gain.
 *
 * **What it costs extra is on the option, not in the small print.** A slot
 * choice that carries a surcharge says so where the choice is made; finding out
 * at the total is how a combo stops feeling like a fixed price.
 *
 * **A chosen item can still be customised.** The burger inside a meal takes the
 * same "no onions" the burger on its own does — that is how every chain's app
 * works, and without it somebody who wants it plain has to abandon the combo
 * and order à la carte. The options are folded away until the item is picked,
 * because an unchosen item's sauces are not a question yet.
 */
export default function ComboSlots({
  groups,
  selections,
  onToggle,
  onAdjust,
  errors,
  currency,
  modifiers = {},
  onModifierToggle,
  modifierErrors = null,
}) {
  if (!groups?.length) return null;

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => {
        const chosen = selections[group.id] ?? {};
        const error = errors?.[group.id] ?? null;
        const single = (group.maxSelect ?? 1) === 1;
        const required = (group.minSelect ?? 0) > 0;
        const count = comboSelectedCount(group, chosen);

        return (
          <fieldset key={group.id} id={`combo-${group.id}`}>
            <legend className="flex flex-wrap items-baseline gap-2">
              <span className="font-display text-label-bold uppercase text-on-surface">
                {group.name}
              </span>
              {required ? (
                <span className="text-label-bold text-primary">Required</span>
              ) : (
                <span className="text-label-bold font-normal text-on-surface-variant">
                  Optional
                </span>
              )}
              {single ? null : (
                <span className="text-label-bold font-normal text-on-surface-variant">
                  {count} of {group.maxSelect} chosen
                </span>
              )}
            </legend>

            {group.options.length === 0 ? (
              /*
               * A slot whose every option was unpublished. Said plainly rather
               * than rendered as an empty box: the combo cannot currently be
               * completed, and the Add button will say so too.
               */
              <p className="mt-3 rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
                Nothing is available in this part of the combo right now.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {group.options.map((option) => {
                  const taken = chosen[option.id] ?? 0;
                  const picked = taken > 0;
                  const full = !picked && !canPickMore(group, chosen, option);
                  const weight = optionWeight(option);
                  const room = hasRoomFor(group, chosen, option);
                  /*
                   * Four drinks and two flavours means somebody wants two of
                   * one of them, so a slot holding more than one lets an
                   * option be taken again rather than forcing four different
                   * choices.
                   *
                   * Shown only where it can actually do something. A slot
                   * holding one is a radio; and a "2 burgers" option that
                   * fills its slot on its own has no second helping to offer,
                   * where a stepper reading "1" would look like one burger.
                   */
                  const repeatable = picked && !single && (room || taken > 1);

                  const own = optionGroupsFor(option);
                  const problems = modifierErrors?.[option.id] ?? null;

                  return (
                    <div key={option.id} className="flex flex-col gap-2">
                      <label
                        className={`flex items-center gap-3 rounded-field border-2 p-2 pr-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                          picked
                            ? "border-primary-container bg-surface-container-low"
                            : "border-outline-variant"
                        } ${full ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      >
                        <input
                          type={single ? "radio" : "checkbox"}
                          name={`combo-${group.id}`}
                          checked={picked}
                          disabled={full}
                          onChange={() => onToggle(group, option)}
                          className="sr-only"
                        />

                        <span className="relative size-14 shrink-0 overflow-hidden rounded-field bg-surface-container">
                          <FoodImage
                            src={option.product.imageUrl}
                            alt=""
                            sizes="56px"
                            className="size-full"
                          />
                        </span>

                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body-md text-on-surface">
                            {option.product.name}
                            {weight > 1 ? ` ×${weight}` : ""}
                          </span>
                          {option.variant ? (
                            <span className="truncate text-label-bold font-normal text-on-surface-variant">
                              {option.variant.name}
                            </span>
                          ) : null}
                        </span>

                        {/* Zero is the baseline, not a price, so it is left out. */}
                        {Number(option.priceDelta) ? (
                          <span className="shrink-0 text-label-bold text-primary">
                            +
                            {formatMoney(
                              Number(option.priceDelta) *
                                weight *
                                Math.max(taken, 1),
                              currency,
                            )}
                          </span>
                        ) : (
                          <span className="shrink-0 text-label-bold font-normal text-on-surface-variant">
                            Included
                          </span>
                        )}

                        {repeatable ? (
                          <span className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              // Inside a label, so without this the click
                              // reaches the input and toggles the option off.
                              onClick={(event) => {
                                event.preventDefault();
                                onAdjust(group, option, -1);
                              }}
                              aria-label={`One less ${option.product.name}`}
                              className="grid size-7 place-items-center rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            >
                              <Minus aria-hidden="true" className="size-3" />
                            </button>
                            <span
                              aria-live="polite"
                              className="min-w-6 text-center text-label-bold text-on-surface"
                            >
                              {taken}
                            </span>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                onAdjust(group, option, 1);
                              }}
                              disabled={!room}
                              aria-label={`One more ${option.product.name}`}
                              className="grid size-7 place-items-center rounded-full bg-surface-container-high text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
                            >
                              <Plus aria-hidden="true" className="size-3" />
                            </button>
                          </span>
                        ) : null}
                      </label>

                      {picked && own.length ? (
                        <OptionCustomiser
                          option={option}
                          groups={own}
                          selections={modifiers[option.id] ?? {}}
                          onToggle={(modifierGroup, modifierOption) =>
                            onModifierToggle(
                              option,
                              modifierGroup,
                              modifierOption,
                            )
                          }
                          errors={problems}
                          currency={currency}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {error ? (
              <p role="alert" className="mt-2 text-label-bold text-error">
                {error}
              </p>
            ) : null}
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * How one chosen item is made.
 *
 * Closed by default and opened on demand: most people take the combo as it
 * comes, and unfolding four sauce lists under every slot turns a three-tap
 * order into a wall. It opens by itself when something inside it is wrong,
 * because an error nobody can see is worse than no error.
 */
function OptionCustomiser({
  option,
  groups,
  selections,
  onToggle,
  errors,
  currency,
}) {
  const [open, setOpen] = useState(false);
  const broken = Boolean(errors && Object.keys(errors).length);
  const showing = open || broken;

  const chosen = groups.flatMap((group) =>
    group.options
      .filter((row) => (selections[group.id] ?? {})[row.id])
      .map((row) => row.name),
  );

  return (
    <div className="rounded-field bg-surface-container-low">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={showing}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <span className="min-w-0">
          <span className="text-label-bold text-on-surface">Customise</span>
          {chosen.length ? (
            <span className="block truncate text-label-bold font-normal text-on-surface-variant">
              {chosen.join(", ")}
            </span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 text-on-surface-variant transition-transform ${showing ? "rotate-180" : ""}`}
        />
      </button>

      {showing ? (
        <div className="flex flex-col gap-4 border-t border-outline-variant px-4 py-3">
          {groups.map((group) => {
            const picks = selections[group.id] ?? {};
            const problem = errors?.[group.id] ?? null;

            return (
              <fieldset key={group.id}>
                <legend className="flex flex-wrap items-baseline gap-2">
                  <span className="text-label-bold text-on-surface">
                    {group.name}
                  </span>
                  {group.isRequired ? (
                    <span className="text-label-bold text-primary">
                      Required
                    </span>
                  ) : null}
                </legend>

                <div className="mt-2 flex flex-wrap gap-2">
                  {group.options.map((row) => {
                    const checked = Boolean(picks[row.id]);
                    const full =
                      !checked && !canSelectMore(group, picks, row.id);

                    return (
                      <label
                        key={row.id}
                        className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-body-md transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring ${
                          checked
                            ? "bg-secondary-container text-on-secondary-container"
                            : "bg-surface-container text-on-surface"
                        } ${full ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                      >
                        <input
                          type={
                            group.selectionType === "SINGLE"
                              ? "radio"
                              : "checkbox"
                          }
                          name={`combo-mod-${option.id}-${group.id}`}
                          checked={checked}
                          disabled={full}
                          onChange={() => onToggle(group, row)}
                          className="sr-only"
                        />
                        {row.name}
                        {Number(row.priceDelta) ? (
                          <span className="text-label-bold text-primary">
                            +{formatMoney(Number(row.priceDelta), currency)}
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>

                {problem ? (
                  <p role="alert" className="mt-2 text-label-bold text-error">
                    {problem}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
