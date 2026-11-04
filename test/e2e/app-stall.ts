import type { ElectronApplication } from '@playwright/test'

// A diagnosis of a just-started app that does not answer (worfy-polish ticket 47): on the GitHub
// Windows runner the page's first evaluate in canvasReady once took 9–20 s. This records, in main,
// how late its own event loop ran, when the window reported itself unresponsive, and what each
// process of the app spent on the CPU, so the log says which process was stuck.

/** What main recorded since the probe was installed. */
export interface StallRecord {
  since: number
  display: string
  gaps: Array<{ at: number; ms: number }>
  events: Array<{ at: number; what: string }>
  metrics: Array<{ at: number; processes: string }>
}

/** Installs the probe in main; answers how long main took to run it. */
export async function installStallProbe(app: ElectronApplication): Promise<number> {
  const started = Date.now()
  await app.evaluate(({ app: electronApp, BrowserWindow, screen }) => {
    const holder = globalThis as unknown as { __worfyStall?: StallRecord }
    if (holder.__worfyStall) return
    const primary = screen.getPrimaryDisplay()
    const display = `${primary.size.width}x${primary.size.height}, work area ${primary.workAreaSize.width}x${primary.workAreaSize.height}, scale ${primary.scaleFactor}`
    const record: StallRecord = { since: Date.now(), display, gaps: [], events: [], metrics: [] }
    holder.__worfyStall = record
    let last = Date.now()
    const loop = setInterval(() => {
      const now = Date.now()
      if (now - last > 400) record.gaps.push({ at: now, ms: now - last })
      last = now
    }, 100)
    const metrics = setInterval(() => {
      const processes = electronApp
        .getAppMetrics()
        .map((each) => `${each.type}:${each.pid}:${each.cpu.percentCPUUsage.toFixed(0)}%`)
        .join(' ')
      record.metrics.push({ at: Date.now(), processes })
      if (record.metrics.length > 40) record.metrics.shift()
    }, 1000)
    loop.unref?.()
    metrics.unref?.()
    for (const win of BrowserWindow.getAllWindows()) {
      win.on('unresponsive', () => record.events.push({ at: Date.now(), what: 'unresponsive' }))
      win.on('responsive', () => record.events.push({ at: Date.now(), what: 'responsive' }))
      win.webContents.on('render-process-gone', (_event, details) => record.events.push({ at: Date.now(), what: `render-process-gone ${details.reason}` }))
      win.webContents.on('did-start-loading', () => record.events.push({ at: Date.now(), what: 'did-start-loading' }))
      win.webContents.on('did-stop-loading', () => record.events.push({ at: Date.now(), what: 'did-stop-loading' }))
    }
  })
  return Date.now() - started
}

/**
 * Runs `call` (a page evaluate) while pinging main every 250 ms; when the call took longer than
 * `slowMs`, prints what main answered and recorded meanwhile. Returns the call's value.
 */
export async function watchCall<T>(app: ElectronApplication, label: string, call: () => Promise<T>, slowMs = 2000): Promise<T> {
  const started = Date.now()
  let done = false
  const pings: number[] = []
  const pinger = (async () => {
    while (!done) {
      const at = Date.now()
      await app.evaluate(() => 0).catch(() => undefined)
      pings.push(Date.now() - at)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  })()
  try {
    return await call()
  } finally {
    done = true
    const took = Date.now() - started
    if (took > slowMs) {
      await pinger
      const record = await app.evaluate(() => (globalThis as unknown as { __worfyStall?: StallRecord }).__worfyStall).catch(() => undefined)
      const rel = (at: number): string => `${((at - started) / 1000).toFixed(1)}s`
      const lines = [
        `[stall] ${label} answered after ${took} ms; main pings: ${pings.length}, max ${Math.max(0, ...pings)} ms, ${pings.join(',')}`,
        `[stall] display ${record?.display ?? 'unknown'}`,
        `[stall] main loop gaps: ${(record?.gaps ?? []).map((gap) => `${rel(gap.at)}+${gap.ms}`).join(' ') || 'none'}`,
        `[stall] window events: ${(record?.events ?? []).map((event) => `${rel(event.at)} ${event.what}`).join('; ') || 'none'}`,
        ...(record?.metrics ?? []).filter((each) => each.at >= started - 2000).map((each) => `[stall] cpu ${rel(each.at)} ${each.processes}`),
      ]
      console.log(lines.join('\n'))
    }
  }
}
