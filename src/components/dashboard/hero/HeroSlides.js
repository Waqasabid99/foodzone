"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import Field from "@/components/ui/Field";
import ArtworkField from "@/components/dashboard/hero/ArtworkField";
import FormAlert from "@/components/ui/FormAlert";
import Chip from "@/components/dashboard/inventory/Chip";
import { dateLabel } from "@/lib/finance";

/**
 * The home page's front window.
 *
 * Edited in place rather than through a detail page per slide: there are three
 * or four of these, somebody is usually reordering them or switching one off
 * rather than writing a new one, and a round trip to another screen for a
 * checkbox is the wrong shape for that. Rewriting one opens the same form the
 * banner was written in, in the row it belongs to, so the list stays the one
 * place this is done.
 *
 * **Every slide says what it is doing right now.** "Active" is not the same as
 * "showing" — a slide can be switched on and still be outside its campaign
 * window, which is the single most confusing state here and the one somebody
 * will report as a bug. So the row says `Live`, `Scheduled`, `Finished` or
 * `Off`, worked out from the same comparison the storefront makes.
 */
const BLANK = {
  headline: "",
  subtext: "",
  imageUrl: null,
  focalPoint: "CENTER",
  ctaHref: "/menu",
  ctaLabel: "Order now",
  startsAt: "",
  endsAt: "",
};

/** The same question the storefront asks, in the words an editor needs. */
function slideState(slide, now = new Date()) {
  if (!slide.isActive) return { label: "Off", tone: "bg-surface-container-high text-on-surface-variant" };
  if (slide.startsAt && new Date(slide.startsAt) > now) {
    return { label: "Scheduled", tone: "bg-secondary-container text-on-secondary-container" };
  }
  if (slide.endsAt && new Date(slide.endsAt) <= now) {
    return { label: "Finished", tone: "bg-surface-container-high text-on-surface-variant" };
  }
  return { label: "Live", tone: "bg-success-container text-on-success-container" };
}

/**
 * A stored instant, in the shape `datetime-local` will accept.
 *
 * Deliberately local rather than the ISO string the API returns: an editor in
 * Karachi scheduling a banner for 9am means 9am where the shop is, and feeding
 * the input a UTC string shows them a time nobody chose.
 */
