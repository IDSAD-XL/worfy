import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { FRAME_GAP } from '../../src/renderer/canvas/epic-layout'
import { LIVE_SESSION_WIDTH } from '../../src/shared/ipc/sessions'
import { captureScreenshot } from './evidence-capture'
import { canvasReady, launchApp, ticketCardCuts } from './helpers'
import { catScript } from '../harness-node'
import { ms } from '../time-scale'

// "Resolve conflicts", "Fix checks" and "Address comments" on a Ticket Node (worfy-pr-follow ticket 05) in the built app
// on the fake agent, which records every message it gets (WORFY_AGENT_LOG) and never calls the model. The Project is a
// git repository whose `origin` is on github.com, with Ticket 08 claimed on the branch demo/08; the Harness is the
// plugin (a plugin.json and `epic-status` under the Harness home of the temporary Claude home), so the actions have the
// plugin's templates. gh is the stub of launchApp (test/fixtures/gh/gh-stub.mjs) over a graphql.json: the PR inbox finds
// the Ticket's PR in conflict, with red CI. No Session is bound to the Ticket, so the click starts a new Session Node by
// the Ticket, whose first message is the template over the head the stub gives; the way into a bound Session is the
// contract test of ticket 01 (test/contract/actions.test.ts). Every name, login and hash is invented.

const removeDir = (dir: string): Promise<void> => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })

const PROJECT = 'demo-0000pr05'
const EPIC = 'demo'
const SLUG = 'example-org/demo'
const ME = 'dev-me'
const HEAD = '5e1f0c2b9a8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f'

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }
type Rect = { x: number; y: number; w: number; h: number }

let scratch: string

function git(cwd: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' }).trim()
}

function ticketFile(num: number, status: string): string {
  const nn = String(num).padStart(2, '0')
  return [`# ${nn} — Ticket ${num}`, '', 'Type: task', `Status: ${status}`, 'Blocked by: —', '', '## Что делаем', '', 'text', ''].join('\n')
}

const ticketJson = (num: number, status: string, state: string) => ({
  epic: EPIC,
  num,
  slug: `ticket-${num}`,
  title: `${String(num).padStart(2, '0')} — Ticket ${num}`,
  statusRaw: status,
  state,
  blockedRaw: '—',
  blockedNums: [],
  blockedParsed: true,
})

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

/** A Node's place on the Canvas, from React Flow's transform (absolute canvas units), and its size. */
async function flowRect(window: Page, id: string): Promise<Rect> {
  const { transform, w, h } = await window.getByTestId(`rf__node-${id}`).evaluate((element) => {
    const html = element as unknown as { style: { transform: string }; offsetWidth: number; offsetHeight: number }
    return { transform: html.style.transform, w: html.offsetWidth, h: html.offsetHeight }
  })
  const match = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(transform)
  if (!match) throw new Error(`no translate in ${transform}`)
  return { x: Number(match[1]), y: Number(match[2]), w, h }
}

test.beforeEach(() => {
  scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'worfy-e2e-pr-follow-')))
})

test.afterEach(async () => {
  await removeDir(scratch)
})

