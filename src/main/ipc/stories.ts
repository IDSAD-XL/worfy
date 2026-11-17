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
//
// Ticket 13: the screens of a story read and the answers to its "Check yourself" (`stories.marks`), kept in stories.json
// under the same key as its answers; main names the key once, and the window adds to it (`stories.markRead`,
// `stories.selfCheck`) without the workflow model being read at each screen.
//
// Ticket 11: a story made by the button (`stories.make`, src/main/stories/by-button.ts): main reads the material with
// gh (read-only, the Project's account, `--repo` of the PR) and the workflow reader, builds through the same builder
// — so `stories.stop` ends it — and keeps it in stories.json. Under WORFY_AGENT=fake an Epic's build plays the script
// WORFY_STORY_EPIC_SCRIPT ("story-epic" by default), a PR's the build's script. A folder the window names for
// `stories.build` may be, in a Project over several repositories, one of the repositories its Profile lists or one of
// their git worktrees.
import { appendFileSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import * as nativePath from 'node:path'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import {
  storiesActivity,
  storiesAnswers,
  storiesAsk,
  storiesBuild,
  storiesCode,
  storiesMadeEvent,
  storiesMake,
  storiesMarkRead,
  storiesMarks,
  storiesRead,
  storiesRunning,
  storiesSaved,
  storiesSelfCheck,
  storiesStop,
  type StoryRead,
} from '../../shared/ipc/stories'
import { parseStory } from '../../shared/stories/parse'
import type { VendorId } from '../../shared/vendors/vendor'
import { FakeReleases, fakeQueryFactory } from '../agent/fake-query'
import { harnessScriptEnv } from '../harness/script-env'
import { gitWorktrees } from '../claude-home/registry'
import { remoteRepos } from '../github/inbox'
import { readProjectSettings } from '../projects/settings'
import { projectStore } from '../projects/store'
import { claudeHome, dataRoot } from '../storage/paths'
import { cachedPrCommits, storyFragmentCode, storyPathParts, ticketPrFromModel, type PrCommits } from '../stories/code'
import type { StoryFile } from '../../shared/stories/schema'
import type { WorkflowModel } from '../../shared/workflow/types'
import { askFolder, gatherMaterial, StoryAsker, storyHeadOf, type AskSources } from '../stories/ask'
import { profileLanguage, StoryMaker, type PrRead, type StoryRepo } from '../stories/by-button'
import { StoryBuilder, storyFolder } from '../stories/one-shot'
import { addStoryAnswer, addStoryReadMark, keepSelfCheck, readSavedStory, readStoryAnswers, readStoryMarks, storyAnswersKey, storyDigest } from '../stories/store'
import { assistDir } from '../terminal-ai/options'
import { claudeOneShotOver } from '../vendors/claude/one-shot'
import type { OneShot } from '../vendors/one-shot'
import { vendorDriver } from '../vendors/registry'
import { layoutFailure, projectLayouts, type ProjectLayout } from '../workflow/folder'
import { refTree, resolveSource, runGit, type RefGitRunner } from '../workflow/main-ref'
import { profileRunner, readGithubAccount } from '../workflow/profile'
import { readWorkflow } from '../workflow/reader'
import { defineHandler, emit, type EventTarget, type HandlerModule } from './index'
import { resolveProjectFile, workflowPlaces, type ResolveOptions } from './shell'
import { readTicketFile, TICKET_SIZE_MAX } from './tickets'

/**
 * The fake agent's releases of every story request (a build, a story by the button, a question): one set, on
 * globalThis.worfyFakeRelease, made once — the builder and the asker each make a oneShot, and the later one must not
 * take the release away from the other.
 */
let storyReleases: FakeReleases | undefined
function sharedStoryReleases(): FakeReleases {
  if (storyReleases === undefined) {
    const releases = new FakeReleases()
    ;(globalThis as { worfyFakeRelease?: (name: string) => void }).worfyFakeRelease = (name) => releases.release(name)
    storyReleases = releases
  }
  return storyReleases
}

/**
 * The oneShot of `vendor`: its driver's, or the fake agent's for Claude Code under WORFY_AGENT=fake, playing `script`
 * (the build's WORFY_STORY_SCRIPT, "story", by default) — and for an Epic story, told apart by the answer's schema,
 * WORFY_STORY_EPIC_SCRIPT ("story-epic").
 */
export function storyOneShotFromEnv(env: NodeJS.ProcessEnv = process.env, script: string = env.WORFY_STORY_SCRIPT ?? 'story'): (vendor: VendorId) => OneShot {
  if (env.WORFY_AGENT !== 'fake') return (vendor) => vendorDriver(vendor).oneShot
  const log = env.WORFY_AGENT_LOG
  const releases = sharedStoryReleases()
  const playing = (name: string): OneShot => {
    const fake = fakeQueryFactory({
      scriptsDir: env.WORFY_AGENT_SCRIPTS ?? join(app.getAppPath(), 'test', 'fixtures', 'agent-scripts'),
      script: name,
      releases,
      record: log ? (call) => appendFileSync(log, `${JSON.stringify({ story: true, ...call })}\n`) : undefined,
    })
    return claudeOneShotOver((request) => fake(request))
  }
  const pr = playing(script)
  const epic = playing(env.WORFY_STORY_EPIC_SCRIPT ?? 'story-epic')
  const claude: OneShot = (prompt, options) => {
    const properties = (options.outputSchema as { properties?: Record<string, unknown> } | undefined)?.properties
    return properties !== undefined && 'chapters' in properties ? epic(prompt, options) : pr(prompt, options)
  }
  return (vendor) => (vendor === 'claude' ? claude : vendorDriver(vendor).oneShot)
}

let shared: StoryBuilder | undefined
const builder = (): StoryBuilder =>
  (shared ??= new StoryBuilder({
    oneShot: storyOneShotFromEnv(),
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    runDir: () => assistDir(dataRoot()),
  }))

/** The folders of the Project's repositories: those its Profile lists, or its root for a Project of one repository. */
async function repoFolders(root: string): Promise<{ name: string | null; path: string }[]> {
  const layout = await projectLayouts().get(root)
  return layout.repos.length > 0 ? layout.repos.map((repo) => ({ name: repo.name, path: repo.path })) : [{ name: null, path: root }]
}

/**
 * The checkouts a story may read besides the Project's root: its git worktrees and, in a Project over several
 * repositories, each repository its Profile lists (`_resolved.repos`) and their worktrees.
 */
async function storyCheckouts(root: string): Promise<string[]> {
  const layout = await projectLayouts()
    .get(root)
    .catch(() => null)
  const repos = layout?.repos.map((repo) => repo.path) ?? []
  const worktrees = await Promise.all([root, ...repos].map((folder) => gitWorktrees(folder)))
  return [...repos, ...worktrees.flat()]
}

const prViewSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  author: z.object({ login: z.string().nullish() }).nullish(),
  headRefOid: z.string().nullish(),
  headRefName: z.string().nullish(),
  comments: z.array(z.object({ author: z.object({ login: z.string().nullish() }).nullish(), body: z.string().nullish() })).nullish(),
})

