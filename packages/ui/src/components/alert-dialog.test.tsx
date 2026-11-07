import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./alert-dialog";
import { Button } from "./button";

function Example() {
  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button />}>Sign out other devices</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Sign out 2 other devices?</AlertDialogTitle>
        <AlertDialogDescription>
          They’ll need your password to sign in again.
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button />}>Cancel</AlertDialogClose>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

describe("AlertDialog", () => {
  it("opens as an alert dialog with a title and description", async () => {
    const user = userEvent.setup();
    render(<Example />);
    await user.click(screen.getByRole("button", { name: "Sign out other devices" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Sign out 2 other devices?" });
    expect(dialog).toHaveAccessibleDescription("They’ll need your password to sign in again.");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("closes with its close button and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "Sign out other devices" });
    await user.click(trigger);
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});
