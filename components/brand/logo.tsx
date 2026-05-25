import { cn } from "@/lib/utils";

interface LogoProps {
  className?: string;
  /** show wordmark beside the symbol */
  showWord?: boolean;
  size?: number;
}

/**
 * Lumen mark — original. A nested aperture / lens with a focal dot, evoking
 * "light gathered to a point". Built with simple geometry, no external assets.
 */
export function Logo({ className, showWord = true, size = 28 }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        className="shrink-0"
      >
        <defs>
          <linearGradient id="lumen-grad" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%" stopColor="oklch(0.86 0.14 75)" />
            <stop offset="55%" stopColor="oklch(0.74 0.18 65)" />
            <stop offset="100%" stopColor="oklch(0.70 0.16 195)" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="14" stroke="url(#lumen-grad)" strokeWidth="2" />
        <circle cx="16" cy="16" r="8.5" stroke="url(#lumen-grad)" strokeWidth="1.5" opacity="0.85" />
        <circle cx="16" cy="16" r="3" fill="url(#lumen-grad)" />
        <path
          d="M16 2 L16 6 M16 26 L16 30 M2 16 L6 16 M26 16 L30 16"
          stroke="url(#lumen-grad)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity="0.7"
        />
      </svg>
      {showWord && (
        <span className="font-display text-[19px] tracking-tight font-medium leading-none">
          Lumen
          <span className="ml-1 text-[11px] font-sans text-muted-foreground tracking-widest uppercase">流明</span>
        </span>
      )}
    </span>
  );
}
