// A Code story made by the button (Epic worfy-code-stories, ticket 11; spec, owner decisions 6, 9, 13, 18, 19, 25):
// the story of a PR that has none — an ordinary Session's PR, a colleague's, an old one, a Ticket's PR whose story is
// not in the main branch — and the story of an Epic before its end. The window names only what the story is of
// (`stories.make`); this module reads the material itself, asks the invisible build of ticket 04 (one-shot.ts: one
// oneShot of the Project's Vendor, no Session, no Session Node, Read/Glob/Grep inside the checkout only) and keeps the
// answer in the store of ticket 08 (store.ts).
//
// - A PR: its diff and its text (gh, read-only; the diff goes in the request, the oneShot has no Bash), the file of its
//   Ticket when a Ticket's `PR: #N` line names it, and the review verdicts of the Project's own GitHub account. The
//   checkout read is the worktree where the PR's branch is checked out, else the clone of its repository.
// - An Epic: its spec and, per Ticket in order, the story file of its PR with the PR's number and head — the Ticket is
//   ready — or why it is not (no PR, no story in the main branch yet: decision 18). worfy, not the agent, has the last
//   word on the chapters: each ready one names its own PR head (TICKETS.md, "Story anchor", item 3), a Ticket that is
//   not ready stays a chapter without steps, and Start ends with the list of the Tickets not ready yet.
// - A colleague's PR: the agent reads the colleague's text in the request, and nothing of it is kept — the store drops
//   the title too (ADR-0105). Whose PR it is: its author against the login of the PR inbox, else the Project's account;
//   unknown counts as a colleague's.
// - The key: `owner/name#N` for a PR, `epic:<name>` for an Epic. A story kept under it opens again without a request;
//   `rebuild` builds it anew. A stopped or failed build keeps nothing.
// - Stop (`stories.stop`, `stop`) reaches a build from its first moment: while main reads the material (gh, the
//   workflow, the spec) the build ends after the read in flight, before any request; during the request the builder's
//   own Stop ends it; an answer that comes after Stop is dropped. Nothing is kept after Stop.
// - The repository of a PR: `owner/name`, or the name the Profile gives it (`_resolved.repos`), as a Ticket's
//   `PR: <repo>#N` line spells it; none — the Project's first.
// - A Vendor without a oneShot (Codex today) answers its reason before anything is read.
import { STORY_INPUT_MAX_CHARS, type StoryInput, type StoryMade, type StoryOutcome, type StoryTarget } from '../../shared/ipc/stories'
import type { Story, StoryChapter, StoryLanguage } from '../../shared/stories/schema'
import type { Capabilities } from '../../shared/vendors/capabilities'
import type { VendorId } from '../../shared/vendors/vendor'
import { repoFactsOf, type Epic, type Ticket } from '../../shared/workflow/types'
import { findVerdict } from '../../shared/workflow/verdict.mjs'
import notReadyTexts from './not-ready.json'
import { oneShotRefusal, type StoryRequest } from './one-shot'
import { readSavedStory, saveStory } from './store'

/** A GitHub repository of the Project: `owner/name`, the folder of its clone and its name in the Profile (`_resolved.repos`; null for a Project of one repository). */
export interface StoryRepo {
  slug: string
  folder: string
  name: string | null
}

/** What gh says of a PR: its text, author, head and the comments of its conversation. */
export interface PrRead {
  title: string
  body: string
  author: string | null
  head: string | null
  branch: string | null
  comments: readonly { author: string | null; body: string }[]
}

