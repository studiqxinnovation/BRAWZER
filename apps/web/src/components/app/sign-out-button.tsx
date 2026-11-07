"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { logout } from "@/lib/api/auth";

/**
 * Ends the session on the server, then reloads into the sign-in page. The
 * full reload (rather than client navigation) drops everything the app held
 * in memory, and `replace` keeps the signed-in page out of Back.
 */
export function SignOutButton() {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    const result = await logout();
    if (!result.ok) {
      setPending(false);
      toast.add({
        type: "error",
        title: "You’re still signed in",
        description: `${result.error.message} Closing the browser also ends a shared-computer session.`,
      });
      return;
    }
    window.location.replace("/sign-in?signed_out=1");
  }

  return (
    <Button variant="secondary" size="sm" loading={pending} onClick={() => void signOut()}>
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
}
