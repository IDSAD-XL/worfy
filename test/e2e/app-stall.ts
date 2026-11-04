import { execFile } from 'node:child_process'
import { cpus } from 'node:os'
import type { ElectronApplication } from '@playwright/test'

/** The machine's CPU time as os.cpus() counts it: busy and total, over every core. */
function cpuTimes(): { busy: number; total: number } {
  let busy = 0
  let total = 0
  for (const each of cpus()) {
    const { user, nice, sys, idle, irq } = each.times
    busy += user + nice + sys + irq
    total += user + nice + sys + idle + irq
  }
  return { busy, total }
}

// Windows only: the 10 processes of the whole machine that used the most CPU over 2 s, the
// machine's free memory and the disk's busy time, from one Windows PowerShell run.
const TOP_SCRIPT = [
  '$a = @{}; Get-Process | ForEach-Object { $a[$_.Id] = $_.TotalProcessorTime.TotalMilliseconds }',
  "$disk = (Get-Counter '\\PhysicalDisk(_Total)\\% Disk Time' -SampleInterval 2 -MaxSamples 1).CounterSamples[0].CookedValue",
  '$rows = Get-Process | ForEach-Object { $before = $a[$_.Id]; if ($null -eq $before) { $before = 0 }; [pscustomobject]@{ Name = $_.ProcessName; Id = $_.Id; Ms = [int]($_.TotalProcessorTime.TotalMilliseconds - $before) } }',
  '$free = [int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1024)',
  "'free ' + $free + ' MB, disk ' + [int]$disk + '%, top: ' + (($rows | Sort-Object Ms -Descending | Select-Object -First 10 | ForEach-Object { $_.Name + ':' + $_.Id + ':' + $_.Ms + 'ms' }) -join ' ')",
].join('; ')

function machineTop(): Promise<string> {
  if (process.platform !== 'win32') return Promise.resolve('not on Windows')
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', TOP_SCRIPT], { encoding: 'utf8', timeout: 30_000, windowsHide: true }, (error, stdout, stderr) => {
      resolve(error ? `failed: ${error.message} ${stderr.trim().slice(0, 200)}` : stdout.trim())
    })
  })
}

// A diagnosis of a just-started app that does not answer (worfy-polish ticket 47): on the GitHub
// Windows runner the page's first evaluate in canvasReady once took 9–20 s. This records, in main,
// how late its own event loop ran, when the window reported itself unresponsive, and what each
// process of the app spent on the CPU, so the log says which process was stuck.

/** What main recorded since the probe was installed. */
export interface StallRecord {
  since: number
  /** When main's event loop last ran its 100 ms timer. */
  lastTick: number
  display: string
  gaps: Array<{ at: number; ms: number }>
  events: Array<{ at: number; what: string }>
  metrics: Array<{ at: number; processes: string }>
}

/** Events of each fs.watch main opened after installWatchCounter, by the path it watches. */
interface WatchCounts {
  [path: string]: { opened: number; events: number; bySecond: Record<string, number>; names: string[] }
}

/**
 * Counts the events of every fs.watch main opens from now on, by watched path and by second (the
 * stall's main stack was inside FSWatcher's onchange). The module's watch is replaced, and the
 * bindings of `import { watch } from 'node:fs'` follow it (syncBuiltinESMExports).
 */
export async function installWatchCounter(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => {
    const holder = globalThis as unknown as { __worfyWatches?: WatchCounts }
    if (holder.__worfyWatches) return
    const counts: WatchCounts = {}
    holder.__worfyWatches = counts
    const fs = process.getBuiltinModule('node:fs')
    const original = fs.watch
    const counted = function (this: unknown, ...args: Parameters<typeof fs.watch>) {
      const watcher = original.apply(this, args) as ReturnType<typeof fs.watch>
      const key = String(args[0])
      const entry = (counts[key] ??= { opened: 0, events: 0, bySecond: {}, names: [] })
      entry.opened += 1
      watcher.on('change', (event: string, name: unknown) => {
        entry.events += 1
        const second = String(Math.floor(Date.now() / 1000))
        entry.bySecond[second] = (entry.bySecond[second] ?? 0) + 1
        if (entry.names.length < 6) entry.names.push(`${event}:${String(name)}`)
      })
      return watcher
    }
    fs.watch = counted as typeof fs.watch
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
  })
}