export interface StoryMakerDeps {
  /** The build of ticket 04 (StoryBuilder): Stop of a build that reached it goes on to its own `stop`. */
  builder: { build(request: StoryRequest, onActivity: (text: string) => void): Promise<StoryOutcome>; stop(storyId: string): boolean }
  capabilities(vendor: VendorId): Promise<Capabilities>
  /** The Project's root, its data folder and its Vendor. */
  project(projectId: string): { root: string; dataDir: string; vendor: VendorId }
  /** The Project's GitHub repositories, its own first: one per clone the Profile lists (the root for one repository). */
  repos(root: string): Promise<StoryRepo[]>
  pr(repo: StoryRepo, number: number): Promise<PrRead>
  diff(repo: StoryRepo, number: number): Promise<string>
  /** The worktree of `repo` where `branch` is checked out; the clone itself when none is. */
  checkout(repo: StoryRepo, branch: string | null): Promise<string>
  /** The login of the person at this machine (the PR inbox's viewer); null when unknown. */
  viewer(projectId: string): Promise<string | null>
  /** The Project's GitHub account (`github.account`): the author of its review verdicts; null when none. */
  account(root: string): Promise<string | null>
  /** `language.reports` of the Profile. */
  language(root: string): Promise<StoryLanguage>
  workflow(root: string): Promise<{ tickets: readonly Ticket[]; epics: readonly Epic[] }>
  ticketFile(root: string, ticket: { epic: string; num: number; slug: string }): Promise<{ file: string; text: string }>
  /** The text of a story file under the Tickets root (`<epic>/stories/NN-<slug>.md`), where the workflow is read from. */
  storyFile(root: string, path: string): Promise<string>
  /** The text of the Epic's spec.md, where the workflow is read from. */
  spec(root: string, epic: string): Promise<string>
}

export interface MakeRequest {
  storyId: string
  projectId: string
  target: StoryTarget
  rebuild?: boolean
}

const SHA = /^[0-9a-f]{40}$/u

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const sameLogin = (a: string | null, b: string | null): boolean => a !== null && b !== null && a.toLowerCase() === b.toLowerCase()

const nn = (num: number): string => String(num).padStart(2, '0')

/** The text, cut to what a request carries (STORY_INPUT_MAX_CHARS), with a note where it was cut. */
export function cutMaterial(text: string): string {
  const note = '\n[… cut here: the text is longer than a request carries]'
  return text.length <= STORY_INPUT_MAX_CHARS ? text : text.slice(0, STORY_INPUT_MAX_CHARS - note.length) + note
}

/** `language.reports` from what `profile --field language` prints: the object's `reports`, or the string form; `en` otherwise. */
export function profileLanguage(stdout: string): StoryLanguage {
  let value: unknown = stdout.trim()
  try {
    value = JSON.parse(stdout)
  } catch {
    // A bare string: taken as it is.
  }
  const reports = typeof value === 'object' && value !== null ? (value as { reports?: unknown }).reports : value
  return reports === 'ru' ? 'ru' : 'en'
}

/** The key a story made by the button is kept under: `owner/name#N`, `epic:<name>`. */
export function storyKeyOf(target: StoryTarget, repo: string | null): string {
  return target.kind === 'epic' ? `epic:${target.epic}` : `${repo ?? ''}#${String(target.number)}`
}

/** Why a Ticket of an Epic is not ready, and the line Start ends with, in the story's language (not-ready.json). */
const notReady = {
  noPr: (language: StoryLanguage): string => notReadyTexts[language].noPr,
  noStory: (language: StoryLanguage, pr: number): string => fill(notReadyTexts[language].noStory, { pr: String(pr) }),
  noHead: (language: StoryLanguage, pr: number, why: string): string => fill(notReadyTexts[language].noHead, { pr: String(pr), why }),
  unreadable: (language: StoryLanguage, why: string): string => fill(notReadyTexts[language].unreadable, { why }),
  headNotGiven: (language: StoryLanguage): string => notReadyTexts[language].headNotGiven,
  noRepo: (language: StoryLanguage): string => notReadyTexts[language].noRepo,
  skipped: (language: StoryLanguage): string => notReadyTexts[language].skipped,
}

/** `text` with each `{name}` replaced by its value. */
const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/gu, (whole, name: string) => values[name] ?? whole)

/** The line Start ends with: the Tickets not ready yet (decision 18). */
export const notReadyLine = (language: StoryLanguage, tickets: readonly string[]): string => fill(notReadyTexts[language].line, { tickets: tickets.join(', ') })

/** A Ticket of an Epic as worfy knows it before the build: ready with its PR and head, or the reason it is not. */
export interface KnownChapter {
  ticket: string
  title: string
  ready: { pr: number; head: string; story: string; path: string } | null
  why: string | null
}

/** The text of a chapter in the request. */
function chapterText(chapter: KnownChapter): string {
  if (chapter.ready === null) return `Ticket ${chapter.ticket} — ${chapter.title}\nReady: no — ${chapter.why ?? ''}`
  const { pr, head, story, path } = chapter.ready
  return `Ticket ${chapter.ticket} — ${chapter.title}\nReady: yes\nPR: #${String(pr)}\nHead: ${head}\nThe Code story of its PR (${path}):\n${story}`
}

