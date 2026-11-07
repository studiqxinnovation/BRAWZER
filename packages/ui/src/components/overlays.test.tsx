import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "./menu";

describe("Dialog", () => {
  function ConfirmDialog() {
    return (
      <Dialog>
        <DialogTrigger render={<Button />}>End all sessions</DialogTrigger>
        <DialogContent>
          <DialogTitle>End all sessions?</DialogTitle>
          <DialogDescription>Every device will be signed out.</DialogDescription>
          <DialogClose render={<Button />}>Cancel</DialogClose>
        </DialogContent>
      </Dialog>
    );
  }

  it("opens with an accessible name and description", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    await user.click(screen.getByRole("button", { name: "End all sessions" }));

    const dialog = await screen.findByRole("dialog", { name: "End all sessions?" });
    expect(dialog).toHaveAccessibleDescription("Every device will be signed out.");
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<ConfirmDialog />);
    const trigger = screen.getByRole("button", { name: "End all sessions" });
    await user.click(trigger);
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});

describe("Menu", () => {
  it("lists its items and runs the chosen one", async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    render(
      <Menu>
        <MenuTrigger render={<Button />}>Profile actions</MenuTrigger>
        <MenuContent>
          <MenuItem onClick={onRename}>Rename</MenuItem>
          <MenuItem tone="danger">Delete</MenuItem>
        </MenuContent>
      </Menu>,
    );

    await user.click(screen.getByRole("button", { name: "Profile actions" }));
    expect(await screen.findAllByRole("menuitem")).toHaveLength(2);

    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    expect(onRename).toHaveBeenCalledOnce();
    await waitFor(() => {
      expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    });
  });
});
