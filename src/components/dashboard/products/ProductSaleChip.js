import { CircleAlert, CircleCheck, EyeOff, FileEdit, MenuSquare, Trash2 } from "lucide-react";

/**
 * The one-word answer to "can a customer buy this?", with an icon and words so
 * it never depends on colour. The longer explanation lives on the product page.
 */
const TONES = {
  ON_SALE: { icon: CircleCheck, tone: "bg-success-container text-on-success-container" },
  DRAFT: { icon: FileEdit, tone: "bg-surface-container-high text-on-surface-variant" },
  NOT_ON_MENU: { icon: MenuSquare, tone: "bg-warning-container text-on-warning-container" },
  CATEGORY_HIDDEN: { icon: EyeOff, tone: "bg-warning-container text-on-warning-container" },
  COMBO_INCOMPLETE: { icon: CircleAlert, tone: "bg-error-container text-on-error-container" },
  DELETED: { icon: Trash2, tone: "bg-surface-container-high text-on-surface-variant" },
};

export default function ProductSaleChip({ state }) {
  const { icon: Icon, tone } = TONES[state.key] ?? TONES.DRAFT;
  return (
    <span
      className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-label-bold ${tone}`}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {state.label}
    </span>
  );
}
