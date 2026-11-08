// The save signal of a Product Session (Epic worfy-product-session, ticket 04; the spec, the section on
// saving `docs/product/`, the owner's answers Q5 and Q6). A Product Session never touches git: when the owner
// says «save» its agent calls `product_save` (src/main/mcp/mind-map-server.ts), and when the owner closes
// its Node (NodeSessions.close) main does the same. Both come here.
//
// - Full mode: one read, `git status --porcelain=v2 -- docs/product` in the Project root; main runs no other
//   git command and commits nothing. With changes, the Project's Orchestrator gets a message — the
//   changed files, their topics, and the request to save them with an ordinary docs PR without touching
//   the tree's other changes — through Session.send: a busy Orchestrator queues it for after its turn
//   (MessageQueue, src/main/agent/queue.ts). No changes, no message.
// - The same changes signalled twice — the same files with the same contents — make one message, not two.
// - Silent mode: the files live in `<Workflow folder>/product/`, outside git; nothing to save, no message.
// - While Autopilot runs the Orchestrator, nothing is sent: the message would land in a run's Session.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PRODUCT_FULL_DIR, isProductTopicName, CRITIC_DIR } from '../../shared/product/paths'

/** What the signal needs of a Project; the app's stores by default (appSaveSignal). */
export interface SaveSignalDeps {
  /** The Project's root; rejects for a Project that is not in the list. */
  projectRoot(projectId: string): string | Promise<string>
  /** Where the Project's workflow lives: `failed` when the Harness did not answer. */
  layout(root: string): Promise<{ mode: 'full' | 'silent'; failed: boolean }>
  /** Runs git with `args` (only `-C <root> status …` is ever asked); resolves to its stdout. */
  git(args: readonly string[]): Promise<string>
  /** True while Autopilot runs the Project's Orchestrator. */
  unattended(projectId: string): boolean | Promise<boolean>
  /** Sends `text` to the Project's Orchestrator: at once when it is idle, queued after its turn when busy. */
  send(projectId: string, text: string): Promise<void>
  /** Reads a file of the Project for the fingerprint of the changes; fs by default. */
  read?(path: string): Promise<Buffer>
}

/** One changed file under docs/product, by git's status. */
export interface ChangedFile {
  /** Relative to the Project root, with `/`. */
  path: string
  change: 'new' | 'modified' | 'deleted' | 'renamed'
}

export type SaveOutcome =
  | { kind: 'sent'; files: ChangedFile[]; topics: string[] }
  | { kind: 'already'; files: ChangedFile[] }
  | { kind: 'nothing' }
  | { kind: 'silent' }
  | { kind: 'autopilot' }
  | { kind: 'unknown'; reason: string }

/** The folder git is asked about, relative to the Project root. */
const PRODUCT_PATH = PRODUCT_FULL_DIR.join('/')

/**
 * The git arguments of the one read: porcelain v2, NUL-separated, every untracked file listed by itself.
 * Version 2 starts every entry with its type, never with a blank, so output trimmed by the runner
 * (runGit) still parses.
 */
export const statusArgs = (root: string): string[] => ['-C', root, 'status', '--porcelain=v2', '-z', '--untracked-files=all', '--', PRODUCT_PATH]

/** How many fields come before the path of each entry type of porcelain v2. */
const FIELDS_BEFORE_PATH: Readonly<Record<string, number>> = { '1': 8, '2': 9, u: 10, '?': 1 }

/** The files of `git status --porcelain=v2 -z` output. */
export function changedFiles(output: string): ChangedFile[] {
  const entries = output.split('\0')
  const files: ChangedFile[] = []
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at]!
    const type = entry.slice(0, 1)
    const before = FIELDS_BEFORE_PATH[type]
    if (before === undefined) continue
    let rest = entry
    for (let field = 0; field < before; field++) rest = rest.slice(rest.indexOf(' ') + 1)
    // A rename or a copy carries its old path as the next entry.
    if (type === '2') at += 1
    const xy = type === '?' ? '??' : entry.slice(2, 4)
    const change: ChangedFile['change'] = type === '?' || xy.includes('A') ? 'new' : xy.includes('D') ? 'deleted' : type === '2' ? 'renamed' : 'modified'
    if (rest !== '') files.push({ path: rest, change })
  }
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

/** The topics the files belong to: `docs/product/<topic>/…`, not the critic's folder. */
export function changedTopics(files: readonly ChangedFile[]): string[] {
  const topics = new Set<string>()
  for (const { path } of files) {
    const parts = path.split('/')
    const topic = parts[2]
    if (parts.length > 3 && topic !== undefined && topic !== CRITIC_DIR && isProductTopicName(topic)) topics.add(topic)
  }
  return [...topics].sort()
}

