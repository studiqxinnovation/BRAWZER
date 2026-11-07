import type { MetadataRoute } from "next";
import { site } from "@/content/site";

/** Search engines are kept out until launch (SITE_INDEXING=enabled). */
export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_INDEXING !== "enabled") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/design", "/dev", "/sign-in", "/create-account"],
      },
    ],
    sitemap: new URL("/sitemap.xml", site.url).toString(),
  };
}
