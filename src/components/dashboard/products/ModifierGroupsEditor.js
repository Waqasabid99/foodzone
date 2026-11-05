"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";

/**
 * The choices a customer makes when ordering this product — "Add cheese",
 * "Choose a sauce".
 *
 * Groups are shared across products and built on the Modifiers page; this only
 * attaches them. The group's own pick rules apply, and "Required" is the one
 * per-product decision worth making here: the same "Choose a sauce" group can
 * be mandatory on wings and optional on fries.
 */
export default function ModifierGroupsEditor({ productId, attached, available, canEdit, canManageGroups }) {
  const router = useRouter();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const attachedIds = new Set(attached.map((group) => group.id));
  const attachable = available.filter((group) => !attachedIds.has(group.id));

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const rules = (group) => {
    if (group.selectionType === "SINGLE") return group.minSelect > 0 ? "Pick one" : "Pick up to one";
    if (group.minSelect > 0) return `Pick ${group.minSelect}–${group.maxSelect}`;
    return `Pick up to ${group.maxSelect}`;
  };

  return (
    <Section title="Options" description="Choices customers make when they order this, like extras or a sauce.">
      <FormAlert>{message}</FormAlert>

      {attached.length ? (
        <ul className="flex flex-col gap-3">
          {attached.map((group) => (
            <li key={group.id} className="flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-4">
              <div className="min-w-0 flex-1">
                <p className="text-label-bold text-on-surface">
                  {group.name}
                  {!group.isActive ? <span className="font-normal text-on-surface-variant"> · switched off</span> : null}
                </p>
                <p className="text-body-md text-on-surface-variant">
                  {rules(group)} · {group.options?.length ?? 0} {group.options?.length === 1 ? "choice" : "choices"}
                </p>
              </div>
              {canEdit ? (
                <>
                  <label className="flex items-center gap-2 text-body-md text-on-surface">
                    <input
                      type="checkbox"
                      checked={group.isRequired}
                      disabled={busy}
                      onChange={(event) =>
                        run(
                          () =>
                            api.patch(`/admin/products/${productId}/modifier-groups/${group.id}`, {
                              isRequired: event.target.checked,
                            }),
                          event.target.checked ? `${group.name} is now required.` : `${group.name} is now optional.`,
                        )
                      }
                      className="size-4 accent-primary"
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => api.delete(`/admin/products/${productId}/modifier-groups/${group.id}`),
                        `${group.name} removed.`,
                      )
                    }
                    className="rounded-field px-3 py-2 text-label-bold text-error hover:bg-surface-container disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    Remove
                  </button>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No options — customers order it as it comes.</p>
      )}

      {canEdit ? (
        available.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">
            No option groups exist yet.{" "}
            {canManageGroups ? (
              <Link href="/dashboard/modifiers" className="text-label-bold text-primary hover:underline">
                Create them on the Modifiers page.
              </Link>
            ) : null}
          </p>
        ) : attachable.length ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <label htmlFor="attach-group" className="text-label-bold text-on-surface">
                Add an option group
              </label>
              <select
                id="attach-group"
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
                className="rounded-field border border-transparent bg-surface-container-low px-3 py-2.5 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
              >
                <option value="">Choose a group</option>
                {attachable.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                    {group.internalName ? ` (${group.internalName})` : ""}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              disabled={!choice || busy}
              onClick={() => {
                const group = attachable.find((row) => row.id === choice);
                run(
                  () => api.post(`/admin/products/${productId}/modifier-groups`, { groupId: choice, sortOrder: attached.length }),
                  `${group?.name ?? "Group"} added.`,
                ).then(() => setChoice(""));
              }}
              className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Add
            </button>
          </div>
        ) : null
      ) : null}
    </Section>
  );
}
