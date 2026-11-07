/**
 * Creates the owner account and the first branch, from the command line.
 *
 * The same work the `/setup` page does, through the same service, for the
 * cases a browser cannot cover: an automated deployment, a rebuild, or a
 * system where the page will not load and somebody needs a way in.
 *
 *   OWNER_NAME="Ayesha Khan" OWNER_EMAIL=owner@example.com \
 *   BRANCH_CODE=FZ-KHI-01 BRANCH_NAME="Main Branch" BRANCH_CITY=Karachi \
 *   npm run db:bootstrap
 *
 * `OWNER_PASSWORD` is optional. Left out, one is generated and printed once —
 * which is better than a weak password typed in a hurry, and better than a
 * password sitting in a shell history file.
 *
 * No `SETUP_TOKEN` is required here. Anybody who can run this already has the
 * server's environment and its database credentials; a token would be a lock
 * on a door that is already open.
 */
import "dotenv/config";
import { generateTemporaryPassword } from "../src/server/utils/password.js";
import { bootstrapSchema } from "../src/server/validation/bootstrap.schemas.js";
import { bootstrapInstallation, installationNeedsSetup } from "../src/server/services/bootstrap.service.js";
import { prisma } from "../src/lib/prisma.js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Missing ${name}.\n\nSee the comment at the top of scripts/bootstrap.mjs for the full list.`);
    process.exit(1);
  }
  return value;
}

async function main() {
  if (!(await installationNeedsSetup())) {
    console.error(
      "This installation already has users, so it has been set up.\n" +
        "Sign in instead, or reset the database if this was meant to be a fresh install.",
    );
    process.exit(1);
  }

  // Generated when absent, and shown once. Printed deliberately: there is no
  // other way to hand it over, and the alternative is a predictable default.
  const generated = process.env.OWNER_PASSWORD?.trim() ? null : generateTemporaryPassword();

  const parsed = bootstrapSchema.safeParse({
    owner: {
      name: required("OWNER_NAME"),
      email: required("OWNER_EMAIL"),
      password: generated ?? process.env.OWNER_PASSWORD.trim(),
    },
    branch: {
      code: required("BRANCH_CODE"),
      name: required("BRANCH_NAME"),
      city: process.env.BRANCH_CITY?.trim() || null,
      timezone: process.env.BRANCH_TIMEZONE?.trim() || undefined,
      currency: process.env.BRANCH_CURRENCY?.trim() || undefined,
    },
  });

  if (!parsed.success) {
    console.error("These details will not do:\n");
    for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }

  const { owner, branch } = await bootstrapInstallation(parsed.data);

  console.log(`\nOwner:  ${owner.name} <${owner.email}>`);
  console.log(`Branch: ${branch.code} — ${branch.name} (${branch.timezone}, ${branch.currency})`);
  if (generated) {
    console.log(`\n  Password: ${generated}`);
    console.log("  Shown once and never stored in readable form. Change it after signing in.");
  }
  console.log("\nSign in at /login. The /setup page is now closed.");
}

main()
  .catch((error) => {
    console.error(error.message ?? error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
