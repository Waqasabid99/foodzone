"use client";

import { useEffect, useRef } from "react";
import { Printer } from "lucide-react";

/**
 * The print button, and the dialog that opens itself after a sale.
 *
 * `auto` is passed by the till at the end of a collection sale, where the
 * cashier has already decided to print and a second tap with a customer
 * waiting is a step for nothing. It is deliberately *not* the default: the
 * other reason to be on this page is to look at a receipt or reprint an old
 * one, and a print dialog that seizes the screen every time somebody opens a
 * receipt is worse than the tap it saves.
 *
 * In a browser this opens Chrome's preview. A counter running in kiosk mode
 * with `--kiosk-printing` sends it straight to the roll, which is how this is
 * meant to be run on a till.
 *
 * The ref guards against a second dialog when React mounts the effect twice.
 */
export default function PrintNow({ auto = false }) {
  const printed = useRef(false);

  useEffect(() => {
    if (!auto || printed.current) return;
    printed.current = true;
    // After paint, so the dialog previews the receipt rather than a blank page.
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [auto]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-3 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Printer aria-hidden="true" className="size-4" />
      Print
    </button>
  );
}
