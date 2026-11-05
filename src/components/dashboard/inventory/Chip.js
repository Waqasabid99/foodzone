/** A short state label. The words carry the meaning; the tone only repeats it. */
export default function Chip({ tone = "bg-surface-container-high text-on-surface-variant", children }) {
  return <span className={`inline-flex w-fit items-center whitespace-nowrap rounded-full px-2.5 py-1 text-label-bold ${tone}`}>{children}</span>;
}
