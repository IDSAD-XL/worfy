import type { CSSProperties } from 'react'
import type { LimitBar, LimitLevel } from '../../shared/agent/limits'

// One Limits window drawn as a bar in the toolbar (src/renderer/shell/toolbar/LimitsMeter.tsx).
// The Limits are shown only there: the Session view's rail no longer repeats them.

const FILL: Record<LimitLevel, string> = {
  normal: 'var(--text-secondary)',
  working: 'var(--working-dot)',
  blocked: 'var(--blocked-ring)',
}

const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

/** The share as a bar; an empty track when the source gave no share. */
function Meter({ bar, height }: { bar: LimitBar; height: number }) {
  const track: CSSProperties = { height, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }
  if (bar.percent === null) return <div style={track} aria-hidden="true" />
  return (
    <div role="meter" aria-label={`${bar.label} limit`} aria-valuenow={bar.percent} aria-valuemin={0} aria-valuemax={100} style={track}>
      <div style={{ width: `${Math.min(bar.percent, 100)}%`, height, background: FILL[bar.level] }} />
    </div>
  )
}

/** One window: label, share (or status in words), bar, reset time and, when old, "as of". */
export function LimitBarView({ bar }: { bar: LimitBar }) {
  const valueColor = bar.level === 'blocked' ? 'var(--blocked-text)' : 'var(--text)'
  const note = [bar.resets, bar.asOf].filter((part) => part !== null).join(' · ')
  const common = { 'data-testid': `limit-${bar.window}`, 'data-level': bar.level }

  // The toolbar gives a bar 104 px (F-SPEC): the reset time and "as of" go on a line each, the
  // word in the UI font and the time in mono as in the F mockup, and the full note is the tooltip.
  // Two lines are tighter (2 px gaps, 12 px lines) so the bar stays inside the 52 px toolbar.
  const twoLines = bar.resets !== null && bar.asOf !== null
  const lineHeight = twoLines ? '12px' : '13px'
  return (
    <div {...common} style={{ display: 'flex', flexDirection: 'column', gap: twoLines ? 2 : 3, width: 104 }}>
      {/* One line: a status in words ("limit reached") is set in the UI font, which is narrower
          than mono, and anything still wider ends with an ellipsis instead of wrapping. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 2, fontSize: 'var(--text-11)', lineHeight: '13px', whiteSpace: 'nowrap' }}>
        <span style={{ flex: 'none', color: 'var(--text-secondary)' }}>{bar.label}</span>
        <span
          title={bar.value}
          style={{ ...(bar.percent === null ? {} : mono), minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 600, color: valueColor }}
          data-testid={`limit-${bar.window}-value`}
        >
          {bar.value}
        </span>
      </div>
      <Meter bar={bar} height={4} />
      {note && (
        <div title={note} style={{ fontSize: 'var(--text-11)', lineHeight, color: 'var(--text-muted)' }} data-testid={`limit-${bar.window}-note`}>
          {bar.resets !== null && <NoteLine text={bar.resets} testId={`limit-${bar.window}-resets`} />}
          {bar.asOf !== null && <NoteLine text={bar.asOf} testId={`limit-${bar.window}-as-of`} />}
        </div>
      )}
    </div>
  )
}

/** The words a toolbar note line starts with; the rest of the line is a time. */
const NOTE_WORDS = ['resets ', 'as of ']

/**
 * One line of a toolbar note, `resets Thu 09:00` or `as of Mon 04:53`: the word in the UI font,
 * the time in mono. A line wider than the bar ends with an ellipsis rather than running into the
 * next bar; the full note is the title of the whole note.
 */
function NoteLine({ text, testId }: { text: string; testId: string }) {
  const word = NOTE_WORDS.find((start) => text.startsWith(start))
  const line: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  if (word === undefined) {
    return (
      <div style={{ ...line, ...mono }} data-testid={testId}>
        {text}
      </div>
    )
  }
  return (
    <div style={line} data-testid={testId}>
      {word}
      <span style={mono}>{text.slice(word.length)}</span>
    </div>
  )
}
