// Settings → Terminal AI: the switches of Claude's help in the Terminals of this Machine —
// Suggestion and the model behind it, Next command and its model, Command request, Fix — and, for
// a feature the Limits stopped, until when. Main keeps the settings (terminal-ai.json) and decides
// what is on (`terminalAi.state`, useTerminalAi.ts); a switch here only asks for a change.
//
// A switch under a switch that is off takes no click: its value is kept and shown, and the row
// says in words what holds it off, since a dimmed switch alone says it by colour only.
import type { CSSProperties, ReactNode } from 'react'
import type { TerminalAiFeatureState, TerminalAiState } from '../../shared/ipc/terminal-ai'
import { NEXT_COMMAND_MODELS, type NextCommandModel, type TerminalAiSettingsPatch } from '../../shared/terminal-ai/settings'
import { useNow } from '../limits/useLimits'
import { Select, type SelectOption } from '../theme/Select'
import { SettingRow, SettingSwitch } from './controls'
import { useTerminalAi } from './useTerminalAi'

export const order = 50
export const title = 'Terminal AI'

const MODEL_LABELS: Record<NextCommandModel, string> = { sonnet: 'Sonnet', haiku: 'Haiku' }
const MODEL_OPTIONS: readonly SelectOption<NextCommandModel>[] = NEXT_COMMAND_MODELS.map((value) => ({ value, label: MODEL_LABELS[value] }))

const styles = {
  // The rows under a switch they depend on stand one step to the right of it.
  under: { paddingLeft: 'var(--space-4)' },
  note: { display: 'block' },
  // The blocked colour of the theme, as the Limits themselves; the words carry the meaning.
  paused: { display: 'block', color: 'var(--blocked-text)' },
  problem: { margin: 'var(--space-2) 0 0', color: 'var(--blocked-text)', fontSize: 'var(--text-12)', overflowWrap: 'anywhere' },
} satisfies Record<string, CSSProperties>

const clock = (ms: number, timeZone: string | undefined): string => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(ms)
const weekday = (ms: number, timeZone: string | undefined): string => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(ms)
const day = (ms: number, timeZone: string | undefined): string => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(ms)

/** `Paused by Limits until 14:20`, with the day (`Thu 09:00`) when that is not today — as the Limits write a reset. */
function pausedUntil(until: number, now: number, timeZone: string | undefined): string {
  const sameDay = day(until, timeZone) === day(now, timeZone)
  return `Paused by Limits until ${sameDay ? '' : `${weekday(until, timeZone)} `}${clock(until, timeZone)}`
}

interface RowProps {
  /** The row's name in test ids: `terminal-ai-<id>-row`, `-note`, `-status`. */
  id: string
  label: string
  hint: ReactNode
  /** What holds the row off ("Off while Terminal AI is off."); undefined when its control works. */
  heldOff: string | undefined
  /** `Paused by Limits until …` of the row's feature; undefined when it is not paused. */
  paused?: string | undefined
  /** The control at the right. */
  children: ReactNode
}

/** One setting of the section: the hint, then what holds the row off or, failing that, the pause of its feature. */
function Row({ id, label, hint, heldOff, paused, children }: RowProps) {
  return (
    <SettingRow
      label={label}
      description={
        <>
          {hint}
          {heldOff !== undefined ? (
            <span style={styles.note} data-testid={`terminal-ai-${id}-note`}>
              {heldOff}
            </span>
          ) : paused !== undefined ? (
            <span role="status" style={styles.paused} data-testid={`terminal-ai-${id}-status`}>
              {paused}
            </span>
          ) : null}
        </>
      }
      testId={`terminal-ai-${id}-row`}
    >
      {children}
    </SettingRow>
  )
}

export interface TerminalAiSectionViewProps {
  state: TerminalAiState
  onChange: (patch: TerminalAiSettingsPatch) => void
  /** Why the last change was not saved. */
  problem?: string | undefined
  /** The time now: a pause that lifts on another day names the day. */
  now: number
  /** IANA time zone of the times shown; the system's when omitted. Tests pass a fixed one. */
  timeZone?: string
}

