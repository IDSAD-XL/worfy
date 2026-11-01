import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { runningElsewhere, STOP_TEXT } from '../../src/main/autopilot/run'
import { launchLinkedPair, openSecondWindow, repoRoot, type LaunchedApp } from './helpers'
import { catScript } from '../harness-node'

// One Autopilot per Epic and origin across the Linked machines (worfy-link ticket 15, ADR-0053,
// Q13), in two built worfy linked through "Link a machine" (launchLinkedPair, worfy-link ticket 02)
// on the fake agent. Each worfy has its own Project: a clone of one fixture repository, both with
// remote origin https://example.invalid/demo.git, and the Epic `demo`. The Machines are named
// through their link/machine.json (Studio is A, Laptop is B), so the refusal names one of them.
// "Linked machines can work with my Projects" stays off on both: the question about runs is a
// service message of the link and works without it (question 2 of the ticket).
//
// The fake agent plays `orchestrator` with the Wave's turn held until the test releases it
// (wait_release "turn"), as the graceful Stop test of autopilot.spec.ts does. Electron's
// powerSaveBlocker is replaced in main before a run starts, so the test never keeps the Mac awake.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-000000a4'
const EPIC = 'demo'
const ORIGIN = 'https://example.invalid/demo.git'
const ORIGIN_KEY = 'example.invalid/demo'

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS = [
  { num: 1, blocked: [] as number[] },
  { num: 2, blocked: [] as number[] },
]
const nn = (num: number): string => String(num).padStart(2, '0')

/** The fixture repository: the Epic with two ready Tickets, remote origin ORIGIN. */
function fixtureRepo(): string {
  const repo = join(scratch, 'fixture')
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo epic\n')
  for (const { num } of TICKETS) {
    writeFileSync(join(issues, `${nn(num)}-ticket-${num}.md`), [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', 'Status: open', 'Blocked by: —', '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n'))
  }
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', ORIGIN)
  return repo
}

/**
 * One worfy's folders: its clone of the fixture with the same origin, a Claude home with an
 * epic-status that answers the Epic, a data folder with the Project and the Machine's name, and the
 * held `orchestrator` script.
 */
function prepare(fixture: string, machine: string) {
  const root = join(scratch, machine.toLowerCase())
  const dataDir = join(root, 'data')
  const claudeHome = join(root, 'claude-home')
  const log = join(root, 'agent.jsonl')
  const repo = join(root, 'demo')
  git(scratch, 'clone', '-q', fixture, repo)
  git(repo, 'remote', 'set-url', 'origin', ORIGIN)

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num }) => ({
        epic: EPIC,
        num,
        slug: `ticket-${num}`,
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: 'open',
        state: 'open',
        blockedRaw: '—',
        blockedNums: [],
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.8 } }))
  // The Machine's name: a machine.json whose key is missing keeps its id and name and makes a new
  // certificate (src/main/link/identity.ts), so both worfy on this Mac are told apart.
  mkdirSync(join(dataDir, 'link'), { recursive: true })
  writeFileSync(join(dataDir, 'link', 'machine.json'), JSON.stringify({ version: 1, id: randomUUID(), name: machine, certificate: 'none yet', port: null }))

  const scripts = join(root, 'scripts')
  mkdirSync(scripts, { recursive: true })
  const fixtureScript = readFileSync(join(repoRoot, 'test', 'fixtures', 'agent-scripts', 'orchestrator.jsonl'), 'utf8').split('\n').filter(Boolean)
  const held = fixtureScript.map((line) => (line.includes('"wait_interrupt"') ? '{"fake":"wait_release","name":"turn"}' : line))
  writeFileSync(join(scripts, 'autopilot-held.jsonl'), `${held.join('\n')}\n`)

  return {
    dataDir,
    log,
    env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPTS: scripts, WORFY_AGENT_SCRIPT: 'autopilot-held', WORFY_AGENT_LOG: log },
  }
}

/** The messages the fake agent got, in order. */
function messages(log: string): string[] {
  if (!existsSync(log)) return []
  return readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; text?: string })
    .filter((call) => call.kind === 'message')
    .map((call) => call.text ?? '')
}