/** gh in the clone of `repo` as the Project's account (the PR tracker's gh), read-only, `--repo` named. */
const repoGh = async (repo: StoryRepo, args: readonly string[]): Promise<string> => {
  const { sharedPrTracker } = await import('./checks')
  return sharedPrTracker().gh(repo.folder, [...args, '--repo', repo.slug])
}

/** The worktree of `folder` where `branch` is checked out (`git worktree list --porcelain`); null when none is. */
async function worktreeOf(folder: string, branch: string): Promise<string | null> {
  const listed = await runGit(folder, ['worktree', 'list', '--porcelain']).catch(() => '')
  for (const block of listed.split(/\n\s*\n/u)) {
    const path = /^worktree (.+)$/mu.exec(block)?.[1]
    if (path !== undefined && block.split('\n').includes(`branch refs/heads/${branch}`)) return path
  }
  return null
}

/** The Project's GitHub repositories, its first first: one per clone the Profile lists (the root for one repository). */
async function projectRepos(root: string): Promise<StoryRepo[]> {
  const repos: StoryRepo[] = []
  for (const { name, path } of await repoFolders(root)) {
    for (const slug of await remoteRepos([path])) if (!repos.some((repo) => repo.slug.toLowerCase() === slug.toLowerCase())) repos.push({ slug, folder: path, name })
  }
  return repos
}

