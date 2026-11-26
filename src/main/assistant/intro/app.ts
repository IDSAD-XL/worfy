// The introduction of the Assistant in the running app (worfy-assistant ticket 16; intro.ts): its file under worfy's data
// root, the switch of the app settings, the Guide's language, the claude.ai connectors from a query of Claude Code that
// sends no message (ticket 11's listConnectors), the proposals of the Assistant and the conversation of its section.
//
// Under WORFY_AGENT=fake (the e2e runs) the connectors are listed by the fake agent's query of the inventory, never by a
// real Claude Code. With WORFY_GETTING_STARTED_AUTO=0 (the e2e runs) the message for an updated user does not show by
// itself, as the notice of Getting started does not.
import { app } from 'electron'
import { machineTimeZone } from '../../../shared/assistant/schedule/work-hours'
import { assistantOn } from '../../../shared/assistant/settings'
import { guideLanguage } from '../../../shared/guide/language'
import { appSettingsStore } from '../../settings/store'
import { dataRoot } from '../../storage/paths'
import { connectorCheckDir, listConnectors } from '../../vendors/claude/connector-check'
import { inventoryStarterFromEnv, sdkInventoryStarter } from '../../vendors/claude/query'
import { appProposals } from '../proposals/book'
import { appAssistantWindow } from '../window/app'
import { AssistantIntro, introStateFile, introStatePath } from './intro'

let shared: AssistantIntro | null = null

/** The introduction of the running app, made on first use. */
export function appAssistantIntro(env: NodeJS.ProcessEnv = process.env): AssistantIntro {
  shared ??= new AssistantIntro({
    store: introStateFile(introStatePath(dataRoot())),
    on: () => assistantOn(appSettingsStore().get()),
    turnOn: () => void appSettingsStore().set({ assistant: { on: true } }),
    noticeAllowed: () => env.WORFY_GETTING_STARTED_AUTO !== '0',
    language: () => guideLanguage(appSettingsStore().get().guideLanguage, app.getPreferredSystemLanguages()),
    machine: () => (process.platform === 'win32' ? 'PC' : 'Mac'),
    connectors: () => {
      const folder = (): string => connectorCheckDir(dataRoot())
      return listConnectors(env.WORFY_AGENT === 'fake' ? inventoryStarterFromEnv(env) : sdkInventoryStarter(undefined, folder), folder())
    },
    settings: () => appSettingsStore().get(),
    timeZone: machineTimeZone,
    propose: ({ title, why, change }) => appProposals().create({ title, why, item: null, prepare: null, change }),
    say: (text, proposalId) => appAssistantWindow().noteAssistantMessage('intro', text, proposalId),
    changed: () => appAssistantWindow().changed(),
    log: (message, error) => console.warn(message, error),
  })
  return shared
}