/** Installs the probe in main; answers how long main took to run it. */
export async function installStallProbe(app: ElectronApplication): Promise<number> {
  const started = Date.now()
  await app.evaluate(({ app: electronApp, BrowserWindow, screen }) => {
    const holder = globalThis as unknown as { __worfyStall?: StallRecord }
    if (holder.__worfyStall) return
    const primary = screen.getPrimaryDisplay()
    const display = `${primary.size.width}x${primary.size.height}, work area ${primary.workAreaSize.width}x${primary.workAreaSize.height}, scale ${primary.scaleFactor}`
    const record: StallRecord = { since: Date.now(), lastTick: Date.now(), display, gaps: [], events: [], metrics: [] }
    holder.__worfyStall = record
    let last = Date.now()
    const loop = setInterval(() => {
      const now = Date.now()
      if (now - last > 400) record.gaps.push({ at: now, ms: now - last })
      last = now
      record.lastTick = now
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
export async function watchCall<T>(app: ElectronApplication, label: string, call: () => Promise<T>, slowMs = 1500): Promise<T> {
  const started = Date.now()
  const cpuBefore = cpuTimes()
  let done = false
  const pings: number[] = []
  // Main's JavaScript stack, taken by a ping that came while main's event loop was held up: the
  // inspector runs an evaluate between two statements of running code, so the stack is that code's.
  const stacks = new Map<string, number>()
  let top: Promise<string> | undefined
  const pinger = (async () => {
    while (!done) {
      // While the call still hangs: what the whole machine does.
      if (top === undefined && Date.now() - started > 3000) top = machineTop()
      const at = Date.now()
      const stack = await app
        .evaluate(() => {
          const record = (globalThis as unknown as { __worfyStall?: StallRecord }).__worfyStall
          if (!record || Date.now() - record.lastTick < 300) return undefined
          const limit = Error.stackTraceLimit
          Error.stackTraceLimit = 60
          const text = new Error(`main held up ${Date.now() - record.lastTick} ms`).stack
          Error.stackTraceLimit = limit
          return text
        })
        .catch(() => undefined)
      pings.push(Date.now() - at)
      if (stack) {
        const key = stack.split('\n').slice(1).join('\n')
        stacks.set(key, (stacks.get(key) ?? 0) + 1)
      }
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
      const cpuAfter = cpuTimes()
      const machineBusy = Math.round((100 * (cpuAfter.busy - cpuBefore.busy)) / Math.max(1, cpuAfter.total - cpuBefore.total))
      const record = await app.evaluate(() => (globalThis as unknown as { __worfyStall?: StallRecord }).__worfyStall).catch(() => undefined)
      const rel = (at: number): string => `${((at - started) / 1000).toFixed(1)}s`
      const lines = [
        `[stall] ${label} answered after ${took} ms; main pings: ${pings.length}, max ${Math.max(0, ...pings)} ms, ${pings.join(',')}`,
        `[stall] display ${record?.display ?? 'unknown'}; machine CPU busy ${machineBusy}% of ${cpus().length} cores over the call`,
        `[stall] machine at 3 s: ${top ? await top : 'not sampled'}`,
        `[stall] main loop gaps: ${(record?.gaps ?? []).map((gap) => `${rel(gap.at)}+${gap.ms}`).join(' ') || 'none'}`,
        `[stall] window events: ${(record?.events ?? []).map((event) => `${rel(event.at)} ${event.what}`).join('; ') || 'none'}`,
        ...(record?.metrics ?? []).filter((each) => each.at >= started - 2000).map((each) => `[stall] cpu ${rel(each.at)} ${each.processes}`),
      ]
      const watches = await app.evaluate(() => (globalThis as unknown as { __worfyWatches?: WatchCounts }).__worfyWatches).catch(() => undefined)
      const from = Math.floor(started / 1000) - 1
      const busiest = Object.entries(watches ?? {})
        .map(([path, entry]) => ({ path, entry, during: Object.entries(entry.bySecond).filter(([second]) => Number(second) >= from).reduce((sum, [, n]) => sum + n, 0) }))
        .sort((a, b) => b.during - a.during)
        .slice(0, 5)
      lines.push(`[stall] fs.watch: ${Object.keys(watches ?? {}).length} paths; busiest during the call: ${busiest.map(({ path, entry, during }) => `${path} (opened ${entry.opened}, ${during} events now, ${entry.events} in all, ${entry.names.join(' ')})`).join(' | ') || 'none'}`)
      for (const [stack, count] of stacks) lines.push(`[stall] main stack (${count} pings):\n${stack}`)
      console.log(lines.join('\n'))
    }
  }
}
