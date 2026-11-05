"use client";

import { CreditCard, Wallet } from "lucide-react";

/**
 * How the customer chooses to pay.
 *
 * A choice only when there is one. Each restaurant brings its own merchant
 * account and most will have none, so a branch with nothing configured sees a
 * plain statement rather than an empty radio group — and offering a "Card"
 * button that did not take a card would be worse than offering none at all.
 *
 * Paying in person is always first and always present. It is this component's
 * own copy rather than an option sent by the server, so a gateway lookup that
 * fails leaves the customer able to order rather than stranded.
 *
 * Kept as its own component so the design-review page renders the real thing.
 * A preview that reimplemented this markup would drift from what ships, and a
 * design signed off on a drifted copy is worse than no review.
 */
export default function PaymentChoice({ options = [], value = null, onChange, orderType = "PICKUP" }) {
  const inPerson = orderType === "DELIVERY" ? "when your order arrives" : "at the counter";

  if (!options.length) {
    return (
      <p className="flex items-start gap-3 text-body-md text-on-surface">
        <Wallet aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
        <span>Pay {inPerson}. Paying online isn&apos;t available here yet.</span>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Option
        checked={value === null}
        onChange={() => onChange(null)}
        icon={<Wallet aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />}
        title={`Pay ${inPerson}`}
      />

      {options.map((option) => (
        <Option
          key={option.provider}
          checked={value === option.provider}
          onChange={() => onChange(option.provider)}
          icon={<CreditCard aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />}
          /*
           * Named, because two gateways both reading "Pay now by card or
           * wallet" is a choice nobody can make. The name is the branch's own
           * wording when it set one, and the provider's otherwise.
           */
          title={option.label ?? "Pay now"}
          detail={option.description ?? "You will be taken to a secure page to pay, then brought back."}
        />
      ))}
    </div>
  );
}

function Option({ checked, onChange, icon, title, detail = null }) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-field px-4 py-3 text-body-md text-on-surface transition-colors ${
        checked ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-low hover:bg-surface-container"
      }`}
    >
      <input
        type="radio"
        name="payment-choice"
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 shrink-0 accent-primary"
      />
      <span className="flex items-start gap-3">
        {icon}
        <span>
          {title}
          {detail ? <span className="block text-body-sm text-on-surface-variant">{detail}</span> : null}
        </span>
      </span>
    </label>
  );
}