/** The section over a state: what it shows and what a click asks for. */
export function TerminalAiSectionView({ state, onChange, problem, now, timeZone }: TerminalAiSectionViewProps) {
  const { settings, features } = state
  const pauseOf = (feature: TerminalAiFeatureState): string | undefined => (feature.state === 'paused' ? pausedUntil(feature.until, now, timeZone) : undefined)

  const allOff = settings.enabled ? undefined : 'Off while Terminal AI is off.'
  const modelOff = allOff ?? (settings.suggestion ? undefined : 'Off while Suggestion is off.')
  const nextModelOff = allOff ?? (settings.nextCommand ? undefined : 'Off while Next command is off.')

  return (
    <div data-testid="settings-terminal-ai">
      <Row
        id="enabled"
        label="Terminal AI"
        heldOff={undefined}
        hint={
          <>
            Claude suggests commands and never runs them. <span data-testid="terminal-ai-zsh">Works in zsh Terminals.</span>
          </>
        }
      >
        <SettingSwitch label="Terminal AI" testId="terminal-ai-enabled" checked={settings.enabled} onChange={(enabled) => onChange({ enabled })} />
      </Row>
      <div style={styles.under}>
        <Row id="suggestion" label="Suggestion" hint="Grey text after the cursor, from your command history." heldOff={allOff}>
          <SettingSwitch label="Suggestion" testId="terminal-ai-suggestion" checked={settings.suggestion} disabled={allOff !== undefined} onChange={(suggestion) => onChange({ suggestion })} />
        </Row>
        <div style={styles.under}>
          <Row id="suggestion-model" label="Ask Claude when history has nothing" hint="Claude continues the line after a short pause in typing." heldOff={modelOff} paused={pauseOf(features.suggest)}>
            <SettingSwitch
              label="Ask Claude when history has nothing"
              testId="terminal-ai-suggestion-model"
              checked={settings.suggestionAsksModel}
              disabled={modelOff !== undefined}
              onChange={(suggestionAsksModel) => onChange({ suggestionAsksModel })}
            />
          </Row>
        </div>
        <Row id="next" label="Next command" hint="On an empty line after a command, Claude suggests what to run next." heldOff={allOff} paused={pauseOf(features.next)}>
          <SettingSwitch label="Next command" testId="terminal-ai-next" checked={settings.nextCommand} disabled={allOff !== undefined} onChange={(nextCommand) => onChange({ nextCommand })} />
        </Row>
        <div style={styles.under}>
          <Row id="next-model" label="Next command model" hint="The model that suggests the Next command." heldOff={nextModelOff}>
            <Select
              aria-label="Next command model"
              data-testid="terminal-ai-next-model"
              value={settings.nextCommandModel}
              options={MODEL_OPTIONS}
              disabled={nextModelOff !== undefined}
              onChange={(nextCommandModel) => onChange({ nextCommandModel })}
            />
          </Row>
        </div>
        <Row id="request" label="Command request" hint="Say what you need in words: Claude writes the command." heldOff={allOff} paused={pauseOf(features.request)}>
          <SettingSwitch label="Command request" testId="terminal-ai-request" checked={settings.commandRequest} disabled={allOff !== undefined} onChange={(commandRequest) => onChange({ commandRequest })} />
        </Row>
        <Row id="fix" label="Fix" hint="After a command fails, Claude writes a corrected one." heldOff={allOff} paused={pauseOf(features.fix)}>
          <SettingSwitch label="Fix" testId="terminal-ai-fix" checked={settings.fix} disabled={allOff !== undefined} onChange={(fix) => onChange({ fix })} />
        </Row>
      </div>
      {problem !== undefined ? (
        <p role="alert" style={styles.problem} data-testid="terminal-ai-problem">
          Not saved: {problem}
        </p>
      ) : null}
    </div>
  )
}

export default function TerminalAiSection() {
  const { state, problem, change } = useTerminalAi()
  const now = useNow()
  if (state === undefined) {
    // Nothing to show until main has answered — a few milliseconds — unless it could not.
    return problem === undefined ? null : (
      <p role="alert" style={styles.problem} data-testid="terminal-ai-unavailable">
        Terminal AI settings are unavailable: {problem}
      </p>
    )
  }
  return <TerminalAiSectionView state={state} onChange={change} problem={problem} now={now} />
}
