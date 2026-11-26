// The introduction of the Assistant in main (worfy-assistant ticket 16; owner's decisions 10, 12 and 19; stories 27–30).
//
// - The offer. worfy offers to turn the Assistant on once: on the welcome page of First run for a new user, in one
//   message after an update for an existing one, and in the Assistant's section while it stands. It stands while the
//   Assistant is off, has never introduced itself, and the person neither took nor refused it. Refused, it never comes
//   back (decision 10); taken, it turns the Assistant on as its switch in Settings → Assistant does. The window says
//   which person is new or existing from Getting started (src/shared/ipc/getting-started.ts), which decided it once.
// - The introduction. The first time the Assistant is turned on — by the offer or in Settings — it says who it is, what it
//   does and what it can, asks the work hours and the sources, and hands over the first setup as a card «before → after»
//   (ticket 15): nothing changes until Apply. The words are worfy's (words.ts), with no model. Which sources are
//   connected main reads from the person's claude.ai connectors, without a model (ticket 11); a source not connected is
//   named with where to connect it in claude.ai, and no token is asked for (decision 19).
// - Once. The file records that the introduction is owed before the connectors are read and that it is done after, so a
//   quit in between brings it at the next start, and nothing brings it twice. A Assistant found on at the start of worfy
//   with nothing recorded was turned on before the introduction existed — the owner's (decision 10): it is not
//   introduced then.
//
// The state is `<WORFY_DATA_DIR>/assistant/intro.json`, in worfy's own data folder (ADR-0005), written only here.
import { join } from 'node:path'
import { z } from 'zod'
import { NO_OFFER, type OfferAnswer, type OfferView } from '../../../shared/assistant/intro'
import { DEFAULT_WORK_HOURS } from '../../../shared/assistant/schedule/work-hours'
import { checkSettingsOf, SOURCE_CHECK_KINDS, type AssistantScheduleSettings, type SourceCheckKind } from '../../../shared/assistant/schedule/settings'
import type { SettingsChange } from '../../../shared/assistant/settings-change'
import type { GuideLanguage } from '../../../shared/settings/app-settings'
import { readJsonFile, writeJsonFile } from '../../storage/json-file'
import { isJiraConnector } from '../sources/jira'
import { SLACK_CONNECTOR } from '../sources/slack'
import { introWords } from './words'

export const introStateSchema = z.object({
  /** What the person did with the offer; null while it stands or was never answered. */
  offer: z.enum(['accepted', 'declined']).nullable(),
  /** The message for an updated user was shown. */
  noticeShown: z.boolean(),
  /** `owed`: turned on, the introduction not written yet; `done`: written, or not owed (turned on before it existed). */
  introduction: z.enum(['owed', 'done']).nullable(),
})
export type IntroState = z.output<typeof introStateSchema>

export interface IntroStore {
  read(): IntroState
  /** Throws when it cannot write. */
  write(state: IntroState): void
}

const empty = (): IntroState => ({ offer: null, noticeShown: false, introduction: null })

/** The file under worfy's data root. */
export function introStatePath(root: string): string {
  return join(root, 'assistant', 'intro.json')
}

/** The store over `file`; an unreadable file is set aside by readJsonFile and reads as nothing recorded. */
export function introStateFile(file: string): IntroStore {
  return { read: () => readJsonFile(file, introStateSchema) ?? empty(), write: (state) => writeJsonFile(file, introStateSchema, state) }
}

/** A store in memory, for tests. */
export function memoryIntroState(initial: IntroState = empty()): IntroStore {
  let kept = structuredClone(initial)
  return { read: () => structuredClone(kept), write: (state) => void (kept = structuredClone(state)) }
}

/** A claude.ai connector as Claude Code lists it: its name and its status (`connected`, `needs-auth`…). */
export interface IntroConnector {
  name: string
  status: string
}

/** Whether the connector `name` is the source's: the names the checks of Slack and Jira look for (tickets 12, 13). */
const SOURCE_CONNECTOR: Readonly<Record<SourceCheckKind, (name: string) => boolean>> = Object.freeze({
  slack: (name: string) => name === SLACK_CONNECTOR,
  jira: isJiraConnector,
})

