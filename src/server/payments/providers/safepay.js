import { z } from "zod";
import { safeEqual } from "@/server/utils/crypto";
import crypto from "node:crypto";

/**
 * Safepay.
 *
 * Chosen as the first real gateway for three reasons: their documentation is
 * public rather than locked behind a merchant portal, their sandbox is
 * self-serve so the whole path can be exercised before anyone is approved, and
 * one integration covers cards, wallets and Raast — which keeps JazzCash and
 * Easypaisa off the critical path entirely.
 *
 * Each restaurant holds its own Safepay account, so every method below takes a
 * `config` resolved from that branch's row. There is no deployment-wide
 * Safepay secret anywhere in this system.
 *
 * ## Everything here was verified against a real callback, not the docs
 *
 * Safepay's published webhook payload does not match what Safepay sends. A
 * sandbox delivery captured on 2026-11-03 (kept at
 * `tests/fixtures/safepay-payment-created.json`) differs in almost every field
 * path:
 *
 *   | documented                        | actually sent                      |
 *   | --------------------------------- | ---------------------------------- |
 *   | `type`/`version`/`data` at top    | everything nested under `data`     |
 *   | `payment.succeeded`               | `payment:created` (a colon)        |
 *   | event id `token` = `evt_…`        | `token` = 20 uppercase chars       |
 *   | `merchant_api_key`                | `client_id`                        |
 *   | tracker `track_…`                 | `tracker_…`                        |
 *   | `data.state` = `TRACKER_ENDED`    | `data.notification.state` = `PAID` |
 *   | amount: integer, lowest denom.    | decimal **string**, major units    |
 *   | `created_at` = {seconds, nanos}   | ISO 8601 string                    |
 *
 * The amount is the dangerous one. Reading the documentation and dividing by
 * 100 would record every PKR 150 sale as PKR 1.50.
 */

/**
 * States that mean the money is actually ours.
 *
 * `TRACKER_ENDED` is what a genuine payment reports; `PAID` is what the
 * dashboard's test button sends. Nothing outside this set is ever treated as
 * paid — an unfamiliar status leaves the payment alone rather than guessing.
 */
const PAID_STATES = new Set(["TRACKER_ENDED", "PAID"]);

const REFUND_STATES = new Map([
  ["TRACKER_REFUNDED", "REFUNDED"],
  ["TRACKER_PARTIAL_REFUND", "PARTIALLY_REFUNDED"],
]);

