import axe from "axe-core";

/**
 * Runs axe-core against rendered markup. Colour contrast is checked in the
 * browser end-to-end tests instead, because jsdom cannot compute styles.
 */
export async function axeViolations(container: Element): Promise<axe.Result[]> {
  const results = await axe.run(container, {
    rules: { "color-contrast": { enabled: false } },
  });
  return results.violations;
}