/**
 * Where a question about a story made by the button goes, by the key it was kept under (`StoryMade.key`): for
 * `owner/name#N` the repository of the Project it names — the PR must be the story's — and none for `epic:<name>`. A
 * key of another form, a repository the Project does not have or another PR is refused with its reason.
 */
export async function madeStoryRepo(root: string, key: string, story: StoryFile, repos: (root: string) => Promise<StoryRepo[]> = projectRepos): Promise<{ ok: true; repo: StoryRepo | null } | { ok: false; reason: string }> {
  if (key.startsWith('epic:')) return story.kind === 'epic' ? { ok: true, repo: null } : { ok: false, reason: `The key ${key} names an Epic, the story is of a PR.` }
  const named = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/u.exec(key)
  if (named === null) return { ok: false, reason: `${key} is not the key of a story made by the button: owner/name#N or epic:<name>.` }
  const slug = named[1]!
  const repo = (await repos(root).catch((): StoryRepo[] => [])).find((one) => one.slug.toLowerCase() === slug.toLowerCase())
  if (repo === undefined) return { ok: false, reason: `${slug} is not a repository of this Project.` }
  const pr = story.kind === 'pr' ? story.header.pr : null
  if (pr === null || String(pr) !== named[2]) return { ok: false, reason: `The key ${key} names another PR than the story (#${pr === null ? '-' : String(pr)}).` }
  return { ok: true, repo }
}

