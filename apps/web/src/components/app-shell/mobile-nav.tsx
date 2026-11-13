"use client";

import { Logo } from "@brawzer/ui/brand";
import { Button } from "@brawzer/ui/components/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@brawzer/ui/components/sheet";
import { Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { AppNav } from "./nav";

/** Phones and small windows: the same navigation in a drawer. */
export function MobileNav({ account, admin = false }: { account: ReactNode; admin?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent className="w-[min(20rem,85vw)]">
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <div className="pb-5">
          <Logo size={18} />
        </div>
        <div className="-mx-2">
          <AppNav
            label="Brawzer"
            admin={admin}
            onNavigate={() => {
              setOpen(false);
            }}
          />
        </div>
        <div className="-mx-2 mt-6 border-t border-line pt-3">{account}</div>
      </SheetContent>
    </Sheet>
  );
}
