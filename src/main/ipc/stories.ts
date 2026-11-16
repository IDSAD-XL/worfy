// Handlers of the `stories` domain (src/shared/ipc/stories.ts, worfy-code-stories ticket 04): the invisible
// build of a Code story on the Project's Vendor (its settings' `defaultVendor`, Claude Code when none), its
// progress lines to the window that asked, and its Stop. The story reads the Project's root, or the git
// worktree of it the window names (where the PR's head is checked out); any other folder is refused. The builder (src/main/stories/one-shot.ts) writes
// nothing; keeping a story is its caller's (tickets 11 and 12).
//
// Under WORFY_AGENT=fake the Claude driver's oneShot runs over the fake agent, which plays
// test/fixtures/agent-scripts/<WORFY_STORY_SCRIPT or "story">.jsonl and appends what it was asked to
// WORFY_AGENT_LOG, as the draft of a Project's profile does (src/main/ipc/projects.ts): the e2e runs of
// tickets 11 and 12 go through it. A Codex Project is refused by its capabilities before any request.
//
// The reads of ticket 08: a story file of an Epic (`stories.read`, readStoryFile below), the code of a fragment
// from git (`stories.code`, src/main/stories/code.ts) and a story made by the button (`stories.saved`,
// src/main/stories/store.ts). A story file is read where the workflow reader reads the Tickets (ADR-0107): from the
// Project's main branch in Full mode with the Tickets in git, otherwise from the folder, through the guard of
// tickets.read — a link out of the Project, its Tickets root or its Workflow folder is refused before anything is read.
import { appendFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join } from 'node:path'
import { app } from 'electron'
import { storiesActivity, storiesBuild, storiesCode, storiesRead, storiesSaved, storiesStop, type StoryRead } from '../../shared/ipc/stories'
import { parseStory } from '../../shared/stories/parse'
import type { VendorId } from '../../shared/vendors/vendor'
import { fakeQueryFactory } from '../agent/fake-query'
import { gitWorktrees } from '../claude-home/registry'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { dataRoot } from '../storage/paths'
import { storyFragmentCode, storyPathParts } from '../stories/code'
import { StoryBuilder, storyFolder } from '../stories/one-shot'
import { readSavedStory } from '../stories/store'
import { assistDir } from '../terminal-ai/options'
import { claudeOneShotOver } from '../vendors/claude/one-shot'
import type { OneShot } from '../vendors/one-shot'
import { vendorDriver } from '../vendors/registry'
import { layoutFailure, projectLayouts, type ProjectLayout } from '../workflow/folder'
import { refTree, resolveSource, type RefGitRunner } from '../workflow/main-ref'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'
import { resolveProjectFile, workflowPlaces, type ResolveOptions } from './shell'
import { TICKET_SIZE_MAX } from './tickets'

/** The oneShot of `vendor`: its driver's, or the fake agent's for Claude Code under WORFY_AGENT=fake. */
export function storyOneShotFromEnv(env: NodeJS.ProcessEnv = process.env): (vendor: VendorId) => OneShot {
  if (env.WORFY_AGENT !== 'fake') return (vendor) => vendorDriver(vendor).oneShot
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script: env.WORFY_STORY_SCRIPT ?? 'story',
    record: log ? (call) => appendFileSync(log, `${JSON.stringify({ story: true, ...call })}\n`) : undefined,
  })
  const claude = claudeOneShotOver((request) => fake(request))
  return (vendor) => (vendor === 'claude' ? claude : vendorDriver(vendor).oneShot)
}

let shared: StoryBuilder | undefined
const builder = (): StoryBuilder =>
  (shared ??= new StoryBuilder({
    oneShot: storyOneShotFromEnv(),
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    runDir: () => assistDir(dataRoot()),
  }))

function toSender(sender: EventTarget & { isDestroyed?: () => boolean }, send: (target: EventTarget) => void): void {
  if (sender.isDestroyed?.() === true) return
  try {
    send(sender)
  } catch (error) {
    console.warn('[stories] could not send to the window', error)
  }
}