/** The app's material of a story made by the button. */
const appMaker = (): StoryMaker =>
  new StoryMaker({
    builder: builder(),
    capabilities: (vendor) => vendorDriver(vendor).capabilities(),
    project: (projectId) => {
      const store = projectStore()
      const project = store.get(projectId)
      const dataDir = store.dataDir(project.id)
      return { root: project.path, dataDir, vendor: readProjectSettings(dataDir).defaultVendor ?? 'claude' }
    },
    repos: projectRepos,
    pr: async (repo, number): Promise<PrRead> => {
      const fields = 'title,body,author,headRefOid,headRefName,comments'
      const parsed = prViewSchema.parse(JSON.parse(await repoGh(repo, ['pr', 'view', String(number), '--json', fields])))
      return {
        title: parsed.title,
        body: parsed.body ?? '',
        author: parsed.author?.login ?? null,
        head: parsed.headRefOid ?? null,
        branch: parsed.headRefName ?? null,
        comments: (parsed.comments ?? []).map((comment) => ({ author: comment.author?.login ?? null, body: comment.body ?? '' })),
      }
    },
    diff: (repo, number) => repoGh(repo, ['pr', 'diff', String(number)]),
    checkout: async (repo, branch) => (branch === null ? null : await worktreeOf(repo.folder, branch)) ?? repo.folder,
    viewer: async (projectId) => (await import('./pr-inbox')).sharedPrInbox().snapshot(projectId).viewer,
    account: async (root) => (await readGithubAccount({ root, claudeHome: claudeHome(), env: await harnessScriptEnv(), log: () => undefined })).account,
    language: async (root) => {
      const run = await profileRunner(claudeHome(), await harnessScriptEnv())(root, ['-C', root, '--field', 'language'])
      return run.code === 0 ? profileLanguage(run.stdout) : 'en'
    },
    workflow: async (root) => (await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
    ticketFile: async (root, ticket) => {
      const read = await readTicketFile(await projectLayouts().get(root), ticket)
      return { file: nativePath.basename(read.path), text: read.text }
    },
    storyFile: async (root, path) => {
      const where = storyPathParts(path)
      if (where === null) throw new Error(`${path} is not a story of an Epic`)
      return storyText(await projectLayouts().get(root), path, where.parts, {})
    },
    spec: async (root, epic) => storyText(await projectLayouts().get(root), `${epic}/spec.md`, [epic, 'spec.md'], {}),
  })

let sharedMaker: StoryMaker | undefined
const maker = (): StoryMaker => (sharedMaker ??= appMaker())

const askPrViewSchema = z.object({
  title: z.string(),
  body: z.string().nullish(),
  comments: z.array(z.object({ author: z.object({ login: z.string().nullish() }).nullish(), body: z.string().nullish() })).nullish(),
})

/**
 * The text and the comments of a PR and its diff, read with gh in the Project's root with its account, as ghPrCommits;
 * with `repo` (a story made by the button) in that repository, `--repo` named. Read-only.
 */
const ghSources = async (repo: string | null = null): Promise<Pick<AskSources, 'prView' | 'prDiff'>> => {
  const { sharedPrTracker } = await import('./checks')
  const where = repo === null ? [] : ['--repo', repo]
  return {
    prView: async (root, pr) => {
      const parsed = askPrViewSchema.parse(JSON.parse(await sharedPrTracker().gh(root, ['pr', 'view', String(pr), '--json', 'title,body,comments', ...where])))
      return { title: parsed.title, body: parsed.body ?? '', comments: (parsed.comments ?? []).map((comment) => ({ author: comment.author?.login ?? '', body: comment.body ?? '' })) }
    },
    prDiff: (root, pr) => sharedPrTracker().gh(root, ['pr', 'diff', String(pr), ...where]),
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
    material: async (request) => {
      // A story made by the button: gh in its PR's repository; the Ticket and the account where the Project's root is.
      const root = request.made?.root
      const sources: AskSources =
        root === undefined
          ? { ...(await ghSources()), ticketPr, ticketFile: ticketFileOf, account: projectAccount }
          : { ...(await ghSources(request.made?.repo ?? null)), ticketPr: (_folder, epic, num) => ticketPr(root, epic, num), ticketFile: (_folder, epic, ticket) => ticketFileOf(root, epic, ticket), account: () => projectAccount(root) }
      return gatherMaterial(request.folder, request.story, request.about, sources)
    },
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
export async function answersKey(root: string, story: StoryFile, sources: AnswersKeySources = answersKeySources): Promise<string> {
  const model = await sources.model(root).catch(() => null)
  const epic = story.header.epic === null ? undefined : model?.epics.find((one) => one.epic === story.header.epic)
  const entry = epic?.stories?.find((one) => (story.kind === 'epic' ? one.kind === 'epic' : one.kind === 'pr' && one.ticket !== null && one.ticket === story.header.ticket))
  const repo = await sources.repo(root).catch(() => null)
  return storyAnswersKey(story, { file: entry?.path ?? null, repo })
}

/** Where answersKey reads the Epics' story files and the Project's `owner/name`; stood in by tests. */
export interface AnswersKeySources {
  model(root: string): Promise<Pick<WorkflowModel, 'epics'> | null>
  repo(root: string): Promise<string | null>
}

const answersKeySources: AnswersKeySources = {
  model: async (root) => (await readWorkflow({ root, claudeHome: claudeHome(), env: harnessScriptEnv })).model,
  repo: async (root) => (await remoteRepos([root]))[0] ?? null,
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
    // The other checkouts are listed only when a folder other than the root is asked for.
    const chosen = storyFolder(project.path, folder, folder === undefined ? [] : await storyCheckouts(project.path))
    if (!chosen.ok) return { status: 'failed' as const, reason: chosen.reason }
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    return builder().build({ storyId, folder: chosen.folder, vendor, input }, (text) => toSender(event.sender, (target) => emit(target, storiesActivity, { storyId, text })))
  }),

  // One Stop for every request of the window (stories.build, stories.make, stories.ask): the maker's Stop goes on to the
  // builder (a build by the button is the maker's from the press on), and the asker holds the questions. The window
  // makes each id with crypto.randomUUID, and the Stop asks every holder (no short-circuit), so an id held by a build
  // and a question at once — which the window never makes — would stop both rather than leave one running.
  defineHandler(storiesStop, ({ storyId }) => {
    const build = maker().stop(storyId)
    const question = asker().stop(storyId)
    return { stopped: build || question }
  }),

  // A build runs to its end whatever view is open (worfy-polish 122): its end goes to the window as stories.made too, so a
  // button that came back to it — or the window's toast, when none did — hears it after the press's own answer is lost.
  defineHandler(storiesMake, ({ storyId, projectId, target, rebuild }, { event }) =>
    maker().make(
      { storyId, projectId, target, rebuild: rebuild === true },
      (text) => toSender(event.sender, (sendTo) => emit(sendTo, storiesActivity, { storyId, text })),
      (made) => toSender(event.sender, (sendTo) => emit(sendTo, storiesMadeEvent, { storyId, projectId, made })),
    ),
  ),

  defineHandler(storiesRunning, ({ projectId, target }) => maker().runningOf(projectId, target)),

  defineHandler(storiesAsk, async ({ questionId, projectId, folder, story, about, code, question, key: madeKey }, { event }) => {
    // Made before the first wait: under WORFY_AGENT=fake the asker's fake agent puts its release on globalThis when it
    // is made, and an e2e test releases the answer as soon as the progress bar shows.
    const answering = asker()
    const store = projectStore()
    const project = store.get(projectId)
    // A story made by the button names the key it was kept under: the repository of its PR (ticket 11), whose clone
    // and worktrees are the checkouts, and where gh reads the PR. Otherwise the Project's root and its worktrees.
    const made = madeKey === undefined ? null : await madeStoryRepo(project.path, madeKey, story)
    if (made !== null && !made.ok) return { status: 'failed' as const, reason: made.reason }
    const base = made?.repo?.folder ?? project.path
    // The checkout the story's code was read from, as for a build (storyFolder): the PR's worktree when it is checked out.
    const chosen = await askFolder(base, folder, storyHeadOf(story, about), await gitWorktrees(base), (one) => headOf(one).catch(() => null))
    if (!chosen.ok) return { status: 'failed' as const, reason: chosen.reason }
    const vendor = readProjectSettings(store.dataDir(project.id)).defaultVendor ?? 'claude'
    const key = madeKey ?? (await answersKey(project.path, story))
    const where = made === null ? {} : { made: { repo: made.repo?.slug ?? null, root: project.path } }
    return answering.ask({ questionId, folder: chosen.folder, dataDir: store.dataDir(project.id), key, vendor, story, about, code, question, ...where }, (text) =>
      toSender(event.sender, (target) => emit(target, storiesActivity, { storyId: questionId, text })),
    )
  }),

  defineHandler(storiesAnswers, async ({ projectId, story, key }) => {
    const store = projectStore()
    const project = store.get(projectId)
    // A story made by the button: the key it was kept under (stories.ask keeps its answers there).
    return { digest: storyDigest(story), answers: readStoryAnswers(store.dataDir(project.id), key ?? (await answersKey(project.path, story))) }
  }),

  defineHandler(storiesMarks, async ({ projectId, story, key: madeKey }) => {
    const store = projectStore()
    const project = store.get(projectId)
    // A story made by the button: the key it was kept under, the same as its answers'.
    const key = madeKey ?? (await answersKey(project.path, story))
    return { key, ...readStoryMarks(store.dataDir(project.id), key) }
  }),

  defineHandler(storiesMarkRead, ({ projectId, key, mark }) => {
    const store = projectStore()
    return { kept: addStoryReadMark(store.dataDir(store.get(projectId).id), key, mark) }
  }),

  defineHandler(storiesSelfCheck, ({ projectId, key, answer }) => {
    const store = projectStore()
    const kept = { at: new Date().toISOString(), ...answer }
    keepSelfCheck(store.dataDir(store.get(projectId).id), key, kept)
    return kept
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