function localInput(value) {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** A slide as the form holds it: dates as local strings, nothing undefined. */
function toDraft(slide) {
  return {
    headline: slide.headline ?? "",
    subtext: slide.subtext ?? "",
    imageUrl: slide.imageUrl ?? null,
    focalPoint: slide.focalPoint ?? "CENTER",
    ctaHref: slide.ctaHref ?? "/menu",
    ctaLabel: slide.ctaLabel ?? "Order now",
    startsAt: localInput(slide.startsAt),
    endsAt: localInput(slide.endsAt),
  };
}

function payload(form) {
  return {
    headline: form.headline.trim(),
    subtext: form.subtext.trim() || null,
    imageUrl: form.imageUrl || null,
    focalPoint: form.focalPoint,
    ctaHref: form.ctaHref.trim(),
    ctaLabel: form.ctaLabel.trim(),
    // Empty means "no bound", which is null rather than an empty string the
    // server would have to interpret.
    startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
    endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
  };
}

/**
 * One form for both jobs.
 *
 * Writing a banner and rewriting one ask for exactly the same seven answers,
 * and keeping a second copy for the edit case is how the two drift until a
 * field can be set on creation and never changed again. The draft lives here
 * rather than in the list so that opening a row starts from that row's values
 * and cancelling leaves nothing behind.
 */
function SlideForm({ title, initial, submitLabel, busyLabel, busy, onSubmit, onCancel, idPrefix }) {
  const [draft, setDraft] = useState(initial);
  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(payload(draft));
      }}
      className="flex w-full flex-col gap-4 rounded-card bg-surface-container-low p-5"
    >
      <h2 className="font-display text-headline-md text-on-surface">{title}</h2>

      <Field
        id={`${idPrefix}-headline`}
        label="Headline"
        value={draft.headline}
        onChange={(event) => set({ headline: event.target.value })}
        required
      />
      <Field
        id={`${idPrefix}-subtext`}
        label="Supporting line"
        value={draft.subtext}
        onChange={(event) => set({ subtext: event.target.value })}
        hint="Optional. One sentence under the headline."
      />

      <ArtworkField
        idPrefix={idPrefix}
        value={draft.imageUrl}
        focalPoint={draft.focalPoint}
        onChange={(url) => set({ imageUrl: url })}
        onFocalPointChange={(focalPoint) => set({ focalPoint })}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-cta-label`}
          label="Button"
          value={draft.ctaLabel}
          onChange={(event) => set({ ctaLabel: event.target.value })}
          required
        />
        <Field
          id={`${idPrefix}-cta-href`}
          label="Button goes to"
          value={draft.ctaHref}
          onChange={(event) => set({ ctaHref: event.target.value })}
          hint="A page on this site, like /menu or /menu/zinger-burger."
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${idPrefix}-starts`}
          label="Starts"
          type="datetime-local"
          value={draft.startsAt}
          onChange={(event) => set({ startsAt: event.target.value })}
          hint="Optional. Empty means it is live as soon as it is switched on."
        />
        <Field
          id={`${idPrefix}-ends`}
          label="Ends"
          type="datetime-local"
          value={draft.endsAt}
          onChange={(event) => set({ endsAt: event.target.value })}
          hint="Optional. Empty means it runs until somebody stops it."
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={busy !== null || !draft.headline.trim()}
          className="rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {busy === idPrefix ? busyLabel : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function HeroSlides({ slides, canManage, timeZone = "UTC" }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function run(key, work, success) {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await work();
      if (success) toast.success(success);
      router.refresh();
      return true;
    } catch (failure) {
      setError(failure?.message ?? "That did not work.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  /**
   * Moving a slide swaps its `sortOrder` with its neighbour's.
   *
   * Two writes rather than renumbering the list, because renumbering means
   * every slide changes every time anybody nudges one, and the audit log then
   * says four things happened when one did.
   */
  async function move(index, delta) {
    const slide = slides[index];
    const other = slides[index + delta];
    if (!other) return;

    await run(
      `move:${slide.id}`,
      async () => {
        await api.patch(`/admin/hero-slides/${slide.id}`, { sortOrder: other.sortOrder });
        await api.patch(`/admin/hero-slides/${other.id}`, { sortOrder: slide.sortOrder });
      },
      null,
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <FormAlert>{error}</FormAlert>

      {slides.length === 0 && !adding ? (
        <p className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant">
          No banners yet. Until one is live the home page shows its standard opening — nothing is broken without
          these, they are what replaces it.
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {slides.map((slide, index) => {
          const state = slideState(slide);

          if (canManage && editingId === slide.id) {
            return (
              <li key={slide.id} className="flex">
                <SlideForm
                  // Keyed by the row so switching straight from one banner to
                  // another re-seeds the draft instead of keeping the first.
                  key={slide.id}
                  idPrefix="hero-edit"
                  title={`Editing “${slide.headline}”`}
                  initial={toDraft(slide)}
                  submitLabel="Save changes"
                  busyLabel="Saving…"
                  busy={busy}
                  onCancel={() => setEditingId(null)}
                  onSubmit={async (body) => {
                    const done = await run(
                      "hero-edit",
                      () => api.patch(`/admin/hero-slides/${slide.id}`, body),
                      "Saved.",
                    );
                    if (done) setEditingId(null);
                  }}
                />
              </li>
            );
          }

          return (
            <li key={slide.id} className="flex flex-wrap items-start gap-4 rounded-card bg-surface-container-lowest p-5">
              {slide.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slide.imageUrl} alt="" className="h-20 w-32 shrink-0 rounded-field object-cover" />
              ) : (
                <span
                  aria-hidden="true"
                  className="grid h-20 w-32 shrink-0 place-items-center rounded-field bg-surface-container-high text-label-bold font-normal text-on-surface-variant"
                >
                  No image
                </span>
              )}

              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-label-bold text-on-surface">{slide.headline}</span>
                  <Chip tone={state.tone}>{state.label}</Chip>
                </p>
                {slide.subtext ? (
                  <p className="mt-1 text-body-md text-on-surface-variant">{slide.subtext}</p>
                ) : null}
                <p className="mt-1 text-label-bold font-normal text-on-surface-variant">
                  {slide.ctaLabel} → {slide.ctaHref}
                  {slide.startsAt ? ` · from ${dateLabel(slide.startsAt, timeZone)}` : ""}
                  {slide.endsAt ? ` · until ${dateLabel(slide.endsAt, timeZone)}` : ""}
                </p>
              </div>

              {canManage ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0 || busy !== null}
                    aria-label={`Move "${slide.headline}" up`}
                    className="grid size-9 place-items-center rounded-field bg-surface-container-high text-on-surface hover:bg-surface-container-highest disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <ArrowUp aria-hidden="true" className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === slides.length - 1 || busy !== null}
                    aria-label={`Move "${slide.headline}" down`}
                    className="grid size-9 place-items-center rounded-field bg-surface-container-high text-on-surface hover:bg-surface-container-highest disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <ArrowDown aria-hidden="true" className="size-4" />
                  </button>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                      setEditingId(slide.id);
                    }}
                    aria-label={`Edit "${slide.headline}"`}
                    className="grid size-9 place-items-center rounded-field bg-surface-container-high text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Pencil aria-hidden="true" className="size-4" />
                  </button>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      run(
                        `toggle:${slide.id}`,
                        () => api.patch(`/admin/hero-slides/${slide.id}`, { isActive: !slide.isActive }),
                        slide.isActive ? "Switched off." : "Switched on.",
                      )
                    }
                    className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    {slide.isActive ? "Switch off" : "Switch on"}
                  </button>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => {
                      if (!window.confirm(`Remove "${slide.headline}" from the home page?`)) return;
                      run(`del:${slide.id}`, () => api.delete(`/admin/hero-slides/${slide.id}`), "Removed.");
                    }}
                    aria-label={`Remove "${slide.headline}"`}
                    className="grid size-9 place-items-center rounded-field bg-surface-container-high text-on-surface hover:bg-error-container hover:text-on-error-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canManage ? (
        adding ? (
          <SlideForm
            idPrefix="hero-new"
            title="A new banner"
            initial={BLANK}
            submitLabel="Add it"
            busyLabel="Adding…"
            busy={busy}
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => {
              const done = await run(
                "hero-new",
                () => api.post("/admin/hero-slides", { ...body, sortOrder: slides.length }),
                "Added.",
              );
              if (done) setAdding(false);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setError(null);
              setAdding(true);
            }}
            className="flex w-fit items-center gap-2 rounded-field bg-surface-container-high px-5 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add a banner
          </button>
        )
      ) : null}
    </div>
  );
}
