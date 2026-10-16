// Settings → Sessions (worfy-polish ticket 24): the autocompact window of a Session, the number of
// tokens Claude Code lets the context grow to before it compacts the history. Two app settings of
// this Machine (src/shared/settings/app-settings.ts): one for every Project's Orchestrator — under
// Autopilot too, and its Subagents, which compact at their parent's window — and one for every
// other Session. Each is a window in thousands of tokens (100K–1M by steps of 10K) or "Claude Code
// default": worfy then passes nothing, and the user's settings.json and Claude Code decide.
//
// Main reads the window when a Session starts Claude Code (src/main/agent/app-registry.ts): a
// running Session keeps its own until it is started again, and worfy restarts none by itself.
// CLAUDE_CODE_AUTO_COMPACT_WINDOW in the login shell environment wins over both settings; the
// section says so when main finds it there (`sessionAutocompact.shellOverride`).
import { useEffect, useId, useState, type CSSProperties } from 'react'
import {
  AUTO_COMPACT_WINDOW_DEFAULTS,
  AUTO_COMPACT_WINDOW_MAX,
  AUTO_COMPACT_WINDOW_MIN,
  AUTO_COMPACT_WINDOW_STEP,
  clampAutoCompactWindow,
} from '../../shared/settings/app-settings'
import { invoke } from '../ipc'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow } from './controls'
import { setAppSettings, useAppSettings } from './useAppSettings'

export const order = 60
export const title = 'Sessions'

/** Which window: a Project's Orchestrator, or any other Session. */
export type WindowRole = 'orchestrator' | 'other'

/** The hint next to the windows: the threshold sits below the window. */
export const BELOW_WINDOW_HINT = 'Autocompact runs a little below this: Claude Code keeps room for the summary.'
/** Under each field: a running Session keeps its window. */
export const RESTART_HINT = 'Applies after restarting the Session.'
/** The line shown when the login shell sets the window for every Session. */
export const SHELL_OVERRIDE_TEXT = 'Overridden by CLAUDE_CODE_AUTO_COMPACT_WINDOW in your shell'

const THOUSAND = 1000

const ROLES: readonly { role: WindowRole; label: string; description: string }[] = [
  { role: 'orchestrator', label: 'Orchestrator', description: 'The Orchestrator of each Project, under Autopilot too. Its Subagents compact at the same window.' },
  { role: 'other', label: 'Other Sessions', description: 'Sessions opened on the Canvas.' },
]

type Mode = 'default' | 'custom'

const MODE_OPTIONS: readonly SelectOption<Mode>[] = [
  { value: 'default', label: 'Claude Code default' },
  { value: 'custom', label: 'Custom' },
]

const styles = {
  control: { display: 'flex', alignItems: 'center', gap: 'var(--space-2)' },
  input: {
    width: 64,
    height: 'var(--row-height)',
    boxSizing: 'border-box',
    padding: '0 var(--space-2)',
    borderRadius: 'var(--radius-button)',
    border: '1px solid var(--border-strong)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 'var(--text-12)',
    fontVariantNumeric: 'tabular-nums',
    textAlign: 'right',
  },
  unit: { color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  notes: { margin: 'var(--space-3) 0 0', color: 'var(--text-secondary)', fontSize: 'var(--text-12)' },
  override: { margin: '0 0 var(--space-2)', fontSize: 'var(--text-12)', color: 'var(--text)' },
} satisfies Record<string, CSSProperties>

/** A window in tokens as the field shows it: 400 000 → "400". */
const toThousands = (tokens: number): string => String(Math.round(tokens / THOUSAND))

/**
 * What the field's text asks for: thousands of tokens brought into 100K–1M on a step of 10K
 * ("450" → 450 000, "5" → 100 000, "1200" → 1 000 000); undefined when it is no number at all, so
 * the field goes back to the window in force.
 */
function windowFromText(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const thousands = Number(trimmed)
  if (!Number.isFinite(thousands)) return undefined
  return clampAutoCompactWindow(thousands * THOUSAND) ?? undefined
}

/** CLAUDE_CODE_AUTO_COMPACT_WINDOW of the Sessions' environment, asked once; null while unknown or absent. */
function useShellOverride(): string | null {
  const [value, setValue] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void invoke('sessionAutocompact.shellOverride').then((result) => {
      if (live && result.ok) setValue(result.value.value)
    })
    return () => {
      live = false
    }
  }, [])
  return value
}

/** One window: "Claude Code default" or "Custom", and the custom window in thousands of tokens. */
function WindowRow({ role, label, description }: { role: WindowRole; label: string; description: string }) {
  const current = useAppSettings((settings) => settings.autoCompactWindow[role])
  // The text being typed, from the first key until the field commits it; undefined shows the window in force.
  const [draft, setDraft] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const fieldId = useId()

  const save = (next: number | null): void => {
    void setAppSettings({ autoCompactWindow: role === 'orchestrator' ? { orchestrator: next } : { other: next } }).then(setProblem)
  }

  const commit = (): void => {
    if (draft === undefined) return
    const next = windowFromText(draft)
    setDraft(undefined)
    if (next !== undefined && next !== current) save(next)
  }

  return (
    <SettingRow
      label={<label htmlFor={current === null ? undefined : fieldId}>{label}</label>}
      description={
        <>
          {description}
          <br />
          {problem === undefined ? (
            RESTART_HINT
          ) : (
            <span role="alert" data-testid={`settings-autocompact-${role}-problem`}>
              Not saved: {problem}
            </span>
          )}
        </>
      }
      testId={`settings-autocompact-${role}-row`}
    >
      <div style={styles.control}>
        <Select
          aria-label={`${label} autocompact window`}
          data-testid={`settings-autocompact-${role}-mode`}
          value={current === null ? 'default' : 'custom'}
          options={MODE_OPTIONS}
          onChange={(mode) => {
            setDraft(undefined)
            save(mode === 'default' ? null : AUTO_COMPACT_WINDOW_DEFAULTS[role])
          }}
        />
        {current === null ? null : (
          <>
            <input
              id={fieldId}
              type="number"
              inputMode="numeric"
              style={styles.input}
              min={AUTO_COMPACT_WINDOW_MIN / THOUSAND}
              max={AUTO_COMPACT_WINDOW_MAX / THOUSAND}
              step={AUTO_COMPACT_WINDOW_STEP / THOUSAND}
              value={draft ?? toThousands(current)}
              aria-label={`${label} autocompact window, thousands of tokens`}
              data-testid={`settings-autocompact-${role}`}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
              }}
            />
            <span style={styles.unit} aria-hidden="true">
              K tokens
            </span>
          </>
        )}
      </div>
    </SettingRow>
  )
}

export default function SessionsSection() {
  const shellOverride = useShellOverride()
  return (
    <>
      {shellOverride === null ? null : (
        <p role="note" style={styles.override} data-testid="settings-autocompact-shell-override">
          {SHELL_OVERRIDE_TEXT} ({shellOverride}).
        </p>
      )}
      {ROLES.map((each) => (
        <WindowRow key={each.role} {...each} />
      ))}
      <p style={styles.notes} data-testid="settings-autocompact-hint">
        {BELOW_WINDOW_HINT}
      </p>
    </>
  )
}
