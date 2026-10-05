import { useCallback, useEffect, useState } from 'react'
import { EFFORT_LEVELS, PERMISSION_MODES, type ModelOption, type PermissionModeChoice, type SettingsChange } from '../../../shared/agent/settings'
import { invoke } from '../../ipc'
import { useSessionControls } from '../store'
import type { ComposerItemProps } from './index'

// The model, effort and permission mode of the Session, under its input field (ticket 19). A
// change goes to main (`agent.configure`), which applies it to the live Session without a restart
// and to every later start of it; the pickers then show what main reports (`settings` events).
// The models come from Claude Code (`agent.models`: supportedModels(), or the model of the last
// system/init). Claude Code does not report the effort it applies (ticket 06), so the effort
// shown is the level worfy asked for.

export const order = 10

const MODE_LABELS: Record<PermissionModeChoice, string> = {
  bypassPermissions: 'Bypass permissions',
  acceptEdits: 'Accept edits',
  default: 'Ask before tools',
  plan: 'Plan only',
}

/** The select value of the default model, which setModel() takes as undefined. */
const DEFAULT_VALUE = ''

/** The models of a Session; fetched again on focus, as the list may grow after the first turn. */
function useModels(sessionId: string | null): { models: readonly ModelOption[]; refresh: () => void } {
  const [found, setFound] = useState<{ sessionId: string; models: readonly ModelOption[] } | null>(null)
  const refresh = useCallback(() => {
    if (sessionId === null) return
    void invoke('agent.models', { sessionId }).then((result) => {
      if (result.ok) setFound({ sessionId, models: result.value.models })
      else console.error(`agent.models ${sessionId} failed:`, result.error)
    })
  }, [sessionId])
  useEffect(refresh, [refresh])
  return { models: found !== null && found.sessionId === sessionId ? found.models : [], refresh }
}

export default function Pickers({ sessionId }: ComposerItemProps) {
  const { settings } = useSessionControls(sessionId)
  const { models, refresh } = useModels(sessionId)
  const [error, setError] = useState<string | null>(null)
  const disabled = sessionId === null || settings === null

  const configure = (change: SettingsChange) => {
    if (sessionId === null) return
    setError(null)
    void invoke('agent.configure', { sessionId, change }).then((result) => {
      if (!result.ok) setError(result.error)
    })
  }

  const model = settings?.model ?? null
  // A saved model Claude Code no longer lists still shows as picked.
  const rows = model !== null && !models.some((row) => row.value === model) ? [...models, { value: model, displayName: model, efforts: [] }] : models
  const picked = rows.find((row) => row.value === model)
  const efforts = picked === undefined && models.length === 0 ? EFFORT_LEVELS : (picked?.efforts ?? [])
  const effort = settings?.effort ?? null
  const effortRows = effort !== null && !efforts.includes(effort) ? [...efforts, effort] : efforts
  /** A model change; an effort level the new model does not list goes back to the model's default with it. */
  const modelChange = (next: string | null): SettingsChange => {
    const target = models.find((row) => row.value === next)
    return target !== undefined && effort !== null && !target.efforts.includes(effort) ? { model: next, effort: null } : { model: next }
  }

  return (
    <span className="w-pickers" data-testid="pickers">
      <select
        className="w-pickers__select w-mono"
        aria-label="Model"
        data-testid="picker-model"
        disabled={disabled}
        value={model ?? DEFAULT_VALUE}
        onFocus={refresh}
        onChange={(event) => configure(modelChange(event.target.value === DEFAULT_VALUE ? null : event.target.value))}
      >
        {rows.some((row) => row.value === null) ? null : <option value={DEFAULT_VALUE}>Default model</option>}
        {rows.map((row) => (
          <option key={row.value ?? DEFAULT_VALUE} value={row.value ?? DEFAULT_VALUE}>
            {row.displayName}
          </option>
        ))}
      </select>
      <select
        className="w-pickers__select w-mono"
        aria-label="Effort"
        title="Claude Code does not report the effort it applies: this is the level worfy asked for"
        data-testid="picker-effort"
        disabled={disabled || effortRows.length === 0}
        value={effort ?? DEFAULT_VALUE}
        onChange={(event) => {
          const level = EFFORT_LEVELS.find((each) => each === event.target.value)
          configure({ effort: level ?? null })
        }}
      >
        <option value={DEFAULT_VALUE}>{effortRows.length === 0 ? 'effort —' : 'effort default'}</option>
        {effortRows.map((level) => (
          <option key={level} value={level}>
            effort {level}
          </option>
        ))}
      </select>
      <select
        className="w-pickers__select"
        aria-label="Permission mode"
        data-testid="picker-permissions"
        data-mode={settings?.permissionMode}
        disabled={disabled}
        value={settings?.permissionMode ?? 'bypassPermissions'}
        onChange={(event) => {
          const mode = PERMISSION_MODES.find((each) => each === event.target.value)
          if (mode !== undefined) configure({ permissionMode: mode })
        }}
      >
        {PERMISSION_MODES.map((mode) => (
          <option key={mode} value={mode}>
            {MODE_LABELS[mode]}
          </option>
        ))}
      </select>
      {error !== null ? (
        <span className="w-pickers__error" role="alert" title={error} data-testid="pickers-error">
          not applied
        </span>
      ) : null}
    </span>
  )
}
