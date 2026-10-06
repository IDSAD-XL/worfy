import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launchedHint } from '../../src/shared/actions/render-template'
import { launchApp } from './helpers'

// "Ship ticket", "Run wave" and "Open PR" (ticket 23) in the built app on the fake agent, which
// records every message it gets (WORFY_AGENT_LOG) and never calls the model. The Project is a git
// repository with the Epic `worfy-mvp`; `epic-status` is a script under the temporary Claude home
// that prints a fixed answer, and `gh` is test/fixtures/gh/gh over a prs.json. The fake agent plays
// `orchestrator`: its first turn holds until it is interrupted, so the Orchestrator stays busy
// after the first wave and the second one waits in its queue.
//
// The Epic's plan (every Ticket open): wave 1 — 01, 10, 11; wave 2 — 02; wave 3 — 07, 09; wave 4 — 08.
// Now 01 and 02 are done, 10 and 11 claimed: the ready Wave is 07 and 09, Wave 3 of the plan.
// worfy must not touch the repository: no file of `.scratch` changes, nor anything else in it; nor
// anything under the Claude home it reads (`bin/epic-status`, transcripts).

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'worfy-00000023'
const EPIC = 'worfy-mvp'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type Stored = { sessionId: string; agentId: string | null; target: Record<string, unknown>; source?: string }

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

const TICKETS: { num: number; status: string; state: string; blocked: number[] }[] = [
  { num: 1, status: 'done — 2026-10-01', state: 'done', blocked: [] },
  { num: 2, status: 'done — 2026-10-02', state: 'done', blocked: [1] },
  { num: 7, status: 'open', state: 'open', blocked: [2] },
  { num: 8, status: 'open', state: 'open', blocked: [9] },
  { num: 9, status: 'open', state: 'open', blocked: [2] },
  { num: 10, status: 'claimed — 2026-10-05', state: 'work', blocked: [] },
  { num: 11, status: 'claimed — 2026-10-05', state: 'work', blocked: [] },
]
const nn = (num: number): string => String(num).padStart(2, '0')
const slug = (num: number): string => `ticket-${num}`

function ticketFile({ num, status, blocked }: (typeof TICKETS)[number]): string {
  const blockers = blocked.length ? blocked.map(nn).join(', ') : '—'
  return [`# ${nn(num)} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, `Blocked by: ${blockers}`, '', '## Где в коде', '', `- \`src/f${num}.ts\``, ''].join('\n')
}

/** Every file under `dir` with its size and modification time. */
function listing(dir: string, skip: (path: string) => boolean = () => false): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (folder: string): void => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name)
      if (skip(path)) continue
      if (entry.isDirectory()) walk(path)
      else {
        const stats = statSync(path)
        out[relative(dir, path)] = `${stats.size}:${stats.mtimeMs}`
      }
    }
  }
  walk(dir)
  return out
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

const bridgeCall = (window: Page, channel: string, input?: unknown) =>
  window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)