export interface StoryReadOptions extends ResolveOptions {
  /** Runs git for the main branch (main-ref.ts); replaced in tests. */
  git?: RefGitRunner
  /** The user's home folder, never a place of the Tickets (workflowPlaces); os.homedir() by default. */
  home?: string
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** The text of the story file `rel` (under the Tickets root) from where the workflow is read; throws with the reason. */
async function storyText(layout: ProjectLayout, rel: string, parts: readonly string[], options: StoryReadOptions): Promise<string> {
  const source = await resolveSource(layout.root, layout, { details: false, ...(options.git === undefined ? {} : { git: options.git }) })
  if (source.kind === 'ref') {
    const tree = refTree(source, source.ticketsRel, [parts[0]!], options.git)
    const text = (await tree.texts([rel], TICKET_SIZE_MAX)).get(rel)
    if (text === undefined) throw new Error(`${rel} does not exist in the main branch, or is larger than ${TICKET_SIZE_MAX} bytes`)
    return text
  }
  const paths = options.paths ?? nativePath
  const places = await workflowPlaces(layout, { paths, home: options.home, real: options.real })
  const file = await resolveProjectFile(layout.root, paths.join(layout.ticketsRoot, ...parts), places, options).catch((error: unknown) => {
    throw new Error(`${rel} cannot be read: ${errorText(error)}`)
  })
  const info = await stat(file)
  if (!info.isFile()) throw new Error(`${rel} is not a file`)
  if (info.size > TICKET_SIZE_MAX) throw new Error(`${rel} is larger than ${TICKET_SIZE_MAX} bytes`)
  return readFile(file, 'utf8')
}

/**
 * The story file `rel` of the Project laid out as `layout` — `<epic>/story.md` or `<epic>/stories/<NN>-<slug>.md` under its
 * Tickets root — parsed; or the reason it cannot be shown: no such file, or one that does not fit the format.
 */
export async function readStoryFile(layout: ProjectLayout, rel: string, options: StoryReadOptions = {}): Promise<StoryRead> {
  if (layout.failed) return { ok: false, reason: layoutFailure(layout) }
  const where = storyPathParts(rel)
  if (where === null) return { ok: false, reason: `${JSON.stringify(rel)} is not a story of an Epic: <epic>/story.md or <epic>/stories/<NN>-<slug>.md` }
  let text: string
  try {
    text = await storyText(layout, rel, where.parts, options)
  } catch (error) {
    return { ok: false, reason: errorText(error) }
  }
  const parsed = parseStory(text)
  if (!parsed.ok) return { ok: false, reason: `${rel}: ${parsed.reason}` }
  const paths = options.paths ?? nativePath
  const dir = paths.relative(layout.root, paths.join(layout.ticketsRoot, ...where.parts.slice(0, -1))).split(paths.sep).join('/')
  return { ok: true, story: parsed.story, path: rel, dir }
}

const handlers: HandlerModule = [
  defineHandler(storiesBuild, async ({ storyId, projectId, folder, input }, { event }) => {
    const store = projectStore()
    const project = store.get(projectId)
    // The worktrees are listed only when a folder other than the root is asked for.
    const chosen = storyFolder(project.path, folder, folder === undefined ? [] : await gitWorktrees(project.path))
    if (!chosen.ok) return { status: 'failed' as const, reason: chosen.reason }
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    return builder().build({ storyId, folder: chosen.folder, vendor, input }, (text) => toSender(event.sender, (target) => emit(target, storiesActivity, { storyId, text })))
  }),

  defineHandler(storiesStop, ({ storyId }) => ({ stopped: builder().stop(storyId) })),

  defineHandler(storiesRead, async ({ projectId, path }) => {
    const root = projectStore().get(projectId).path
    return readStoryFile(await projectLayouts().get(root), path)
  }),

  defineHandler(storiesCode, async ({ projectId, at, fragment }) => {
    const root = projectStore().get(projectId).path
    return storyFragmentCode(await projectLayouts().get(root), at, fragment)
  }),

  defineHandler(storiesSaved, ({ projectId, key }) => {
    const store = projectStore()
    return readSavedStory(store.dataDir(store.get(projectId).id), key)
  }),
]

export default handlers
