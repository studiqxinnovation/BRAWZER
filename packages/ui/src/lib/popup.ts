/** Shared surface for menus, selects and popovers: raised, hairline border, quick scale-in. */
export const popupSurface =
  "origin-(--transform-origin) rounded-lg border border-line bg-surface-raised text-ink shadow-lg outline-none transition-[opacity,scale] duration-(--bw-duration-fast) ease-standard data-starting-style:scale-[0.97] data-starting-style:opacity-0 data-ending-style:scale-[0.98] data-ending-style:opacity-0";

/** Focus ring used by every interactive element. */
export const focusRing =
  "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";
