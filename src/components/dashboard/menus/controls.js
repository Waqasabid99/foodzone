/** Small row controls shared by the menu and station editors. */

export function RowButton({ tone = "neutral", children, ...props }) {
  return (
    <button
      type="button"
      className={`rounded-field px-3 py-2 text-label-bold hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 ${tone === "danger" ? "text-error" : "text-on-surface"}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function IconButton({ label, icon: Icon, ...props }) {
  return (
    <button type="button" aria-label={label} title={label} className="inline-flex size-10 items-center justify-center rounded-field text-on-surface-variant hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-30" {...props}>
      <Icon aria-hidden="true" className="size-4" />
    </button>
  );
}
