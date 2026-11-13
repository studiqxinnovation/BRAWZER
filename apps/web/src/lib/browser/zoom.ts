/** The zoom steps Brawzer offers, as browsers do; 1 is no zoom. */
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;

export function nextZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.findIndex((step) => Math.abs(step - current) < 0.001);
  if (index === -1) {
    // Off the scale (an older value): the nearest step in that direction.
    const candidates = ZOOM_STEPS.filter((step) =>
      direction === 1 ? step > current : step < current,
    );
    const chosen = direction === 1 ? candidates[0] : candidates[candidates.length - 1];
    return chosen ?? current;
  }
  const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
  return next ?? current;
}

export function zoomLabel(factor: number): string {
  return `${String(Math.round(factor * 100))}%`;
}
