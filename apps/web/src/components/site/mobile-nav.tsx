"use client";

import { Button } from "@brawzer/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@brawzer/ui/components/sheet";
import { buttonVariants } from "@brawzer/ui/lib/button-variants";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { accountLinks, primaryNav } from "@/content/site";

/** Small-screen navigation in a panel that slides in from the right. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };

  return (
    <Sheet side="right" open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" aria-label="Open menu" className="md:hidden" />}
      >
        <Menu aria-hidden="true" />
      </SheetTrigger>
      <SheetContent>
        <div className="flex items-center justify-between">
          <SheetTitle>Menu</SheetTitle>
          <SheetClose render={<Button variant="ghost" size="icon-sm" aria-label="Close menu" />}>
            <X aria-hidden="true" />
          </SheetClose>
        </div>
        <nav aria-label="Main menu" className="mt-6">
          <ul className="flex flex-col">
            {primaryNav.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={close}
                  className="block rounded-md px-2 py-3 text-body-lg text-ink hover:bg-hover"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-auto flex flex-col gap-2 pt-10">
          <a
            href={accountLinks.createAccount}
            onClick={close}
            className={buttonVariants({ variant: "primary", size: "lg" })}
          >
            Get started
          </a>
          <a href={accountLinks.signIn} onClick={close} className={buttonVariants({ size: "lg" })}>
            Sign in
          </a>
        </div>
      </SheetContent>
    </Sheet>
  );
}