test.beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'worfy-e2e-ship-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Ship ticket, Run wave and Open PR send the Project\'s templates, bind what they launch, and leave the repository alone', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const ghDir = join(scratch, 'gh')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'worfy')

  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# worfy MVP\n')
  for (const ticket of TICKETS) writeFileSync(join(issues, `${nn(ticket.num)}-${slug(ticket.num)}.md`), ticketFile(ticket))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')

  mkdirSync(join(claudeHome, 'bin'), { recursive: true })
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(
    answer,
    JSON.stringify({
      ref: 'main',
      epics: [{ epic: EPIC, hasSpec: true, hasMap: false }],
      tickets: TICKETS.map(({ num, status, state, blocked }) => ({
        epic: EPIC,
        num,
        slug: slug(num),
        title: `${nn(num)} — Ticket ${num}`,
        statusRaw: status,
        state,
        blockedRaw: blocked.length ? blocked.map(nn).join(', ') : '—',
        blockedNums: blocked,
        blockedParsed: true,
      })),
    }),
  )
  writeFileSync(join(claudeHome, 'bin', 'epic-status'), `#!/bin/sh\ncat '${answer}'\n`)
  chmodSync(join(claudeHome, 'bin', 'epic-status'), 0o755)

  // GitHub: a PR on worfy-mvp/10 at github.com, and one on worfy-mvp/11 somewhere else.
  mkdirSync(ghDir)
  writeFileSync(
    join(ghDir, 'prs.json'),
    JSON.stringify([
      { number: 41, headRefName: `${EPIC}/10`, state: 'OPEN', url: 'https://github.com/o/r/pull/41', statusCheckRollup: [], comments: [] },
      { number: 42, headRefName: `${EPIC}/11`, state: 'OPEN', url: 'https://gitlab.example/o/r/pull/42', statusCheckRollup: [], comments: [] },
    ]),
  )

  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'worfy', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 20, y: 20, zoom: 0.7 } }))

  const scratchBefore = listing(join(repo, '.scratch'))
  const repoBefore = listing(repo, (path) => path.endsWith('/.git'))
  const statusBefore = git(repo, 'status', '--porcelain')
  const claudeBefore = listing(claudeHome)

  const env = { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_SCRIPT: 'orchestrator', WORFY_AGENT_LOG: log, GH_STUB_DIR: ghDir }
  const launched = await launchApp({ env })
  let sessionsOf07: string[] | undefined
  try {
    const { window, app } = launched
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1600, 1000))
    // "Open PR" must not reach a browser: shell.openExternal only records the address.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as unknown as { opened: string[] }).opened = opened
      shell.openExternal = async (url: string) => {
        opened.push(url)
      }
    })

    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    const ship = (num: number): Locator => ticket(num).getByTestId('action-ship-ticket')
    const runWave = window.locator(`[data-testid="epic-frame"][data-epic="${EPIC}"]`).getByTestId('action-run-wave')
    const sessionNodes = window.locator('[data-testid="session-node"]')
    await expect(ticket(7)).toBeVisible()
    await expect(window.getByTestId('orchestrator-node')).toBeVisible()

    // Inactive with the open blocker named; claimed Tickets have no button.
    await expect(ship(8)).toHaveAttribute('aria-disabled', 'true')
    await expect(ship(8)).toHaveAttribute('title', 'blocked by 09')
    await expect(ship(10)).toHaveCount(0)
    await window.screenshot({ path: test.info().outputPath('ship-ticket-buttons.png') })

    // Ship ticket with the default template: a new Session gets `/ship-ticket worfy-mvp 07`.
    await expect(ship(7)).toHaveAttribute('aria-disabled', 'false')
    await expect(ship(7)).toHaveAttribute('title', `/ship-ticket ${EPIC} 07`)
    await ship(7).click()
    await expect(sessionNodes).toHaveCount(1)
    await expect.poll(() => messages(log)).toContain(`/ship-ticket ${EPIC} 07`)

    // The Session is bound to Ticket 07 with source launch, in the Project's bindings.json.
    const bindingsFile = join(dataDir, PROJECT, 'bindings.json')
    await expect
      .poll(() => (existsSync(bindingsFile) ? (JSON.parse(readFileSync(bindingsFile, 'utf8')) as { bindings: Stored[] }).bindings : []))
      .toEqual([{ sessionId: expect.any(String) as unknown as string, agentId: null, target: { kind: 'ticket', epic: EPIC, num: 7 }, source: 'launch' }])
    sessionsOf07 = (JSON.parse(readFileSync(bindingsFile, 'utf8')) as { bindings: Stored[] }).bindings.map((binding) => binding.sessionId)
    await expect(window.locator(`[data-testid="session-node"][data-session-id="${sessionsOf07[0]!}"]`)).toBeVisible()

    // 07 stays open until the launched agent runs `ticket claim` (the fake agent never does): while
    // its Session lives, a second Ship ticket is refused, on the button and in main.
    await expect(ship(7)).toHaveAttribute('aria-disabled', 'true')
    await expect(ship(7)).toHaveAttribute('title', launchedHint(7))
    await ship(7).click({ force: true })
    const twice = await bridgeCall(window, 'actions.shipTicket', { projectId: PROJECT, epic: EPIC, num: 7 })
    expect(twice).toMatchObject({ ok: false, error: expect.stringContaining(launchedHint(7)) as unknown as string })
    await window.waitForTimeout(300)
    await expect(sessionNodes).toHaveCount(1)
    expect(messages(log).filter((text) => text === `/ship-ticket ${EPIC} 07`)).toHaveLength(1)
    // Once that Session closes, the button is active again without a click. Its turn holds until
    // it is interrupted, and a running turn cannot be closed (ticket 18).
    const session07 = sessionsOf07[0]!
    expect(await bridgeCall(window, 'agent.interrupt', { sessionId: session07 })).toMatchObject({ ok: true })
    await expect.poll(async () => (await bridgeCall(window, 'agent.close', { sessionId: session07 })).ok).toBe(true)
    await expect(ship(7)).toHaveAttribute('aria-disabled', 'false')
    await expect(ship(7)).toHaveAttribute('title', `/ship-ticket ${EPIC} 07`)

    // A template changed in Project settings goes out as it is, with its values.
    const saved = await bridgeCall(window, 'projects.settings.set', {
      id: PROJECT,
      settings: { actionTemplates: { shipTicket: 'Ship {epic}/{NN} ({slug}) from {branch}', runWave: '/epic-wave волна {wave} эпика {epic}' } },
    })
    expect(saved.ok).toBe(true)
    await expect(ship(9)).toHaveAttribute('title', `Ship ${EPIC}/09 (ticket-9) from main`)
    await ship(9).click()
    await expect(sessionNodes).toHaveCount(2)
    await expect.poll(() => messages(log)).toContain(`Ship ${EPIC}/09 (ticket-9) from main`)

    // Empty templates: both actions are inactive and point to Project settings; no Session starts.
    await bridgeCall(window, 'projects.settings.set', { id: PROJECT, settings: { actionTemplates: { shipTicket: '', runWave: ' ' } } })
    await expect(ship(7)).toHaveAttribute('title', 'Set the Ship ticket template in Project settings')
    await expect(ship(7)).toHaveAttribute('aria-disabled', 'true')
    await expect(runWave).toHaveAttribute('title', 'Set the Run wave template in Project settings')
    await expect(runWave).toHaveAttribute('aria-disabled', 'true')
    // An inactive button does nothing even when clicked (Playwright would wait for it to turn active).
    await ship(7).click({ force: true })
    await runWave.click({ force: true })
    // main refuses too, whatever the renderer shows.
    const refused = await bridgeCall(window, 'actions.shipTicket', { projectId: PROJECT, epic: EPIC, num: 7 })
    expect(refused).toMatchObject({ ok: false, error: expect.stringContaining('Set the Ship ticket template in Project settings') as unknown as string })
    await window.waitForTimeout(300)
    await expect(sessionNodes).toHaveCount(2)

    // Run wave with the default template: the Orchestrator gets `/epic-wave Ticket-ы 07, 09 эпика worfy-mvp`
    // and is bound to the Epic. The old default saved here reads as the new one (ADR-0033).
    await bridgeCall(window, 'projects.settings.set', { id: PROJECT, settings: { actionTemplates: { shipTicket: '/ship-ticket {epic} {NN}', runWave: '/epic-wave волна {wave} эпика {epic}' } } })
    await expect(runWave).toHaveAttribute('aria-disabled', 'false')
    await runWave.click()
    await expect.poll(() => messages(log)).toContain(`/epic-wave Ticket-ы 07, 09 эпика ${EPIC}`)
    await expect
      .poll(() => (JSON.parse(readFileSync(bindingsFile, 'utf8')) as { bindings: Stored[] }).bindings.filter((binding) => binding.target.kind === 'epic'))
      .toEqual([{ sessionId: expect.any(String) as unknown as string, agentId: null, target: { kind: 'epic', epic: EPIC }, source: 'launch' }])

    // The Orchestrator is busy: the next wave waits in its queue.
    const second = await bridgeCall(window, 'actions.runWave', { projectId: PROJECT, epic: EPIC })
    expect(second).toMatchObject({ ok: true, value: { delivery: 'queued', text: `/epic-wave Ticket-ы 07, 09 эпика ${EPIC}` } })
    const orchestratorSession = (second.value as { sessionId: string }).sessionId
    const controls = await bridgeCall(window, 'agent.controls', { sessionId: orchestratorSession })
    expect((controls.value as { queue: { items: { text: string }[] } }).queue.items.map((item) => item.text)).toEqual([`/epic-wave Ticket-ы 07, 09 эпика ${EPIC}`])
    expect(messages(log).filter((text) => text.startsWith('/epic-wave'))).toHaveLength(1)

    // Open PR: the GitHub address opens; another address is refused on the button.
    await expect(ticket(10).getByTestId('action-open-pr')).toHaveAttribute('aria-disabled', 'false', { timeout: 15_000 })
    await ticket(10).getByTestId('action-open-pr').click()
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://github.com/o/r/pull/41'])
    await expect(ticket(11).getByTestId('action-open-pr')).toHaveAttribute('aria-disabled', 'true')
    await expect(ticket(11).getByTestId('action-open-pr')).toHaveAttribute('title', 'Not a GitHub address: https://gitlab.example/o/r/pull/42')
    await ticket(11).getByTestId('action-open-pr').click({ force: true })
    await window.waitForTimeout(300)
    expect(await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual(['https://github.com/o/r/pull/41'])
    await window.screenshot({ path: test.info().outputPath('ship-ticket-after.png') })
  } finally {
    await launched.close()
  }

  // Nothing in the repository changed: not a file of .scratch, nor anything else.
  expect(listing(join(repo, '.scratch'))).toEqual(scratchBefore)
  expect(listing(repo, (path) => path.endsWith('/.git'))).toEqual(repoBefore)
  expect(git(repo, 'status', '--porcelain')).toBe(statusBefore)
  // Nor anything under the Claude home.
  expect(listing(claudeHome)).toEqual(claudeBefore)

  // The Bindings outlive a restart.
  const again = await launchApp({ env })
  try {
    const result = await bridgeCall(again.window, 'bindings.get', { projectId: PROJECT })
    const stored = (result.value as { bindings: Stored[] }).bindings
    expect(stored.filter((binding) => binding.target.kind === 'ticket' && binding.target.num === 7)).toEqual([{ sessionId: sessionsOf07?.[0], agentId: null, target: { kind: 'ticket', epic: EPIC, num: 7 }, source: 'launch' }])
    expect(stored.filter((binding) => binding.target.kind === 'epic')).toHaveLength(1)
  } finally {
    await again.close()
  }
  expect(listing(claudeHome)).toEqual(claudeBefore)
})
