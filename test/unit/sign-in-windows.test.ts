// The OAuth sign-in window of an Integration is a service's page, not a worfy window (src/main/sign-in-windows.ts,
// worfy-integrations ticket 05). Ticket 09 (the review of ticket 05): an Autopilot confirmation goes on a worfy window,
// never on the sign-in page where nobody would see it; the events of the app — the Layout, the link, the Linked
// machines — go to worfy's own pages only, never into the service's page; and no other place of main takes the list of
// every window without leaving the sign-in windows out. Over a mocked `electron`; no window opens.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const sent: { to: string; channel: string }[] = []
  const window = (name: string, shown = true) => {
    const contents = { name, send: (channel: string) => sent.push({ to: name, channel }), isDestroyed: () => false, once: () => undefined }
    return {
      name,
      webContents: contents,
      isDestroyed: () => false,
      isVisible: () => shown,
      isMinimized: () => false,
      restore: () => undefined,
      show: () => undefined,
    }
  }
  const all: ReturnType<typeof window>[] = []
  return { sent, window, all }
})

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => electron.all, getFocusedWindow: () => null } }))

const { markSignInWindow } = await import('../../src/main/sign-in-windows')
const { dialogOwner } = await import('../../src/main/autopilot/chat-confirm')
const { appWindowContents, toEveryWindow } = await import('../../src/main/broadcast')

type Fake = ReturnType<typeof electron.window>

/** The windows of `windows` as dialogOwner asks for them, `focused` the one in focus. */
const local = (windows: Fake[], focused: Fake | null) => ({ getAllWindows: () => windows, getFocusedWindow: () => focused }) as unknown as Parameters<typeof dialogOwner>[0]

describe('an Autopilot confirmation', () => {
  it('goes on worfy`s window, not on the sign-in window in focus', () => {
    const app = electron.window('app')
    const signIn = electron.window('sign-in')
    markSignInWindow(signIn.webContents)
    expect((dialogOwner(local([signIn, app], signIn)) as unknown as Fake | null)?.name).toBe('app')
  })

  it('has no window to go on while only a sign-in window is open', () => {
    const signIn = electron.window('sign-in-only')
    markSignInWindow(signIn.webContents)
    expect(dialogOwner(local([signIn], signIn))).toBeNull()
  })
})

describe('the events of the app', () => {
  it('reach the worfy windows and never the sign-in window', () => {
    const app = electron.window('main')
    const signIn = electron.window('service-page')
    markSignInWindow(signIn.webContents)
    electron.all.splice(0, electron.all.length, app, signIn)
    electron.sent.length = 0
    toEveryWindow((target) => target.send('layout.changed', null))
    expect(electron.sent).toEqual([{ to: 'main', channel: 'layout.changed' }])
    expect(appWindowContents().map((contents) => (contents as unknown as { name: string }).name)).toEqual(['main'])
  })
})

/** Every TypeScript file under `dir`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? sources(path) : path.endsWith('.ts') ? [path] : []
  })
}

describe('the list of every window in main', () => {
  /**
   * The places that may take every window as it is, each with why the sign-in windows do not matter there; every other
   * call of getAllWindows() leaves them out on the same line (appWindows) or is appWindowContents itself.
   */
  const MAY_TAKE_ALL: Readonly<Record<string, string>> = {
    // The interface scale is the zoom of a page; the service's page at worfy's zoom harms nobody.
    'src/main/settings/interface-scale.ts': 'zoom',
  }

  it('leaves the sign-in windows out everywhere else: the link, the Linked machines, the broadcast, a dialog', () => {
    const root = join(import.meta.dirname, '..', '..')
    const found = sources(join(root, 'src', 'main')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) => (/\.getAllWindows\(\)/u.test(line) && !/^\s*(\/\/|\*)/u.test(line) ? [{ file: relative(root, file).split('\\').join('/'), line: index + 1, text: line.trim() }] : [])),
    )
    const bare = found.filter((each) => !each.text.includes('appWindows(') && !(each.file in MAY_TAKE_ALL) && !(each.file === 'src/main/broadcast.ts' && each.text.includes('appWindows')))
    expect(bare).toEqual([])
  })
})
