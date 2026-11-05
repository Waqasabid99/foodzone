/**
 * Category tree rules the admin screens need before they talk to the server.
 *
 * The server is the authority on every one of these — it refuses a cycle and a
 * tree that is too deep. They are repeated here so the form never *offers* a
 * choice the server will refuse: a parent dropdown that lists a category's own
 * children invites exactly the drag that corrupts a tree, and the only feedback
 * would be an error after the fact.
 */

/** Mirrors `MAX_DEPTH` in category.service — a unit test keeps the two equal. */
export const MAX_CATEGORY_DEPTH = 4;

function childrenByParent(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = row.parentId ?? null;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  return map;
}

/**
 * Flat rows to a tree, in display order.
 *
 * A row whose parent is not in the set is treated as a root, so a filtered or
 * partially loaded list still shows every row rather than silently dropping one.
 */
export function toTree(rows) {
  const ids = new Set(rows.map((row) => row.id));
  const byParent = childrenByParent(
    rows.map((row) => ({ ...row, parentId: row.parentId && ids.has(row.parentId) ? row.parentId : null })),
  );

  const build = (parentId, depth, trail) =>
    (byParent.get(parentId) ?? [])
      // Defensive: data that is already cyclic must not hang the page.
      .filter((row) => !trail.has(row.id))
      .map((row) => ({
        ...row,
        depth,
        children: build(row.id, depth + 1, new Set([...trail, row.id])),
      }));

  return build(null, 1, new Set());
}

/** Tree back to a flat list in display order, each row carrying its depth. */
export function flattenTree(tree) {
  const out = [];
  const walk = (nodes) => {
    for (const { children, ...node } of nodes) {
      out.push(node);
      walk(children);
    }
  };
  walk(tree);
  return out;
}

/** Every id below `id`, at any depth. */
export function descendantIds(rows, id) {
  const byParent = childrenByParent(rows);
  const found = new Set();
  const stack = [id];
  while (stack.length) {
    for (const child of byParent.get(stack.pop()) ?? []) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      stack.push(child.id);
    }
  }
  return found;
}

/** How many levels hang below `id` — 0 for a leaf. */
export function heightBelow(rows, id) {
  const byParent = childrenByParent(rows);
  const height = (nodeId, seen) => {
    const children = (byParent.get(nodeId) ?? []).filter((child) => !seen.has(child.id));
    if (!children.length) return 0;
    return 1 + Math.max(...children.map((child) => height(child.id, new Set([...seen, child.id]))));
  };
  return height(id, new Set([id]));
}

/**
 * The categories `selfId` may be placed under, indented, with the reason any
 * are unavailable.
 *
 * Disabled rather than removed: a parent that vanishes from the list is a
 * mystery, while one shown greyed with "would be too deep" answers the question
 * before it is asked.
 */
export function parentOptions(rows, selfId = null) {
  const excluded = selfId ? descendantIds(rows, selfId) : new Set();
  const subtree = selfId ? heightBelow(rows, selfId) : 0;

  return flattenTree(toTree(rows)).map((row) => {
    let reason = null;
    if (row.id === selfId) reason = "this category";
    else if (excluded.has(row.id)) reason = "inside this category";
    // Same arithmetic as the server: parent depth + everything below us + us.
    else if (row.depth + subtree + 1 > MAX_CATEGORY_DEPTH) reason = "too deep";

    return {
      value: row.id,
      label: `${"— ".repeat(row.depth - 1)}${row.name}${reason ? ` (${reason})` : ""}`,
      disabled: Boolean(reason),
    };
  });
}

/**
 * The reorder request for moving one category up or down among its siblings.
 *
 * Every sibling is renumbered, not just the two that swap. New categories all
 * default to `sortOrder: 0`, so swapping the values of two siblings that are
 * both 0 changes nothing — the button would appear broken. Renumbering the
 * group gives each a distinct position first.
 *
 * Returns null when the move is impossible (first up, last down, unknown id).
 */
export function reorderSiblings(siblings, id, direction) {
  const ordered = [...siblings].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  const index = ordered.findIndex((row) => row.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) return null;

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered.map((row, position) => ({ id: row.id, sortOrder: position * 10 }));
}
