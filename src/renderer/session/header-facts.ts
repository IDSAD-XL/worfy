import { useEffect, useState } from 'react'
import type { ModelOption } from '../../shared/agent/settings'
import { invoke } from '../ipc'

// The Model and Effort of the Session header (SessionView.tsx; worfy-polish 52). The model is the one
// the last system/init named, or the one picked since; an empty name reads as unknown, as none does.
// The effort is the level worfy asked for. A Codex Session with no level picked runs its model's
// default level, which Codex's `model/list` names (`agent.models`, ModelOption.defaultEffort): the
// header shows that level, marked as the default by a muted value and its tooltip. A mark in the text,
// such as « (default)», would take the width the model's name has at the default 1280 px window.
// Claude Code reports no level, so a Claude Session with none picked shows «—», as before.

/** What a header fact shows: its text, its tooltip, and whether it is the default the Vendor names rather than a pick. */
export interface HeaderFact {
  text: string
  title: string
  isDefault: boolean
}

/** The model the header names: a pick since the last init (Default reads «default»), else the init's; null when unknown. */
export function headerModel(pick: { model: string | null } | null, initModel: string | null, viewModel: string | null): string | null {
  if (pick !== null) return pick.model === null || pick.model === '' ? 'default' : pick.model
  for (const model of [initModel, viewModel]) if (model !== null && model !== '') return model
  return null
}

/**
 * The level the next turn of a Codex Session runs at while none is picked: the default of the model
 * picked since the last init, else of the model it runs (`model`), else of Codex's default model (the
 * Default row of the list). Null when the list does not name it.
 */
export function codexDefaultEffort(models: readonly ModelOption[], pick: { model: string | null } | null, model: string | null): string | null {
  const wanted = pick !== null ? pick.model : model
  const row = wanted === null || wanted === '' ? models.find((each) => each.value === null) : models.find((each) => each.value === wanted)
  return row?.defaultEffort ?? null
}

const CLAUDE_EFFORT_TITLE = 'The level worfy asked for: Claude Code does not report the level it applies'

/** The header's Effort: the picked level, a Codex model's default level, or «—»; the tooltip by the Vendor (null: the Orchestrator, Claude Code's). */
export function headerEffort(effort: string | null, vendor: string | null, defaultEffort: string | null): HeaderFact {
  if (vendor !== 'codex') return { text: effort ?? '—', title: CLAUDE_EFFORT_TITLE, isDefault: false }
  if (effort !== null) return { text: effort, title: 'The level worfy asked Codex for', isDefault: false }
  if (defaultEffort !== null) return { text: defaultEffort, title: "The default: no level is picked, so Codex runs the model's default level, as its model/list names it", isDefault: true }
  return { text: '—', title: "No level is picked: Codex runs the model's default level", isDefault: false }
}

/**
 * The model rows of a Codex Session (`agent.models`), asked again when the model it runs changes; none
 * for any other Session, which the header does not ask.
 */
export function useCodexModels(sessionId: string | null, vendor: string | null, model: string | null): readonly ModelOption[] {
  const asks = sessionId !== null && vendor === 'codex'
  const [found, setFound] = useState<{ sessionId: string; models: readonly ModelOption[] } | null>(null)
  useEffect(() => {
    if (!asks || sessionId === null) return
    let current = true
    void invoke('agent.models', { sessionId }).then((result) => {
      if (!current) return
      if (result.ok) setFound({ sessionId, models: result.value.models })
      else console.error(`agent.models ${sessionId} failed:`, result.error)
    })
    return () => {
      current = false
    }
  }, [asks, sessionId, model])
  return asks && found !== null && found.sessionId === sessionId ? found.models : []
}
