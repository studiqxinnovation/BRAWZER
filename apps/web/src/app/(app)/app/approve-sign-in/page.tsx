import { FormMessage } from "@brawzer/ui/components/form-message";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ApproveSignIn } from "@/components/auth/approve-sign-in";
import { PageContainer, PageHeader } from "@/components/app-shell/page";

export const metadata: Metadata = {
  title: "Approve a sign-in",
  robots: { index: false, follow: false },
};

/** The request named in the address, read inside a boundary as Next.js asks. */
async function Approval({ searchParams }: Pick<PageProps<"/app/approve-sign-in">, "searchParams">) {
  const params = await searchParams;
  const requestId = typeof params.r === "string" ? params.r : "";
  const key = typeof params.k === "string" ? params.k : "";
  if (!requestId || !key) {
    return (
      <FormMessage tone="info" title="Scan the code on the computer">
        This page opens from the QR code a computer shows under “Sign in with your phone”.
      </FormMessage>
    );
  }
  return <ApproveSignIn requestId={requestId} approvalKey={key} />;
}

/** Opened on the phone by scanning the computer's QR code. */
export default function ApproveSignInPage({ searchParams }: PageProps<"/app/approve-sign-in">) {
  return (
    <PageContainer>
      <PageHeader title="Approve a sign-in">
        <p>A computer wants to sign in to your account, with you watching.</p>
      </PageHeader>
      <Suspense fallback={null}>
        <Approval searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
