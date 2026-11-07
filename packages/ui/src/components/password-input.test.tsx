import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe";
import { Field, FieldLabel } from "./field";
import { FormMessage } from "./form-message";
import { PasswordInput } from "./password-input";

function renderPassword() {
  return render(
    <Field>
      <FieldLabel>Password</FieldLabel>
      <PasswordInput autoComplete="current-password" />
    </Field>,
  );
}

describe("PasswordInput", () => {
  it("hides the password by default and is labelled by its field", () => {
    renderPassword();
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toHaveAttribute("spellcheck", "false");
  });

  it("shows and hides the password with a toggle button", async () => {
    const user = userEvent.setup();
    renderPassword();
    const input = screen.getByLabelText("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await user.click(toggle);
    expect(input).toHaveAttribute("type", "password");
  });

  it("warns when Caps Lock is on", async () => {
    const user = userEvent.setup();
    renderPassword();
    await user.click(screen.getByLabelText("Password"));
    await user.keyboard("{CapsLock}a");
    expect(await screen.findByText("Caps Lock is on")).toBeVisible();
  });

  it("has no accessibility violations", async () => {
    const { container } = renderPassword();
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("FormMessage", () => {
  it("announces errors immediately and other messages politely", () => {
    render(
      <>
        <FormMessage tone="danger">Email or password is incorrect.</FormMessage>
        <FormMessage tone="info" title="Check your email" />
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    expect(screen.getByRole("status")).toHaveTextContent("Check your email");
  });
});
