import type { CSSProperties } from 'react'
import type { ContextUsage } from '../../../shared/agent/events'
import { BLOCKED_FROM, WORKING_FROM, type LimitLevel } from '../../../shared/agent/limits'
import { useSessionContext } from '../store'
import type { ComposerItemProps } from './index'

// How full the Session's context window is (worfy-polish ticket 23): a ring filled to the share of
// the window Claude Code's getContextUsage() reports — the numbers of `/context` — and that share
// in words, right after the model, effort and permission pickers. The window is the autocompact window, so 100 % is where
// Claude Code compacts the history, not the model's whole window. main asks after every turn and
// every compaction (src/main/agent/session.ts); until an answer, or when the ask failed, the ring
// is empty and says "no data".
//
// The colours are the levels of the Limits bars (src/renderer/limits/LimitBar.tsx): the same
// shares, and "at the threshold" from the autocompact threshold itself when Claude Code gives one.

/**
 * Right after the pickers (Pickers.tsx, order 10), before the queue (Queue.tsx, order 20): in a
 * narrow column the bar moves the pickers to a second line, and the meter goes along with them.
 */
export const order = 15

const FILL: Record<LimitLevel, string> = {
  normal: 'var(--text-secondary)',
  working: 'var(--working-dot)',
  blocked: 'var(--blocked-ring)',
}

const SIZE = 14
const STROKE = 2
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Normal, nearer the threshold, at it: the shares of the Limits bars, or the threshold's own tokens. */
function levelOf(usage: ContextUsage): LimitLevel {
  const atThreshold = usage.autoCompactEnabled && usage.autoCompactThreshold !== null && usage.totalTokens >= usage.autoCompactThreshold
  if (atThreshold || usage.percentage >= BLOCKED_FROM * 100) return 'blocked'
  if (usage.percentage >= WORKING_FROM * 100) return 'working'
  return 'normal'
}

/** 950, 84.2K, 200K, 1M, 1.2M. */
function tokens(count: number): string {
  const short = (value: number, unit: string) => `${Number(value.toFixed(1))}${unit}`
  if (count >= 1_000_000) return short(count / 1_000_000, 'M')
  if (count >= 1_000) return short(count / 1_000, 'K')
  return String(Math.round(count))
}

/** `84.2K / 200K tokens · autocompact at 167K`, or `… · autocompact off`. */
function titleOf(usage: ContextUsage): string {
  const used = `${tokens(usage.totalTokens)} / ${tokens(usage.windowTokens)} tokens`
  if (!usage.autoCompactEnabled) return `${used} · autocompact off`
  return usage.autoCompactThreshold === null ? used : `${used} · autocompact at ${tokens(usage.autoCompactThreshold)}`
}

const mono: CSSProperties = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }

export default function ContextMeter({ sessionId }: ComposerItemProps) {
  const usage = useSessionContext(sessionId)
  if (sessionId === null) return null

  const level = usage === null ? null : levelOf(usage)
  const share = usage === null ? 0 : Math.min(Math.max(usage.percentage, 0), 100) / 100
  const percent = usage === null ? null : Math.round(usage.percentage)
  const meter =
    usage === null
      ? { 'aria-label': 'Context window: no data' }
      : { role: 'meter', 'aria-label': 'Context window', 'aria-valuenow': percent ?? 0, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuetext': `${percent}% · ${titleOf(usage)}` }

  return (
    <span
      className="w-context-meter"
      data-testid="context-meter"
      data-level={level ?? 'none'}
      title={usage === null ? 'Context window: no data' : titleOf(usage)}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 6px', fontSize: 'var(--text-11)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}
      {...meter}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ flex: 'none' }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--border)" strokeWidth={STROKE} />
        {level !== null && share > 0 ? (
          <circle
            data-testid="context-meter-arc"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={FILL[level]}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * share} ${CIRCUMFERENCE}`}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        ) : null}
      </svg>
      <span data-testid="context-meter-value" style={{ ...(percent === null ? {} : mono), color: level === 'blocked' ? 'var(--blocked-text)' : undefined }}>
        {percent === null ? 'no data' : `${percent}%`}
      </span>
    </span>
  )
}
