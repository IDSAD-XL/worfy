// The narrator the app gives each Product Session (narrator.ts, worfy-product-session ticket 32): Haiku's requests
// through the Claude driver (src/main/vendors/claude/narrator.ts), or the fake agent under WORFY_AGENT=fake, and the
// switch of Settings → Sessions (`productSession.liveSummary`) read from the app settings before each request.
import { app } from 'electron'
import { liveSummaryOf, type AppSettings } from '../../shared/settings/app-settings'
import { appSettingsStore } from '../settings/store'
import { dataRoot } from '../storage/paths'
import { narratorFromEnv } from '../vendors/claude/narrator'
import { Narrator, type NarratorClock } from './narrator'

export interface AppNarratorOptions {
  /** The app settings as they are now; the app's store by default. */
  settings?: () => Pick<AppSettings, 'productSession'>
  env?: NodeJS.ProcessEnv
  clock?: NarratorClock
}

/** A Product Session's narrator, whose lines go to `emit`. */
export function appNarrator(emit: (lines: readonly string[], first: number) => void, options: AppNarratorOptions = {}): Narrator {
  const settings = options.settings ?? (() => appSettingsStore().get())
  const { ask, cadence } = narratorFromEnv(dataRoot(options.env), app.getAppPath(), options.env)
  return new Narrator({
    ask,
    cadence,
    emit,
    enabled: () => liveSummaryOf(settings()),
    log: (message) => console.warn(`[narrator] ${message}`),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
  })
}