/**
 * The Epic story with worfy's word on its chapters: only the Tickets worfy knows, once each. A ready one names the head
 * of its own PR, as worfy read it from GitHub; one worfy knows is not ready has no PR, head or steps and worfy's
 * reason; a Ticket the answer left out, or gave without steps, is such a chapter too. Start ends with the Tickets not
 * ready yet.
 */
export function settleChapters(story: Extract<Story, { kind: 'epic' }>, known: readonly KnownChapter[]): Extract<Story, { kind: 'epic' }> {
  const language = story.header.language
  const chapters: StoryChapter[] = known.map((ours) => {
    const chapter = story.chapters.find((one) => one.ticket === ours.ticket)
    const asNotReady = (why: string): StoryChapter => ({ ready: false, pr: null, ticket: ours.ticket, title: chapter?.title ?? ours.title, head: null, steps: [], why })
    if (ours.ready === null) return asNotReady(ours.why ?? '-')
    // A ready Ticket the answer left out, or gave without steps: nothing of it to tell, so not ready, with why.
    if (chapter === undefined || !chapter.ready || chapter.steps.length === 0) return asNotReady(chapter?.why ?? notReady.skipped(language))
    return { ...chapter, pr: ours.ready.pr, head: ours.ready.head, why: null }
  })
  const waiting = chapters.filter((chapter) => !chapter.ready).map((chapter) => chapter.ticket)
  const start = waiting.length === 0 ? story.start : { ...story.start, text: `${story.start.text.trimEnd()}\n\n${notReadyLine(language, waiting)}` }
  return { ...story, start, chapters }
}

/** The repository `asked` names among `repos`: by `owner/name` or by its name in the Profile; the first when null. */
function repoNamed(repos: readonly StoryRepo[], asked: string | null): StoryRepo | null {
  if (asked === null) return repos[0] ?? null
  const wanted = asked.toLowerCase()
  return repos.find((one) => one.slug.toLowerCase() === wanted) ?? repos.find((one) => one.name?.toLowerCase() === wanted) ?? null
}

/** Whether `ticket` names PR `number` of `repo`: `PR: <repo>#N` by its name, a bare `PR: #N` in the Project's first repository. */
function ticketNamesPr(ticket: Ticket, repo: StoryRepo, repos: readonly StoryRepo[], number: number): boolean {
  return repoFactsOf(ticket).prs.some((pr) => pr.number === number && (pr.repo === null ? repo === repos[0] : repo.name !== null && pr.repo.toLowerCase() === repo.name.toLowerCase()))
}

export class StoryMaker {
  /** The builds under way, by storyId, from the press until the story is kept: Stop aborts the signal. */
  private readonly running = new Map<string, AbortController>()

  constructor(private readonly deps: StoryMakerDeps) {}

  /** Stop: ends the build `storyId` wherever it is — reading the material, or in the request; false when none runs. */
  stop(storyId: string): boolean {
    const run = this.running.get(storyId)
    const inBuilder = this.deps.builder.stop(storyId)
    if (run === undefined) return inBuilder
    run.abort()
    return true
  }

  /** Makes the story of `request.target`, or opens the one kept before; `onActivity` hears the build's lines. */
  async make(request: MakeRequest, onActivity: (text: string) => void): Promise<StoryMade> {
    const asked = request.target.kind === 'pr' ? request.target.repo : null
    if (this.running.has(request.storyId)) return failed(storyKeyOf(request.target, asked), `The story ${request.storyId} is already being built.`)
    // Taken before the first wait, so Stop reaches the build from the press on.
    const stop = new AbortController()
    this.running.set(request.storyId, stop)
    try {
      return await this.makeWith(request, stop.signal, onActivity)
    } finally {
      if (this.running.get(request.storyId) === stop) this.running.delete(request.storyId)
    }
  }

