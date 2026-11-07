import type { Route } from "next";

export type ReleaseStage = "in-development" | "launched";

/** Site-wide facts. Flip `releaseStage` at launch to remove the pre-launch notices. */
export const site = {
  releaseStage: "in-development" as ReleaseStage,
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100",
};

export interface NavItem {
  href: Route;
  label: string;
}

export const primaryNav: readonly NavItem[] = [
  { href: "/product", label: "Product" },
  { href: "/security", label: "Security" },
  { href: "/profiles", label: "Profiles" },
  { href: "/drive", label: "Drive" },
  { href: "/pricing", label: "Pricing" },
  { href: "/about", label: "About" },
];

/**
 * Link to these with a plain <a>, not next/link. Account pages run under a
 * stricter script policy (src/lib/csp.ts), and a browser keeps the policy of
 * the page it loaded first during client-side navigation, so entering them
 * must be a full page load.
 */
export const accountLinks = {
  signIn: "/sign-in",
  createAccount: "/create-account",
  forgotPassword: "/forgot-password",
} as const satisfies Record<string, Route>;

export const footerNav: readonly { title: string; items: readonly NavItem[] }[] = [
  {
    title: "Product",
    items: [
      { href: "/product", label: "Overview" },
      { href: "/profiles", label: "Browser profiles" },
      { href: "/drive", label: "Brawzer Drive" },
      { href: "/security", label: "Security" },
      { href: "/pricing", label: "Pricing" },
    ],
  },
  { title: "Company", items: [{ href: "/about", label: "About" }] },
  {
    title: "Legal",
    items: [
      { href: "/privacy", label: "Privacy (draft)" },
      { href: "/terms", label: "Terms (draft)" },
    ],
  },
];

/** Every public, indexable page. Used for the sitemap and tests. */
export const publicRoutes: readonly Route[] = [
  "/",
  "/product",
  "/security",
  "/profiles",
  "/drive",
  "/pricing",
  "/about",
  "/privacy",
  "/terms",
];

export const places = [
  "Internet cafés",
  "Libraries",
  "Hotels",
  "Universities",
  "Shared offices",
  "Co-working spaces",
] as const;
