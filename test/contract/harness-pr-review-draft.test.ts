// The writer of an Agent review (harness/bin/pr-review-draft, worfy-pr-review ticket 08): the Session of an Agent review
// writes the review draft of someone else's PR — comments on lines, the summary, the suggested verdict, the end — only
// through this script, into <Profile folder>/state/pr-review/<owner>-<name>-<N>.json, the file main keeps
// (src/main/github/pr-review-draft.ts, ticket 07). It changes only what the agent wrote (`by: 'agent'`), the summary only
// while it is empty or the agent's, and refuses without a draft, on a draft being submitted or submitted, and after
// Stop / Take over. The last case races it with main: both write the same file 200 times at once, and no change is lost.
// Every run gets a temporary HARNESS_HOME, HOME and project; the texts are invented.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrReviewDrafts } from '../../src/main/github/pr-review-draft'
import { reviewDraftSchema, type ReviewDraft } from '../../src/shared/ipc/pr-review'
import { removeTestTree } from '../remove'
import { scriptNode } from '../script-node'
import { ms } from '../time-scale'

const CLI = join(process.cwd(), 'harness', 'bin', 'pr-review-draft')
const REPO = 'example-org/app'
const PR = 118
const SLUG = `${REPO}#${PR}`

let root: string
let home: string
let harnessHome: string
let repo: string
let profileDir: string
let folder: string
let file: string
let head: string

const CART = ['export function cart() {', '  const items = []', '  for (let i = 0; i < 3; i++) {', '    items.push(i)', '  }', '  return items', '}', ''].join('\n')

beforeAll(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'pr-review-draft-')))
  home = join(root, 'home')
  harnessHome = join(root, 'hh')
  repo = join(root, 'repo')
  for (const dir of [home, join(harnessHome, 'gate'), join(harnessHome, 'projects', 'fp'), join(repo, 'src')]) mkdirSync(dir, { recursive: true })
  const git = (...args: string[]): string => {
    const run = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    return run.stdout.trim()
  }
  git('init', '-q')
  writeFileSync(join(repo, 'src', 'cart.ts'), CART)
  git('add', '.')
  git('commit', '-q', '-m', 'cart')
  head = git('rev-parse', 'HEAD')
  const entry = { key: 'fp', match: repo, profile: 'fp', pm: 'npm', root: {}, workspace: {} }
  writeFileSync(join(harnessHome, 'gate', 'config.json'), JSON.stringify({ repos: [entry] }))
  writeFileSync(join(harnessHome, 'projects', 'fp', 'profile.json'), JSON.stringify({ schema: 2, name: 'fp', mode: 'full', attribution: 'on', tickets: { root: '.scratch/' } }))
  profileDir = join(harnessHome, 'projects', 'fp')
  folder = join(profileDir, 'state', 'pr-review')
  file = join(folder, 'example-org-app-118.json')
})

afterAll(() => {
  removeTestTree(root)
})

interface Run {
  status: number | null
  stdout: string
  stderr: string
}

function env(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, HARNESS_HOME: harnessHome, EVAL_HARNESS_HOME: '' }
  // The gate runs the tests with CLAUDE_GATE_CONFIG naming the registry of this machine; the scripts would read
  // that one instead of the temporary HARNESS_HOME.
  for (const name of ['CLAUDE_GATE_CONFIG', 'CLAUDE_GATE_RESOLVE', 'CLAUDE_PROFILES_DIR', 'CLAUDE_PROFILE_BIN', 'CLAUDE_TICKET_BIN']) delete out[name]
  return out
}

function draftCli(args: string[], input?: string, extra: NodeJS.ProcessEnv = {}): Run {
  const run = spawnSync(scriptNode(), [CLI, ...args], { cwd: repo, encoding: 'utf8', env: { ...env(), ...extra }, ...(input === undefined ? {} : { input }) })
  return { status: run.status, stdout: run.stdout, stderr: run.stderr }
}

