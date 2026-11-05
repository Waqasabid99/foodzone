"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, Info, Plus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toFormErrors } from "@/lib/form-errors";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { IconButton, RowButton } from "@/components/dashboard/menus/controls";

/**
 * The headings a menu is read under — "Starters", "Mains", "Drinks".
 *
 * Deleting a section never deletes what is in it: its products move to the
 * unsectioned group, which customers see under "More". Switching a section off
 * hides its products, and the health notice says so.
 */
export default function MenuSectionsEditor({ menuId, sections, productCounts, unsectioned = 0, canEdit }) {
  const router = useRouter();
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (success) toast.success(success);
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "That change could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const move = (index, by) =>
    run(() => {
      const next = [...sections];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return api.post(`/admin/menus/${menuId}/sections/reorder`, { items: next.map((section, position) => ({ id: section.id, sortOrder: position })) });
    });

  return (
    <Section title="Sections" description="Headings customers browse the menu by. Products with no section show last, under “More”.">
      {/*
       * Said at the moment it is true, not only in the description above.
       *
       * Sections are the easiest step in the whole setup to skip: nothing asks
       * for them, and a menu without them is not broken — it just arrives on
       * the storefront as one heading called "More" with everything under it,
       * which reads as a styling fault rather than a missing step. The notice
       * only appears while that is actually the case.
       */}
      {unsectioned > 0 ? (
        <p
          className={`flex items-start gap-2 rounded-field px-4 py-3 text-body-md ${
            sections.length ? "bg-surface-container-low text-on-surface" : "bg-warning-container text-on-warning-container"
          }`}
        >
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {sections.length ? (
              <>
                {unsectioned} {unsectioned === 1 ? "item is" : "items are"} not under a heading yet, so{" "}
                {unsectioned === 1 ? "it shows" : "they show"} last under “More”. Set each one&rsquo;s section in the
                list below.
              </>
            ) : (
              <>
                This menu has no headings, so customers see all {unsectioned}{" "}
                {unsectioned === 1 ? "item" : "items"} in one group called “More”. Add a heading for each part of the
                menu — Pizza, Burgers, Drinks — then file the items under them.
              </>
            )}
          </span>
        </p>
      ) : null}

      <FormAlert>{message}</FormAlert>
      {sections.length ? (
        <ul className="flex flex-col gap-2">
          {sections.map((section, index) =>
            editing === section.id ? (
              <li key={section.id}>
                <SectionForm menuId={menuId} section={section} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={section.id} className={`flex flex-wrap items-center gap-3 rounded-field bg-surface-container-low p-3 ${section.isActive ? "" : "opacity-75"}`}>
                {canEdit ? (
                  <div className="flex flex-col">
                    <IconButton label={`Move ${section.name} up`} icon={ArrowUp} disabled={busy || index === 0} onClick={() => move(index, -1)} />
                    <IconButton label={`Move ${section.name} down`} icon={ArrowDown} disabled={busy || index === sections.length - 1} onClick={() => move(index, 1)} />
                  </div>
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-label-bold text-on-surface">
                    {section.name}
                    {!section.isActive ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-on-surface-variant">Off</span> : null}
                  </p>
                  <p className="text-body-md text-on-surface-variant">
                    {productCounts[section.id] ?? 0} {(productCounts[section.id] ?? 0) === 1 ? "product" : "products"}
                  </p>
                </div>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    <RowButton disabled={busy} onClick={() => setEditing(section.id)}>Rename</RowButton>
                    <RowButton
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => api.patch(`/admin/menus/${menuId}/sections/${section.id}`, { isActive: !section.isActive }),
                          section.isActive ? `${section.name} switched off.` : `${section.name} switched on.`,
                        )
                      }
                    >
                      {section.isActive ? "Switch off" : "Switch on"}
                    </RowButton>
                    <RowButton
                      tone="danger"
                      disabled={busy}
                      onClick={() => {
                        const count = productCounts[section.id] ?? 0;
                        const detail = count ? ` Its ${count} ${count === 1 ? "product stays" : "products stay"} on the menu, under “More”.` : "";
                        if (!window.confirm(`Delete the section "${section.name}"?${detail}`)) return;
                        run(() => api.delete(`/admin/menus/${menuId}/sections/${section.id}`), `${section.name} deleted.`);
                      }}
                    >
                      Delete
                    </RowButton>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No sections yet. Everything shows under one heading.</p>
      )}

      {canEdit ? (
        editing === "new" ? (
          <SectionForm menuId={menuId} onDone={() => setEditing(null)} />
        ) : (
          <button type="button" onClick={() => setEditing("new")} className="inline-flex w-fit items-center gap-2 rounded-field px-3 py-2 text-label-bold text-primary hover:underline">
            <Plus aria-hidden="true" className="size-4" />
            Add a section
          </button>
        )
      ) : null}
    </Section>
  );
}

function SectionForm({ menuId, section = null, onDone }) {
  const router = useRouter();
  const creating = !section;
  const [name, setName] = useState(section?.name ?? "");
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (pending) return;
    const value = name.trim();
    if (!value) return setError("Give the section a name.");
    if (value.length > 120) return setError("Keep it under 120 characters.");
    setPending(true);
    setError(null);
    setFormError(null);
    try {
      if (creating) await api.post(`/admin/menus/${menuId}/sections`, { name: value });
      else await api.patch(`/admin/menus/${menuId}/sections/${section.id}`, { name: value });
      toast.success(creating ? `${value} added.` : `${value} saved.`);
      onDone();
      router.refresh();
    } catch (failure) {
      const mapped = toFormErrors(failure, { fields: ["name"] });
      setError(mapped.fieldErrors.name ?? null);
      setFormError(mapped.formError);
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label={creating ? "New section" : `Rename ${section.name}`} className="flex flex-col gap-4 rounded-field border border-outline-variant p-4">
      <FormAlert>{formError}</FormAlert>
      <Field id={`section-name-${section?.id ?? "new"}`} label="Section name" autoFocus placeholder="e.g. Mains" value={name} onChange={(event) => setName(event.target.value)} error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {pending ? "Saving…" : creating ? "Add section" : "Save"}
        </button>
        <button type="button" onClick={onDone} className="rounded-field px-5 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
      </div>
    </form>
  );
}
