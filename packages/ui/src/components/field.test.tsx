import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe";
import { Field, FieldDescription, FieldError, FieldLabel, Input } from "./field";

describe("Field", () => {
  it("connects the label and the description to the input", () => {
    render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input type="email" />
        <FieldDescription>We send a sign-in code here.</FieldDescription>
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAccessibleDescription("We send a sign-in code here.");
  });

  it("shows the error and marks the input invalid", () => {
    render(
      <Field invalid>
        <FieldLabel>Profile name</FieldLabel>
        <Input />
        <FieldError match>Give the profile a name.</FieldError>
      </Field>,
    );
    expect(screen.getByText("Give the profile a name.")).toBeVisible();
    expect(screen.getByLabelText("Profile name")).toHaveAttribute("aria-invalid", "true");
  });

  it("validates required input when the field loses focus", async () => {
    const user = userEvent.setup();
    render(
      <Field validationMode="onBlur">
        <FieldLabel>Profile name</FieldLabel>
        <Input required />
        <FieldError match="valueMissing">Give the profile a name.</FieldError>
      </Field>,
    );
    const input = screen.getByLabelText("Profile name");
    expect(screen.queryByText("Give the profile a name.")).not.toBeInTheDocument();

    await user.type(input, "Research");
    await user.clear(input);
    await user.tab();
    expect(await screen.findByText("Give the profile a name.")).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <Field>
        <FieldLabel>Email</FieldLabel>
        <Input type="email" placeholder="you@example.com" />
        <FieldDescription>Used to sign in.</FieldDescription>
      </Field>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
