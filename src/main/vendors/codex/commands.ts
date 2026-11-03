// The commands part of the Codex driver (ADR-0094 item 2; worfy-multi-vendor ticket 22): the rows of a
// Codex Session's slash menu, and what a message that starts with one of them sends.
//
// Codex has no method that lists its slash commands: `/model`, `/plan` and the rest belong to its own
// terminal (ticket 02, "List of slash commands"). The menu lists
// - the skills of `skills/list` for the Session's folder, the enabled ones; the Session asks again after
//   `skills/changed`;
// - the built-in commands the app-server runs as methods: `/compact` (`thread/compact/start`) and
//   `/review` (`review/start`, inline on the Session's thread: the uncommitted changes, or the
//   instructions typed after it).
// A skill is called the way Codex's own clients call one: its `$name` in the text, and a `skill` item
// with its name and path in the same input of `turn/start`. Commands without a method stay out of the
// menu, and capabilities say so (`commandsComplete: false`).
import type { SlashCommand } from '../../../shared/agent/commands'
import type { CommandsPart } from '../commands'
import type { SessionHandle, SessionMessage } from '../session'
import type { ReviewTarget } from './protocol/ts/v2/ReviewTarget'
import type { SkillMetadata } from './protocol/ts/v2/SkillMetadata'

/** The commands the app-server runs, as the menu lists them. */
export const CODEX_BUILT_IN_COMMANDS: readonly SlashCommand[] = [
  { name: 'compact', description: 'Summarize the conversation to free up context.', argumentHint: '', kind: 'command' },
  { name: 'review', description: 'Review the uncommitted changes, or what the instructions after it name.', argumentHint: '[instructions]', kind: 'command' },
]

const BUILT_IN = new Set(CODEX_BUILT_IN_COMMANDS.map((command) => command.name))

/** What a message that starts with a command of the menu sends instead of a plain turn. */
export type CodexCommand =
  | { kind: 'compact' }
  | { kind: 'review'; target: ReviewTarget }
  /** A turn whose input names the skill: `$name` and the rest of the text, then the `skill` item. */
  | { kind: 'skill'; name: string; path: string; text: string }

/** What a live Codex Session tells of its skills: those of `skills/list` for its folder. */
export interface CodexSkillSource {
  codexSkills(): Promise<SkillMetadata[]>
}

/** The skill source of a Session's handle; null for a handle that is not a Codex one. */
export function codexSkillSource(session: SessionHandle | undefined): CodexSkillSource | null {
  const source = session as (SessionHandle & Partial<CodexSkillSource>) | undefined
  return typeof source?.codexSkills === 'function' ? (source as CodexSkillSource) : null
}

/** The description a skill shows: its interface's short one, its own short one, else its description. */
const describe = (skill: SkillMetadata): string => skill.interface?.shortDescription ?? skill.shortDescription ?? skill.description

/**
 * The rows of the menu: the built-in commands, then the enabled skills by name, each once. A skill named
 * like a built-in command is left out: `/compact` runs the command. So is one whose name has a space or
 * a `/`: slashName() never reads such a name, so its row could not run it.
 */
export function codexSlashCommands(skills: readonly SkillMetadata[]): SlashCommand[] {
  const rows: SlashCommand[] = [...CODEX_BUILT_IN_COMMANDS]
  const seen = new Set(BUILT_IN)
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!skill.enabled || skill.name === '' || /[\s/]/.test(skill.name) || seen.has(skill.name)) continue
    seen.add(skill.name)
    rows.push({ name: skill.name, description: describe(skill), argumentHint: '', kind: 'skill' })
  }
  return rows
}

/** The `/name` a message starts with, without the slash; null when it starts with none. */
export function slashName(text: string): string | null {
  return /^\/([^\s/]+)/.exec(text.trimStart())?.[1] ?? null
}

/**
 * The command a message runs: a built-in one by its name, else an enabled skill of `skills`; null for a
 * plain message (it goes as a turn of its own text). The built-in commands take no attachments: a
 * message with any goes as a plain turn, so nothing the user attached is dropped.
 */
export function codexCommandOf(message: SessionMessage, skills: readonly SkillMetadata[]): CodexCommand | null {
  const name = slashName(message.text)
  if (name === null) return null
  const rest = message.text.trimStart().slice(name.length + 1).trim()
  if (BUILT_IN.has(name)) {
    if (message.attachments.length > 0) return null
    if (name === 'compact') return rest === '' ? { kind: 'compact' } : null
    return { kind: 'review', target: rest === '' ? { type: 'uncommittedChanges' } : { type: 'custom', instructions: rest } }
  }
  const skill = skills.find((each) => each.enabled && each.name === name)
  if (skill === undefined) return null
  return { kind: 'skill', name: skill.name, path: skill.path, text: rest === '' ? `$${skill.name}` : `$${skill.name} ${rest}` }
}

export const codexCommands: CommandsPart = {
  async list(session) {
    const source = codexSkillSource(session)
    if (source === null) throw new Error('the commands of the Codex driver take a Session handle of the Codex driver')
    return session.commands()
  },
}
