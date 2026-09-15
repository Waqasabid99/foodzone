import { ExternalLink } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import SectionHeading from "@/components/home/SectionHeading";

/**
 * The social grid.
 *
 * Nothing feeds this yet — an Instagram grid needs a Graph API token and a
 * refresh job, which is a call about a third-party dependency rather than a
 * frontend task. Each tile renders as branded artwork until then, and the
 * component takes whatever shape a real feed would, so wiring one up is a
 * change to the data layer alone.
 */
export default function SocialSnap({ posts, handle = "foodzone" }) {
  if (!posts.length) return null;

  return (
    <section>
      <SectionHeading
        title="Social snap"
        action={
          <a
            href={`https://instagram.com/${handle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            @{handle}
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        }
      />

      <ul className="mt-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        {posts.map((post) => (
          <li key={post.id} className="relative aspect-square overflow-hidden rounded-card">
            <FoodImage
              src={post.href}
              alt={post.alt}
              sizes="(max-width: 768px) 50vw, 25vw"
              className="size-full"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
