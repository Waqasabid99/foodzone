"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { toast } from "react-toastify";
import { Bike, MapPin, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import AddressPicker from "@/components/checkout/AddressPicker";
import CheckoutSummary from "@/components/checkout/CheckoutSummary";
import OrderPlaced from "@/components/checkout/OrderPlaced";
import TipPicker from "@/components/checkout/TipPicker";
import Field from "@/components/ui/Field";
import { api } from "@/lib/api-client";
import { loadCart, setCartType, useCart } from "@/hooks/useCart";
import { useSession } from "@/hooks/useSession";
import { checkoutBlockers, checkoutPayload, checkoutRequirements, quoteItems } from "@/lib/checkout";
import PaymentChoice from "@/components/checkout/PaymentChoice";
import StoreCreditPicker from "@/components/checkout/StoreCreditPicker";
import { toFormErrors } from "@/lib/form-errors";
import { loginHref } from "@/lib/redirects";
import { formatMoney } from "@/lib/format";

const ORDER_TYPES = [
  { value: "DELIVERY", label: "Delivery", icon: Bike },
  { value: "PICKUP", label: "Pickup", icon: Store },
  { value: "DINE_IN", label: "Dine in", icon: UtensilsCrossed },
];

const GUEST_FIELDS = ["guest", "name", "phone", "email"];

/**
 * Checkout.
 *
 * Client-rendered for the same reason the basket is: a guest's cart is matched
 * by a session id in `localStorage`, which the server cannot see while
 * rendering, so a server-rendered checkout would show every signed-out visitor
 * an empty one.
 *
 * Nothing here computes money. The totals come from `POST /checkout/quote`,
 * which runs the real pricing engine and the real guards, and the order is
 * priced again from the live menu when it is placed. That is three chances for
 * the number on screen to be the number charged, and no chance for a
 * browser-side multiply to disagree with the kitchen.
 */
export default function CheckoutView({ currency = "PKR", tableId = null, tableName = null }) {
  const { status: cartStatus, cart, error: cartError } = useCart();
  const { status: sessionStatus, user } = useSession();
  const pathname = usePathname();

  const [addresses, setAddresses] = useState({ status: "idle", list: [] });
  const [addressId, setAddressId] = useState(null);
  /*
   * How this branch lets people pay.
   *
   * Loaded from the branch rather than assumed, because each restaurant brings
   * its own merchant account and most will have none. Paying in person is not
   * in this list: it is always available, so it is stated here rather than
   * being a server-sent option that could go missing and leave somebody unable
   * to order at all.
   */
  const [payOptions, setPayOptions] = useState([]);
  const [payWith, setPayWith] = useState(null);

  useEffect(() => {
    const branchId = cart?.branchId;
    if (!branchId) return undefined;

    let live = true;
    api
      .get(`/checkout/payment-options?branchId=${encodeURIComponent(branchId)}`)
      .then((options) => {
        if (!live) return;
        setPayOptions(Array.isArray(options) ? options : []);
      })
      // A branch that cannot be asked is a branch that takes payment in
      // person. Failing quietly is right: the customer can still order.
      .catch(() => live && setPayOptions([]));

    return () => {
      live = false;
    };
  }, [cart?.branchId]);

  const [guest, setGuest] = useState({ name: "", phone: "", email: "" });
  const [guestErrors, setGuestErrors] = useState({});
  const [guestCount, setGuestCount] = useState("");
  const [note, setNote] = useState("");
  const [tip, setTip] = useState(0);
  const [tipCustom, setTipCustom] = useState("");
  const [quote, setQuote] = useState({ key: null, totals: null, error: null });
  /*
   * Bumped to force a re-quote when the inputs have not changed.
   *
   * The quote effect keys off `quoteKey`, so clearing the quote after a failed
   * checkout was not enough on its own: the basket is usually identical, the
   * key is therefore identical, the effect never re-runs, and `quoting` stays
   * true for good — a dimmed total and a dead Place order button until the
   * customer thinks to reload. Any failure did this, whatever its cause.
   */
  const [requote, setRequote] = useState(0);
  /*
   * Store credit: the customer's answer to what the quote offered.
   *
   * The ceiling arrives with the totals rather than from a call of its own.
   * It is a percentage of the total, so quoting it separately meant a second
   * round trip and a window where the two disagreed — a tip added between the
   * calls moves the total, and the figure on screen was then a ceiling for a
   * bill that no longer existed.
   */
  const [creditApplied, setCreditApplied] = useState(false);

  if (order) {
    return (
      <Page title="Order confirmed" subtitle="We've sent it through to the kitchen.">
        <OrderPlaced order={order} signedIn={signedIn} storeCredit={placedCredit} />
      </Page>
    );
  }

  if (cartStatus === "loading" || !sessionResolved) {
    return (
      <Page>
        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <div className="flex flex-col gap-4" aria-hidden="true">
            {[0, 1].map((key) => (
              <div key={key} className="h-40 animate-pulse rounded-card bg-surface-container" />
            ))}
          </div>
          <div aria-hidden="true" className="h-80 animate-pulse rounded-card bg-surface-container" />
          <p className="sr-only">Loading checkout</p>
        </div>
      </Page>
    );
  }

  if (cartStatus === "error") {
    return (
      <Page>
        <p role="alert" className="rounded-card bg-error-container px-6 py-8 text-body-md text-on-error-container">
          We couldn&apos;t load your order{cartError ? `: ${cartError}` : ""}. Please refresh in a moment.
        </p>
      </Page>
    );
  }

  if (!cart?.items?.length) {
    return (
      <Page>
        <EmptyCheckout />
      </Page>
    );
  }

  const blockers = checkoutBlockers({ cart, user, signedIn, addressId, guest });
  const cartBlockers = blockers.filter((blocker) => blocker.fix === "cart");
  const accountBlocker = blockers.find((blocker) => blocker.fix === "account");

  const totals = quote.totals ?? { ...(cart.totals ?? {}), discounts: cart.discounts ?? [] };

  /*
   * Only a ceiling the server quoted for the total now on screen counts. It
   * rides on `quote.totals`, so while a re-quote is in flight the control
   * disappears rather than offering a figure that belonged to a different
   * bill, and `applied` can only ever spend what the current offer allows.
   */
  const credit = quote.totals?.storeCredit ?? { available: 0, redeemable: 0, maxPercent: null };
  const creditToSpend = creditApplied && credit.redeemable > 0 ? credit.redeemable : 0;
  const quoting = quoteKey !== null && quote.key !== quoteKey;
  const lineCurrency = cart.branch?.currency || currency;

  async function changeType(next) {
    if (switching || cart.type === next) return;
    setSwitching(true);
    try {
      await setCartType(next);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSwitching(false);
    }
  }

  async function place() {
    if (placing || blockers.length) return;

    setPlacing(true);
    setGuestErrors({});

    try {
      const placed = await api.post(
        "/checkout",
        checkoutPayload({
          cart,
          signedIn,
          addressId,
          guest,
          guestCount: guestCount ? Number(guestCount) : null,
          note,
          tipAmount: tip,
          tableId,
          payWith,
          storeCredit: creditToSpend,
        }),
      );

      /*
       * The gateway's hosted page. Sent before the cart is refreshed and
       * before any success state is shown: the order exists, the money does
       * not yet, and showing a receipt first would tell the customer they had
       * paid while their card details were still unasked for.
       */
      if (placed?.clientAction?.url) {
        window.location.assign(placed.clientAction.url);
        return;
      }

      // Asked to pay now, but the gateway would not start. The order stands,
      // so say so plainly rather than losing it.
      if (payWith && placed?.payment?.status === "UNAVAILABLE") {
        toast.info("Your order is placed. Online payment is unavailable right now, so please pay in person.");
      }

      // The server emptied the cart inside the same transaction; refresh the
      // local copy so the header badge and every other reader agree.
      loadCart({ force: true });
      setPlacedCredit(creditToSpend);
      setOrder(placed);
    } catch (error) {
      const { fieldErrors, formError } = toFormErrors(error, { fields: GUEST_FIELDS });
      setGuestErrors(fieldErrors);
      toast.error(formError ?? error.message);
      // A price that moved, an item that sold out, a promotion just exhausted —
      // all are answered by re-reading rather than by letting the customer press
      // the button again against figures that are now wrong.
      loadCart({ force: true });
      setQuote({ key: null, totals: null, error: null });
      // ...and actually ask again, which an unchanged basket would not.
      setRequote((n) => n + 1);
    } finally {
      setPlacing(false);
    }
  }

  return (
    <Page title="Checkout" subtitle="Last look before the kitchen starts.">
      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="flex flex-col gap-5">
        {cartBlockers.length ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-card bg-error-container px-6 py-5 text-on-error-container"
          >
            {cartBlockers.map((blocker) => (
              <p key={blocker.code} className="text-body-md">
                {blocker.message}
              </p>
            ))}
            <Link href="/cart" className="self-start text-label-bold underline underline-offset-2">
              Back to your order
            </Link>
          </div>
        ) : null}

        <Section title="How would you like it?">
          <div className="flex flex-wrap gap-2">
            {ORDER_TYPES.map(({ value, label, icon: Icon }) => {
              const active = cart.type === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => changeType(value)}
                  disabled={switching}
                  aria-pressed={active}
                  className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
                    active
                      ? "bg-primary-container text-on-primary-container"
                      : "bg-surface-container-low text-on-surface hover:bg-surface-container-high"
                  }`}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  {label}
                </button>
              );
            })}
          </div>

          {cart.branch ? (
            <p className="mt-3 flex items-center gap-2 text-body-md text-on-surface-variant">
              <MapPin aria-hidden="true" className="size-4 text-primary" />
              {type === "DELIVERY" ? "From" : "At"}{" "}
              <span className="text-on-surface">{cart.branch.name}</span>
            </p>
          ) : null}
        </Section>

        {accountBlocker ? (
          <AccountPrompt blocker={accountBlocker} pathname={pathname} />
        ) : requirements.needsAddress ? (
          <Section title="Delivery address">
            <AddressPicker
              addresses={addresses.list}
              status={addresses.status === "idle" ? "loading" : addresses.status}
              selectedId={addressId}
              onSelect={setAddressId}
              onCreated={(address) => {
                setAddresses((current) => ({ status: "ready", list: [address, ...current.list] }));
                setAddressId(address.id);
              }}
            />
          </Section>
        ) : null}

        {requirements.needsContact ? (
          <Section
            title="Your details"
            description="So the branch can reach you about this order."
            action={
              <Link
                href={loginHref(pathname)}
                className="text-label-bold text-primary hover:underline"
              >
                Sign in instead
              </Link>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                id="guest-name"
                label="Name"
                value={guest.name}
                onChange={(event) => setGuest((current) => ({ ...current, name: event.target.value }))}
                error={guestErrors.name ?? guestErrors.guest}
                autoComplete="name"
                required
              />
              <Field
                id="guest-phone"
                label="Phone"
                type="tel"
                value={guest.phone}
                onChange={(event) => setGuest((current) => ({ ...current, phone: event.target.value }))}
                error={guestErrors.phone}
                placeholder="+92 300 1234567"
                autoComplete="tel"
                required
              />
            </div>
            <div className="mt-4">
              <Field
                id="guest-email"
                label="Email (optional)"
                type="email"
                value={guest.email}
                onChange={(event) => setGuest((current) => ({ ...current, email: event.target.value }))}
                error={guestErrors.email}
                hint="We'll send your receipt here if you add it."
                autoComplete="email"
              />
            </div>
          </Section>
        ) : null}

        {requirements.wantsGuestCount ? (
          <Section title="How many are eating?">
            {/* Shown rather than assumed: the customer scanned a sticker, and
                confirming the table is cheaper than a tray going to the wrong
                one. No table just means the order is collected at the counter. */}
            {tableName ? (
              <p className="rounded-field bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">
                Serving table <strong>{tableName}</strong>, from the code you scanned.
              </p>
            ) : null}
            <Field
              id="guest-count"
              label="Guests"
              type="number"
              min="1"
              max="50"
              value={guestCount}
              onChange={(event) => setGuestCount(event.target.value)}
              placeholder="2"
            />
          </Section>
        ) : null}

        <Section title="Anything else?" description="Allergies, directions, or a note for the kitchen.">
          <label htmlFor="order-note" className="sr-only">
            Note for this order
          </label>
          <textarea
            id="order-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="No onions, please."
            className="w-full rounded-field border border-transparent bg-surface-container-low px-4 py-3 text-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-2 focus:outline-offset-2 focus:outline-ring"
          />
        </Section>

        {requirements.acceptsTip ? (
          <Section title={type === "DELIVERY" ? "Tip your rider" : "Tip the team"}>
            <TipPicker
              subtotal={totals.subtotal}
              currency={lineCurrency}
              value={tip}
              custom={tipCustom}
              onChange={setTip}
              onCustomChange={setTipCustom}
              label={type === "DELIVERY" ? "Tip your rider" : "Tip the team"}
            />
          </Section>
        ) : null}

        {/* Before the gateway choice, because applying credit changes how much
            is left for a gateway to take — and may leave nothing at all. */}
        <StoreCreditPicker
          available={credit.available}
          redeemable={credit.redeemable}
          maxPercent={credit.maxPercent}
          orderTotal={Number(quote.totals?.grandTotal ?? 0)}
          currency={lineCurrency}
          applied={creditToSpend > 0}
          onChange={setCreditApplied}
        />

        <Section title="Payment">
          <PaymentChoice options={payOptions} value={payWith} onChange={setPayWith} orderType={type} />
        </Section>

        <Section title={`Your order (${cart.totals?.itemCount ?? cart.items.length})`}>
          <ul className="flex flex-col gap-2 text-body-md">
            {cart.items.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className={item.problem ? "text-error" : "text-on-surface"}>
                  {item.quantity} × {item.name}
                  {item.variantName && item.variantName !== "Regular" ? ` (${item.variantName})` : ""}
                </span>
                <span className="shrink-0 text-on-surface-variant">
                  {item.problem ? "Unavailable" : formatMoney(item.lineTotal, lineCurrency)}
                </span>
              </li>
            ))}
          </ul>

          <Link
            href="/cart"
            className="mt-4 inline-block text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Edit your order
          </Link>
        </Section>
      </div>

        <CheckoutSummary
          totals={totals}
          currency={lineCurrency}
          couponCode={cart.couponCode}
          quoting={quoting}
          quoteError={quote.error}
          blockers={blockers}
          pending={placing}
          onPlace={place}
          storeCredit={creditToSpend}
        />
      </div>
    </Page>
  );
}

/** The page heading, which changes once the order exists. */
function Page({ title = "Checkout", subtitle = null, children }) {
  return (
    <>
      <h1 className="font-display text-headline-lg text-on-surface">{title}</h1>
      {subtitle ? <p className="mt-2 text-body-md text-on-surface-variant">{subtitle}</p> : null}
      <div className="mt-8">{children}</div>
    </>
  );
}

/**
 * A quote failure, in words a customer can act on.
 *
 * The server's own message is used wherever it was written for them — "this
 * branch is closed", "we are not taking orders right now" — because it is more
 * specific than anything this layer could say. A rejected request body is not
 * in that category: it means the client sent something wrong, which is our bug,
 * and "Invalid request body" tells the customer nothing except that the site is
 * broken.
 */
function quoteMessage(error) {
  if (error?.code === "VALIDATION_ERROR" || error?.status === 400 || error?.status === 422) {
    return "We couldn't price your order just now. Please refresh and try again.";
  }
  return error?.message ?? "We couldn't price your order just now.";
}

function Section({ title, description = null, action = null, children }) {
  return (
    <section className="rounded-card bg-surface-container-lowest p-6">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-headline-md text-on-surface">{title}</h2>
          {description ? <p className="mt-1 text-body-md text-on-surface-variant">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The two things a customer must do in their account before this order can go
 * through, each with the link that does it and a way back here afterwards.
 */
function AccountPrompt({ blocker, pathname }) {
  const verify = blocker.code === "EMAIL_UNVERIFIED";

  return (
    <section className="rounded-card bg-surface-container-lowest p-6">
      <h2 className="font-display text-headline-md text-on-surface">
        {verify ? "Verify your email" : "Sign in to order delivery"}
      </h2>
      <p className="mt-2 text-body-md text-on-surface-variant">
        {verify
          ? "We need a verified email address before we can take an order on this account."
          : "A delivery order is sent to a saved address, and an address book belongs to an account. Pickup and dine-in don't need one."}
      </p>
      <Link
        href={verify ? "/verify-email" : loginHref(pathname)}
        className="mt-5 inline-flex items-center rounded-full bg-primary-container px-8 py-3 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {verify ? "Verify email" : "Sign in"}
      </Link>
    </section>
  );
}

function EmptyCheckout() {
  return (
    <div className="rounded-card bg-surface-container-lowest px-6 py-16 text-center">
      <ShoppingBag aria-hidden="true" className="mx-auto size-10 text-on-surface-variant" />
      <h2 className="mt-4 font-display text-headline-md text-on-surface">There&apos;s nothing to check out</h2>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Your order is empty. Pick something from the menu and come back.
      </p>
      <Link
        href="/menu"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-container px-8 py-3 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Browse the menu
      </Link>
    </div>
  );
}
