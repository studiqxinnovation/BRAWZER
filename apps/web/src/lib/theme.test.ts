import { describe, expect, it, vi } from "vitest";
import {
  readAccent,
  readThemePreference,
  setAccent,
  setThemePreference,
  subscribeToAppearance,
  themeBootstrapScript,
} from "./theme";

const root = document.documentElement;

function runBootstrap() {
  // The same string is inlined in <head>; executing it here tests what ships.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const script = new Function(themeBootstrapScript) as () => void;
  script();
}

describe("theme preferences", () => {
  it("applies a forced theme and remembers it for this session only", () => {
    setThemePreference("dark");
    expect(root.dataset.theme).toBe("dark");
    expect(sessionStorage.getItem("brawzer:theme")).toBe("dark");
    expect(localStorage.length).toBe(0);
  });

  it("returns to the system theme and forgets the stored choice", () => {
    setThemePreference("light");
    setThemePreference("system");
    expect(root.dataset.theme).toBeUndefined();
    expect(sessionStorage.getItem("brawzer:theme")).toBeNull();
    expect(readThemePreference()).toBe("system");
  });

  it("switches the accent and stores only non-default choices", () => {
    setAccent("glacier");
    expect(readAccent()).toBe("glacier");
    expect(sessionStorage.getItem("brawzer:accent")).toBe("glacier");
    setAccent("cobalt");
    expect(sessionStorage.getItem("brawzer:accent")).toBeNull();
  });

  it("notifies subscribers of every change", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToAppearance(listener);
    setThemePreference("dark");
    setAccent("copper");
    unsubscribe();
    setThemePreference("light");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("switches colours without transitions, then restores them", async () => {
    setThemePreference("dark");
    expect(root.dataset.appearanceSwitching).toBe("");
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
    expect(root.dataset.appearanceSwitching).toBeUndefined();
  });
});

describe("theme bootstrap script", () => {
  it("restores stored preferences before the app runs", () => {
    sessionStorage.setItem("brawzer:theme", "dark");
    sessionStorage.setItem("brawzer:accent", "copper");
    runBootstrap();
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.accent).toBe("copper");
  });

  it("ignores tampered or unknown values", () => {
    sessionStorage.setItem("brawzer:theme", "neon");
    sessionStorage.setItem("brawzer:accent", '"><script>');
    runBootstrap();
    expect(root.dataset.theme).toBeUndefined();
    expect(root.dataset.accent).toBeUndefined();
  });

  it("survives storage being unavailable", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(runBootstrap).not.toThrow();
    spy.mockRestore();
  });
});
