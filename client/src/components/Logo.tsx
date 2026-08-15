import { cn } from '../lib/cn';

/**
 * The lens mark: a magnifying glass on an indigo disc, with one off-centre
 * highlight on the glass.
 *
 * Extracted from the 48px entry of the design's size ladder — the full-detail
 * variant, the only one that carries the highlight arc. The 16px variant
 * (highlight dropped, strokes thickened) is a separate asset and lives in
 * `client/public/favicon.svg`; the two are not one component with a prop,
 * because they are different drawings rather than one drawing at two sizes.
 *
 * **The disc is `currentColor` and the glyph is white.** That split is the
 * design's, not a shortcut: the spec hardcodes `#fff` on the glyph in both the
 * light and the dark lockup and varies only the disc, #455492 to #6E81CF.
 * Those two values are exactly `--primary` in the two themes
 * (`228 36% 42%` and `228 50% 62%`), so a caller writing `text-primary` gets
 * the design's own pair with nothing restating the hex.
 *
 * **No width or height attribute**, so the mark is sized entirely by the class
 * the caller passes. The viewBox is the source's `0 0 32 32`; the glyph sits
 * inside it under the spec's own proportion — a 29px drawing in a 48px disc,
 * hence the 0.604167 scale and the 6.333 inset that centres it.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('flex-shrink-0', className)}
      role="img"
      aria-label="FPL Lens"
    >
      <circle cx="16" cy="16" r="16" fill="currentColor" />
      <g
        transform="translate(6.333 6.333) scale(0.604167)"
        fill="none"
        stroke="#fff"
        strokeWidth="1.9"
        strokeLinecap="round"
      >
        <circle cx="13.8" cy="13.8" r="8.3" />
        <path d="M19.7 19.7 L26.4 26.4" />
        {/* The highlight, drawn a touch heavier than the glass it sits on. */}
        <path d="M9.2 11.2 A5.5 5.5 0 0 1 11.6 8.5" strokeWidth="2.38" />
      </g>
    </svg>
  );
}