/** The lines of every run journal in the data folder, by file. */
function journals(dataDir: string): Record<string, unknown>[][] {
  const dir = join(dataDir, 'autopilot')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .sort()
    .map((file) =>
      readFileSync(join(dir, file), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    )
}

/** Each journal as its kinds, with the wave or reason. */
const journalKinds = (dataDir: string): string[][] =>
  journals(dataDir).map((lines) => lines.map((line) => [line.kind, line.wave ?? line.reason].filter((part) => part !== undefined).join(' ')))

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

/** Replaces Electron's powerSaveBlocker in main by one that records the calls. */
async function recordPower(app: ElectronApplication): Promise<() => Promise<string[]>> {
  await app.evaluate(({ powerSaveBlocker }) => {
    const calls: string[] = []
    const started = new Set<number>()
    let next = 100
    ;(globalThis as unknown as { power: string[] }).power = calls
    powerSaveBlocker.start = (type) => {
      next += 1
      started.add(next)
      calls.push(`start ${type}`)
      return next
    }
    powerSaveBlocker.stop = (id) => {
      started.delete(id)
      calls.push('stop')
      return true
    }
    powerSaveBlocker.isStarted = (id) => started.has(id)
  })
  return () => app.evaluate(() => [...(globalThis as unknown as { power: string[] }).power])
}

const release = (app: ElectronApplication): Promise<void> =>
  app.evaluate(() => (globalThis as unknown as { worfyFakeRelease: (name: string) => void }).worfyFakeRelease('turn'))

/**
 * The Epic frame's header with the chips under it, in both themes. Kept with the test's output and,
 * when WORFY_EVIDENCE_DIR is set, there too (the evidence of the ticket's result).
 */
async function snapshots(window: Page, header: Locator, name: string): Promise<void> {
  const evidence = process.env.WORFY_EVIDENCE_DIR
  for (const scheme of ['light', 'dark'] as const) {
    await window.emulateMedia({ colorScheme: scheme })
    const box = (await header.boundingBox())!
    const clip = { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 40 }
    const path = test.info().outputPath(`${name}-${scheme}.png`)
    await window.screenshot({ path, clip })
    if (evidence) await window.screenshot({ path: join(evidence, `${name}-${scheme}.png`), clip })
  }
  await window.emulateMedia({ colorScheme: null })
}

/** The Epic frame of `window` and what the test reads on it. */
function frameOf(window: Page) {
  const frame = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`)
  return {
    frame,
    header: frame.locator('header'),
    autopilot: frame.getByTestId('action-autopilot'),
    anyway: frame.getByTestId('action-autopilot-anyway'),
    stop: frame.getByTestId('action-stop-autopilot'),
    title: frame.locator('header h2'),
    status: frame.getByTestId('autopilot-status'),
    machine: frame.getByTestId('autopilot-machine'),
    elsewhere: frame.getByTestId('autopilot-elsewhere'),
  }
}

async function setUp(launched: LaunchedApp): Promise<() => Promise<string[]>> {
  await launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1400, 900))
  return recordPower(launched.app)
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-linked-autopilot-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Autopilot over an Epic on A: B is refused for the same Epic of the same origin, naming A; Start anyway starts it on B', async () => {
  const fixture = fixtureRepo()
  const a = prepare(fixture, 'Studio')
  const b = prepare(fixture, 'Laptop')
  const pair = await launchLinkedPair({ a: { env: a.env }, b: { env: b.env } })
  try {
    const powerA = await setUp(pair.a)
    const powerB = await setUp(pair.b)
    // Access is off on both sides: the question about runs does not need it.
    for (const window of [pair.a.window, pair.b.window]) expect(await bridgeCall(window, 'link.state')).toMatchObject({ ok: true, value: { projectsAccess: false } })

    // A starts the Epic; the chip under the button says that A runs it.
    const onA = frameOf(pair.a.window)
    await expect(onA.autopilot).toHaveAttribute('aria-disabled', 'false')
    await onA.autopilot.click()
    await expect(onA.status).toHaveText('Wave 1 · running')
    await expect(onA.machine).toHaveText('on Studio')
    await expect(onA.machine).toHaveAttribute('title', `Studio runs Autopilot over ${EPIC}`)
    await expect.poll(() => messages(a.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(journals(a.dataDir)[0]?.[0]).toMatchObject({ kind: 'run-started', origin: ORIGIN_KEY })
    expect(journals(a.dataDir)[0]?.[0]).not.toHaveProperty('override')
    await snapshots(pair.a.window, onA.header, '15-this-machine')

    // B, over its own clone of the same repository, is refused with A's name; nothing goes.
    const onB = frameOf(pair.b.window)
    await expect(onB.autopilot).toHaveAttribute('aria-disabled', 'false')
    const titleBefore = (await onB.title.boundingBox())!.width
    expect(titleBefore, 'the Epic title of the two-Ticket frame has room before the refusal').toBeGreaterThan(20)
    await onB.autopilot.click()
    const refusal = runningElsewhere(EPIC, 'Studio')
    await expect(onB.autopilot).toHaveAttribute('data-error', refusal)
    // The refusal's chip and "Start anyway" stand under the buttons, inside the header: the Epic
    // title keeps its width, and nothing covers it.
    await expect(onB.anyway).toBeVisible()
    const [title, anyway, header] = [(await onB.title.boundingBox())!, (await onB.anyway.boundingBox())!, (await onB.header.boundingBox())!]
    expect(Math.abs(title.width - titleBefore), 'the Epic title keeps its width').toBeLessThanOrEqual(1)
    expect(anyway.y + anyway.height, '"Start anyway" ends inside the header').toBeLessThanOrEqual(header.y + header.height + 0.5)
    expect(anyway.x, '"Start anyway" is clear of the Epic title').toBeGreaterThanOrEqual(title.x + title.width)
    await expect(onB.elsewhere).toHaveText('running on Studio')
    await expect(onB.elsewhere).toHaveAttribute('title', refusal)
    await expect(onB.anyway).toHaveText('Start anyway')
    await expect(onB.anyway).toHaveAttribute('title', `Start Autopilot over ${EPIC} here although Studio runs it: both runs take the same Tickets`)
    await expect(onB.status).toHaveCount(0)
    expect(messages(b.log)).toEqual([])
    expect(journals(b.dataDir)).toEqual([])
    expect(await powerB()).toEqual([])
    // The answer of the channel carries the refusal as its own field.
    expect(await bridgeCall(pair.b.window, 'autopilot.start', { projectId: PROJECT, epic: EPIC })).toEqual({
      ok: true,
      value: { runningElsewhere: { epic: EPIC, machine: 'Studio', message: refusal } },
    })
    await snapshots(pair.b.window, onB.header, '15-other-machine')

    // "Start anyway" starts the run on B, and its journal says the start went past A's run.
    await onB.anyway.click()
    await expect(onB.status).toHaveText('Wave 1 · running')
    await expect(onB.machine).toHaveText('on Laptop')
    // "Stop autopilot" is a button of its own: the Autopilot button's refusal does not carry over.
    await expect(onB.stop).toHaveText('Stop autopilot')
    await expect(onB.stop).not.toHaveAttribute('data-error')
    await expect(onB.stop).toHaveAttribute('title', `Stop Autopilot over ${EPIC}: takes no new Tickets; the Tickets in work finish (merge or blocked)`)
    await expect(onB.anyway).toHaveCount(0)
    await expect(onB.elsewhere).toHaveCount(0)
    await expect.poll(() => messages(b.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    expect(journals(b.dataDir)).toHaveLength(1)
    expect(journals(b.dataDir)[0]?.[0]).toMatchObject({ kind: 'run-started', origin: ORIGIN_KEY, override: true })
    expect(await powerB()).toEqual(['start prevent-display-sleep'])
    await snapshots(pair.b.window, onB.header, '15-start-anyway')

    // A's run went on all along.
    await expect(onA.status).toHaveText('Wave 1 · running')
    expect(await powerA()).toEqual(['start prevent-display-sleep'])
  } finally {
    await pair.close()
  }
})

test('Stop of A\'s run pressed at once on two screens: both show stopped, the journal has one run-stopped', async () => {
  const fixture = fixtureRepo()
  const a = prepare(fixture, 'Studio')
  const b = prepare(fixture, 'Laptop')
  const pair = await launchLinkedPair({ a: { env: a.env }, b: { env: b.env } })
  try {
    await setUp(pair.a)
    await setUp(pair.b)
    const first = frameOf(pair.a.window)
    await first.autopilot.click()
    await expect(first.status).toHaveText('Wave 1 · running')
    // B is refused while A's run goes on; its "Start anyway" stays for after the run.
    const onB = frameOf(pair.b.window)
    await onB.autopilot.click()
    await expect(onB.autopilot).toHaveAttribute('data-error', runningElsewhere(EPIC, 'Studio'))
    // The second screen of A: the Project of A as another window shows it.
    const window = await openSecondWindow(pair.a, { size: { width: 1400, height: 900 } })
    const second = frameOf(window)
    await expect(second.status).toHaveText('Wave 1 · running')
    await expect(second.stop).toHaveText('Stop autopilot')

    // Both screens send Stop at once. Through the bridge, not by clicks: a click that lands after
    // the first screen's answer finds "Stopping…", which sends nothing, and the race would be gone.
    const answers = await Promise.all([pair.a.window, window].map((each) => bridgeCall(each, 'autopilot.stop', { projectId: PROJECT })))
    for (const answer of answers) expect(answer).toMatchObject({ ok: true, value: { status: 'running', stopping: true } })
    for (const screen of [first, second]) {
      await expect(screen.status).toHaveText('stopping')
      await expect(screen.stop).toHaveText('Stopping…')
    }
    // STOP_TEXT waits behind the Wave's running turn: the Orchestrator has not got it yet.
    expect(messages(a.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`])
    // The Wave's turn ends; STOP_TEXT goes as the next turn, and its end ends the run.
    await release(pair.a.app)
    for (const screen of [first, second]) {
      await expect(screen.status).toHaveText('stopped: user stop')
      await expect(screen.autopilot).toHaveText('Autopilot')
    }
    expect(journalKinds(a.dataDir)).toEqual([['run-started', 'forecast', 'wave-started 1', 'run-stopping 1', 'run-stopped user-stop']])
    expect(messages(a.log)).toEqual([`/epic-wave Ticket-ы 01, 02 эпика ${EPIC}`, STOP_TEXT])
    // With A's run over, "Start anyway" left on B asks again and starts a plain run: no override.
    await expect(onB.anyway).toBeVisible()
    await onB.anyway.click()
    await expect(onB.status).toHaveText('Wave 1 · running')
    expect(journals(b.dataDir)[0]?.[0]).toMatchObject({ kind: 'run-started', origin: ORIGIN_KEY })
    expect(journals(b.dataDir)[0]?.[0]).not.toHaveProperty('override')
  } finally {
    await pair.close()
  }
})
