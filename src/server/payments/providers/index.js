import { ApiError } from "@/lib/api";
import { cashProvider } from "@/server/payments/providers/cash";
import { mockProvider } from "@/server/payments/providers/mock";

/**
 * The payment provider registry.
 *
 * Every gateway the system will ever speak to sits behind one interface, and
 * nothing outside this directory knows which one is in use. That is not
 * architectural decoration — it is the only way a restaurant chain can change
 * acquirer, or run a different one per country, without touching the code that
 * creates orders and issues refunds.
 *
 * A provider implements:
 *
 *   name                                   — the string stored on Payment.provider
 *   supportsOnline                         — whether it needs an intent + webhook round trip
 *   createIntent({ payment, order, ... })  — start a charge, return provider ids and
 *                                            whatever the client needs to continue
 *   capture({ payment, amount })           — take an authorised amount
 *   void({ payment })                      — release an authorisation
 *   refund({ payment, refund })            — send money back
 *   verifySignature({ rawBody, headers })  — decide whether a webhook is genuine
 *   parseEvent({ payload })                — normalise a webhook into { eventId, type, ... }
 *
 * Every method returns a plain object; none of them touch the database. The
 * services own persistence, so a provider can be tested with no schema at all,
 * and a provider bug can never leave a half-written payment behind.
 */

const providers = new Map([
  [cashProvider.name, cashProvider],
  [mockProvider.name, mockProvider],
]);

/** Registers a provider. Exported so a real gateway is a drop-in, not an edit. */
export function registerProvider(provider) {
  providers.set(provider.name, provider);
}

export function getProvider(name) {
  const provider = providers.get(String(name ?? "").toLowerCase());
  if (!provider) {
    throw ApiError.validation(`Unknown payment provider "${name}"`, {
      provider: [`Available: ${[...providers.keys()].join(", ")}`],
    });
  }
  return provider;
}

export function listProviders() {
  return [...providers.values()].map((provider) => ({
    name: provider.name,
    supportsOnline: provider.supportsOnline,
    supportsRefund: typeof provider.refund === "function",
    methods: provider.methods ?? [],
  }));
}

export { cashProvider, mockProvider };
