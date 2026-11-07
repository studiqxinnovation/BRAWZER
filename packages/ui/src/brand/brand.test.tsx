import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../test/axe";
import { AppIcon, brandConcepts, conceptSvgMarkup, Logo, Mark } from "./index";

describe("Mark", () => {
  it("is decorative unless it is given a name", () => {
    const { container } = render(<Mark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("is announced as an image when titled", () => {
    render(<Mark title="Brawzer" />);
    expect(screen.getByRole("img", { name: "Brawzer" })).toBeInTheDocument();
  });

  it.each(brandConcepts.map((concept) => concept.id))("renders the %s concept", (concept) => {
    const { container } = render(<Mark concept={concept} />);
    expect(container.querySelectorAll("path").length).toBeGreaterThan(0);
  });
});

describe("Logo", () => {
  it("names the product with real text and hides the decorative mark", async () => {
    const { container } = render(<Logo />);
    expect(screen.getByText("Brawzer")).toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("AppIcon", () => {
  it("has an accessible name", () => {
    render(<AppIcon />);
    expect(screen.getByRole("img", { name: "Brawzer" })).toBeInTheDocument();
  });

  it("is hidden from assistive technology when its title is empty", async () => {
    const { container } = render(<AppIcon title="" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("brand concepts", () => {
  it("recommends exactly one concept", () => {
    expect(brandConcepts.filter((concept) => concept.recommended)).toHaveLength(1);
  });

  it("produces standalone SVG markup in the requested colour", () => {
    for (const { id } of brandConcepts) {
      const markup = conceptSvgMarkup(id, "#f8f7f4");
      expect(markup).toContain('"#f8f7f4"');
      expect(markup.startsWith("<path")).toBe(true);
    }
  });
});
