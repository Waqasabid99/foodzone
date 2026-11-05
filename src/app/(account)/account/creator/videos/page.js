import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import VideoStudio from "@/components/account/VideoStudio";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { filmableOrderItems, myVideos } from "@/server/services/creator-video.service";
import { creatorForUser, programConfig } from "@/server/services/creator.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "My videos — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Filming, and what happened to each clip.
 *
 * "Things you could film" comes first because a creator with nothing uploaded
 * has nothing to look at otherwise, and the window to film an order closes —
 * the list is a deadline as much as a prompt.
 */
export default async function MyVideosPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/account/creator/videos"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.manage_own_videos")) redirect("/account");

  // Not in the programme: the studio page is where joining happens.
  const creator = await creatorForUser(principal.userId, { required: false });
  if (!creator) redirect("/account/creator");

  const [page, filmable, config] = await Promise.all([
    myVideos({ userId: principal.userId, limit: 50 }),
    filmableOrderItems({ userId: principal.userId }),
    programConfig(),
  ]);

  const limits = {
    minVideoSeconds: config.minVideoSeconds,
    maxVideoSeconds: config.maxVideoSeconds,
    maxVideoSizeBytes: config.maxVideoSizeBytes,
    maxUploadAttempts: config.maxUploadAttempts,
    allowedMimeTypes: config.allowedMimeTypes,
    submissionWindowDays: config.submissionWindowDays,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My videos"
        description={`Film something you ordered within ${limits.submissionWindowDays} days of it arriving.`}
        back={{ href: "/account/creator", label: "Creator studio" }}
      />
      <VideoStudio
        videos={serialize(page.items ?? [])}
        filmable={serialize(filmable)}
        limits={serialize(limits)}
      />
    </div>
  );
}
