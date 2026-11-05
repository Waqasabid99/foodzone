"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { loginHref } from "@/lib/redirects";

/**
 * Swaps a stale access token for a fresh one, then goes where you were going.
 *
 * The refresh itself is a plain call to the API, which is the only place that
 * can check a refresh token and rotate the family — the proxy that sent us here
 * only looked at whether a cookie was present.
 *
 * `replace`, never `push`: this page must not end up in the history, or Back
 * from the destination lands on it and resumes forward again.
 */
export default function SessionResume({ next = "/dashboard" }) {
  const router = useRouter();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => !cancelled && setSlow(true), 2000);

    (async () => {
      try {
        await api.post("/auth/refresh", { client: "web" });
        if (!cancelled) router.replace(next);
      } catch {
        // The session really has ended — revoked, expired, or signed out
        // elsewhere. Carry the destination into the login page so the trip is
        // not wasted.
        if (!cancelled) router.replace(loginHref(next));
      }
    })();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [next, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <p role="status" className="text-body-md text-on-surface-variant">
        {slow ? "Still picking your session back up…" : "One moment…"}
      </p>
    </main>
  );
}
