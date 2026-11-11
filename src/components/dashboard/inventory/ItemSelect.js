/**
 * A native item picker, grouped by stock category.
 *
 * Native on purpose: it is keyboard-searchable by typing the first letters, and
 * on a phone in a store room it opens the platform wheel, which beats a custom
 * list under a thumb. Kitchens hold hundreds of items, not tens of thousands.
 */
export default function ItemSelect({ id, label, value, onChange, items, error = null, placeholder = "Choose an item", className = "" }) {
  const groups = new Map();
  for (const item of items) {
    const key = item.category?.name ?? "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-label-bold text-on-surface">{label}</label>
      <select
        id={id}
        value={value}
        onChange={onChange}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={errorId}
        className={`w-full rounded-field bg-surface-container-low px-3 py-3 text-body-md text-on-surface focus:outline-2 focus:outline-offset-2 focus:outline-ring ${error ? "border border-error" : "border border-outline"}`}
      >
        <option value="">{placeholder}</option>
        {ordered.length === 1
          ? ordered[0][1].map((item) => <option key={item.id} value={item.id}>{item.name} ({item.uom.code})</option>)
          : ordered.map(([group, rows]) => (
              <optgroup key={group} label={group}>
                {rows.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.uom.code})</option>)}
              </optgroup>
            ))}
      </select>
      {error ? <p id={errorId} className="text-label-bold text-error">{error}</p> : null}
    </div>
  );
}
