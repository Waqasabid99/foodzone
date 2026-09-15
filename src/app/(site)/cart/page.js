import CartView from "@/components/cart/CartView";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = {
  title: "Your order — FoodZone",
  robots: { index: false, follow: false },
};

/**
 * The basket.
 *
 * A thin server shell around a client component, because the cart itself cannot
 * be server-rendered for a guest: their basket is matched by a session id kept
 * in `localStorage`, which the server never sees. Only the currency default is
 * resolved here, from cached settings, so the page has something sensible to
 * format with before the cart arrives.
 */
export default async function CartPage() {
  const { currency } = await getSiteIdentity();

  return (
    <div className="mx-auto max-w-page px-margin-mobile py-8 md:px-margin-desktop md:py-10">
      <h1 className="font-display text-headline-lg text-on-surface">Your order</h1>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Review everything before it hits the griddle.
      </p>

      <div className="mt-8">
        <CartView currency={currency} />
      </div>
    </div>
  );
}