  private async makeWith(request: MakeRequest, signal: AbortSignal, onActivity: (text: string) => void): Promise<StoryMade> {
    const project = this.deps.project(request.projectId)
    let repos: StoryRepo[] = []
    let repo: StoryRepo | null = null
    if (request.target.kind === 'pr') {
      const asked = request.target.repo
      try {
        repos = await this.deps.repos(project.root)
      } catch (error) {
        return failed(storyKeyOf(request.target, asked), `The repositories of the Project could not be read: ${messageOf(error)}`)
      }
      repo = repoNamed(repos, asked)
      if (repo === null) {
        const reason = asked === null ? 'The Project has no GitHub repository.' : `${asked} is not a repository of this Project.`
        return failed(storyKeyOf(request.target, asked), reason)
      }
    }
    const key = storyKeyOf(request.target, repo?.slug ?? null)
    const stopped: StoryMade = { key, reused: false, outcome: { status: 'stopped' } }
    if (signal.aborted) return stopped
    if (request.rebuild !== true) {
      const saved = readSavedStory(project.dataDir, key)
      if (saved !== null) return { key, reused: true, outcome: { status: 'story', story: saved.story } }
    }
    // A Vendor without a oneShot: its reason, before gh or a file is read.
    try {
      const refusal = oneShotRefusal(await this.deps.capabilities(project.vendor))
      if (refusal !== null) return { key, reused: false, outcome: { status: 'unavailable', reason: refusal } }
    } catch (error) {
      return failed(key, `What ${project.vendor} can do could not be read: ${messageOf(error)}`)
    }
    if (signal.aborted) return stopped

    let prepared: Prepared
    try {
      prepared = request.target.kind === 'pr' ? await this.preparePr(request.projectId, project.root, repo!, repos, request.target.number, signal) : await this.prepareEpic(project.root, request.target.epic, signal)
    } catch (error) {
      return signal.aborted ? stopped : failed(key, messageOf(error))
    }
    // No wait between this check and the builder taking the storyId (it does so before its first wait): from here Stop
    // is the builder's, and an answer that comes after it is dropped there (`stopped`).
    if (signal.aborted) return stopped
    const outcome = await this.deps.builder.build({ storyId: request.storyId, folder: prepared.folder, vendor: project.vendor, input: prepared.input }, onActivity)
    if (outcome.status !== 'story') return { key, reused: false, outcome }
    const story = outcome.story.kind === 'epic' ? settleChapters(outcome.story, prepared.chapters) : outcome.story
    try {
      const saved = saveStory(project.dataDir, key, { story, colleague: prepared.colleague })
      return { key, reused: false, outcome: { status: 'story', story: saved.story } }
    } catch (error) {
      return failed(key, `The story could not be kept: ${messageOf(error)}`)
    }
  }

  /** The material of the story of PR `number` of `repo`. Throws with the reason it cannot be read. */
  private async preparePr(projectId: string, root: string, repo: StoryRepo, repos: readonly StoryRepo[], number: number, signal: AbortSignal): Promise<Prepared> {
    const pr = await this.deps.pr(repo, number).catch((error: unknown) => {
      throw new Error(`PR #${String(number)} of ${repo.slug} could not be read: ${messageOf(error)}`)
    })
    stopIf(signal)
    if (pr.head === null || !SHA.test(pr.head)) throw new Error(`GitHub gives no head commit of PR #${String(number)}.`)
    const diff = await this.deps.diff(repo, number).catch((error: unknown) => {
      throw new Error(`The diff of PR #${String(number)} could not be read: ${messageOf(error)}`)
    })
    stopIf(signal)
    if (diff.trim() === '') throw new Error(`PR #${String(number)} changes nothing: its diff is empty.`)
    // The Ticket whose `PR:` line names this PR: `PR: <repo>#N`, or a bare `PR: #N` of the Project's first repository.
    const model = await this.deps.workflow(root).catch(() => null)
    stopIf(signal)
    const ticket = model?.tickets.find((one) => ticketNamesPr(one, repo, repos, number)) ?? null
    const ticketFile = ticket === null ? null : await this.deps.ticketFile(root, ticket).catch(() => null)
    stopIf(signal)
    const viewer = await this.deps.viewer(projectId).catch(() => null)
    const account = await this.deps.account(root).catch(() => null)
    const me = viewer ?? account
    const verdictsBy = account ?? viewer
    const verdicts = pr.comments
      .filter((comment) => sameLogin(comment.author, verdictsBy))
      .map((comment) => findVerdict(comment.body)?.text ?? null)
      .filter((text): text is string => text !== null)
      .slice(-20)
      .map(cutMaterial)
    const language = await this.deps.language(root).catch((): StoryLanguage => 'en')
    stopIf(signal)
    const colleague = !sameLogin(pr.author, me)
    // A colleague's title stays between the markers of the material: the instruction above them names the PR by number.
    const title = colleague || pr.title.trim() === '' ? `PR #${String(number)}` : pr.title
    const input: StoryInput = {
      kind: 'pr',
      header: { title, epic: ticket?.epic ?? null, ticket: ticket === null ? null : nn(ticket.num), pr: number, language, commit: pr.head },
      diff: cutMaterial(diff),
      prText: cutMaterial(`${pr.title}\n\n${pr.body}`.trim()),
      ticket: ticketFile === null ? null : { file: ticketFile.file, text: cutMaterial(ticketFile.text) },
      verdicts,
    }
    const folder = await this.deps.checkout(repo, pr.branch).catch(() => repo.folder)
    stopIf(signal)
    return { input, folder, colleague, chapters: [] }
  }

