"use client";

import { cn } from "@brawzer/ui/lib/cn";
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { styles } from "./styles";

const stillQuery = "(prefers-reduced-motion: reduce)";

/** Marks the page as moving, so sections can rise into view; never under "reduce motion". */
export function MotionRoot() {
  useEffect(() => {
    const root = document.documentElement;
    const still = window.matchMedia(stillQuery);
    const apply = () => {
      if (still.matches) delete root.dataset.motion;
      else root.dataset.motion = "on";
    };
    apply();
    still.addEventListener("change", apply);
    return () => {
      still.removeEventListener("change", apply);
      delete root.dataset.motion;
    };
  }, []);
  return null;
}

/**
 * The 3D stage: tilts toward the pointer (a mouse or pen only) and lays flat
 * as it scrolls into view. Writes CSS variables; React never re-renders for it.
 */
export function TiltStage({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const still = window.matchMedia(stillQuery);
    const fine = window.matchMedia("(pointer: fine)");
    let frame = 0;
    let pointer = { x: 0, y: 0 };
    const apply = () => {
      frame = 0;
      if (still.matches) {
        element.style.setProperty("--flat", "1");
        element.style.setProperty("--px", "0");
        element.style.setProperty("--py", "0");
        return;
      }
      const rect = element.getBoundingClientRect();
      const flat = Math.min(1, Math.max(0, 1 - rect.top / (window.innerHeight * 0.85)));
      element.style.setProperty("--flat", flat.toFixed(3));
      element.style.setProperty("--px", pointer.x.toFixed(3));
      element.style.setProperty("--py", pointer.y.toFixed(3));
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(apply);
    };
    const onPointer = (event: globalThis.PointerEvent) => {
      if (!fine.matches || event.pointerType === "touch") return;
      pointer = {
        x: event.clientX / window.innerWidth - 0.5,
        y: event.clientY / window.innerHeight - 0.5,
      };
      schedule();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    still.addEventListener("change", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      still.removeEventListener("change", schedule);
    };
  }, []);
  return (
    <div ref={ref} className={cn(styles.scene, className)}>
      <div className={styles.rig}>{children}</div>
    </div>
  );
}

/** A card that leans toward a mouse and catches the light where it points. */
export function TiltCard({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  function move(event: PointerEvent<HTMLDivElement>) {
    const element = ref.current;
    if (!element || event.pointerType !== "mouse") return;
    if (window.matchMedia(stillQuery).matches) return;
    const rect = element.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    element.style.setProperty("--ty", `${((x - 0.5) * 9).toFixed(2)}deg`);
    element.style.setProperty("--tx", `${((0.5 - y) * 7).toFixed(2)}deg`);
    element.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    element.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
    element.style.setProperty("--glare", "1");
  }
  function leave() {
    const element = ref.current;
    if (!element) return;
    for (const name of ["--tx", "--ty", "--glare"]) element.style.removeProperty(name);
  }
  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className={cn(styles.tilt, className)}
    >
      {children}
    </div>
  );
}

/** Rises into view the first time it's on screen. Visible as it is without script. */
export function Reveal({
  className,
  delay = 0,
  children,
}: {
  className?: string;
  delay?: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          element.dataset.shown = "true";
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return (
    <div
      ref={ref}
      className={cn(styles.reveal, className)}
      style={{ "--delay": `${String(delay)}ms` } as CSSProperties}
    >
      {children}
    </div>
  );
}
