import { FormMessage } from "@brawzer/ui/components/form-message";
import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthHeading, TextLink } from "@/components/auth/auth-ui";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to your Brawzer cloud browser, profiles and Drive.",
  robots: { index: false, follow: false },
};

/** Explains why someone landed here: they just signed out, or their session ended. */
async function SignInNotice({ searchParams }: Pick<PageProps<"/sign-in">, "searchParams">) {
  const params = await searchParams;
  if (params.signed_out === "1") {
    return (
      <FormMessage tone="success" title="You’ve signed out">
        On a shared computer, close the browser window as well.
      </FormMessage>
    );
  }
  if (params.signed_out === "idle") {
    return (
      <FormMessage tone="info" title="You were signed out">
        There was no activity for a while, so Brawzer signed you out to protect your account on this
        computer.
      </FormMessage>
    );
  }
  if (params.signed_out === "deleted") {
    return (
      <FormMessage tone="success" title="Your account was deleted">
        Your account and the data stored with it were deleted, and every device was signed out. On a
        shared computer, close the browser window as well.
      </FormMessage>
    );
  }
  if (params.signed_out === "wiped") {
    return (
      <FormMessage tone="success" title="This computer is clean">
        Every app and browser session was closed, the clipboard cleared and you were signed out.
        Your Drive is safe in the cloud. On a shared computer, close the browser window as well.
      </FormMessage>
    );
  }
  if (params.expired === "1") {
    return (
      <FormMessage tone="info" title="Your session has ended">
        Sign in again to continue.
      </FormMessage>
    );
  }
  return null;
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <div className="flex w-full max-w-sm flex-col gap-8">
      <AuthHeading title="Sign in to Brawzer">
        <p>Your cloud browser, profiles and files, on any computer.</p>
      </AuthHeading>
      <Suspense fallback={null}>
        <SignInNotice searchParams={searchParams} />
      </Suspense>
      <SignInForm />
      <p className="text-callout text-ink-secondary">
        New to Brawzer? <TextLink href="/create-account">Create an account</TextLink>
      </p>
    </div>
  );
}
