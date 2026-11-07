/**
 * A short, human description of a device for security notices and the
 * signed-in devices list, such as "Chrome on Windows". Best effort only:
 * user agents are self-reported and easy to fake, so this is never used for
 * security decisions.
 */
export function describeUserAgent(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;

  const browser = /\bEdg(?:e|A|iOS)?\//.test(userAgent)
    ? "Microsoft Edge"
    : /\b(?:OPR|Opera)\//.test(userAgent)
      ? "Opera"
      : /\bSamsungBrowser\//.test(userAgent)
        ? "Samsung Internet"
        : /\b(?:Firefox|FxiOS)\//.test(userAgent)
          ? "Firefox"
          : /\b(?:Chrome|CriOS)\//.test(userAgent)
            ? "Chrome"
            : /\bVersion\/[\d.]+.*\bSafari\//.test(userAgent)
              ? "Safari"
              : null;

  const os = /\b(?:iPhone|iPad|iPod)\b/.test(userAgent)
    ? "iOS"
    : /\bAndroid\b/.test(userAgent)
      ? "Android"
      : /\bCrOS\b/.test(userAgent)
        ? "ChromeOS"
        : /\bWindows\b/.test(userAgent)
          ? "Windows"
          : /\bMac OS X\b|\bMacintosh\b/.test(userAgent)
            ? "macOS"
            : /\bLinux\b/.test(userAgent)
              ? "Linux"
              : null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}
