"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { ArrowDown, ArrowUp, EyeOff, FolderPlus, Pencil } from "lucide-react";
import { api } from "@/lib/api-client";
import { reorderSiblings } from "@/lib/category-tree";

/**
 * The category tree, with ordering controls.
 *
 * Move-up and move-down buttons rather than drag-and-drop. Dragging is
 * mouse-only unless a great deal of keyboard handling is rebuilt, is fiddly on a
 * tablet at the pass, and a slightly-off drop re-parents a category by accident.
 * A button does one unambiguous thing and works for everyone. Order is only
 * ever changed among siblings — moving between parents is an edit, with its own
 * checks, not a side effect of a drop.
 *
 * Plain nested lists, not `role="tree"`: that role promises arrow-key
 * navigation, and a screen reader user told they are in a tree that then
 * ignores the arrow keys is worse off than one given honest lists.
 */
export default function CategoryTree({ tree, canCreate, canUpdate }) {
  return (
    <ul aria-label="Categories" className="flex flex-col gap-2">
      {tree.map((node) => (
        <Node key={node.id} node={node} siblings={tree} canCreate={canCreate} canUpdate={canUpdate} />
      ))}
    </ul>
  );
}

function Node({ node, siblings, canCreate, canUpdate }) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);

  const position = siblings.findIndex((row) => row.id === node.id);
  const productLabel = `${node.productCount} ${node.productCount === 1 ? "product" : "products"}`;

  async function move(direction) {
    const items = reorderSiblings(siblings, node.id, direction);
    if (!items || moving) return;

    setMoving(true);
    try {
      await api.put("/admin/categories/reorder", { items });
      router.refresh();
    } catch (failure) {
      toast.error(failure?.message ?? "The order could not be saved.");
    } finally {
      setMoving(false);
    }
  }

  return (
    <li>
      <div
        className={`flex flex-wrap items-center gap-3 rounded-card bg-surface-container-lowest px-4 py-3 ${
          node.isActive ? "" : "opacity-75"
        }`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-label-bold text-on-surface">{node.name}</span>
            {!node.isActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-label-bold text-on-surface-variant">
                <EyeOff aria-hidden="true" className="size-3" />
                Hidden
              </span>
            ) : null}
          </span>
          <span className="text-body-md text-on-surface-variant">
            {productLabel}
            {node.children.length
              ? ` · ${node.children.length} ${node.children.length === 1 ? "sub-category" : "sub-categories"}`
              : ""}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {canUpdate && siblings.length > 1 ? (
            <>
              <IconButton
                label={`Move ${node.name} up`}
                icon={ArrowUp}
                disabled={moving || position === 0}
                onClick={() => move("up")}
              />
              <IconButton
                label={`Move ${node.name} down`}
                icon={ArrowDown}
                disabled={moving || position === siblings.length - 1}
                onClick={() => move("down")}
              />
            </>
          ) : null}
          {canCreate && node.depth < 4 ? (
            <IconLink
              href={`/dashboard/categories/new?parent=${node.id}`}
              label={`Add a sub-category to ${node.name}`}
              icon={FolderPlus}
            />
          ) : null}
          {canUpdate ? (
            <IconLink href={`/dashboard/categories/${node.id}/edit`} label={`Edit ${node.name}`} icon={Pencil} />
          ) : null}
        </div>
      </div>

      {node.children.length ? (
        <ul aria-label={`Inside ${node.name}`} className="mt-2 flex flex-col gap-2 border-l-2 border-outline-variant pl-3 sm:pl-5">
          {node.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              siblings={node.children}
              canCreate={canCreate}
              canUpdate={canUpdate}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const iconControl =
  "inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-35";

function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className={iconControl} {...props}>
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}

function IconLink({ href, label, icon: Icon }) {
  return (
    <Link href={href} aria-label={label} title={label} className={iconControl}>
      <Icon aria-hidden="true" className="size-4" />
    </Link>
  );
}
