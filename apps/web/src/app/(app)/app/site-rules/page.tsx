import { siteRuleListSchema } from "@brawzer/contracts";
import { Skeleton } from "@brawzer/ui/components/skeleton";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader, Unavailable } from "@/components/app-shell/page";
import { SiteRulesManager } from "@/components/site-rules/site-rules-manager";
import { serverGet, signInAgain } from "@/lib/server-api";

export const metadata: Metadata = { title: "Site rules", robots: { index: false, follow: false } };

async function SiteRules() {
  const list = await serverGet("/site-rules", siteRuleListSchema);
  if (list.kind === "signed-out") signInAgain("/app/site-rules");
  if (list.kind === "unavailable") return <Unavailable />;
  return <SiteRulesManager rules={list.data.rules} limit={list.data.limit} />;
}

export default function SiteRulesPage() {
  return (
    <PageContainer>
      <PageHeader title="Site rules">
        <p>
          Decide where the cloud browser may go. A blocked site never opens; once you allow any
          site, only allowed sites open. A rule covers the site and everything under it, and applies
          to sessions you start from then on.
        </p>
      </PageHeader>
      <Suspense fallback={<Skeleton className="h-40 w-full rounded-xl" />}>
        <SiteRules />
      </Suspense>
    </PageContainer>
  );
}