export const safepayProvider = {
  name: "safepay",
  /** What a person should see. The registry key is an identifier, not a name. */
  label: "Safepay",
  /** One line of customer-facing copy, shown under the option at checkout. */
  description: "Card, wallet or bank transfer on a secure page.",
  signatureHeader: "x-sfpy-signature",
  supportsOnline: true,
  /**
   * "Card refunds are only applicable for up to 90 days after the transaction
   * has completed" — Safepay's own wording. Past this the gateway refuses, so
   * we refuse first and say when it lapsed rather than letting a customer be
   * promised money that will not arrive.
   */
  refundMaxAgeDays: 90,
  // One integration, several rails. `intent` on the real callback was PAYFAST,
  // so what the customer picked is recorded from the event rather than assumed.
  methods: ["CARD", "WALLET", "BANK_TRANSFER"],

  credentials: [
    {
      key: "publicKey",
      label: "Public API Key",
      type: "string",
      // Safepay's own naming: it starts with `sec_` but is the *public* key,
      // sent as `merchant_api_key` on checkout and echoed to the browser. The
      // confusing prefix is theirs, and it is exactly why this is declared
      // non-secret explicitly rather than inferred from the name.
      secret: false,
      required: true,
      schema: z.string().trim().min(8),
      hint: "Dashboard → Developers → API. Starts with sec_, and is safe for the browser.",
    },
    {
      key: "secretKey",
      label: "Private API Secret Key",
      type: "string",
      secret: true,
      required: true,
      schema: z.string().trim().min(8),
      hint: "Dashboard → Developers → API. Server-side only. Rotating it takes effect immediately.",
    },
    {
      key: "webhookSecret",
      label: "Private Webhook Secret Key",
      type: "string",
      secret: true,
      required: true,
      schema: z.string().trim().min(8),
      hint: "Dashboard → Developers → Endpoints → View shared secret.",
    },
  ],

  /**
   * Sandbox and live are separate accounts with separate keys, so the host is
   * chosen by the branch's recorded mode rather than by NODE_ENV. A branch in
   * sandbox mode must reach sandbox even on a production deployment, or a test
   * configuration would silently charge real cards.
   */
  baseUrl(mode) {
    return mode === "LIVE" ? "https://api.getsafepay.com" : "https://sandbox.api.getsafepay.com";
  },

  /**
   * The hosted checkout page.
   *
   * Note the host: live checkout is `getsafepay.com`, **not** the API host.
   * Taken from Safepay's own WooCommerce plugin and PHP SDK, because the
   * documentation only shows an SDK call and never the URL it builds — and
   * guessing it produced a page that loaded and then refused the session with
   * "does not validate for either a payment or subscription".
   */
  checkoutUrl(mode) {
    return mode === "LIVE" ? "https://getsafepay.com/embedded" : "https://sandbox.api.getsafepay.com/embedded";
  },

  /**
   * Starts a charge.
   *
   * Three calls, because Safepay splits "what is owed" from "who may pay it":
   * a tracker is created server-side, a short-lived passport token is minted,
   * and the two are combined into a hosted checkout URL the customer is sent
   * to. The passport expires in an hour and the checkout dies with it, so the
   * URL is generated per attempt and never stored.
   *
   * **Amount units are not the same in both directions.** Checkout takes an
   * integer in the lowest denomination — 15000 is PKR 150 — while the webhook
   * sends back a decimal string in major units ("150"). Getting this backwards
   * either charges a hundredth of the bill or a hundred times it, so the
   * conversion happens here, once, in each direction.
   */
  async createIntent({ payment, order, config, mode = "SANDBOX", returnUrl = null, cancelUrl = null }) {
    const base = this.baseUrl(mode);
    const currency = order?.currency ?? payment.currency ?? "PKR";

    const tracker = await this.call({
      url: `${base}/order/payments/v3/`,
      config,
      body: {
        merchant_api_key: config.publicKey,
        intent: "CYBERSOURCE",
        mode: "payment",
        /**
         * `entry_mode` is deliberately not sent. The documented example uses
         * `raw`, which means collecting card details in plaintext — Safepay
         * requires a PCI certificate before enabling it, and we never want to
         * touch a card number anyway. Omitted, the tracker defaults to `flex`
         * and the hosted page collects the details itself.
         */
        currency,
        amount: toMinorUnits(payment.amount),
        metadata: { order_id: order?.id ?? payment.orderId, source: "foodzone" },
      },
    });

    const trackerToken = tracker?.data?.tracker?.token ?? tracker?.data?.token ?? null;
    if (!trackerToken) throw new Error("Safepay did not return a tracker for this charge");

    const passport = await this.call({ url: `${base}/client/passport/v1/token`, config, body: {} });
    const tbt = typeof passport?.data === "string" ? passport.data : (passport?.data?.token ?? null);
    if (!tbt) throw new Error("Safepay did not return a checkout token");

    // Parameter names come from Safepay's WooCommerce plugin and PHP SDK, which
    // are working integrations. `environment`, not `env` — the checkout page
    // reads the long name and rejects the session without it.
    const url = new URL(this.checkoutUrl(mode));
    url.searchParams.set("tbt", tbt);
    url.searchParams.set("tracker", trackerToken);
    url.searchParams.set("order_id", order?.id ?? payment.orderId ?? "");
    url.searchParams.set("environment", mode === "LIVE" ? "production" : "sandbox");
    url.searchParams.set("source", "custom");
    if (returnUrl) url.searchParams.set("redirect_url", returnUrl);
    if (cancelUrl) url.searchParams.set("cancel_url", cancelUrl);

    return {
      providerOrderId: trackerToken,
      providerPaymentId: null,
      status: "PENDING",
      clientAction: { type: "REDIRECT", url: url.toString(), returnUrl },
      // The passport is deliberately left out: it is a bearer token with an
      // hour of life, and `rawResponse` is read by anyone with ledger access.
      raw: { tracker: trackerToken, amount: String(payment.amount), currency, mode },
    };
  },

  /**
   * Takes a previously authorised amount.
   *
   * Only reachable when the charge was created with `do_capture: false`;
   * Safepay captures automatically otherwise, and the webhook is what tells us
   * it happened. An empty body is required — Safepay rejects a bare POST.
   */
  async capture({ payment, config, mode = "SANDBOX" }) {
    const tracker = payment.providerOrderId;
    if (!tracker) throw new Error("This payment has no Safepay tracker to capture");

    const result = await this.call({ url: `${this.baseUrl(mode)}/order/payments/v3/${tracker}`, config, body: {} });
    const state = result?.data?.tracker?.state ?? result?.data?.state ?? null;

    return {
      status: state === "TRACKER_ENDED" ? "CAPTURED" : "PENDING",
      providerPaymentId: tracker,
      capturedAmount: payment.amount,
      feeAmount: 0,
      raw: { state, tracker },
    };
  },

  /**
   * Safepay has no single "cancel". A tracker that was never paid simply
   * expires, and one that was authorised is reversed rather than voided. We do
   * not create authorisations yet, so this reports the local truth instead of
   * calling an endpoint whose semantics we have not verified against sandbox —
   * a provider that claims to have reversed a payment it did not would be
   * worse than one that admits it cannot.
   */
  async void() {
    return { status: "CANCELLED", raw: { note: "Safepay trackers expire; nothing was reversed at the gateway" } };
  },

  /**
   * Sends money back.
   *
   * Partial refunds are allowed with no limit until the full amount is
   * reached. Two windows Safepay imposes and we do not yet enforce: a reversal
   * is the correct call within 24 hours of capture, and card refunds stop
   * working about 90 days after the transaction. Both are recorded here so the
   * refund service can grow the rule rather than discover it from a rejection.
   */
  async refund({ payment, refund, config, mode = "SANDBOX" }) {
    const tracker = payment.providerOrderId;
    if (!tracker) throw new Error("This payment has no Safepay tracker to refund against");

    const result = await this.call({
      url: `${this.baseUrl(mode)}/order/payments/v3/${tracker}/refunds`,
      config,
      body: { currency: payment.currency ?? "PKR", amount: toMinorUnits(refund.amount) },
    });

    const state = result?.data?.tracker?.state ?? result?.data?.state ?? null;

    return {
      status: state === "TRACKER_REFUNDED" || state === "TRACKER_PARTIAL_REFUND" ? "COMPLETED" : "PENDING",
      providerRefundId: result?.data?.token ?? null,
      raw: { state, tracker, amount: String(refund.amount) },
    };
  },

  /**
   * Proves the stored credentials actually work.
   *
   * Minting a passport token is the cheapest honest check: it exercises the
   * real secret key against the real host for the recorded environment, and
   * creates nothing. A check that only looked at whether the fields were
   * non-empty would pass for a key with a typo in it, which is precisely the
   * failure somebody wants to catch here rather than at a customer's checkout.
   *
   * It cannot prove the webhook secret, because nothing but a real callback
   * can — that one is only tested by a payment going through.
   */
  async verifyCredentials({ config, mode = "SANDBOX" }) {
    const passport = await this.call({ url: `${this.baseUrl(mode)}/client/passport/v1/token`, config, body: {} });
    const token = typeof passport?.data === "string" ? passport.data : (passport?.data?.token ?? null);
    if (!token) throw new Error("Safepay accepted the key but returned no checkout token");

    return {
      ok: true,
      detail: `${mode === "LIVE" ? "Live" : "Sandbox"} keys accepted. The webhook secret is only proven by a real payment.`,
    };
  },

  /** Current state, for reconciling a payment whose callback never arrived. */
  async fetchStatus({ payment, config, mode = "SANDBOX" }) {
    const tracker = payment.providerOrderId;
    if (!tracker) return null;

    const result = await this.call({
      url: `${this.baseUrl(mode)}/reporter/api/v1/payments/${tracker}`,
      config,
      method: "GET",
    });

    return result?.data ?? null;
  },

  /**
   * One place that talks to Safepay.
   *
   * Their own documentation gives three different auth headers across three
   * pages — `X-SFPY-MERCHANT-SECRET` on checkout, `x-sfpy-api-key` on capture,
   * and a JWT on refunds. Rather than pick one from prose, both header names
   * are sent: they are read by Safepay, ignored if unexpected, and carry the
   * same value. The alternative is an integration that works on one endpoint
   * and 401s on another for reasons nobody can see.
   */
  async call({ url, config, body = null, method = null }) {
    const secret = config?.secretKey;
    if (!secret) throw new Error("Safepay is not configured for this branch: the API secret key is missing");

    const response = await fetch(url, {
      method: method ?? "POST",
      headers: {
        "content-type": "application/json",
        "x-sfpy-api-key": secret,
        "X-SFPY-MERCHANT-SECRET": secret,
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    if (!response.ok) {
      // The gateway's own message, trimmed. Never the request, which carried
      // the secret key in a header.
      const detail = parsed?.status?.message ?? parsed?.message ?? text.slice(0, 300);
      throw new Error(`Safepay refused this request (${response.status}): ${detail}`);
    }

    return parsed;
  },

  /**
   * Verifies a callback: HMAC-SHA512, hex, over the `data` value, with the
   * secret used as raw text.
   *
   * Established empirically. Safepay's docs sign `JSON.stringify(payload)`
   * while their own SDK signs `JSON.stringify(payload.data)`; brute-forcing 243
   * combinations against a real delivery matched the SDK, not the docs.
   *
   * Safepay signs a *re-serialised* object, which is normally the bug our
   * webhook route exists to avoid — a signature checked against re-encoded
   * JSON can pass when it should fail. So the received bytes are preferred:
   * the exact `data` substring is lifted out of the raw body and verified as
   * it arrived, which guarantees that what we verified and what we parse are
   * the same bytes.
   *
   * The re-serialised form is tried only as a fallback, for a proxy that
   * reformats the JSON in transit. That costs nothing: both candidates still
   * require the secret, so accepting either widens the encodings we tolerate
   * without widening who can forge one.
   */
  verifySignature({ rawBody, headers, config }) {
    const secret = config?.webhookSecret;
    if (!secret) return false;

    const signature = headers?.["x-sfpy-signature"] ?? headers?.get?.("x-sfpy-signature");
    if (!signature) return false;

    const text = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody ?? "").toString("utf8");

    // The whole body first: that is what a genuine payment event is signed
    // over, and verifying the bytes as received is the strongest form there is.
    const candidates = [text];

    // `data` alone, as the legacy test-button event is signed. Lifted from the
    // raw bytes rather than re-encoded, so what we verify is what we parse.
    const lifted = liftRawValue(text, "data");
    if (lifted != null) candidates.push(lifted);

    try {
      const parsed = JSON.parse(text);
      candidates.push(JSON.stringify(parsed));
      if (parsed?.data !== undefined) candidates.push(JSON.stringify(parsed.data));
    } catch {
      // Not JSON at all. The raw body is still a candidate.
    }

    return candidates.some((message) =>
      safeEqual(crypto.createHmac("sha512", secret).update(Buffer.from(message, "utf8")).digest("hex"), signature),
    );
  },

  /**
   * Normalises a callback into the shape the webhook service understands.
   *
   * Returns `outcome` rather than deciding anything: the service owns the state
   * machine. An event whose state we have never seen comes back without an
   * outcome, so an unfamiliar status can never mark an order paid — our webhook
   * route already answers 200 for events it does not understand, which is the
   * right behaviour for a gateway that adds a state we have not met yet.
   */
  parseEvent({ payload }) {
    if (!payload || typeof payload !== "object") return null;

    /*
     * Safepay sends two different envelopes, and they disagree about
     * everything that matters — including the units money is in.
     *
     *   genuine payment (version 2.0.0)   dashboard test button (legacy)
     *   ------------------------------    ------------------------------
     *   token: "evt_…" at the top         data.token: 20 uppercase chars
     *   type:  "payment.succeeded"        data.type: "payment:created"
     *   data.state: "TRACKER_ENDED"       data.notification.state: "PAID"
     *   data.amount: 15000  (INTEGER,     …notification.amount: "150"
     *                        paisa)                     (STRING, rupees)
     *
     * Both were captured from this account. Reading either one with the
     * other's rules misprices every payment by a factor of a hundred, in
     * opposite directions, so the shape is detected explicitly rather than
     * inferred from whichever field happens to be present.
     */
    const isLegacy = payload.data?.notification !== undefined || payload.data?.token !== undefined;
    return isLegacy ? parseLegacyEvent(payload) : parseVersionedEvent(payload);
  },
};

/**
 * PKR 150 -> 15000.
 *
 * Checkout wants an integer in the lowest denomination; the webhook sends
 * decimal strings in major units. Done with string arithmetic rather than
 * `* 100`, because the amount arrives as a Prisma Decimal and multiplying a
 * float by 100 is how 1.15 becomes 114.99999999999999.
 */
export function toMinorUnits(amount) {
  const [whole, fraction = ""] = String(amount).split(".");
  const paisa = (fraction + "00").slice(0, 2);
  return Number.parseInt(`${whole}${paisa}`, 10);
}

/**
 * Lifts the exact bytes of one top-level JSON value out of a raw body, without
 * parsing or re-encoding it.
 *
 * String-aware so a brace inside a string — a URL, a description — cannot end
 * the scan early. Returns null rather than guessing if the value does not
 * close, so a truncated body fails verification instead of verifying a
 * fragment.
 */
function liftRawValue(body, key) {
  const needle = `"${key}":`;
  const at = body.indexOf(needle);
  if (at === -1) return null;

  let index = at + needle.length;
  while (index < body.length && /\s/.test(body[index])) index += 1;

  const start = index;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; index < body.length; index += 1) {
    const char = body[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return body.slice(start, index + 1);
      if (depth < 0) return null;
    }
  }

  return null;
}

/**
 * The envelope a real payment produces. Money arrives as integers in paisa.
 */
function parseVersionedEvent(payload) {
  const data = payload.data;
  if (!payload.token || !data) return null;

  const state = String(data.state ?? "");

  return {
    eventId: String(payload.token),
    type: String(payload.type ?? ""),
    providerOrderId: data.tracker ?? null,
    providerPaymentId: data.tracker ?? null,
    // Converted to major units here, once. Every caller downstream works in
    // rupees, and a stray paisa value reaching the ledger would post a sale
    // at a hundred times its value.
    amount: fromMinorUnits(data.amount),
    feeAmount: fromMinorUnits(data.fee) ?? 0,
    netAmount: fromMinorUnits(data.net),
    currency: data.currency ?? null,
    orderReference: data.metadata?.order_id ?? null,
    intent: data.intent ?? null,
    state,
    outcome: outcomeFor(state),
    deliveryAttempts: null,
    failureCode: null,
    failureMessage: null,
  };
}

/**
 * The envelope the dashboard's test button sends. Money arrives as decimal
 * strings already in rupees, so it is passed through untouched — parsing it to
 * a Number would put binary floating point into a money path whose whole point
 * is Decimal arithmetic.
 */
function parseLegacyEvent(payload) {
  const data = payload.data;
  if (!data?.token || !data?.type) return null;

  const notification = data.notification ?? {};
  const state = String(notification.state ?? "");

  return {
    eventId: String(data.token),
    type: String(data.type),
    providerOrderId: notification.tracker ?? null,
    providerPaymentId: notification.tracker ?? null,
    amount: notification.amount ?? null,
    feeAmount: notification.fee ?? 0,
    netAmount: notification.net ?? null,
    currency: notification.currency ?? null,
    orderReference: notification.metadata?.order_id ?? null,
    intent: notification.intent ?? null,
    state,
    outcome: outcomeFor(state),
    deliveryAttempts: data.delivery_attempts ?? null,
    failureCode: null,
    failureMessage: null,
  };
}

function outcomeFor(state) {
  if (PAID_STATES.has(state)) return "CAPTURED";
  return REFUND_STATES.get(state) ?? null;
}

/**
 * 15000 paisa -> "150". String arithmetic, never division: `15000 / 100` is
 * fine, but `950 / 100` is 9.5 and `4925 / 100` is 49.25 only by luck of
 * binary representation, and the one that bites is the amount nobody checked.
 */
function fromMinorUnits(value) {
  if (value == null) return null;
  const digits = String(value).replace(/[^0-9-]/g, "");
  if (!digits) return null;

  const negative = digits.startsWith("-");
  const body = (negative ? digits.slice(1) : digits).padStart(3, "0");
  const whole = body.slice(0, -2).replace(/^0+(?=\d)/, "");
  const fraction = body.slice(-2).replace(/0+$/, "");

  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
