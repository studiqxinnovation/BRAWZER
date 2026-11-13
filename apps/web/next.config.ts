import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.resolve(import.meta.dirname, "../..");

// Local development reads the workspace-root .env. Deployed environments
// provide variables directly. Only NEXT_PUBLIC_* values ever reach the browser.
try {
  process.loadEnvFile(path.join(workspaceRoot, ".env"));
} catch {
  // No .env file: rely on the environment.
}

const isDev = process.env.NODE_ENV !== "production";
const apiOrigin = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4100";
// HTTPS-only directives apply where the site is actually served over HTTPS, so a
// production build can still be tried locally on http://localhost.
const servedOverHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

/**
 * The page may only load resources from Brawzer itself. In particular the
 * computer in front of the user never contacts third parties: no external
 * fonts, analytics or scripts.
 *
 * This is the site-wide policy for prerendered public pages, which render no
 * user data. It still allows inline scripts, because per-request nonces can't
 * be combined with prerendering. Account pages and the signed-in app replace
 * it with a strict nonce-based policy set per request in src/proxy.ts (see
 * src/lib/csp.ts and docs/adr/0007-content-security-policy.md).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  ...(servedOverHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), display-capture=(), browsing-topics=()",
  },
  ...(servedOverHttps
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  // A self-contained server for container images (apps/web/Dockerfile).
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  reactStrictMode: true,
  poweredByHeader: false,
  // No "N" button in the corner while developing: it reads as part of the desktop.
  devIndicators: false,
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@brawzer/ui"],
  turbopack: {
    root: workspaceRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  headers: () =>
    Promise.resolve([
      { source: "/:path*", headers: securityHeaders },
      {
        // The desktop shows cloud browsers in windows by framing this page
        // (src/proxy.ts sets its policy's frame-ancestors to 'self' as well).
        source: "/app/browser/window",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
      {
        // Signed-in pages show account data: never cache them (a shared
        // computer's next user must not see them) and never index them.
        source: "/app/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ]),
  // The browser talks to one origin; the web server forwards API calls. That
  // keeps cookies first-party (__Host- prefix) and removes any CORS surface.
  rewrites: () =>
    Promise.resolve([{ source: "/api/v1/:path*", destination: `${apiOrigin}/api/v1/:path*` }]),
};

export default nextConfig;
