"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Power } from "lucide-react";
import { api } from "@/lib/api-client";

/**
 * Switches a menu on or off — publishing it, as far as customers are concerned.
 *
 * Both directions confirm. Switching off can empty a branch's menu mid-service;
 * switching on can replace the menu customers are ordering from.
 */
export default function MenuPublishButton({ menuId, name, isActive, productCount }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handle() {
    const question = isActive
      ? `Switch off "${name}"? Customers stop seeing it straight away. If it is the menu showing now, another menu takes over — or the branch has nothing to order from.`
      : productCount
        ? `Switch on "${name}"? Customers see it whenever its schedule says so, which may be right now.`
        : `"${name}" has nothing on it. Switch it on anyway? If it becomes the menu showing, customers will see an empty menu.`;
    if (!window.confirm(question)) return;

    setPending(true);
    try {
      await api.patch(`/admin/menus/${menuId}`, { isActive: !isActive });
      toast.success(isActive ? `${name} switched off.` : `${name} switched on.`);
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
      className={`inline-flex items-center gap-2 rounded-field px-5 py-3 font-display text-label-bold uppercase tracking-wide focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
        isActive ? "border border-outline text-on-surface hover:bg-surface-container" : "bg-primary-container text-on-primary-container hover:shadow-e2"
      }`}
    >
      <Power aria-hidden="true" className="size-4" />
      {pending ? "Saving…" : isActive ? "Switch off" : "Switch on"}
    </button>
  );
}