test('Resolve conflicts on a Ticket with no bound Session: the button for the first reason, Fix checks in «▾», and a click starts a new Session by the Ticket with the template over the head of the PR', async () => {
  const dataDir = join(scratch, 'data')
  const claudeHome = join(scratch, 'claude-home')
  const ghDir = join(scratch, 'gh')
  const log = join(scratch, 'agent.jsonl')
  const repo = join(scratch, 'demo')

  // The Project: Ticket 08 claimed, Ticket 09 open. `origin` is on github.com, so the PR inbox reads it.
  const issues = join(repo, '.scratch', EPIC, 'issues')
  mkdirSync(issues, { recursive: true })
  writeFileSync(join(repo, '.scratch', EPIC, 'spec.md'), '# Demo\n')
  writeFileSync(join(issues, '08-ticket-8.md'), ticketFile(8, 'claimed — 2026-11-18'))
  writeFileSync(join(issues, '09-ticket-9.md'), ticketFile(9, 'open'))
  git(repo, 'init', '-q')
  git(repo, 'add', '.')
  git(repo, 'commit', '-q', '-m', 'init')
  git(repo, 'remote', 'add', 'origin', `https://github.com/${SLUG}.git`)

  // The Harness plugin under the Harness home (<Claude home>/worfy-harness): its templates are the defaults.
  const plugin = join(claudeHome, 'worfy-harness', 'plugin')
  mkdirSync(join(plugin, '.claude-plugin'), { recursive: true })
  mkdirSync(join(plugin, 'bin'), { recursive: true })
  writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'worfy' }))
  const answer = join(claudeHome, 'epic-status.json')
  writeFileSync(answer, JSON.stringify({ ref: 'main', epics: [{ epic: EPIC, hasSpec: true, hasMap: false }], tickets: [ticketJson(8, 'claimed — 2026-11-18', 'work'), ticketJson(9, 'open', 'open')] }))
  writeFileSync(join(plugin, 'bin', 'epic-status'), catScript(answer))
  chmodSync(join(plugin, 'bin', 'epic-status'), 0o755)

  // GitHub: the user's PR #31 on demo/08 in conflict (DIRTY) and with red CI; nothing on demo/09.
  mkdirSync(ghDir)
  writeFileSync(join(ghDir, 'prs.json'), JSON.stringify([{ number: 31, headRefName: `${EPIC}/08`, state: 'OPEN', url: `https://github.com/${SLUG}/pull/31`, statusCheckRollup: [], comments: [] }]))
  const at = (hoursAgo: number): string => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  writeFileSync(
    join(ghDir, 'graphql.json'),
    JSON.stringify({
      viewer: ME,
      pulls: [
        {
          repo: SLUG,
          number: 31,
          updatedAt: at(1),
          headRefOid: HEAD,
          reviewRequested: false,
          involves: true,
          pull: {
            title: 'Export the report',
            url: `https://github.com/${SLUG}/pull/31`,
            state: 'OPEN',
            isDraft: false,
            isCrossRepository: false,
            createdAt: at(48),
            author: { login: ME },
            headRefName: `${EPIC}/08`,
            reviewDecision: null,
            mergeable: 'CONFLICTING',
            mergeStateStatus: 'DIRTY',
            commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] },
            reviewRequests: { nodes: [] },
            latestOpinionatedReviews: { nodes: [] },
            reviewThreads: { nodes: [] },
            comments: { nodes: [] },
          },
        },
      ],
    }),
  )
  mkdirSync(join(dataDir, PROJECT), { recursive: true })
  writeFileSync(join(dataDir, 'projects.json'), JSON.stringify({ projects: [{ id: PROJECT, name: 'demo', path: repo }], activeId: PROJECT }))
  writeFileSync(join(dataDir, PROJECT, 'layout.json'), JSON.stringify({ nodes: [], viewport: { x: 40, y: 40, zoom: 0.8 } }))

  const launched = await launchApp({ env: { WORFY_DATA_DIR: dataDir, WORFY_CLAUDE_HOME: claudeHome, WORFY_AGENT_LOG: log, GH_STUB_DIR: ghDir, GH_STUB_LOG: join(ghDir, 'calls.jsonl') } })
  try {
    const { window } = launched
    await canvasReady(launched, { size: { width: 1600, height: 1000 } })
    const ticket = (num: number): Locator => window.locator(`[data-testid="ticket-node"][data-ticket="${num}"]`)
    const button = ticket(8).getByTestId('action-pr-follow')
    // The first search of the PR inbox answers within the reader's first look.
    await expect(button).toBeVisible({ timeout: ms(30_000) })
    await expect(button).toHaveText('Resolve conflicts')
    await expect(button).toHaveAttribute('aria-disabled', 'false')
    await expect(button).toHaveAttribute('title', `/worfy:pr-fix conflicts ${SLUG}#31 ${HEAD}`)
    await expect(ticket(9).getByTestId('action-pr-follow')).toHaveCount(0)
    expect(await ticketCardCuts(ticket(8)), 'nothing is cut on Ticket 08').toEqual([])

    // «▾» holds the other reason, with the text it would send.
    await ticket(8).getByTestId('action-pr-follow-more').click()
    const fix = window.getByTestId(`action-pr-follow-item-fixChecks-${SLUG}#31`)
    await expect(fix).toHaveText('Fix checks')
    await expect(fix).toHaveAttribute('title', `/worfy:pr-fix checks ${SLUG}#31 ${HEAD}`)
    // The Ticket Node with its menu open, both themes: in the test's output (the Evidence of the ticket is taken from
    // there or at the acceptance, worfy-pr-follow ticket 07).
    await captureScreenshot(window, 'pr-follow-ticket-menu')
    await window.keyboard.press('Escape')
    await expect(fix).toHaveCount(0)

    // The click: no Session is bound to Ticket 08, so a new Session Node starts, bound to it, right of the Epic frames'
    // column by the Ticket, and its first message is the template over the head of the PR.
    const frame = await flowRect(window, `epic:${EPIC}`)
    const card = await flowRect(window, `ticket:${EPIC}/8`)
    await button.click()
    const sessions = window.locator('[data-testid="session-node"]')
    await expect(sessions).toHaveCount(1)
    await expect.poll(() => messages(log)).toEqual([`/worfy:pr-fix conflicts ${SLUG}#31 ${HEAD}`])
    const bindings = await bridgeCall(window, 'bindings.get', { projectId: PROJECT })
    expect((bindings.value as { bindings: { target: unknown; source?: string }[] }).bindings).toEqual([expect.objectContaining({ target: { kind: 'ticket', epic: EPIC, num: 8 }, source: 'launch' })])
    const layout = await bridgeCall(window, 'layout.get', { projectId: PROJECT })
    const session = (layout.value as { layout: { nodes: (Rect & { kind: string })[] } }).layout.nodes.find((node) => node.kind === 'session')
    expect(session, 'the new Session Node in the Layout').toBeDefined()
    const columnRight = frame.x + frame.w
    expect(session!.x).toBeGreaterThanOrEqual(columnRight + FRAME_GAP)
    expect(session!.x - columnRight).toBeLessThanOrEqual(LIVE_SESSION_WIDTH)
    expect(session!.y).toBeGreaterThanOrEqual(Math.round(card.y))
  } finally {
    await launched.close()
  }
  // worfy wrote nothing in the Project.
  expect(git(repo, 'status', '--porcelain')).toBe('')
})
