"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import SelectField from "@/components/ui/SelectField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";
import { combinedRate, taxGroupPayload, taxRatePayload } from "@/lib/finance";

const blankRate = { name: "", rate: "", accountId: "", region: "", isCompound: false, sortOrder: 0, isActive: true };

/**
 * Tax groups and the rates inside them.
 *
 * The combined rate is worked out and shown for every group, because that is
 * the number people think they are setting and it is not always the sum.
 * A compound rate is charged on the net *plus* everything added before it, so
 * 10% then 10% compound is 21%, not 20% — and a group that silently behaves
 * differently from what the screen implies gets found at an audit.
 *
 * Changing a rate here changes what every outlet charges, which is why it
 * needs a company-wide grant and why the warning is on the page rather than
 * only in the API's refusal.
 */
export default function TaxEditor({ groups, accounts, canManage }) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [newGroup, setNewGroup] = useState({ open: false, name: "", isInclusive: false });
  const [adding, setAdding] = useState({});

  async function run(key, work, success) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await work();
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const rateFor = (groupId) => adding[groupId] ?? blankRate;
  const setRate = (groupId, patch) => setAdding((state) => ({ ...state, [groupId]: { ...rateFor(groupId), ...patch } }));

  return (
    <div className="flex flex-col gap-5">
      <FormAlert>{error}</FormAlert>

      {canManage ? (
        <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
          A tax group is used by every branch. Changing a rate changes what every outlet charges from the next order
          onwards — it does not alter orders already placed.
        </p>
      ) : null}

      {groups.map((group) => {
        const combined = combinedRate(group.rates);
        const draft = rateFor(group.id);

        return (
          <section key={group.id} className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 font-display text-headline-md text-on-surface">
                  {group.name}
                  {group.isInclusive ? <Chip tone="bg-secondary-container text-on-secondary-container">Tax included in prices</Chip> : null}
                  {group.isActive ? null : <Chip>Inactive</Chip>}
                </h2>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {group.rates.length ? (
                    <>
                      Combined rate <span className="tabular-nums text-on-surface">{Number(combined)}%</span>
                      {group.rates.some((rate) => rate.isCompound) ? " — compounded, so not the sum of the rates below." : ""}
                    </>
                  ) : (
                    "No rates yet, so this group charges nothing."
                  )}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  Used by {group._count?.products ?? 0} {group._count?.products === 1 ? "product" : "products"} and{" "}
                  {group._count?.items ?? 0} inventory {group._count?.items === 1 ? "item" : "items"}.
                </p>
              </div>
            </div>

            {group.rates.length ? (
              <ul className="flex flex-col gap-2">
                {group.rates.map((rate) => (
                  <li key={rate.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                    <span className="min-w-0">
                      <span className="text-body-md text-on-surface">{rate.name}</span>
                      <span className="block text-label-bold font-normal text-on-surface-variant">
                        {Number(rate.rate)}%
                        {rate.isCompound ? " · compound, charged on the running total" : ""}
                        {rate.region ? ` · ${rate.region}` : ""}
                        {rate.isActive ? "" : " · inactive"}
                      </span>
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (!window.confirm(`Remove ${rate.name}? Orders already placed keep the tax they were charged.`)) return;
                          run(`del-${rate.id}`, () => api.delete(`/admin/tax-rates/${rate.id}`), "Removed.");
                        }}
                        aria-label={`Remove ${rate.name}`}
                        className="rounded-field p-2 text-on-surface-variant hover:bg-surface-container hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      >
                        <Trash2 aria-hidden="true" className="size-4" />
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}

            {canManage ? (
              <form
                className="flex flex-col gap-3 rounded-field bg-surface-container-low p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!draft.name.trim() || draft.rate === "") return;
                  run(
                    `add-${group.id}`,
                    async () => {
                      await api.post(`/admin/tax-groups/${group.id}/rates`, taxRatePayload({ ...draft, sortOrder: group.rates.length }));
                      setAdding((state) => ({ ...state, [group.id]: blankRate }));
                    },
                    "Rate added.",
                  );
                }}
              >
                <p className="text-label-bold text-on-surface">Add a rate to {group.name}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    id={`rate-name-${group.id}`}
                    label="Name"
                    value={draft.name}
                    onChange={(event) => setRate(group.id, { name: event.target.value })}
                    hint="What it is called on a receipt."
                    autoComplete="off"
                    required
                  />
                  <Field
                    id={`rate-value-${group.id}`}
                    label="Percent"
                    type="number"
                    step="0.0001"
                    min="0"
                    max="100"
                    value={draft.rate}
                    onChange={(event) => setRate(group.id, { rate: event.target.value })}
                    autoComplete="off"
                    required
                  />
                </div>
                <SelectField
                  id={`rate-account-${group.id}`}
                  label="Collected into"
                  value={draft.accountId}
                  onChange={(event) => setRate(group.id, { accountId: event.target.value })}
                  options={[{ value: "", label: "Not mapped" }, ...accounts.map((row) => ({ value: row.id, label: `${row.code} — ${row.name}` }))]}
                  hint="The liability account this tax is owed from. Without one it will not reach the books."
                />
                <label className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={draft.isCompound}
                    onChange={(event) => setRate(group.id, { isCompound: event.target.checked })}
                    className="mt-1 size-4 accent-primary"
                  />
                  <span className="text-body-md text-on-surface">
                    Compound
                    <span className="block text-on-surface-variant">
                      Charged on the net plus the rates above it, rather than on the net alone.
                    </span>
                  </span>
                </label>
                <button
                  type="submit"
                  disabled={Boolean(busy) || !draft.name.trim() || draft.rate === ""}
                  className="inline-flex w-fit items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <Plus aria-hidden="true" className="size-4" />
                  {busy === `add-${group.id}` ? "Adding…" : "Add the rate"}
                </button>
              </form>
            ) : null}
          </section>
        );
      })}

      {canManage ? (
        newGroup.open ? (
          <form
            className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5"
            onSubmit={(event) => {
              event.preventDefault();
              if (!newGroup.name.trim()) return;
              run(
                "new-group",
                async () => {
                  await api.post("/admin/tax-groups", taxGroupPayload(newGroup));
                  setNewGroup({ open: false, name: "", isInclusive: false });
                },
                "Group created.",
              );
            }}
          >
            <h2 className="font-display text-headline-md text-on-surface">New tax group</h2>
            <Field
              id="group-name"
              label="Name"
              value={newGroup.name}
              onChange={(event) => setNewGroup((state) => ({ ...state, name: event.target.value }))}
              hint="Products point at a group, not at individual rates."
              autoComplete="off"
              required
            />
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={newGroup.isInclusive}
                onChange={(event) => setNewGroup((state) => ({ ...state, isInclusive: event.target.checked }))}
                className="mt-1 size-4 accent-primary"
              />
              <span className="text-body-md text-on-surface">
                Prices already include this tax
                <span className="block text-on-surface-variant">
                  Usual for a restaurant menu. With this off, the tax is added on top at checkout — which customers
                  notice.
                </span>
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={Boolean(busy) || !newGroup.name.trim()}
                className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {busy === "new-group" ? "Creating…" : "Create it"}
              </button>
              <button
                type="button"
                onClick={() => setNewGroup({ open: false, name: "", isInclusive: false })}
                className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest"
              >
                Not now
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNewGroup((state) => ({ ...state, open: true }))}
            className="inline-flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-4" />
            New tax group
          </button>
        )
      ) : null}
    </div>
  );
}
