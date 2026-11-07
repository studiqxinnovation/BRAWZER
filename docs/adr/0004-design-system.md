# 0004 Design system

- **Status:** Accepted. Logo concept and accent colour await the owner's choice.
- **Date:** 2026-11-06

## Context

Brawzer must feel like premium software with its own identity, work on
whatever computer is in front of the user, and be accessible. Public computers
often have poor, washed-out displays.

## Decision

- **Tailwind CSS 4** with Tailwind's default palette, type scale, radii and shadows removed. Every value comes from Brawzer tokens (`--bw-*`) mapped into the theme in `packages/ui/src/styles`.
- **Base UI** for component behaviour, covering focus, keyboard and ARIA. Brawzer owns all styling. **Lucide** for icons. **Motion** (formerly Framer Motion) for the few transitions that need more than CSS.
- **Themes:** light by default; dark through `[data-theme="dark"]` or the operating-system setting. The theme can also be applied to any section. Every token is declared in every theme block, and a unit test keeps the dark blocks identical.
- **Accent:** one accent colour, kept separate from status colours, so green, amber and red always mean status. Three candidates: cobalt (recommended), copper and glacier.
- **Contrast targets (WCAG 2.2 AA):**
  - Text reaches 4.5:1 on every main background.
  - Form-control borders reach 3:1 (`--bw-line-control`). This is a deliberate choice for poor displays in public places.
  - The `/design` page measures these live, and an end-to-end test fails if any combination of theme and accent misses its target.
- **Typography:** Inter, using its optical sizes, and Geist Mono for technical values. Both are self-hosted.
- **Appearance preferences** are stored in `sessionStorage` only.
- **Development states:** anything not yet connected uses the `DevState` component, so placeholders can't be mistaken for features.

## Consequences

- Off-palette colours or sizes can't be used by accident; the utilities don't exist.
- Choosing the logo means changing one value (`activeConcept`); the favicon, app icons and lockups follow.
- The wordmark is set in Inter until a concept is chosen, then drawn as outlines.
