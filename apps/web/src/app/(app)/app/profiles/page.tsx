import { profileListSchema, proxyListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { textLinkClassName } from "@/components/auth/auth-ui";
import { ProfilesManager } from "@/components/profiles/profiles-manager";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Profiles", robots: { index: false, follow: false } };

async function Profiles() {
  const [result, proxies] = await Promise.all([
    serverGet("/profiles", profileListSchema),
    serverGet("/proxies", proxyListSchema),
  ]);
  if (result.kind === "signed-out" || proxies.kind === "signed-out") signInAgain("/app/profiles");
  if (result.kind === "unavailable" || proxies.kind === "unavailable") return <Unavailable />;
  return (
    <ProfilesManager
      profiles={result.data.profiles}
      limit={result.data.limit}
      engines={result.data.engines}
      proxies={proxies.data.proxies.map(({ id, name, team }) => ({
        id,
        name: team ? `${name} (team)` : name,
      }))}
    />
  );
}

export default function ProfilesPage() {
  return (
    <PageContainer>
      <PageHeader title="Profiles">
        <p>
          Separate browsers for work, personal life, research and anything else. Each keeps its own
          cookies, history and sign-ins, encrypted, between sessions.
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10">
        <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
          <Profiles />
        </Suspense>
        <p className="text-footnote text-ink-secondary">
          Extensions for each profile are chosen on the{" "}
          <Link href="/app/extensions" className={textLinkClassName}>
            Extensions
          </Link>{" "}
          page.
        </p>
      </div>
    </PageContainer>
  );
}
