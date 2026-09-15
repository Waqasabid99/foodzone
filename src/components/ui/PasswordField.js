"use client";

import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import Field from "@/components/ui/Field";

/**
 * A password input with a reveal toggle.
 *
 * Worth having: the alternative to letting someone check what they typed is a
 * second "confirm" box on every form, and on a phone keyboard a masked field is
 * where long passwords go to be abandoned. The toggle defaults to hidden and is
 * per-field, so revealing one does not reveal the other on the register form.
 *
 * The button is labelled and its state is exposed with `aria-pressed`, so it is
 * operable without seeing the icon change.
 */
export default function PasswordField({ id, ...props }) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const [revealed, setRevealed] = useState(false);
  const Icon = revealed ? EyeOff : Eye;

  return (
    <Field
      {...props}
      id={fieldId}
      type={revealed ? "text" : "password"}
      trailing={
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          aria-pressed={revealed}
          aria-controls={fieldId}
          aria-label={revealed ? "Hide password" : "Show password"}
          className="absolute right-2 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Icon aria-hidden="true" className="size-5" />
        </button>
      }
    />
  );
}