export interface AssistantIntroDeps {
  store: IntroStore
  /** Whether the Assistant is on: its switch in Settings → Assistant. */
  on(): boolean
  /** Turns it on, as its switch does. */
  turnOn(): void
  /** Whether the message for an updated user may show by itself: not under WORFY_GETTING_STARTED_AUTO=0 (the e2e runs). */
  noticeAllowed(): boolean
  language(): GuideLanguage
  machine(): 'Mac' | 'PC'
  /** The person's claude.ai connectors, without a model; rejects when they cannot be read. */
  connectors(): Promise<readonly IntroConnector[]>
  /** The app settings the first setup reads: what the person chose stays out of it. */
  settings(): AssistantScheduleSettings
  /** The zone of this Machine, which the work hours of the first setup name. */
  timeZone(): string
  /** A proposal of the Assistant with a change of its settings (ticket 15). */
  propose(draft: { title: string; why: string; change: SettingsChange }): { id: string }
  /** A message of the Assistant in the conversation, with the proposal it hands over. */
  say(text: string, proposalId: string | null): void
  /** The window is told: the offer changed. */
  changed(): void
  log?(message: string, error?: unknown): void
}

export class AssistantIntro {
  /** The introduction being written now: a second start waits for it instead of writing another. */
  private running: Promise<void> | null = null

  constructor(private readonly deps: AssistantIntroDeps) {}

  private edit(change: (state: IntroState) => void): void {
    const state = this.deps.store.read()
    change(state)
    this.deps.store.write(state)
  }

  /** The offer as the window reads it. */
  offer(): OfferView {
    const state = this.deps.store.read()
    if (this.deps.on() || state.offer !== null || state.introduction !== null) return { ...NO_OFFER }
    return { owed: true, notice: !state.noticeShown && this.deps.noticeAllowed() }
  }

  /** The person's answer to the offer. `accepted` turns the Assistant on; its start brings the introduction. */
  answer(answer: OfferAnswer): void {
    if (answer === 'seen') this.edit((state) => void (state.noticeShown = true))
    else this.edit((state) => void (state.offer = answer))
    if (answer === 'accepted') this.deps.turnOn()
    this.deps.changed()
  }

  /**
   * After each start of the Assistant (switch.ts). `atStartup`: the start that came with worfy's own start, where an
   * Assistant on with nothing recorded was turned on before the introduction existed.
   */
  started(atStartup: boolean): Promise<void> {
    this.running ??= this.introduce(atStartup).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async introduce(atStartup: boolean): Promise<void> {
    const state = this.deps.store.read()
    if (state.introduction === 'done') return
    if (state.introduction === null && atStartup && state.offer !== 'accepted') {
      this.edit((next) => void (next.introduction = 'done'))
      return
    }
    this.edit((next) => void (next.introduction = 'owed'))
    let connected: SourceCheckKind[] | null = null
    try {
      const connectors = await this.deps.connectors()
      connected = SOURCE_CHECK_KINDS.filter((kind) => connectors.some((each) => SOURCE_CONNECTOR[kind](each.name) && each.status === 'connected'))
    } catch (error) {
      this.deps.log?.('[assistant] the introduction could not read the claude.ai connectors', error)
    }
    const change = this.firstSetup(connected ?? [])
    const words = introWords(this.deps.language(), {
      machine: this.deps.machine(),
      connected,
      notConnected: connected === null ? [] : SOURCE_CHECK_KINDS.filter((kind) => !connected.includes(kind)),
      setup: change !== null,
    })
    let proposalId: string | null = null
    if (change !== null) {
      try {
        proposalId = this.deps.propose({ title: words.setupTitle, why: words.setupWhy, change }).id
      } catch (error) {
        this.deps.log?.('[assistant] the first setup of the introduction was not proposed', error)
      }
    }
    const [who, what, setup] = words.messages
    this.deps.say(who, null)
    this.deps.say(what, null)
    this.deps.say(setup, proposalId)
    this.edit((next) => void (next.introduction = 'done'))
  }

  /**
   * The first setup: the work hours Monday to Friday, 09:00–18:00 in this Machine's zone unless the person chose some,
   * and the check of each source connected in claude.ai that is off. Null when nothing is left to set.
   */
  private firstSetup(connected: readonly SourceCheckKind[]): SettingsChange | null {
    const settings = this.deps.settings()
    const workHours = settings.assistantSchedule?.workHours === undefined ? { ...DEFAULT_WORK_HOURS, days: [...DEFAULT_WORK_HOURS.days], windows: DEFAULT_WORK_HOURS.windows.map((each) => ({ ...each })), timeZone: this.deps.timeZone() } : undefined
    const off = connected.filter((kind) => !checkSettingsOf(settings, kind).enabled)
    const checks = off.length === 0 ? undefined : Object.fromEntries(off.map((kind) => [kind, { enabled: true }]))
    if (workHours === undefined && checks === undefined) return null
    return { ...(workHours === undefined ? {} : { workHours }), ...(checks === undefined ? {} : { checks }) }
  }
}
