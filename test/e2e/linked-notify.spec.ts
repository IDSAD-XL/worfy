// Notifications on Linked machines (worfy-link ticket 13) on two built worfy with the fake agent:
// a turn of a Session of A's Project ends while no window of either worfy has focus, and both
// record the notification; a click on B's opens that Session on the Canvas of A's Project in B's
// window. Each worfy has its own data folder and so its own Machine; they are linked through "Link
// a machine" (launchApp: the link server on 127.0.0.1, Bonjour off).
//
// No system notification is shown: Notification.prototype.show in each main is replaced so that it
// only records the instance, and the click is that instance's `click` event (src/main/notify.ts
// listens to it with `on`). The windows lose focus by BrowserWindow.blur(), on Windows by hide()
// (see unfocusAll).
//
// Both worfy start without quiet windows (WORFY_QUIET_WINDOWS=0; src/main/quiet-windows.ts): in
// quiet mode main shows no system notification at all, so no Notification would reach the recorder
// and the spec would have nothing to check. This spec does take the focus of the Mac for a moment.
import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { canvasReady, launchApp, linkThroughUi, machineIdOf, setProjectsAccess, type LaunchedApp } from './helpers'
import { quarantined } from './quarantine'
import { ms } from '../time-scale'

test.setTimeout(ms(180_000))

/** Turns quiet windows off for both worfy (see the top of the file). */
const NORMAL_WINDOWS = { WORFY_QUIET_WINDOWS: '0' }
const ALPHA = 'alpha-0000000a'
const GAMMA = 'gamma-0000000b'
/** What the fake agent answers every turn of test/fixtures/agent-scripts/turn.jsonl. */
const FAKE_ANSWER = 'Hello from the fake agent'
const SIZE = { width: 1400, height: 900 }

/** A folder with a git repository on branch main, for a Project. */
function gitRepo(path: string): string {
  mkdirSync(path, { recursive: true })
  const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: path, env: gitEnv })
  return realpathSync.native(path)
}

/** A data folder whose projects.json lists one Project, active. */
function dataFolder(path: string, project: { id: string; name: string; path: string }): string {
  mkdirSync(path, { recursive: true })
  writeFileSync(join(path, 'projects.json'), JSON.stringify({ projects: [project], activeId: project.id }))
  return path
}

type Bridge = { invoke(channel: string, input?: unknown): Promise<{ ok: boolean; value?: unknown; error?: string }> }

/** Calls a channel of the window's own main through the preload, the way the renderer does. */
async function call<T>(window: Page, channel: string, input?: unknown): Promise<T> {
  const result = await window.evaluate(([name, value]) => (globalThis as unknown as { worfy: Bridge }).worfy.invoke(name as string, value), [channel, input] as const)
  if (!result.ok) throw new Error(`${channel}: ${result.error ?? 'failed'}`)
  return result.value as T
}

/** The main process of one worfy as this spec reaches it, with what Notification records there. */
type Recorded = { title: string; body: string }

/** Replaces Notification.prototype.show in main: the instance is recorded, nothing is shown. */
async function recordNotifications(launched: LaunchedApp): Promise<void> {
  await launched.app.evaluate(({ Notification }) => {
    const store = globalThis as unknown as { recordedNotifications?: unknown[] }
    store.recordedNotifications = []
    Notification.prototype.show = function show(this: unknown) {
      store.recordedNotifications?.push(this)
    }
  })
}

/** The notifications main of `launched` has shown so far. */
function recorded(launched: LaunchedApp): Promise<Recorded[]> {
  return launched.app.evaluate(() => {
    const store = globalThis as unknown as { recordedNotifications?: { title: string; body: string }[] }
    return (store.recordedNotifications ?? []).map((each) => ({ title: each.title, body: each.body }))
  })
}

/**
 * Takes the focus away from every window of every worfy in `apps`; resolves once none of them has it.
 * On Windows BrowserWindow.blur() hands the foreground to the next visible window in z-order, which is
 * the other worfy's window: blurring B focuses A again. Electron's focus there is also the window its
 * own thread calls active, not the system foreground: a window started while Windows keeps another
 * app in front (the foreground lock) counts as focused although it never was in front, and neither
 * blur() nor minimize() changes that, since the window is never deactivated (measured on a Windows 11
 * PC, 2026-10-23, with the same worfy code as when minimize() was enough). hide() deactivates the window in that case too (measured the same
 * way), and a hidden window is not the next in z-order, so on Windows each window is hidden instead; a
 * click on a notification shows it again (openNote in src/main/notify.ts).
 */