/** The same, without blocking the test's own event loop: main writes meanwhile. */
function draftCliAsync(args: string[]): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(scriptNode(), [CLI, ...args], { cwd: repo, env: env(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

const personComment = (line: number, body: string) => ({ path: 'src/cart.ts', line, side: 'RIGHT' as const, body })

function draft(over: Partial<ReviewDraft> = {}): ReviewDraft {
  return {
    schema: 1,
    repo: REPO,
    pr: PR,
    startedOn: head,
    payload: { body: '', comments: [personComment(2, 'Why an array?')] },
    anchors: [{ text: '  const items = []', by: 'person' }],
    viewed: {},
    state: 'draft',
    agent: { sessionId: 'session-1', state: 'writing' },
    ...over,
  }
}

const reset = (content: ReviewDraft | string | null): void => {
  removeTestTree(folder)
  if (content === null) return
  mkdirSync(folder, { recursive: true })
  writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2))
}
const saved = (): ReviewDraft => reviewDraftSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
const leftovers = (): string[] => (existsSync(folder) ? readdirSync(folder).filter((name) => name !== 'example-org-app-118.json') : [])

describe('pr-review-draft', () => {
  it('comment: adds a comment of the agent with the text of its lines at the head, after the person’s, whose comments stay as they are', { timeout: ms(30_000) }, () => {
    reset(draft())
    const one = draftCli([SLUG, 'comment', 'src/cart.ts', '3', 'Three is a magic number here.'])
    expect(one.status, one.stdout + one.stderr).toBe(0)
    expect(one.stdout).toBe(`pr-review-draft: wrote ${file}: a comment on src/cart.ts:3\n`)
    const range = draftCli([SLUG, 'comment', 'src/cart.ts', '5', '--start-line', '3', '--side', 'RIGHT', '-'], 'The loop could be Array.from.\nNo hurry.')
    expect(range.status, range.stdout + range.stderr).toBe(0)
    // Lines the person commented on: the agent's comment goes beside, the person's stays.
    const beside = draftCli([SLUG, 'comment', 'src/cart.ts', '2', 'Typed array?'])
    expect(beside.status, beside.stdout + beside.stderr).toBe(0)
    expect(saved().payload.comments).toEqual([
      personComment(2, 'Why an array?'),
      { path: 'src/cart.ts', line: 3, side: 'RIGHT', body: 'Three is a magic number here.' },
      { path: 'src/cart.ts', start_line: 3, start_side: 'RIGHT', line: 5, side: 'RIGHT', body: 'The loop could be Array.from.\nNo hurry.' },
      { path: 'src/cart.ts', line: 2, side: 'RIGHT', body: 'Typed array?' },
    ])
    expect(saved().anchors).toEqual([
      { text: '  const items = []', by: 'person' },
      { text: '  for (let i = 0; i < 3; i++) {', by: 'agent' },
      { text: '  for (let i = 0; i < 3; i++) {\n    items.push(i)\n  }', by: 'agent' },
      { text: '  const items = []', by: 'agent' },
    ])
    expect(leftovers()).toEqual([])
  })

  it('comment: a line past the end of the file at the head is refused; a file the head does not have keeps an empty text', { timeout: ms(30_000) }, () => {
    reset(draft())
    const before = readFileSync(file, 'utf8')
    const past = draftCli([SLUG, 'comment', 'src/cart.ts', '40', 'Here?'])
    expect(past.status).toBe(1)
    expect(past.stderr).toContain(`line 40 is past the end of src/cart.ts at ${head} (7 lines): nothing written`)
    expect(readFileSync(file, 'utf8')).toBe(before)
    const gone = draftCli([SLUG, 'comment', 'src/old.ts', '4', '--side', 'LEFT', 'Removed on purpose?'])
    expect(gone.status, gone.stdout + gone.stderr).toBe(0)
    expect(saved().payload.comments.at(-1)).toEqual({ path: 'src/old.ts', line: 4, side: 'LEFT', body: 'Removed on purpose?' })
    expect(saved().anchors.at(-1)).toEqual({ text: '', by: 'agent' })
  })

  it('summary: written while empty or the agent’s, refused over the person’s', { timeout: ms(30_000) }, () => {
    reset(draft())
    expect(draftCli([SLUG, 'summary', 'Two small things.']).status).toBe(0)
    expect(saved().payload.body).toBe('Two small things.')
    expect(saved()).toMatchObject({ bodyBy: 'agent' })
    expect(draftCli([SLUG, 'summary', '-'], 'One small thing.\n').status).toBe(0)
    expect(saved().payload.body).toBe('One small thing.')

    reset(draft({ payload: { body: 'My own words.', comments: [personComment(2, 'Why an array?')] } }))
    const before = readFileSync(file, 'utf8')
    const refused = draftCli([SLUG, 'summary', 'Overwrite.'])
    expect(refused.status).toBe(1)
    expect(refused.stderr).toContain("the summary is the person's: nothing written")
    expect(readFileSync(file, 'utf8')).toBe(before)
  })

  it('verdict: only suggested, the event stays the person’s; done ends the agent’s writing', { timeout: ms(30_000) }, () => {
    reset(draft())
    expect(draftCli([SLUG, 'verdict', 'request_changes']).status).toBe(0)
    expect(saved().suggestedEvent).toBe('REQUEST_CHANGES')
    expect(saved().payload.event).toBeUndefined()
    expect(draftCli([SLUG, 'verdict', 'approve']).status).toBe(0)
    expect(saved().suggestedEvent).toBe('APPROVE')
    const bad = draftCli([SLUG, 'verdict', 'merge'])
    expect(bad.status).toBe(2)
    expect(bad.stderr).toContain('verdict must be comment, approve or request_changes')
    const done = draftCli([SLUG, 'done'])
    expect(done.status, done.stdout + done.stderr).toBe(0)
    expect(saved().agent).toEqual({ sessionId: 'session-1', state: 'done' })
    expect(saved().payload.comments).toEqual([personComment(2, 'Why an array?')])
  })

  it('refuses without a draft, on a draft being submitted or submitted, and after Stop; writes nothing then', { timeout: ms(30_000) }, () => {
    reset(null)
    const none = draftCli([SLUG, 'comment', 'src/cart.ts', '3', 'Hello.'])
    expect(none.status).toBe(1)
    expect(none.stderr).toContain(`there is no review draft of ${SLUG}`)
    expect(existsSync(folder)).toBe(false)
    for (const [over, words] of [
      [{ state: 'submitting' }, 'the review is submitting'],
      [{ state: 'submitted' }, 'the review is submitted'],
      [{ agent: { sessionId: 'session-1', state: 'stopped' } }, 'Agent review was stopped'],
    ] as const) {
      reset(draft(over))
      const before = readFileSync(file, 'utf8')
      for (const args of [['comment', 'src/cart.ts', '3', 'Hello.'], ['summary', 'Hi.'], ['verdict', 'comment'], ['done']]) {
        const run = draftCli([SLUG, ...args])
        expect(run.status, `${args[0]} on ${words}`).toBe(1)
        expect(run.stderr).toContain(words)
      }
      expect(readFileSync(file, 'utf8')).toBe(before)
    }
  })

  it('refuses a broken draft file, a draft of another PR, bad arguments and a folder of no project', { timeout: ms(30_000) }, () => {
    reset('{ half')
    expect(draftCli([SLUG, 'done']).stderr).toContain('is not JSON')
    reset(draft({ pr: 7 }))
    const other = draftCli([SLUG, 'done'])
    expect(other.status).toBe(2)
    expect(other.stderr).toContain('is of example-org/app#7')
    reset(draft())
    for (const args of [[], ['app#1', 'done'], [SLUG], [SLUG, 'post'], [SLUG, 'comment', 'src/cart.ts', 'x', 'Hi'], [SLUG, 'comment', 'src/cart.ts', '3', '--start-line', '3', 'Hi'], [SLUG, 'comment', 'src/cart.ts', '3', '']])
      expect(draftCli(args).status, args.join(' ')).toBe(2)
    const outside = join(root, 'outside')
    mkdirSync(outside, { recursive: true })
    const stray = draftCli(['-C', outside, SLUG, 'done'])
    expect(stray.status).toBe(2)
    expect(stray.stderr).toContain('is not a registered project')
    expect(leftovers()).toEqual([])
  })

  it('a rename Windows refuses for a moment (main reads the file) is retried; one refused for good writes nothing and leaves no lock', { timeout: ms(30_000) }, () => {
    // Loaded into the script before it runs: its first FAIL_RENAMES renames fail with EPERM, as on Windows while
    // another process has the target open.
    const preload = join(root, 'refuse-renames.cjs')
    writeFileSync(
      preload,
      "const fs = require('node:fs'); const rename = fs.renameSync; let left = Number(process.env.FAIL_RENAMES);\n" +
        "fs.renameSync = (from, to) => { if (left-- > 0) throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' }); return rename(from, to) }\n",
    )
    const refusing = (n: number): NodeJS.ProcessEnv => ({ NODE_OPTIONS: `--require ${JSON.stringify(preload)}`, FAIL_RENAMES: String(n) })
    reset(draft())
    const run = draftCli([SLUG, 'comment', 'src/cart.ts', '3', 'Why three?'], undefined, refusing(5))
    expect(run.status, run.stdout + run.stderr).toBe(0)
    expect(saved().payload.comments.map((each) => each.body)).toEqual(['Why an array?', 'Why three?'])
    const before = readFileSync(file, 'utf8')
    const refused = draftCli([SLUG, 'comment', 'src/cart.ts', '4', 'And here?'], undefined, refusing(1000))
    expect(refused.status).toBe(2)
    expect(refused.stderr).toContain('cannot write the review draft')
    expect(readFileSync(file, 'utf8')).toBe(before)
    expect(leftovers()).toEqual([])
  })

  it('races main: main saves 200 comments of the person while the script writes 200 of the agent; none is lost, the file always parses', { timeout: ms(240_000) }, async () => {
    reset(draft({ payload: { body: '', comments: [] }, anchors: [] }))
    // A clock that jumps 1 s a call: main writes each change at once, never waits out its 500 ms.
    let clock = 0
    const drafts = new PrReviewDrafts({ profileDir: async () => ({ dir: profileDir, reason: null }), now: () => (clock += 1000), warn: () => undefined })
    const N = 200
    let reads = 0
    const broken: string[] = []
    let racing = true
    const reader = (async () => {
      while (racing) {
        let text: string | null = null
        try {
          text = readFileSync(file, 'utf8')
        } catch (error) {
          // Windows refuses an open for a moment while a rename replaces the file: no read, not a broken file.
          if (!['EPERM', 'EBUSY', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) broken.push(String(error))
        }
        if (text !== null) {
          try {
            reviewDraftSchema.parse(JSON.parse(text))
            reads++
          } catch (error) {
            broken.push(String(error))
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1))
      }
    })()
    const main = (async () => {
      for (let i = 0; i < N; i++) {
        const answer = await drafts.saveComment(repo, REPO, PR, { head, comment: personComment(1 + (i % 7), `person ${i}`), anchor: CART.split('\n')[i % 7] ?? '' })
        expect(answer.problem).toBeNull()
        await new Promise((resolve) => setTimeout(resolve, i % 3))
      }
    })()
    const agent = (async () => {
      let next = 0
      const lane = async (): Promise<void> => {
        while (next < N) {
          const i = next++
          const run = await draftCliAsync([SLUG, 'comment', 'src/cart.ts', String(1 + (i % 7)), `agent ${i}`])
          expect(run.status, run.stdout + run.stderr).toBe(0)
        }
      }
      await Promise.all(Array.from({ length: 8 }, lane))
    })()
    await Promise.all([main, agent])
    await drafts.flush()
    racing = false
    await reader
    expect(broken).toEqual([])
    expect(reads).toBeGreaterThan(0)
    const final = saved()
    const bodies = final.payload.comments.map((each) => each.body)
    const expected = [...Array.from({ length: N }, (_, i) => `person ${i}`), ...Array.from({ length: N }, (_, i) => `agent ${i}`)]
    expect([...bodies].sort()).toEqual([...expected].sort())
    expect(final.anchors.filter((anchor) => anchor.by === 'agent')).toHaveLength(N)
    expect(final.anchors.filter((anchor) => anchor.by === 'person')).toHaveLength(N)
    expect(leftovers()).toEqual([])
  })
})

describe('the write at quit (flushSync) and the lock', () => {
  const lock = (): string => `${file}.lock`
  const bodies = (): string[] => saved().payload.comments.map((each) => each.body)
  /**
   * Main with 'First.' written and 'Second.' waiting for its write: its clock goes an hour back after the first write,
   * so the timer of the second never fires within the test and only flushSync writes it.
   */
  async function oneWaiting(): Promise<PrReviewDrafts> {
    let clock = 0
    const drafts = new PrReviewDrafts({ profileDir: async () => ({ dir: profileDir, reason: null }), now: () => clock, warn: () => undefined })
    for (const body of ['First.', 'Second.']) {
      expect((await drafts.saveComment(repo, REPO, PR, { head, comment: personComment(4, body), anchor: '    items.push(i)' })).problem).toBeNull()
      clock = -3_600_000
    }
    return drafts
  }

  it('does not wait for the lock its own write of this process holds: written at once, once', { timeout: ms(60_000) }, async () => {
    reset(draft())
    let release = (): void => undefined
    let blocked = false
    const drafts = new PrReviewDrafts({
      profileDir: async () => ({ dir: profileDir, reason: null }),
      warn: () => undefined,
      // The write of main stops after it took the lock and read the file, before the rename: a quit comes now.
      writeFile: async (path, text) => {
        blocked = true
        await new Promise<void>((resolve) => (release = resolve))
        writeFileSync(path, text)
      },
    })
    const save = drafts.saveComment(repo, REPO, PR, { head, comment: personComment(4, 'Why push?'), anchor: '    items.push(i)' })
    while (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
    expect(existsSync(lock())).toBe(true)
    const started = Date.now()
    drafts.flushSync()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(bodies()).toEqual(['Why an array?', 'Why push?'])
    release()
    expect((await save).problem).toBeNull()
    expect(bodies()).toEqual(['Why an array?', 'Why push?'])
    expect(existsSync(lock())).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('waits when another process took over the lock of its own write (stale meanwhile), then writes and leaves no lock', { timeout: ms(60_000) }, async () => {
    reset(draft())
    let release = (): void => undefined
    let blocked = false
    const drafts = new PrReviewDrafts({
      profileDir: async () => ({ dir: profileDir, reason: null }),
      warn: () => undefined,
      writeFile: async (path, text) => {
        blocked = true
        await new Promise<void>((resolve) => (release = resolve))
        writeFileSync(path, text)
      },
    })
    const save = drafts.saveComment(repo, REPO, PR, { head, comment: personComment(4, 'Why push?'), anchor: '    items.push(i)' })
    while (!blocked) await new Promise((resolve) => setTimeout(resolve, 5))
    // The script found the lock stale and took it over: the lock now names its process, which lets it go in 300 ms.
    const holder = spawn(scriptNode(), ['-e', "require('fs').writeFileSync(process.argv[1], process.pid + '\\n'); process.stdout.write('ready\\n'); setTimeout(() => require('fs').unlinkSync(process.argv[1]), 300)", lock()], { stdio: ['ignore', 'pipe', 'inherit'] })
    const gone = new Promise((resolve) => holder.on('close', resolve))
    await new Promise((resolve) => holder.stdout.once('data', resolve))
    const started = Date.now()
    drafts.flushSync()
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    await gone
    expect(bodies()).toEqual(['Why an array?', 'Why push?'])
    expect(existsSync(lock())).toBe(false)
    release()
    await save
    expect(existsSync(lock())).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('waits for the lock of another writer, then writes and leaves no lock', { timeout: ms(60_000) }, async () => {
    reset(draft())
    const drafts = await oneWaiting()
    expect(bodies()).toEqual(['Why an array?', 'First.'])
    // Another process holds the lock and lets it go 300 ms after it says it is running.
    writeFileSync(lock(), '1\n')
    const holder = spawn(scriptNode(), ['-e', "process.stdout.write('ready\\n'); setTimeout(() => require('fs').unlinkSync(process.argv[1]), 300)", lock()], { stdio: ['ignore', 'pipe', 'inherit'] })
    const gone = new Promise((resolve) => holder.on('close', resolve))
    await new Promise((resolve) => holder.stdout.once('data', resolve))
    const started = Date.now()
    drafts.flushSync()
    expect(Date.now() - started).toBeGreaterThanOrEqual(150)
    await gone
    expect(bodies()).toEqual(['Why an array?', 'First.', 'Second.'])
    expect(existsSync(lock())).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('takes over a lock left by a writer that died (older than 10 s) at once', { timeout: ms(60_000) }, async () => {
    reset(draft())
    const drafts = await oneWaiting()
    writeFileSync(lock(), '1\n')
    const old = new Date(Date.now() - 20_000)
    utimesSync(lock(), old, old)
    const started = Date.now()
    drafts.flushSync()
    expect(Date.now() - started).toBeLessThan(1000)
    expect(bodies()).toEqual(['Why an array?', 'First.', 'Second.'])
    expect(existsSync(lock())).toBe(false)
  })
})
