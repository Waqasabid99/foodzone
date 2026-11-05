"use client";

import dynamic from "next/dynamic";

/**
 * The count sheet, rendered in the browser only: it starts from whatever was
 * typed on this device before, which the server cannot know.
 */
const CountSheetForm = dynamic(() => import("@/components/dashboard/inventory/CountSheetForm"), {
  ssr: false,
  loading: () => <p className="text-body-md text-on-surface-variant">Opening the sheet…</p>,
});

export default function CountSheet({ count }) {
  return <CountSheetForm count={count} />;
}
