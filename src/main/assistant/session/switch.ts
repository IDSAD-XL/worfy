// The switch of the Assistant (worfy-assistant ticket 15; owner's decisions 7 and 10; ADR-0114): the setting «Assistant
// on this machine» of Settings → Assistant (`assistant.on` of the app settings, src/shared/assistant/settings.ts) starts
// the Assistant of ticket 10 (startAssistant) and stops it. Off while the person has not turned it on, for a new user
// and for one who updated worfy alike. After each start and each stop the section of the window is told
// (AssistantWindow.changed), so its «Assistant is off on this machine» and its box to write follow at once.
//
// The checks of sources follow the same setting in their scheduler (src/main/assistant/schedule/app.ts): off, the
// Assistant checks no source.
//
// After each start the introduction hears of it (worfy-assistant ticket 16, src/main/assistant/intro/): the first time the
// person turns the Assistant on, it introduces itself.
import { assistantOn } from '../../../shared/assistant/settings'
import { appSettingsStore } from '../../settings/store'
import type { PowerEvents } from '../schedule/scheduler'
import { appAssistantIntro } from '../intro/app'
import { appAssistantWindow } from '../window/app'
import { startAssistant } from './app'

export interface AssistantSwitchDeps {
  /** Whether the person turned the Assistant on. */
  on(): boolean
  /** Follows the changes of the setting; answers the function that stops it. */
  onChange(listener: () => void): () => void
  /** Starts the Assistant; answers its stop, or null when it did not start. */
  start(): (() => void) | null
  /** The section of the window: told after each start and stop. */
  changed(): void
  /** After each start that took; `atStartup`: the setting has been on since worfy started, not turned on since. */
  started?(atStartup: boolean): void
  log?(message: string): void
}

/** Starts the Assistant when the setting is on and stops it when it is off; answers the function that stops both. */
export function followAssistantSwitch(deps: AssistantSwitchDeps): () => void {
  let stop: (() => void) | null = null
  const log = deps.log ?? ((message: string) => console.warn(`[assistant] ${message}`))
  // Off once since worfy started: a start after it is the person's turn of the switch, not one that came with worfy's.
  let seenOff = false
  const follow = (): void => {
    const on = deps.on()
    if (!on) seenOff = true
    if (on && stop === null) {
      stop = deps.start()
      if (stop === null) return log('the Assistant did not start: the attention core is not running')
      deps.changed()
      deps.started?.(!seenOff)
    } else if (!on && stop !== null) {
      const running = stop
      stop = null
      running()
      deps.changed()
    }
  }
  const unfollow = deps.onChange(follow)
  follow()
  return () => {
    unfollow()
    const running = stop
    stop = null
    running?.()
  }
}

/** The switch of the running app, over the app settings, after the attention core and the section have started. */
export function startAssistantSwitch(power: PowerEvents): () => void {
  const settings = appSettingsStore()
  return followAssistantSwitch({
    on: () => assistantOn(settings.get()),
    onChange: (listener) => {
      settings.on('changed', listener)
      return () => void settings.off('changed', listener)
    },
    start: () => startAssistant(power),
    changed: () => appAssistantWindow().changed(),
    started: (atStartup) => void appAssistantIntro().started(atStartup),
  })
}
