"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import FormAlert from "@/components/ui/FormAlert";
import { parseProse } from "@/lib/prose";

/**
 * Editing the words on a public page.
 *
 * A textarea and a live preview, not an editor. The person using this is
 * correcting a phone number or a refund window a few times a year, and every
 * richer option costs them a thing to learn while buying them nothing.
 *
 * **The preview renders through the same parser the page does.** Two
 * implementations of "what does `## ` mean" is how a preview starts lying, and
 * a preview that lies is worse than no preview — it is the thing people trust
 * instead of looking.
 *
 * The slug is shown and not editable: it is half of a route, and renaming it
 * breaks every link already printed on a menu or sitting in an email footer.
 */
export default function PageEditor({ page, canEdit }) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: page.title ?? "",
    summary: page.summary ?? "",
    body: page.body ?? "",
    isPublished: page.isPublished,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const set = (key) => (event) => setForm((state) => ({ ...state, [key]: event.target.value }));

  const blocks = useMemo(() => parseProse(form.body), [form.body]);

  const changed =
    form.title !== (page.title ?? "") ||
    form.summary !== (page.summary ?? "") ||
    form.body !== (page.body ?? "") ||
    form.isPublished !== page.isPublished;

  const problems = [];
  if (!form.title.trim()) problems.push("A page needs a title.");
  if (!form.body.trim()) problems.push("A page needs something on it.");

  async function save(event) {
    event.preventDefault();
    if (pending || !changed || problems.length) return;

    setPending(true);
    setError(null);

    try {
      await api.patch(`/admin/content-pages/${page.id}`, {
        title: form.title.trim(),
        // Empty means "work it out from the first paragraph", which is null to
        // the server rather than an empty string it would have to interpret.
        summary: form.summary.trim() || null,
        body: form.body,
        isPublished: form.isPublished,
      });

      toast.success("Saved. The page is live.");
      router.refresh();
    } catch (failure) {
      setError(failure?.message ?? "That did not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-6">
      <FormAlert>{error}</FormAlert>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Field
            id="page-title"
            label="Title"
            value={form.title}
            onChange={set("title")}
            disabled={!canEdit}
            required
          />

          <Field
            id="page-summary"
            label="Search description"
            value={form.summary}
            onChange={set("summary")}
            disabled={!canEdit}
            hint="One line, shown in search results. Left empty, the first paragraph is used."
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="page-body" className="text-label-bold text-on-surface">
              The page
            </label>
            <textarea
              id="page-body"
              rows={22}
              value={form.body}
              onChange={set("body")}
              disabled={!canEdit}
              className="rounded-field border border-outline-variant bg-surface-container-lowest px-4 py-3 font-mono text-body-md text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60"
            />
            <p className="text-body-md text-on-surface-variant">
              Leave a blank line between paragraphs. Start a line with{" "}
              <code className="rounded bg-surface-container-high px-1">##</code> to make it a heading. That is
              everything — there is no other formatting, so nothing you type here can break the page.
            </p>
          </div>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={form.isPublished}
              disabled={!canEdit}
              onChange={(event) => setForm((state) => ({ ...state, isPublished: event.target.checked }))}
              className="size-4 accent-primary"
            />
            <span className="text-body-md text-on-surface">
              Visible to customers
              <span className="block text-body-md text-on-surface-variant">
                Unticked, /{page.slug} is not found rather than blank.
              </span>
            </span>
          </label>
        </div>

        {/* Through the same parser the real page uses, so this cannot drift
            into telling a comfortable lie about what will be published. */}
        <div className="flex flex-col gap-3">
          <p className="text-label-bold uppercase tracking-widest text-on-surface-variant">How it will read</p>

          <div className="rounded-card bg-surface-container-lowest p-6">
            <h2 className="font-display text-headline-md text-on-surface">{form.title || "Untitled"}</h2>

            <div className="mt-5 flex flex-col gap-4">
              {blocks.length ? (
                blocks.map((block, index) =>
                  block.type === "heading" ? (
                    <h3 key={index} className="mt-2 font-display text-headline-md text-on-surface">
                      {block.text}
                    </h3>
                  ) : (
                    <p key={index} className="text-body-md text-on-surface-variant">
                      {block.text}
                    </p>
                  ),
                )
              ) : (
                <p className="text-body-md text-on-surface-variant">Nothing on the page yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {problems.length ? (
        <ul className="flex flex-col gap-1">
          {problems.map((problem) => (
            <li key={problem} className="text-body-md text-error">
              {problem}
            </li>
          ))}
        </ul>
      ) : null}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={pending || !changed || problems.length > 0}
            className="rounded-field bg-primary px-6 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {changed ? <span className="text-body-md text-on-surface-variant">Unsaved changes.</span> : null}
        </div>
      ) : (
        <p className="text-body-md text-on-surface-variant">You can read this page but not change it.</p>
      )}
    </form>
  );
}
