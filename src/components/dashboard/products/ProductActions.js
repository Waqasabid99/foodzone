"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Eye, EyeOff, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";

const button =
  "inline-flex items-center gap-2 rounded-field px-4 py-2.5 text-label-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/** Publish or unpublish. Its own permission, so it is its own control. */
export function PublishButton({ productId, isActive }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function toggle() {
    setPending(true);
    try {
      await api.put(`/admin/products/${productId}/publish`, { isActive: !isActive });
      toast.success(isActive ? "Unpublished — customers can no longer see it." : "Published.");
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`${button} ${
        isActive
          ? "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"
          : "bg-primary-container font-display uppercase tracking-wide text-on-primary-container hover:shadow-e2"
      }`}
    >
      {isActive ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
      {pending ? "Saving…" : isActive ? "Unpublish" : "Publish"}
    </button>
  );
}

/**
 * Delete, or restore a deleted product.
 *
 * The confirmation names the consequence people do not expect: deleting takes
 * the product off every menu, and restoring does not put it back.
 */
export function DeleteOrRestore({ productId, name, deleted, menuCount }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handle() {
    if (!deleted) {
      const menus = menuCount ? ` It will be removed from ${menuCount} ${menuCount === 1 ? "menu" : "menus"}, and restoring it later will not put it back.` : "";
      if (!window.confirm(`Delete "${name}"?${menus}`)) return;
    }
    setPending(true);
    try {
      if (deleted) {
        await api.post(`/admin/products/${productId}/restore`);
        toast.success("Restored as a draft.");
      } else {
        await api.delete(`/admin/products/${productId}`);
        toast.success(`${name} deleted.`);
      }
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "That could not be changed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className={`${button} ${
        deleted
          ? "bg-primary-container text-on-primary-container"
          : "border border-error text-error hover:bg-error-container"
      }`}
    >
      {deleted ? <RotateCcw aria-hidden="true" className="size-4" /> : <Trash2 aria-hidden="true" className="size-4" />}
      {pending ? "Working…" : deleted ? "Restore" : "Delete product"}
    </button>
  );
}
