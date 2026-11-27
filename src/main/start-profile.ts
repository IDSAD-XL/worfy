// TEMPORARY (worfy-polish 152, measurement only; removed before the final head): CPU profiles of main and of the
// first window's renderer from the start of its page load, taken only when WORFY_START_PROFILE=1. The e2e test
// stops them through ElectronApplication.evaluate (globalThis.__worfyStopStartProfiles) and prints a summary.
import { Session } from 'node:inspector'
import type { BrowserWindow } from 'electron'

/** Child processes main started: [what, at ms since the module loaded, ms it ran (-1: still running), sync]. */
const children: unknown[][] = []
const loadedAt = Date.now()

if (process.env.WORFY_START_PROFILE === '1') {
  const cp = process.getBuiltinModule('node:child_process') as unknown as Record<string, (...args: unknown[]) => unknown>
  const what = (args: unknown[]): string => {
    const [file, rest] = args
    const list = Array.isArray(rest) ? rest.slice(0, 3).map(String) : []
    return `${String(file).split('/').pop()} ${list.join(' ')}`.slice(0, 80)
  }
  for (const name of ['spawn', 'execFile', 'exec', 'fork']) {
    const original = cp[name]!
    cp[name] = function (this: unknown, ...args: unknown[]) {
      const row: unknown[] = [`${name} ${what(args)}`, Date.now() - loadedAt, -1, false]
      children.push(row)
      const t0 = Date.now()
      const child = original.apply(this, args) as { once?: (event: string, listener: () => void) => void }
      child?.once?.('exit', () => (row[2] = Date.now() - t0))
      return child
    }
  }
  for (const name of ['spawnSync', 'execFileSync', 'execSync']) {
    const original = cp[name]!
    cp[name] = function (this: unknown, ...args: unknown[]) {
      const t0 = Date.now()
      try {
        return original.apply(this, args)
      } finally {
        children.push([`${name} ${what(args)}`, t0 - loadedAt, Date.now() - t0, true])
      }
    }
  }
}

interface Stopped {
  children: unknown[][]
  loadedAt: number
  main: string | null
  renderer: string | null
  mainLag: number[][]
  mainIpc: unknown[]
  startedAt: number
}

export function startStartProfiles(window: BrowserWindow): void {
  if (process.env.WORFY_START_PROFILE !== '1') return
  const g = globalThis as unknown as { __worfyStopStartProfiles?: () => Promise<Stopped>; __worfyMainIpc?: unknown[] }
  if (g.__worfyStopStartProfiles) return
  const startedAt = Date.now()
  const session = new Session()
  session.connect()
  const post = (method: string, params?: object): Promise<unknown> =>
    new Promise((done, fail) => session.post(method, params ?? {}, (error, result) => (error ? fail(error) : done(result))))
  void post('Profiler.enable').then(() => post('Profiler.setSamplingInterval', { interval: 500 })).then(() => post('Profiler.start'))
  const wc = window.webContents
  let rendererOn = false
  try {
    wc.debugger.attach('1.3')
    rendererOn = true
    void wc.debugger.sendCommand('Profiler.enable').then(() => wc.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 500 })).then(() => wc.debugger.sendCommand('Profiler.start'))
  } catch (error) {
    console.warn('[start-profile] the renderer profile did not start', error)
  }
  // Gaps of main's event loop over 30 ms: [at ms after startedAt, gap ms].
  const lag: number[][] = []
  let last = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    if (now - last > 30) lag.push([last - startedAt, now - last])
    last = now
  }, 5)
  g.__worfyMainIpc = []
  g.__worfyStopStartProfiles = async () => {
    clearInterval(timer)
    const main = ((await post('Profiler.stop').catch(() => null)) as { profile?: object } | null)?.profile
    let renderer: object | undefined
    if (rendererOn) renderer = ((await wc.debugger.sendCommand('Profiler.stop').catch(() => null)) as { profile?: object } | null)?.profile
    return { main: main ? JSON.stringify(main) : null, renderer: renderer ? JSON.stringify(renderer) : null, mainLag: lag, mainIpc: g.__worfyMainIpc ?? [], startedAt, children, loadedAt }
  }
}
