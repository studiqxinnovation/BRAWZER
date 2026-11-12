import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginScreen } from "@/components/auth/login-screen";
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
      <div className="lg-err lg-info" role="status">
        <b>You’ve signed out</b>
        On a shared computer, close the browser window as well.
      </div>
    );
  }
  if (params.signed_out === "idle") {
    return (
      <div className="lg-err lg-info" role="status">
        <b>You were signed out</b>
        There was no activity for a while, so Brawzer signed you out to protect your account on this
        computer.
      </div>
    );
  }
  if (params.signed_out === "deleted") {
    return (
      <div className="lg-err lg-info" role="status">
        <b>Your account was deleted</b>
        Your account and the data stored with it were deleted, and every device was signed out. On a
        shared computer, close the browser window as well.
      </div>
    );
  }
  if (params.signed_out === "wiped") {
    return (
      <div className="lg-err lg-info" role="status">
        <b>This computer is clean</b>
        Every app and browser session was closed, the clipboard cleared and you were signed out.
        Your Drive is safe in the cloud. On a shared computer, close the browser window as well.
      </div>
    );
  }
  if (params.expired === "1") {
    return (
      <div className="lg-err lg-info" role="status">
        <b>Your session has ended</b>
        Sign in again to continue.
      </div>
    );
  }
  return null;
}

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <LoginScreen
      notice={
        <Suspense fallback={null}>
          <SignInNotice searchParams={searchParams} />
        </Suspense>
      }
    >
      <h1 className="lg-name">Sign in to Brawzer</h1>
      <SignInForm screen />
    </LoginScreen>
  );
}