  /** The material of the story of Epic `name` before its end. Throws with the reason it cannot be read. */
  private async prepareEpic(root: string, name: string, signal: AbortSignal): Promise<Prepared> {
    const model = await this.deps.workflow(root).catch((error: unknown) => {
      throw new Error(`The workflow of the Project could not be read: ${messageOf(error)}`)
    })
    stopIf(signal)
    const epic = model.epics.find((one) => one.epic === name)
    if (epic === undefined) throw new Error(`There is no Epic ${name} in this Project.`)
    const tickets = model.tickets.filter((one) => one.epic === name).sort((a, b) => a.num - b.num)
    if (tickets.length === 0) throw new Error(`The Epic ${name} has no Tickets.`)
    const spec = await this.deps.spec(root, name).catch((error: unknown) => {
      throw new Error(`The spec of ${name} could not be read: ${messageOf(error)}`)
    })
    stopIf(signal)
    if (spec.trim() === '') throw new Error(`The spec of ${name} is empty.`)
    const language = await this.deps.language(root).catch((): StoryLanguage => 'en')
    const repos = await this.deps.repos(root).catch((): StoryRepo[] => [])
    stopIf(signal)
    const own = repos[0] ?? null
    const chapters: KnownChapter[] = []
    for (const ticket of tickets) {
      const num = nn(ticket.num)
      const chapter = (ready: KnownChapter['ready'], why: string | null): void => {
        chapters.push({ ticket: num, title: ticket.title, ready, why })
      }
      const pr = ticket.pr ?? null
      const entry = epic.stories?.find((one) => one.kind === 'pr' && one.ticket === num)
      if (pr === null) chapter(null, notReady.noPr(language))
      else if (entry === undefined) chapter(null, notReady.noStory(language, pr))
      else {
        // gh's own message stays as gh gives it; worfy's reasons are in the story's language.
        const head = own === null ? null : await this.deps.pr(own, pr).then(
          (read) => (read.head !== null && SHA.test(read.head) ? read.head : notReady.headNotGiven(language)),
          (error: unknown) => messageOf(error),
        )
        stopIf(signal)
        const text = await this.deps.storyFile(root, entry.path).then(
          (read) => ({ ok: true as const, read }),
          (error: unknown) => ({ ok: false as const, why: messageOf(error) }),
        )
        stopIf(signal)
        if (head === null || !SHA.test(head)) chapter(null, notReady.noHead(language, pr, head ?? notReady.noRepo(language)))
        else if (!text.ok) chapter(null, notReady.unreadable(language, text.why))
        else chapter({ pr, head, story: cutMaterial(text.read), path: entry.path }, null)
      }
    }
    const input: StoryInput = { kind: 'epic', header: { epic: name, language }, spec: cutMaterial(spec), chapters: chapters.map(chapterText).map(cutMaterial), verdicts: [] }
    return { input, folder: own?.folder ?? root, colleague: false, chapters }
  }
}

interface Prepared {
  input: StoryInput
  /** The checkout the request reads. */
  folder: string
  colleague: boolean
  /** An Epic's Tickets as worfy knows them; none for a PR. */
  chapters: KnownChapter[]
}

const failed = (key: string, reason: string): StoryMade => ({ key, reused: false, outcome: { status: 'failed', reason } })

/** Ends the reading of the material once Stop came: `make` answers `stopped` for it. */
function stopIf(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('stopped')
}
