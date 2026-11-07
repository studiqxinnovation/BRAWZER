import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../test/axe";
import { Checkbox } from "./checkbox";
import { SegmentedControl } from "./segmented-control";
import { Switch } from "./switch";
import { Tab, Tabs, TabsList, TabsPanel } from "./tabs";

describe("Switch", () => {
  it("toggles with the mouse and the keyboard", async () => {
    const user = userEvent.setup();
    render(
      <label>
        <Switch />
        Clipboard access
      </label>,
    );
    const toggle = screen.getByRole("switch", { name: "Clipboard access" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.keyboard(" ");
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});

describe("Checkbox", () => {
  it("toggles and reports its state", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(
      <label>
        <Checkbox onCheckedChange={onCheckedChange} />
        This is a shared computer
      </label>,
    );
    await user.click(screen.getByRole("checkbox", { name: "This is a shared computer" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true, expect.anything());
  });
});

function ThemePicker({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState<"light" | "dark">("light");
  return (
    <SegmentedControl
      aria-label="Theme"
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      options={[
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" },
      ]}
    />
  );
}

describe("SegmentedControl", () => {
  it("exposes the selection and changes it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemePicker onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Dark" }));
    expect(onChange).toHaveBeenCalledWith("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
  });

  it("never leaves nothing selected", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ThemePicker onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ThemePicker />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("Tabs", () => {
  it("moves between tabs with the arrow keys", async () => {
    const user = userEvent.setup();
    render(
      <Tabs defaultValue="overview">
        <TabsList>
          <Tab value="overview">Overview</Tab>
          <Tab value="activity">Activity</Tab>
        </TabsList>
        <TabsPanel value="overview">Overview panel</TabsPanel>
        <TabsPanel value="activity">Activity panel</TabsPanel>
      </Tabs>,
    );

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Activity" })).toHaveTextContent("Activity panel");
  });
});
