"use client";

import { ToastProvider, ToastViewport } from "@brawzer/ui/components/toast";
import { TooltipProvider } from "@brawzer/ui/components/tooltip";
import { MotionConfig } from "motion/react";
import { type ReactNode, useEffect } from "react";
import { watchSystemColorScheme } from "@/lib/theme";

/** App-wide client context: motion preferences, tooltip timing and toasts. */
export function Providers({ children }: { children: ReactNode }) {
  // When the OS switches light/dark, change every colour at once.
  useEffect(() => watchSystemColorScheme(), []);

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delay={500}>
        <ToastProvider>
          {children}
          <ToastViewport />
        </ToastProvider>
      </TooltipProvider>
    </MotionConfig>
  );
}
