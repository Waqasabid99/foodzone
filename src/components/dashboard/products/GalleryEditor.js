"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import ImageField from "@/components/ui/ImageField";
import FormAlert from "@/components/ui/FormAlert";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import StoredImage from "@/components/ui/StoredImage";

const MAX_IMAGES = 12;

/**
 * Extra photos for the product page.
 *
 * The API replaces the whole gallery in one call, so this edits a local copy
 * and saves it once — reordering three photos is three clicks and one request,
 * not three half-saved states a customer might load in between.
 */
export default function GalleryEditor({ productId, images, productName, canUpload }) {
  const router = useRouter();
  const initial = images.map((image) => ({ url: image.url, altText: image.altText ?? "" }));
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(null);

  const dirty = JSON.stringify(items) !== JSON.stringify(initial);

  const move = (index, by) =>
    setItems((current) => {
      const next = [...current];
      [next[index], next[index + by]] = [next[index + by], next[index]];
      return next;
    });

  async function save() {
    setPending(true);
    setMessage(null);
    try {
      await api.put(`/admin/products/${productId}/images`, {
        images: items.map((item, index) => ({
          url: item.url,
          ...(item.altText.trim() ? { altText: item.altText.trim() } : {}),
          sortOrder: index,
        })),
      });
      toast.success("Gallery saved.");
      router.refresh();
    } catch (failure) {
      setMessage(failure?.message ?? "The gallery could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Section
      title="Gallery"
      description="More photos for the product page, in the order shown. The main photo is set in the details above."
    >
      <FormAlert>{message}</FormAlert>

      {items.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {items.map((item, index) => (
            <li key={`${item.url}-${index}`} className="flex gap-3 rounded-field bg-surface-container-low p-3">
              <StoredImage src={item.url} loading="eager" className="size-20 shrink-0 rounded-field object-cover" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label htmlFor={`alt-${index}`} className="text-label-bold text-on-surface">
                  Photo {index + 1} description
                </label>
                <input
                  id={`alt-${index}`}
                  value={item.altText}
                  maxLength={200}
                  placeholder={`e.g. ${productName} cut in half`}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((row, position) => (position === index ? { ...row, altText: event.target.value } : row)),
                    )
                  }
                  className="w-full rounded-field border border-transparent bg-surface-container-lowest px-3 py-2 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring"
                />
                <div className="flex gap-1">
                  <IconButton label={`Move photo ${index + 1} earlier`} icon={ArrowUp} disabled={index === 0} onClick={() => move(index, -1)} />
                  <IconButton label={`Move photo ${index + 1} later`} icon={ArrowDown} disabled={index === items.length - 1} onClick={() => move(index, 1)} />
                  <IconButton
                    label={`Remove photo ${index + 1}`}
                    icon={Trash2}
                    onClick={() => setItems((current) => current.filter((_, position) => position !== index))}
                  />
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-body-md text-on-surface-variant">No gallery photos yet.</p>
      )}

      {canUpload && items.length < MAX_IMAGES ? (
        <ImageField
          // Remounted after each add so the picker is always empty and ready.
          key={items.length}
          id="gallery-add"
          label="Add a photo"
          ownerType="Product"
          value=""
          onChange={(url) => url && setItems((current) => [...current, { url, altText: "" }])}
          hint={`Up to ${MAX_IMAGES} photos. Describe each one for people using screen readers.`}
        />
      ) : null}

      {dirty ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-field bg-primary-container px-5 py-2.5 text-label-bold text-on-primary-container disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {pending ? "Saving…" : "Save gallery"}
          </button>
          <button
            type="button"
            onClick={() => setItems(initial)}
            disabled={pending}
            className="rounded-field px-4 py-2.5 text-label-bold text-on-surface-variant hover:text-on-surface"
          >
            Discard changes
          </button>
          <p role="status" className="text-body-md text-on-surface-variant">
            Unsaved changes.
          </p>
        </div>
      ) : null}
    </Section>
  );
}

function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-35"
      {...props}
    >
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
