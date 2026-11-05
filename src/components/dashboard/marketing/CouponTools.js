"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import { codeExample, couponPayload, isHardToRead, normaliseCode } from "@/lib/marketing";

/**
 * Making codes: one by hand, or ten thousand at once.
 *
 * Two deliberate frictions.
 *
 * **Bulk generation names its batch.** Without a campaign tag there is no way
 * to revoke a print run later except one code at a time, and the moment you
 * need that is the moment the codes have leaked. The field is pre-filled
 * rather than optional.
 *
 * **Ambiguous characters are flagged, not forbidden.** `O` and `0`, `I` and
 * `1` are fine on a screen and indistinguishable on a flyer read over a
 * phone. Plenty of good codes contain them, so this is a warning — but it is
 * shown before ten thousand are printed rather than after the support calls
 * start.
 */
export default function CouponTools({ promotions, defaultPromotionId = "", canCreate, canGenerate }) {
  const router = useRouter();
  const [mode, setMode] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [made, setMade] = useState(null);

  const [single, setSingle] = useState({
    code: "",
    promotionId: defaultPromotionId,
    maxRedemptions: "",
    maxRedemptionsPerUser: "1",
    expiresAt: "",
    campaign: "",
  });

  const [bulk, setBulk] = useState({
    promotionId: defaultPromotionId,
    count: "100",
    prefix: "",
    length: "8",
    campaign: `batch-${new Date().toISOString().slice(0, 10)}`,
    maxRedemptions: "1",
    expiresAt: "",
  });

  const promotionChoices = promotions.map((promotion) => ({
    value: promotion.id,
    label: `${promotion.name}${promotion.requiresCoupon ? "" : " — applies automatically, a code adds nothing"}`,
  }));

  async function createOne(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const coupon = await api.post("/admin/coupons", couponPayload(single));
      toast.success(`${coupon.code} created.`);
      setSingle((state) => ({ ...state, code: "" }));
      setMode(null);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  async function generate(event) {
    event.preventDefault();
    if (pending) return;

    const count = Number(bulk.count);
    if (!bulk.campaign.trim()) {
      setError("Name the batch. Without it these codes cannot be revoked together later.");
      return;
    }
    if (!window.confirm(`Generate ${count} codes for this offer? They become usable immediately.`)) return;

    setPending(true);
    setError(null);
    try {
      const result = await api.post("/admin/coupons/generate", {
        promotionId: bulk.promotionId,
        count,
        prefix: normaliseCode(bulk.prefix) || undefined,
        length: Number(bulk.length),
        campaign: bulk.campaign.trim(),
        ...(bulk.maxRedemptions ? { maxRedemptions: Number(bulk.maxRedemptions) } : {}),
        ...(bulk.expiresAt ? { expiresAt: bulk.expiresAt } : {}),
      });
      setMade(result);
      toast.success(`${result.created ?? count} codes generated.`);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setPending(false);
    }
  }

  if (!canCreate && !canGenerate) return null;

  const example = codeExample(bulk.prefix, bulk.length);

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {made ? (
        <p role="status" className="rounded-card bg-success-container px-5 py-4 text-body-md text-on-success-container">
          {made.created ?? "The"} codes are live under the batch <span className="font-mono">{made.campaign}</span>.
          They can all be revoked together from the campaign filter.
        </p>
      ) : null}

      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {canCreate ? (
            <button
              type="button"
              onClick={() => setMode("single")}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Make one code
            </button>
          ) : null}
          {canGenerate ? (
            <button
              type="button"
              onClick={() => setMode("bulk")}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Generate a batch
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === "single" ? (
        <form onSubmit={createOne} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">One code</h2>

          <SelectField
            id="coupon-promotion"
            label="Unlocks"
            value={single.promotionId}
            onChange={(event) => setSingle((state) => ({ ...state, promotionId: event.target.value }))}
            options={[{ value: "", label: "Choose an offer" }, ...promotionChoices]}
            hint="The offer this code turns on."
            required
          />

          <Field
            id="coupon-code"
            label="Code"
            value={single.code}
            onChange={(event) => setSingle((state) => ({ ...state, code: event.target.value }))}
            hint={
              isHardToRead(single.code)
                ? "Contains characters that look alike on paper (O/0, I/1/L). Fine on screen, awkward read aloud."
                : "Upper-cased automatically. Letters, numbers, dashes and underscores."
            }
            autoComplete="off"
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="coupon-max"
              label="Total redemptions"
              type="number"
              min="1"
              value={single.maxRedemptions}
              onChange={(event) => setSingle((state) => ({ ...state, maxRedemptions: event.target.value }))}
              hint="Empty means unlimited."
              autoComplete="off"
            />
            <Field
              id="coupon-max-per"
              label="Per customer"
              type="number"
              min="1"
              value={single.maxRedemptionsPerUser}
              onChange={(event) => setSingle((state) => ({ ...state, maxRedemptionsPerUser: event.target.value }))}
              autoComplete="off"
            />
            <Field
              id="coupon-expires"
              label="Expires"
              type="date"
              value={single.expiresAt}
              onChange={(event) => setSingle((state) => ({ ...state, expiresAt: event.target.value }))}
            />
            <Field
              id="coupon-campaign"
              label="Batch name"
              value={single.campaign}
              onChange={(event) => setSingle((state) => ({ ...state, campaign: event.target.value }))}
              hint="Optional here, and what lets a group be revoked together later."
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || !single.code.trim() || !single.promotionId}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {pending ? "Creating…" : "Create it"}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Not now
            </button>
          </div>
        </form>
      ) : null}

      {mode === "bulk" ? (
        <form onSubmit={generate} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">A batch of codes</h2>

          <SelectField
            id="bulk-promotion"
            label="Unlocks"
            value={bulk.promotionId}
            onChange={(event) => setBulk((state) => ({ ...state, promotionId: event.target.value }))}
            options={[{ value: "", label: "Choose an offer" }, ...promotionChoices]}
            required
          />

          <div className="grid gap-4 sm:grid-cols-3">
            <Field
              id="bulk-count"
              label="How many"
              type="number"
              min="1"
              max="10000"
              value={bulk.count}
              onChange={(event) => setBulk((state) => ({ ...state, count: event.target.value }))}
              autoComplete="off"
              required
            />
            <Field
              id="bulk-prefix"
              label="Prefix"
              value={bulk.prefix}
              onChange={(event) => setBulk((state) => ({ ...state, prefix: event.target.value }))}
              hint="Optional."
              autoComplete="off"
            />
            <Field
              id="bulk-length"
              label="Random characters"
              type="number"
              min="4"
              max="24"
              value={bulk.length}
              onChange={(event) => setBulk((state) => ({ ...state, length: event.target.value }))}
              autoComplete="off"
            />
          </div>

          <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface" aria-live="polite">
            They will look like <span className="font-mono">{example}</span>
            {Number(bulk.length) < 6 ? (
              <span className="mt-1 block text-on-surface-variant">
                Short codes are easy to guess. At this length somebody can find a working one by trying.
              </span>
            ) : null}
          </p>

          <Field
            id="bulk-campaign"
            label="Batch name"
            value={bulk.campaign}
            onChange={(event) => setBulk((state) => ({ ...state, campaign: event.target.value }))}
            hint="Required. It is the only way to revoke this run as a group if the codes get out."
            autoComplete="off"
            required
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="bulk-max"
              label="Redemptions per code"
              type="number"
              min="1"
              value={bulk.maxRedemptions}
              onChange={(event) => setBulk((state) => ({ ...state, maxRedemptions: event.target.value }))}
              autoComplete="off"
            />
            <Field
              id="bulk-expires"
              label="Expires"
              type="date"
              value={bulk.expiresAt}
              onChange={(event) => setBulk((state) => ({ ...state, expiresAt: event.target.value }))}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={pending || !bulk.promotionId || !bulk.campaign.trim()}
              className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {pending ? "Generating…" : `Generate ${bulk.count || 0} codes`}
            </button>
            <button
              type="button"
              onClick={() => setMode(null)}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
            >
              Not now
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
