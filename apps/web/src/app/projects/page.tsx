import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/page-header";

export default function ProjectsPage() {
  return (
    <>
      <PageHeader title="Projects" description="One project is one Reel: product photos in, an upload-ready video out." />
      <EmptyState icon={<Clapperboard className="size-8" />} title="Projects arrive in phase 2">
        Product upload, analysis and the storyboard come next. Meanwhile, set up your{" "}
        <Link href="/influencers" className="text-primary underline-offset-4 hover:underline">
          influencers
        </Link>{" "}
        and{" "}
        <Link href="/sources" className="text-primary underline-offset-4 hover:underline">
          source logos
        </Link>
        .
      </EmptyState>
    </>
  );
}
