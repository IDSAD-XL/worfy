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
//
// Ticket 12: a question about lines of a story (`stories.ask`, src/main/stories/ask.ts), on the same Vendor and the
// same fake agent path (the script WORFY_STORY_ASK_SCRIPT, "story-answer" by default). It reads one checkout — the
// folder the window names, as a build does, else the git worktree where the story's PR head is checked out, else the
// Project's root; main adds the PR's diff, its text and the review verdicts of the Project's own GitHub account (gh,
// read-only) and the Ticket's file (as tickets.read reads it), and keeps the answer in stories.json under what the
// story names (`stories.answers`, storyAnswersKey): the story file the workflow model lists for its Epic and Ticket,
// or `owner/name#N` of the Project's GitHub repository for a story made by the button.
import { appendFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import { storiesActivity, storiesAnswers, storiesAsk, storiesBuild, storiesCode, storiesRead, storiesSaved, storiesStop, type StoryRead } from '../../shared/ipc/stories'
import { parseStory } from '../../shared/stories/parse'
import type { VendorId } from '../../shared/vendors/vendor'
import { fakeQueryFactory } from '../agent/fake-query'
import { harnessScriptEnv } from '../harness/script-env'
import { gitWorktrees } from '../claude-home/registry'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome, dataRoot } from '../storage/paths'
import { cachedPrCommits, storyFragmentCode, storyPathParts, ticketPrFromModel, type PrCommits } from '../stories/code'
import type { StoryFile } from '../../shared/stories/schema'
import { remoteRepos } from '../github/inbox'
import { askFolder, gatherMaterial, StoryAsker, storyHeadOf, type AskSources } from '../stories/ask'
import { StoryBuilder, storyFolder } from '../stories/one-shot'
import { addStoryAnswer, readSavedStory, readStoryAnswers, storyAnswersKey, storyDigest } from '../stories/store'
import { assistDir } from '../terminal-ai/options'
import { claudeOneShotOver } from '../vendors/claude/one-shot'
import type { OneShot } from '../vendors/one-shot'
import { vendorDriver } from '../vendors/registry'
import { layoutFailure, projectLayouts, type ProjectLayout } from '../workflow/folder'
import { refTree, resolveSource, runGit, type RefGitRunner } from '../workflow/main-ref'
import { readGithubAccount } from '../workflow/profile'
import { readWorkflow } from '../workflow/reader'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'
import { resolveProjectFile, workflowPlaces, type ResolveOptions } from './shell'
import { readTicketFile, TICKET_SIZE_MAX } from './tickets'

/**
 * The oneShot of `vendor`: its driver's, or the fake agent's for Claude Code under WORFY_AGENT=fake, playing `script`
 * (the build's WORFY_STORY_SCRIPT, "story", by default).
 */
export function storyOneShotFromEnv(env: NodeJS.ProcessEnv = process.env, script: string = env.WORFY_STORY_SCRIPT ?? 'story'): (vendor: VendorId) => OneShot {
  if (env.WORFY_AGENT !== 'fake') return (vendor) => vendorDriver(vendor).oneShot
  const log = env.WORFY_AGENT_LOG
  const fake = fakeQueryFactory({
    scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
    script,
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

const prViewSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  comments: z.array(z.object({ author: z.object({ login: z.string().nullish() }).nullish(), body: z.string().nullish() })).nullish(),
})

/** The text and the comments of a PR and its diff, read with gh in the Project's root with its account, as ghPrCommits. Read-only. */
const ghSources = async (): Promise<Pick<AskSources, 'prView' | 'prDiff'>> => {
  const { sharedPrTracker } = await import('./checks')
  return {
    prView: async (root, pr) => {
      const parsed = prViewSchema.parse(JSON.parse(await sharedPrTracker().gh(root, ['pr', 'view', String(pr), '--json', 'title,body,comments'])))
      return { title: parsed.title, body: parsed.body ?? '', comments: (parsed.comments ?? []).map((comment) => ({ author: comment.author?.login ?? '', body: comment.body ?? '' })) }
    },
    prDiff: (root, pr) => sharedPrTracker().gh(root, ['pr', 'diff', String(pr)]),
  }
}

/** The file of Ticket `ticket` of Epic `epic`: its slug from the workflow model, its text as tickets.read reads it. */
async function ticketFileOf(root: string, epic: string, ticket: string): Promise<{ file: string; text: string } | null> {
  const num = Number(ticket)
  const found = (await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })).model.tickets.find((one) => one.epic === epic && one.num === num)
  if (found === undefined) return null
  const read = await readTicketFile(await projectLayouts().get(root), { epic, num, slug: found.slug })
  return { file: nativePath.basename(read.path), text: read.text }
}

let sharedAsker: StoryAsker | undefined
const asker = (): StoryAsker =>
  (sharedAsker ??= new StoryAsker({
    oneShot: storyOneShotFromEnv(process.env, process.env.WORFY_STORY_ASK_SCRIPT ?? 'story-answer'),
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    runDir: () => assistDir(dataRoot()),
    material: async (request) => gatherMaterial(request.folder, request.story, request.about.step, { ...(await ghSources()), ticketPr, ticketFile: ticketFileOf, account: projectAccount }),
    commit: headOf,
    save: (dataDir, key, answer) => addStoryAnswer(dataDir, key, answer),
  }))

