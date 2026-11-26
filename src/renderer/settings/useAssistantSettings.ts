// What Settings → Assistant shows besides the app settings (worfy-assistant ticket 15): main's `assistant.settings`,
// asked again after each `assistant.changed` (the duties, the proposals, a look every minute) and each change of the app
// settings, so the counters, the pauses, the failures of the checks and the usage follow while the window is open. The
// changes go to main through the functions at the end; a refusal says why in a toast.
import { useEffect, useState } from 'react'
import type { DutyAction, DutyActionMode } from '../../shared/assistant/duties'
import type { CheckKind } from '../../shared/assistant/schedule/settings'
import type { AssistantSettingsView } from '../../shared/assistant/settings-view'
import { followAssistant, useAssistant } from '../assistant/useAssistant'
import { invoke, readableReason } from '../ipc'
import { showToast } from '../toast/toasts'
import { checkNowRefusalText } from './assistant-settings-format'
import { useAppSettings } from './useAppSettings'

/** The view of main; null until it has answered once. */
export function useAssistantSettings(): AssistantSettingsView | null {
  const [view, setView] = useState<AssistantSettingsView | null>(null)
  const heard = useAssistant((state) => state.view)
  const revision = useAppSettings((settings) => settings.revision)
  useEffect(followAssistant, [])
  useEffect(() => {
    let live = true
    void invoke('assistant.settings').then((result) => {
      if (!live) return
      if (result.ok) setView(result.value)
      else console.error('assistant.settings failed:', result.error)
    })
    return () => {
      live = false
    }
  }, [heard, revision])
  return view
}

function refused(what: string, error: string): void {
  showToast({ kind: 'error', key: `assistant-settings:${what}`, text: `${what}: ${readableReason(error)}` })
}

export async function configureDuty(dutyId: string, choice: { enabled?: boolean; thresholdMinutes?: number; modes?: Partial<Record<DutyAction, DutyActionMode>> }): Promise<void> {
  const result = await invoke('assistant.configureDuty', { dutyId, ...choice })
  if (!result.ok) refused('Change of the duty', result.error)
}

export async function resumeDuty(dutyId: string): Promise<void> {
  const result = await invoke('assistant.resumeDuty', { dutyId })
  if (!result.ok) refused('Resume', result.error)
}

export async function setPauseAfter(count: number): Promise<void> {
  const result = await invoke('assistant.pauseAfter', { count })
  if (!result.ok) refused('Change of the pause', result.error)
}

/** Check now; says why, as main gives it, when the check did not start. */
export async function checkNow(kind: CheckKind): Promise<void> {
  const result = await invoke('assistant.checkNow', { kind })
  if (!result.ok) return refused('Check now', result.error)
  if (!result.value.started) showToast({ kind: 'info', key: `assistant-settings:check-now:${kind}`, text: checkNowRefusalText(kind, result.value.refused) })
}
