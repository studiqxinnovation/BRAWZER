import { render, screen } from "@testing-library/react";
import { FolderOpen } from "lucide-react";
import { describe, expect, it } from "vitest";
import { cn } from "../lib/cn";
import { axeViolations } from "../test/axe";
import { Badge } from "./badge";
import { Button } from "./button";
import { DevState } from "./dev-state";
import { EmptyState } from "./empty-state";
import { Spinner } from "./spinner";
import { StatusDot } from "./status-dot";

describe("StatusDot", () => {
  it("is announced only when it carries its own label", () => {
    const { container, rerender } = render(<StatusDot tone="success" />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<StatusDot tone="success" label="Connected" />);
    expect(screen.getByRole("img", { name: "Connected" })).toBeInTheDocument();
  });
});

describe("Spinner", () => {
  it("announces its label as a status", () => {
    render(<Spinner label="Starting browser" />);
    expect(screen.getByRole("status")).toHaveTextContent("Starting browser");
  });
});

describe("DevState", () => {
  it("is clearly labelled as a development state", () => {
    render(
      <DevState
        title="Brawzer Drive is not connected"
        milestone="Phase 4"
        requires={["S3-compatible storage"]}
      >
        Files you download will appear here.
      </DevState>,
    );
    const note = screen.getByRole("note", {
      name: "Development state: Brawzer Drive is not connected",
    });
    expect(note).toHaveTextContent("Development state");
    expect(note).toHaveTextContent("Phase 4");
    expect(note).toHaveTextContent("S3-compatible storage");
  });
});

describe("feedback components", () => {
  it("have no accessibility violations together", async () => {
    const { container } = render(
      <main>
        <Badge tone="success">Protected</Badge>
        <StatusDot tone="warning" label="Connecting" pulse />
        <EmptyState
          titleAs="h2"
          icon={<FolderOpen />}
          title="No files yet"
          description="Downloads from your cloud browser are saved here."
          actions={<Button>Upload a file</Button>}
        />
        <DevState title="Not connected yet" />
      </main>,
    );
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("cn", () => {
  it("keeps a custom text size and a custom text colour together", () => {
    expect(cn("text-callout text-ink", "text-ink-secondary")).toBe(
      "text-callout text-ink-secondary",
    );
  });

  it("lets later sizes win", () => {
    expect(cn("text-callout", "text-body")).toBe("text-body");
  });
});