async function unfocusAll(apps: LaunchedApp[]): Promise<void> {
  const hide = process.platform === 'win32'
  await expect
    .poll(async () => {
      for (const launched of apps) {
        await launched.app.evaluate(({ BrowserWindow }, offScreen) => {
          for (const window of BrowserWindow.getAllWindows()) {
            if (offScreen) window.hide()
            else window.blur()
          }
        }, hide)
      }
      const focused = await Promise.all(apps.map((launched) => launched.app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow() !== null)))
      return focused.some(Boolean)
    })
    .toBe(false)
}

quarantined('linked-notify-turn-click-opens-in-b')('a turn of a Session of A ends with no window focused: A and B record the notification; a click on B opens the Session in B on A\'s Project', async () => {
  const scratch = realpathSync.native(await mkdtemp(join(tmpdir(), 'worfy-link-13-notify-')))
  const aData = dataFolder(join(scratch, 'a-data'), { id: ALPHA, name: 'alpha', path: gitRepo(join(scratch, 'alpha')) })
  const bData = dataFolder(join(scratch, 'b-data'), { id: GAMMA, name: 'gamma', path: gitRepo(join(scratch, 'gamma')) })
  const a = await launchApp({ env: { WORFY_DATA_DIR: aData, ...NORMAL_WINDOWS } })
  let b: LaunchedApp | undefined
  try {
    const onB = await launchApp({ env: { WORFY_DATA_DIR: bData, ...NORMAL_WINDOWS } })
    b = onB
    await canvasReady(a, { size: SIZE })
    await canvasReady(onB, { size: SIZE })
    // Without quiet windows the run still keeps both painting (WORFY_KEEP_PAINTING, playwright.config.ts).
    for (const each of [a, onB]) expect(await each.app.evaluate(({ app }) => app.commandLine.hasSwitch('disable-renderer-backgrounding'))).toBe(true)
    await linkThroughUi(a.window, onB.window)
    const aId = await machineIdOf(a.window)
    await setProjectsAccess(a, true)
    await recordNotifications(a)
    await recordNotifications(onB)

    // A Session of A's Project, on its Canvas.
    const live = a.window.locator('[data-testid="session-node"][data-live="true"]')
    await a.window.getByTestId('sidebar-new-session').click()
    await expect(live).toHaveCount(1)
    await expect(live.getByTestId('session-node-status')).toHaveText('idle')
    const nodeId = await live.getAttribute('data-node-id')
    const { views } = await call<{ views: { nodeId: string; sessionId: string }[] }>(a.window, 'sessions.views', { projectId: ALPHA })
    const sessionId = views.find((view) => view.nodeId === nodeId)?.sessionId
    expect(sessionId).toBeDefined()

    // Neither worfy has a focused window when the turn ends.
    await unfocusAll([a, onB])
    await call(a.window, 'agent.send', { sessionId, text: 'notify both' })
    const expected = { title: 'alpha', body: FAKE_ANSWER }
    await expect.poll(() => recorded(a), { timeout: ms(20_000) }).toContainEqual(expected)
    await expect.poll(() => recorded(onB), { timeout: ms(20_000) }).toContainEqual(expected)

    // A click on B's notification: B's window loads again on A and shows that Session of A's Project.
    await onB.app.evaluate(() => {
      const store = globalThis as unknown as { recordedNotifications?: { body: string; emit(event: string): void }[] }
      const note = (store.recordedNotifications ?? []).findLast((each) => each.body === 'Hello from the fake agent')
      if (note === undefined) throw new Error('no notification of the turn on B')
      note.emit('click')
    })
    await expect(onB.window).toHaveURL(new RegExp(`[?&]machine=${aId}`), { timeout: ms(20_000) })
    const opened = onB.window.locator(`[data-testid="session-view"][data-node-id="${nodeId}"]`)
    await expect(opened).toBeVisible({ timeout: ms(20_000) })
    await expect(opened).toHaveAttribute('data-session-id', sessionId ?? '')
    await expect(onB.window).toHaveURL(new RegExp(`[?&]project=${ALPHA}`))
    // A's own window stays where it was: the click is B's.
    await expect(a.window).not.toHaveURL(/[?&]machine=/)
  } finally {
    await a.close()
    await b?.close()
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
