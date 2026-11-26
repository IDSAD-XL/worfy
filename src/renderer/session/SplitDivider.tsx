import { Divider } from '../theme/kit/Divider'

// The divider between two side-by-side panes (worfy-product-session ticket 07: the Mind map and
// the chat of a Product Session). It holds the left pane's share of its parent's width; the parent
// lays the panes out by it. The drag, the keys, the double click and the cancelled drag are those of
// the kit's Divider (theme/kit/Divider.tsx), which the sidebar's edge shares (worfy-polish ticket 158);
// this one counts in shares: a pixel of the pointer is 1 / the parent's width, and each side keeps at
// least `min`.

/** How far one arrow key moves the divider, as a share of the width. */
export const SPLIT_KEY_STEP = 0.05

export interface SplitDividerProps {
  /** The left pane's share of the parent's width, 0–1. */
  share: number
  /** The smallest share either pane keeps. */
  min: number
  /** The share a double click puts back. */
  reset: number
  onMove: (share: number) => void
  onCommit: (share: number) => void
  label: string
  title?: string
  testId?: string
}

/** A share rounded to a tenth of a percent: a drag to 70 / 30 is 0.7, not 0.70000001. */
const roundShare = (share: number): number => Math.round(share * 1000) / 1000
/** A pixel of the pointer as a share of the parent's width; Infinity — no parent width, no drag. */
const sharePerPixel = (divider: HTMLElement): number => 1 / (divider.parentElement?.getBoundingClientRect().width ?? 0)
const percent = (share: number): number => Math.round(share * 100)

export function SplitDivider({ share, min, reset, onMove, onCommit, label, title, testId }: SplitDividerProps) {
  return (
    <Divider
      className="w-split-divider"
      value={share}
      min={min}
      max={1 - min}
      step={SPLIT_KEY_STEP}
      reset={reset}
      perPixel={sharePerPixel}
      round={roundShare}
      ariaValue={percent}
      onMove={onMove}
      onCommit={onCommit}
      label={label}
      title={title}
      testId={testId}
    />
  )
}
