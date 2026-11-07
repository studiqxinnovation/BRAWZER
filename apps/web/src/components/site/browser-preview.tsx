import { Mark } from "@brawzer/ui/brand";
import { StatusDot } from "@brawzer/ui/components/status-dot";
import { cn } from "@brawzer/ui/lib/cn";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Download,
  Ellipsis,
  FileText,
  Lock,
  Plus,
  RotateCw,
  ShieldCheck,
  X,
} from "lucide-react";

/** Night-sky "photo" inside the sample article. Fixed colours: it's an image, not UI. */
function AuroraArt({ idPrefix }: { idPrefix: string }) {
  const sky = `${idPrefix}-sky`;
  const glowA = `${idPrefix}-glow-a`;
  const glowB = `${idPrefix}-glow-b`;
  const blur = `${idPrefix}-blur`;
  return (
    <svg viewBox="0 0 320 240" preserveAspectRatio="xMidYMid slice" className="size-full">
      <defs>
        <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1128" />
          <stop offset="1" stopColor="#163a50" />
        </linearGradient>
        <linearGradient id={glowA} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#4fe3a4" stopOpacity="0" />
          <stop offset="0.45" stopColor="#4fe3a4" stopOpacity="0.9" />
          <stop offset="1" stopColor="#4fe3a4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={glowB} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#38bdf8" stopOpacity="0" />
          <stop offset="0.6" stopColor="#5eead4" stopOpacity="0.7" />
          <stop offset="1" stopColor="#38bdf8" stopOpacity="0" />
        </linearGradient>
        <filter id={blur} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>
      <rect width="320" height="240" fill={`url(#${sky})`} />
      {[
        [24, 22, 0.9],
        [70, 48, 0.6],
        [118, 18, 0.8],
        [168, 40, 0.5],
        [214, 14, 0.9],
        [262, 36, 0.7],
        [298, 20, 0.6],
        [146, 70, 0.4],
        [40, 86, 0.5],
        [284, 80, 0.4],
      ].map(([cx = 0, cy = 0, opacity = 1]) => (
        <circle
          key={`${String(cx)}-${String(cy)}`}
          cx={cx}
          cy={cy}
          r="1.2"
          fill="#ffffff"
          opacity={opacity}
        />
      ))}
      <path
        d="M-10 120 C 50 70, 110 140, 170 96 S 270 60, 330 100 L 330 136 C 270 112, 220 160, 160 134 S 40 150, -10 160 Z"
        fill={`url(#${glowA})`}
        filter={`url(#${blur})`}
      />
      <path
        d="M-10 96 C 60 60, 120 104, 190 72 S 290 54, 330 70 L 330 92 C 280 82, 230 110, 170 100 S 50 108, -10 122 Z"
        fill={`url(#${glowB})`}
        filter={`url(#${blur})`}
        opacity="0.8"
      />
      <path
        d="M0 196 L 54 150 L 92 178 L 146 128 L 206 182 L 250 150 L 320 192 L 320 240 L 0 240 Z"
        fill="#0f1a33"
      />
      <path
        d="M0 214 L 70 182 L 128 206 L 190 176 L 252 208 L 320 190 L 320 240 L 0 240 Z"
        fill="#080d1d"
      />
    </svg>
  );
}

function TabChip({
  title,
  favicon,
  faviconColor,
  active = false,
  className,
}: {
  title: string;
  favicon: string;
  faviconColor: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-t-lg px-3 text-footnote",
        active ? "border border-b-0 border-line bg-surface text-ink" : "text-ink-tertiary",
        className,
      )}
    >
      <span
        className="flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[0.5625rem] font-bold text-white"
        style={{ backgroundColor: faviconColor }}
      >
        {favicon}
      </span>
      <span className="truncate">{title}</span>
      <X className="ml-1 size-3 shrink-0 opacity-60" />
    </div>
  );
}

/**
 * Illustration of the Brawzer browser: Brawzer's own tabs and toolbar around
 * a page that runs in the cloud. Purely visual; described by its label.
 */
