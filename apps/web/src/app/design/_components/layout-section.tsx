import { Section, SubHeading } from "./section";

const spacing = [4, 8, 12, 16, 24, 32, 48, 64];

// Full class names so Tailwind can find them.
const radii = [
  { name: "xs", className: "rounded-xs", px: 4, use: "Badges inside text" },
  { name: "sm", className: "rounded-sm", px: 6, use: "Small controls" },
  { name: "md", className: "rounded-md", px: 8, use: "Buttons and inputs" },
  { name: "lg", className: "rounded-lg", px: 12, use: "Menus and popovers" },
  { name: "xl", className: "rounded-xl", px: 16, use: "Cards and dialogs" },
  { name: "2xl", className: "rounded-2xl", px: 22, use: "Large media" },
];

const elevation = [
  { name: "xs", className: "shadow-xs", use: "Controls" },
  { name: "sm", className: "shadow-sm", use: "Selected segments" },
  { name: "md", className: "shadow-md", use: "Hover lift" },
  { name: "lg", className: "shadow-lg", use: "Menus, toasts" },
  { name: "xl", className: "shadow-xl", use: "Dialogs, sheets" },
];

export function LayoutSection() {
  return (
    <Section
      id="layout"
      index="04"
      title="Layout"
      description="A 4-pixel spacing grid, a small set of corner radii that grow with the size of the surface, and shadows that stay soft. Dark mode leans on borders and lighter surfaces rather than shadows."
    >
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <SubHeading>Spacing</SubHeading>
          <ul className="space-y-2.5">
            {spacing.map((px) => (
              <li key={px} className="flex items-center gap-4">
                <span className="w-12 shrink-0 font-mono text-footnote text-ink-tertiary">
                  {px} px
                </span>
                <span
                  aria-hidden="true"
                  className="h-2 rounded-full bg-accent"
                  style={{ width: px * 3 }}
                />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SubHeading>Corner radius</SubHeading>
          <ul className="grid grid-cols-3 gap-3">
            {radii.map((radius) => (
              <li key={radius.name} className="flex flex-col gap-2">
                <span
                  aria-hidden="true"
                  className={`${radius.className} h-16 border border-line-strong bg-surface shadow-xs`}
                />
                <span className="text-footnote text-ink">
                  {radius.name}{" "}
                  <span className="font-mono text-ink-tertiary">· {radius.px} px</span>
                </span>
                <span className="text-caption text-ink-tertiary">{radius.use}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-10">
        <SubHeading>Elevation</SubHeading>
        <ul className="grid grid-cols-2 gap-4 rounded-xl bg-canvas-subtle p-6 sm:grid-cols-5">
          {elevation.map((level) => (
            <li
              key={level.name}
              className={`${level.className} flex h-24 flex-col justify-end rounded-lg bg-surface-raised p-3`}
            >
              <span className="text-footnote font-medium text-ink">{level.name}</span>
              <span className="text-caption text-ink-tertiary">{level.use}</span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
