import { driveFileListSchema, driveOverviewSchema } from "@brawzer/contracts";
import { Button } from "@brawzer/ui/components/button";
import { EmptyState } from "@brawzer/ui/components/empty-state";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import { FolderX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";
import { PageContainer, PageHeader, Panel, Unavailable } from "@/components/app-shell/page";
import { TrashPanel } from "@/components/drive/trash-panel";
import { DriveManager } from "@/components/drive/drive-manager";
import { serverGet, signInAgain } from "@/lib/server-api";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Drive", robots: { index: false, follow: false } };

const folderIdSchema = z.uuid();

async function Contents({ searchParams }: Pick<PageProps<"/app/drive">, "searchParams">) {
  const params = await searchParams;
  const rawFolder = typeof params.folder === "string" ? params.folder : null;
  const folderId = rawFolder && folderIdSchema.safeParse(rawFolder).success ? rawFolder : null;
  const query = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const space = params.space === "team" ? "team" : "personal";
  const fileParams = new URLSearchParams(query ? { q: query } : folderId ? { folderId } : {});
  if (space === "team") fileParams.set("space", "team");
  const search = fileParams.size > 0 ? `?${fileParams.toString()}` : "";

  const [state, overview, files] = await Promise.all([
    getSession(),
    serverGet(space === "team" ? "/drive?space=team" : "/drive", driveOverviewSchema),
    serverGet(`/drive/files${search}`, driveFileListSchema),
  ]);
  if (
    state.kind === "signed-out" ||
    overview.kind === "signed-out" ||
    files.kind === "signed-out"
  ) {
    signInAgain("/app/drive");
  }
  if (
    state.kind === "unavailable" ||
    overview.kind === "unavailable" ||
    files.kind === "unavailable"
  ) {
    return <Unavailable />;
  }

  const folderExists =
    rawFolder === null || overview.data.folders.some((folder) => folder.id === rawFolder);
  if (!folderExists && !query) {
    return (
      <Panel>
        <EmptyState
          icon={<FolderX />}
          title="That folder doesn’t exist"
          description="It may have been deleted or moved."
          actions={
            <Button variant="secondary" render={<Link href="/app/drive" />}>
              Back to Drive
            </Button>
          }
        />
      </Panel>
    );
  }

  return (
    <>
      <DriveManager
        folders={overview.data.folders}
        files={files.data.files}
        usage={overview.data.usage}
        currentFolderId={query ? null : folderId}
        query={query}
        sharedComputer={!state.data.session.persistent}
        renderedAt={files.receivedAt}
        space={overview.data.space}
        team={overview.data.team}
      />
      <TrashPanel space={overview.data.space} />
    </>
  );
}

export default function DrivePage({ searchParams }: PageProps<"/app/drive">) {
  return (
    <PageContainer>
      <PageHeader title="Drive">
        <p>
          Files that stay with your account, not the computer. Everything is scanned for malware and
          stored encrypted; saving a file to a computer is a deliberate step. In a team, its shared
          Drive is here too.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <Contents searchParams={searchParams} />
        </Suspense>
      </div>
    </PageContainer>
  );
}