export function BrowserPreview({
  className,
  idPrefix = "preview",
}: {
  className?: string;
  idPrefix?: string;
}) {
  return (
    <figure
      role="img"
      aria-label="Illustration of the Brawzer browser: an article open in the Personal profile, marked as isolated in the cloud, with a download saved to Brawzer Drive."
      className={cn("relative", className)}
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-line-strong bg-surface shadow-xl"
      >
        {/* Tab strip: Brawzer's own, drawn on this computer. */}
        <div className="flex items-end gap-1 border-b border-line bg-canvas-subtle px-3 pt-2">
          <Mark size={16} className="mr-2 mb-2.5 text-ink" />
          <TabChip
            active
            title="Where to see the northern lights"
            favicon="D"
            faviconColor="#2b4a8b"
            className="max-w-64"
          />
          <TabChip
            title="Trip plan"
            favicon="T"
            faviconColor="#237a6f"
            className="hidden max-w-40 sm:flex"
          />
          <TabChip
            title="Inbox"
            favicon="M"
            faviconColor="#a2552a"
            className="hidden max-w-36 lg:flex"
          />
          <Plus className="mb-2.5 ml-1 size-3.5 shrink-0 text-ink-tertiary" />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-2">
          <ChevronLeft className="size-4 text-ink-secondary" />
          <ChevronRight className="size-4 text-ink-tertiary" />
          <RotateCw className="mx-1 size-3.5 text-ink-secondary" />
          <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-canvas-subtle px-3 text-footnote">
            <Lock className="size-3 shrink-0 text-ink-secondary" />
            <span className="text-ink">daily.example</span>
            <span className="truncate text-ink-tertiary">/science/northern-lights</span>
          </div>
          <span className="hidden h-7 items-center gap-1.5 rounded-full bg-success-soft px-2.5 text-caption font-medium text-success sm:inline-flex">
            <ShieldCheck className="size-3.5" />
            Isolated
          </span>
          <span className="hidden h-7 items-center gap-1.5 rounded-full border border-line px-1.5 pr-2 text-caption font-medium text-ink md:inline-flex">
            <span className="flex size-5 items-center justify-center rounded-full bg-[#4a5bd4] text-[0.625rem] font-semibold text-white">
              P
            </span>
            Personal
            <ChevronDown className="size-3 text-ink-tertiary" />
          </span>
          <span className="relative flex size-7 items-center justify-center rounded-md bg-hover">
            <Download className="size-3.5 text-ink" />
            <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full border-2 border-surface bg-accent" />
          </span>
          <Ellipsis className="ml-1 size-4 text-ink-secondary" />
        </div>

        {/* The page itself, running in the cloud. */}
        <div className="grid gap-8 bg-surface p-6 sm:p-10 md:grid-cols-[1.25fr_1fr]">
          <div className="min-w-0">
            <p className="text-caption font-semibold tracking-wide text-accent-ink uppercase">
              Science
            </p>
            <p className="mt-2 text-title-3 text-balance text-ink sm:text-title-2">
              Where to see the northern lights this weekend
            </p>
            <p className="mt-2 text-footnote text-ink-tertiary">6 min read</p>
            <div className="mt-6 space-y-2.5">
              <div className="h-2 w-[96%] rounded-full bg-hover" />
              <div className="h-2 w-[88%] rounded-full bg-hover" />
              <div className="h-2 w-[93%] rounded-full bg-hover" />
              <div className="h-2 w-[64%] rounded-full bg-hover" />
            </div>
            <div className="mt-6 space-y-2.5">
              <div className="h-2 w-[90%] rounded-full bg-hover" />
              <div className="h-2 w-[72%] rounded-full bg-hover" />
            </div>
          </div>
          <div className="hidden aspect-[4/3] overflow-hidden rounded-lg md:block">
            <AuroraArt idPrefix={idPrefix} />
          </div>
        </div>

        {/* Status bar */}
        <div className="flex h-8 items-center gap-4 border-t border-line bg-canvas-subtle px-4 text-caption text-ink-secondary">
          <span className="flex items-center gap-1.5">
            <StatusDot tone="success" />
            Cloud session · Frankfurt
          </span>
          <span className="hidden sm:inline">Proxy · SOCKS5</span>
          <span className="ml-auto hidden md:inline">Cookies and history kept in the cloud</span>
        </div>
      </div>

      {/* Download bubble, anchored under the toolbar's download button. */}
      <div
        aria-hidden="true"
        className="absolute top-[5.25rem] right-10 hidden w-72 rounded-lg border border-line bg-surface-raised p-3 shadow-lg lg:block"
      >
        <p className="text-caption font-semibold text-ink-secondary">Saved to Brawzer Drive</p>
        <div className="mt-2 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger">
            <FileText className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-footnote font-medium text-ink">Aurora-forecast.pdf</p>
            <p className="text-caption text-ink-tertiary">284 KB · Scanned</p>
          </div>
          <CircleCheck className="ml-auto size-4 shrink-0 text-success" />
        </div>
      </div>
    </figure>
  );
}
