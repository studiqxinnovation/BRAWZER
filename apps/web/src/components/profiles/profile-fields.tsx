"use client";

import { type ProfileColor, profileColors } from "@brawzer/contracts";
import { Badge } from "@brawzer/ui/components/badge";
import { Field, FieldError, FieldLabel, Input } from "@brawzer/ui/components/field";
import { Check } from "lucide-react";
import { profileColorShades } from "@/lib/profiles";

/** Name and colour, shared by the create and edit dialogs. */
export function ProfileNameAndColor({
  name,
  color,
  errors,
}: {
  name?: string;
  color: ProfileColor;
  errors: Record<string, string>;
}) {
  return (
    <>
      <Field name="name" invalid={Boolean(errors.name)}>
        <FieldLabel>Name</FieldLabel>
        <Input name="name" defaultValue={name} maxLength={40} autoComplete="off" required />
        {errors.name && <FieldError match>{errors.name}</FieldError>}
      </Field>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-callout font-medium text-ink">Colour</legend>
        <div className="flex flex-wrap gap-2.5">
          {profileColors.map((value) => {
            const shade = profileColorShades[value];
            return (
              <label key={value} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="color"
                  value={value}
                  defaultChecked={value === color}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface-raised peer-checked:ring-2 peer-checked:ring-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-accent peer-checked:[&>svg]:block"
                  style={{ backgroundColor: shade.hex }}
                >
                  <Check className="hidden size-4 text-white" />
                </span>
                <span className="sr-only">{shade.label}</span>
              </label>
            );
          })}
        </div>
        {errors.color && <p className="text-footnote text-danger">{errors.color}</p>}
      </fieldset>
    </>
  );
}

/** Engine choice for a new profile. Firefox is shown, honestly, as not yet available. */
export function EngineChoice() {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-callout font-medium text-ink">Browser engine</legend>
      <label className="flex items-center gap-2.5 text-callout text-ink">
        <input
          type="radio"
          name="engine"
          value="chromium"
          defaultChecked
          className="size-4 accent-accent"
        />
        Chromium
      </label>
      <label className="flex flex-wrap items-center gap-2.5 text-callout text-ink-secondary">
        <input type="radio" name="engine" value="firefox" disabled className="size-4" />
        Firefox
        <Badge>Planned for Phase 3b</Badge>
      </label>
    </fieldset>
  );
}
