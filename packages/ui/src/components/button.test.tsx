import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../test/axe";
import { Button } from "./button";

describe("Button", () => {
  it("activates with the mouse and the keyboard", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(3);
  });

  it("announces a busy state, ignores activation and stays focusable while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");

    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    await user.tab();
    expect(button).toHaveFocus();
  });

  it("is removed from the tab order when disabled", async () => {
    const user = userEvent.setup();
    render(
      <>
        <Button disabled>Disabled</Button>
        <Button>Next</Button>
      </>,
    );
    await user.tab();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });

  it("has no accessibility violations across variants", async () => {
    const { container } = render(
      <div>
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
        <Button size="icon" aria-label="Add profile">
          <Plus />
        </Button>
        <Button loading>Saving</Button>
      </div>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});