/** The Project's GitHub account (its profile's github.account): the author of its review verdicts. */
const projectAccount = async (root: string): Promise<string | null> => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account

/** The commit at the HEAD of `folder`; null when git cannot say. */
async function headOf(folder: string): Promise<string | null> {
  const head = (await runGit(folder, ['rev-parse', 'HEAD'])).trim()
  return /^[0-9a-f]{40}$/u.test(head) ? head : null
}

/**
 * The key the answers of `story` are kept under in the Project at `root` (storyAnswersKey): the story file the workflow
 * model lists for the story's Epic — its PR story for the header's Ticket, or its Epic story — and the Project's
 * `owner/name` on GitHub. A committed story is the file it was read from; one made by the button names its PR.
 */
async function answersKey(root: string, story: StoryFile): Promise<string> {
  const model = await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })
    .then((read) => read.model)
    .catch(() => null)
  const epic = story.header.epic === null ? undefined : model?.epics.find((one) => one.epic === story.header.epic)
  const entry = epic?.stories?.find((one) => (story.kind === 'epic' ? one.kind === 'epic' : one.kind === 'pr' && one.ticket !== null && one.ticket === story.header.ticket))
  const repo = (await remoteRepos([root]).catch(() => []))[0] ?? null
  return storyAnswersKey(story, { file: entry?.path ?? null, repo })
}

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
  const parsed = parseStory(text, { committed: true })
  if (!parsed.ok) return { ok: false, reason: `${rel}: ${parsed.reason}` }
  const paths = options.paths ?? nativePath
  const dir = paths.relative(layout.root, paths.join(layout.ticketsRoot, ...where.parts.slice(0, -1))).split(paths.sep).join('/')
  return { ok: true, story: parsed.story, path: rel, dir }
}

const prCommitsSchema = z.object({ headRefOid: z.string().nullish(), mergeCommit: z.object({ oid: z.string() }).nullish() })

/**
 * The head and the merge commit of PR `pr`, read with gh in the Project's root with its GitHub account (the PR tracker's
 * gh, src/main/ipc/checks.ts): the anchor of a Silent Project's story (src/main/stories/code.ts). Read-only.
 */
export const ghPrCommits: PrCommits = async (root, pr) => {
  // Loaded when first asked: the module of the checks makes its handlers, and the app's PR tracker, when it is loaded.
  const { sharedPrTracker } = await import('./checks')
  const out = await sharedPrTracker().gh(root, ['pr', 'view', String(pr), '--json', 'headRefOid,mergeCommit'])
  const parsed = prCommitsSchema.parse(JSON.parse(out))
  return { head: parsed.headRefOid || null, merge: parsed.mergeCommit?.oid || null }
}

/** The app's PR commits, asked of gh once per PR (cachedPrCommits), and the Tickets' PRs, from the workflow model. */
const prCommits = cachedPrCommits(ghPrCommits)
const ticketPr = ticketPrFromModel(async (root) => (await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })).model)

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

  defineHandler(storiesStop, ({ storyId }) => ({ stopped: builder().stop(storyId) || asker().stop(storyId) })),

  defineHandler(storiesAsk, async ({ questionId, projectId, folder, story, about, code, question }, { event }) => {
    // Made before the first wait: under WORFY_AGENT=fake the asker's fake agent puts its release on globalThis when it
    // is made, and an e2e test releases the answer as soon as the progress bar shows.
    const answering = asker()
    const store = projectStore()
    const project = store.get(projectId)
    // The checkout the story's code was read from, as for a build (storyFolder): the PR's worktree when it is checked out.
    const chosen = await askFolder(project.path, folder, storyHeadOf(story, about.step), await gitWorktrees(project.path), (one) => headOf(one).catch(() => null))
    if (!chosen.ok) return { status: 'failed' as const, reason: chosen.reason }
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    const key = await answersKey(project.path, story)
    return answering.ask({ questionId, folder: chosen.folder, dataDir: store.dataDir(project.id), key, vendor, story, about, code, question }, (text) =>
      toSender(event.sender, (target) => emit(target, storiesActivity, { storyId: questionId, text })),
    )
  }),

  defineHandler(storiesAnswers, async ({ projectId, story }) => {
    const store = projectStore()
    const project = store.get(projectId)
    return { digest: storyDigest(story), answers: readStoryAnswers(store.dataDir(project.id), await answersKey(project.path, story)) }
  }),

  defineHandler(storiesRead, async ({ projectId, path }) => {
    const root = projectStore().get(projectId).path
    return readStoryFile(await projectLayouts().get(root), path)
  }),

  defineHandler(storiesCode, async ({ projectId, at, fragment }) => {
    const root = projectStore().get(projectId).path
    return storyFragmentCode(await projectLayouts().get(root), at, fragment, { prCommits, ticketPr })
  }),

  defineHandler(storiesSaved, ({ projectId, key }) => {
    const store = projectStore()
    return readSavedStory(store.dataDir(store.get(projectId).id), key)
  }),
]

export default handlers
