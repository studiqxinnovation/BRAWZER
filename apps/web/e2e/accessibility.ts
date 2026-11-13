import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

/**
 * Waits until no CSS transition or entrance animation is mid-way, so colours
 * are measured at rest. Endless animations (spinners) are left alone.
 */
export async function settleTransitions(page: Page): Promise<void> {
  await page.waitForFunction(() =>
    document.getAnimations().every((animation) => {
      if (animation.playState !== "running") return true;
      if (animation instanceof CSSTransition) return false;
      return animation.effect?.getTiming().iterations === Infinity;
    }),
  );
}

/** WCAG 2.2 A and AA rules, including colour contrast measured by the browser. */
export async function wcagViolations(page: Page) {
  await settleTransitions(page);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(" ")),
  }));
}

export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}