/** The message the Orchestrator gets. */
export function saveMessage(files: readonly ChangedFile[], topics: readonly string[]): string {
  return [
    'Product Session save request: the Product Session of this Project changed files under docs/product/ that are not committed yet.',
    '',
    `Topics: ${topics.length === 0 ? '(none: files outside a topic folder)' : topics.join(', ')}`,
    'Changed files:',
    ...files.map((file) => `- ${file.path} (${file.change})`),
    '',
    'Save exactly these files with an ordinary docs PR: a branch from the main branch, a commit, a PR, green CI, merge. Do not touch the other changes of the working tree.',
  ].join('\n')
}

/** What `product_save` answers the agent. */
export function saveAnswer(outcome: SaveOutcome): string {
  switch (outcome.kind) {
    case 'sent':
      return `Asked the Orchestrator to save ${outcome.files.length} changed file(s) of docs/product with a docs PR: ${outcome.files.map((file) => file.path).join(', ')}.`
    case 'already':
      return 'The Orchestrator was already asked to save these changes; nothing new to save.'
    case 'nothing':
      return 'nothing to save'
    case 'silent':
      return 'Silent mode: nothing to save'
    case 'autopilot':
      return 'Autopilot runs the Orchestrator now: nothing was sent. Save again after Autopilot stops.'
    case 'unknown':
      return `Could not check docs/product for changes: ${outcome.reason}. Nothing was sent.`
  }
}

export class SaveSignal {
  /** The fingerprint of the changes last sent, by Project. */
  private readonly sent = new Map<string, string>()
  /** One signal at a time per Project, so two at once never send twice. */
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly deps: SaveSignalDeps) {}

  /** Checks the Project's docs/product and asks its Orchestrator to save the changes; never rejects. */
  signal(projectId: string): Promise<SaveOutcome> {
    const before = this.chains.get(projectId) ?? Promise.resolve()
    const next = before.then(() => this.once(projectId))
    const settled = next.catch(() => undefined)
    this.chains.set(projectId, settled)
    void settled.then(() => {
      if (this.chains.get(projectId) === settled) this.chains.delete(projectId)
    })
    return next
  }

  private async once(projectId: string): Promise<SaveOutcome> {
    try {
      const root = await this.deps.projectRoot(projectId)
      const layout = await this.deps.layout(root)
      if (layout.failed) return { kind: 'unknown', reason: 'the Project\'s profile did not answer, so it is not known whether it is in Full or Silent mode' }
      if (layout.mode === 'silent') return { kind: 'silent' }
      const files = changedFiles(await this.deps.git(statusArgs(root)))
      if (files.length === 0) {
        this.sent.delete(projectId)
        return { kind: 'nothing' }
      }
      const print = await this.fingerprint(root, files)
      if (this.sent.get(projectId) === print) return { kind: 'already', files }
      if (await this.deps.unattended(projectId)) return { kind: 'autopilot' }
      const topics = changedTopics(files)
      await this.deps.send(projectId, saveMessage(files, topics))
      this.sent.set(projectId, print)
      return { kind: 'sent', files, topics }
    } catch (error) {
      return { kind: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The changed files with a hash of what each holds now: a new edit of a file already changed is a new change. */
  private async fingerprint(root: string, files: readonly ChangedFile[]): Promise<string> {
    const read = this.deps.read ?? ((path: string) => readFile(path))
    const hash = createHash('sha256')
    for (const file of files) {
      let content: string
      try {
        content = createHash('sha256').update(await read(join(root, file.path))).digest('hex')
      } catch {
        content = 'unreadable'
      }
      hash.update(`${file.change}\0${file.path}\0${content}\0`)
    }
    return hash.digest('hex')
  }
}

let shared: SaveSignal | null = null

/** The app's save signal, made on first use. The app's stores are imported then, so a test of SaveSignal never loads Electron. */
export function appSaveSignal(): SaveSignal {
  shared ??= new SaveSignal({
    projectRoot: async (projectId) => (await import('../projects/store')).projectStore().get(projectId).path,
    layout: async (root) => (await import('../workflow/folder')).projectLayouts().get(root),
    git: async (args) => (await import('../projects/store')).runGit(args),
    unattended: async (projectId) => (await import('../agent/app-orchestrators')).sharedOrchestrators().isUnattended(projectId),
    send: async (projectId, text) => {
      const [{ sharedOrchestrators }, { sharedRegistry }] = await Promise.all([import('../agent/app-orchestrators'), import('../agent/app-registry')])
      const view = await sharedOrchestrators().open(projectId)
      if (view.sessionId === null) throw new Error('the Orchestrator has no Session')
      sharedRegistry().get(view.sessionId).send(text)
    },
  })
  return shared
}
