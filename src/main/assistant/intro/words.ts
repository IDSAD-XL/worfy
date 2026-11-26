// What the Assistant says when it introduces itself (worfy-assistant ticket 16; owner's decisions 12 and 19; story 28),
// in the language of the Guide, as it speaks (ticket 17). worfy writes these words itself, without a model: the
// introduction costs no tokens, says the same each time, and holds the facts main knows — which claude.ai connectors are
// connected — rather than a guess. The words follow the prototype Card the owner accepted (ticket 02); each language is
// a file of words/ (data, as the Guide's strings are: the code itself stays English).
//
// The Assistant never asks for a token: Slack and Jira are read only through the person's claude.ai connectors
// (decision 19), and a source not connected is connected in claude.ai, which the Assistant says.
import type { SourceCheckKind } from '../../../shared/assistant/schedule/settings'
import type { GuideLanguage } from '../../../shared/settings/app-settings'
import en from './words/en.json'
import ru from './words/ru.json'

/** What main knows when the Assistant introduces itself. */
export interface IntroFacts {
  machine: 'Mac' | 'PC'
  /** The sources whose claude.ai connector is connected; null when the connectors could not be read. */
  connected: readonly SourceCheckKind[] | null
  /** The sources without a connected one; empty when the connectors could not be read. */
  notConnected: readonly SourceCheckKind[]
  /** A card with the first setup follows the last message. */
  setup: boolean
}

/** The messages of the introduction, in order, and the title and «why» of the card of the first setup. */
export interface IntroWords {
  messages: [string, string, string]
  setupTitle: string
  setupWhy: string
}

type Words = typeof en
const WORDS: Readonly<Record<GuideLanguage, Words>> = Object.freeze({ en, ru: ru satisfies Words })

const NAMES: Readonly<Record<SourceCheckKind, string>> = Object.freeze({ slack: 'Slack', jira: 'Jira' })

/** Where a connector is connected, as claude.ai names it in every language. */
export const CONNECT_WHERE = 'claude.ai → Settings → Connectors'

const fill = (text: string, values: Readonly<Record<string, string>>): string => text.replace(/\{(\w+)\}/gu, (whole, key: string) => values[key] ?? whole)

/** The introduction in the language of the Guide. */
export function introWords(language: GuideLanguage, facts: IntroFacts): IntroWords {
  const words = WORDS[language]
  const list = (kinds: readonly SourceCheckKind[]): string => {
    const names = kinds.map((kind) => NAMES[kind])
    return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${words.and} ${names[names.length - 1] ?? ''}`
  }
  const machine = facts.machine === 'Mac' ? words.machineMac : words.machinePC
  const sources: string[] = []
  if (facts.connected === null) sources.push(fill(words.unread, { where: CONNECT_WHERE }))
  else {
    if (facts.connected.length > 0) sources.push(fill(facts.connected.length === 1 ? words.connectedOne : words.connectedMany, { list: list(facts.connected) }))
    if (facts.notConnected.length > 0) sources.push(fill(facts.notConnected.length === 1 ? words.notConnectedOne : words.notConnectedMany, { list: list(facts.notConnected), where: CONNECT_WHERE }))
  }
  sources.push(words.hours, facts.setup ? words.setup : words.noSetup)
  return {
    messages: [fill(words.who, { machine }), words.what, sources.join(' ')],
    setupTitle: words.setupTitle,
    setupWhy: words.setupWhy,
  }
}
