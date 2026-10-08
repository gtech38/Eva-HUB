import Link from "next/link";
import { EmptyState } from "@/components/PageHeader";

export default function SiteNotFound() {
  return (
    <div className="py-10">
      <EmptyState title="Page not found" body="This page isn't part of the site." />
      <p className="mt-6 text-center text-sm">
        <Link href="/" className="underline underline-offset-4">
          Back to the home page
        </Link>
      </p>
    </div>
  );
}
