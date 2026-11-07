"use client";

import { Button } from "@brawzer/ui/components/button";
import { useToast } from "@brawzer/ui/components/toast";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { signOut } from "@/lib/session-channel";

/** Always visible: on a computer you don't own, signing out should never be hard to find. */
export function SignOutButton({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await signOut("user");
    if (result.ok) return;
    setPending(false);
    toast.add({
      type: "error",
      title: "You’re still signed in",
      description: `${result.error.message} Closing the browser also ends a shared-computer session.`,
    });
  }

  return (
    <Button
      variant={compact ? "secondary" : "ghost"}
      size="sm"
      loading={pending}
      className={className}
      onClick={() => void handleClick()}
    >
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
}
