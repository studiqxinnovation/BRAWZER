import type { Metadata } from "next";
import { Suspense } from "react";
import { PageContainer, PageHeader } from "@/components/app-shell/page";
import { HelpPageBody } from "@/components/support/help-page";

export const metadata: Metadata = { title: "Help", robots: { index: false, follow: false } };

export default function HelpPage() {
  return (
    <PageContainer>
      <PageHeader title="Help">
        <p>
          Ask Brawzer’s team for help and follow the replies. Each reply also reaches your email.
        </p>
      </PageHeader>
      <Suspense fallback={null}>
        <HelpPageBody />
      </Suspense>
    </PageContainer>
  );
}
