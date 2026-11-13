import { bookmarkListSchema, historyPageSchema, profileListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { HistoryManager } from "@/components/history/history-manager";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = {
  title: "History and bookmarks",
  robots: { index: false, follow: false },
};

async function Contents({ id }: { id: string }) {
  const here = `/app/profiles/${id}/history` as Route;
  const profiles = await serverGet("/profiles", profileListSchema);
  if (profiles.kind === "signed-out") signInAgain(here);
  if (profiles.kind === "unavailable") return <Unavailable />;
  const profile = profiles.data.profiles.find((candidate) => candidate.id === id);
  if (!profile) notFound();
  const [history, bookmarks] = await Promise.all([
    serverGet(`/profiles/${id}/history`, historyPageSchema),
    serverGet(`/profiles/${id}/bookmarks`, bookmarkListSchema),
  ]);
  if (history.kind === "signed-out" || bookmarks.kind === "signed-out") signInAgain(here);
  if (history.kind === "unavailable" || bookmarks.kind === "unavailable") return <Unavailable />;
  return (
    <HistoryManager
      profile={profile}
      initialHistory={history.data}
      initialBookmarks={bookmarks.data.bookmarks}
    />
  );
}

export default async function ProfileHistoryPage({
  params,
}: PageProps<"/app/profiles/[id]/history">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  return (
    <PageContainer>
      <PageHeader title="History and bookmarks">
        <p>
          What a profile’s sessions visited and the pages it keeps, encrypted with the profile’s own
          key. Only you can read them; Brawzer’s administrators can’t. Pages open in the cloud
          browser, never on this computer.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Contents id={id} />
      </Suspense>
    </PageContainer>
  );
}
