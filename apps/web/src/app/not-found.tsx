import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
      <h1 className="font-display text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The link may be from a project or influencer that was deleted.</p>
      <Button className="mt-2" nativeButton={false} render={<Link href="/projects" />}>
        Back to projects
      </Button>
    </div>
  );
}
