import { PrelaunchBanner, SiteFooter, SiteHeader, SkipLink } from "@/components/site/site-chrome";

/** Public website: banner, header, page content and footer. */
export default function SiteLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SkipLink />
      <PrelaunchBanner />
      <SiteHeader />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
