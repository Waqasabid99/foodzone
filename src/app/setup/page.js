import { notFound } from "next/navigation";
import { installationNeedsSetup } from "@/server/services/bootstrap.service";
import SetupForm from "@/components/setup/SetupForm";

export const metadata = {
  title: "Set up FoodZone",
  robots: { index: false, follow: false },
};

/** Reads the live state of the database, so it can never be prerendered. */
export const dynamic = "force-dynamic";

/**
 * The screen a fresh installation opens on.
 *
 * Outside every route group on purpose: no site header, no dashboard shell.
 * There is no menu to browse and nobody signed in, and wrapping this in
 * navigation to places that do not work yet would be a worse first impression
 * than a single page that asks for what it needs.
 *
 * Gone the moment it is used. `notFound()` once any user exists, so the route
 * stops answering rather than explaining itself — an anonymous visitor should
 * not learn that a setup page was ever here.
 */
export default async function SetupPage() {
  if (!(await installationNeedsSetup())) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="font-display text-headline-lg text-on-surface">Set up FoodZone</h1>
        <p className="text-body-md text-on-surface-variant">
          This creates the owner account and the first branch. It runs once — after that, this page is gone.
        </p>
      </div>

      <SetupForm />
    </main>
  );
}
