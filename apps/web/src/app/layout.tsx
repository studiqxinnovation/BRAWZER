import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import { DEFAULT_ACCENT, themeBootstrapScript } from "@/lib/theme";
import "./globals.css";

// Fonts are downloaded at build time and served from Brawzer's own origin:
// the browser never contacts a font provider.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  axes: ["opsz"],
});
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";
// Search engines stay out until launch. Set SITE_INDEXING=enabled to allow them.
const indexingEnabled = process.env.SITE_INDEXING === "enabled";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Brawzer — Browse anywhere. Leave nothing behind.",
    template: "%s · Brawzer",
  },
  description:
    "Brawzer runs your browser in the cloud, so the computer in front of you is only a window to it. Your profiles, history and downloads stay with you, not on the machine.",
  applicationName: "Brawzer",
  referrer: "no-referrer",
  robots: indexingEnabled ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: { type: "website", siteName: "Brawzer", locale: "en" },
  formatDetection: { telephone: false, email: false, address: false },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#121211" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-accent={DEFAULT_ACCENT}
      className={`${inter.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
      </head>
      <body className="min-h-dvh bg-canvas font-sans text-body text-ink antialiased">
        <Providers>
          <div data-brawzer-root className="flex min-h-dvh flex-col">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
