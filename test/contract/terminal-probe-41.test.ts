// TEMPORARY — worfy-windows ticket 41 (on the clean windows-2025 runner the Terminal tests that type
// into Windows PowerShell see the echo of the command but never its output). Remove this file after
// the measurement.
//
// A measurement for the manual "Windows tests" job (.github/workflows/windows-tests.yml, input
// `files`), not a test: every case passes once it has collected its record, and only a crash fails it.
// Each case starts the shell through the Terminal harness of terminal.test.ts — node-pty with the
// same environment (windowsEnv), the same arguments (-NoLogo -NoProfile) and a temporary Project
// folder as the working directory — types a command right after the start as `run` does, and prints
// every output chunk with its time in ms since the open call, as one JSON line per chunk.
// Scenarios: Windows PowerShell at 80 and 200 columns (the prompt of the runner took 74 of 80), and
// pwsh at the same widths as a control when it is on the Path. One more case asks both shells for
// their versions without a pseudo-console, so the versions are known even when the pty gives nothing.
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { release } from 'node:os'
import { win32 } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { describe, it, vi } from 'vitest'
import { findOnPath } from '../../src/main/agent/env'
import { harness, home, NODE, PROJECT, SYSTEM_ROOT, useTerminalScratch, WINDOWS, windowsEnv } from './terminal-harness'

vi.mock('electron', () => ({ app: { on: vi.fn() }, BrowserWindow: { getAllWindows: () => [] } }))

useTerminalScratch()

const NOT_WINDOWS = 'measures powershell.exe on a Windows pseudo-console: nothing to measure on this system'
const LIMIT_MS = 60_000
const AFTER_MS = 2_000
/** When the probe command has given nothing by then, the info command is typed anyway: is later input read at all? */
const SECOND_INPUT_MS = 30_000
const CASE_TIMEOUT_MS = 90_000

/** The typed line holds the expression; only the output holds `probe-42`. */
const PROBE = "Write-Output ('probe-' + (6*7))"
const PROBE_OUTPUT = /probe-42\r?\n/
const INFO =
  "Write-Output ('info|ps=' + $PSVersionTable.PSVersion + '|host=' + $Host.Name + '|psrl=' + (Get-Module PSReadLine).Version + '|enc=' + [Console]::OutputEncoding.WebName + '|psstyle=' + [bool](Get-Variable PSStyle -ErrorAction SilentlyContinue) + '|end')"
/** The echo has a quote right after `info|ps=`; the output does not. */
const INFO_OUTPUT = /info\|ps=[^'\r\n]*\|end/

// process.stdout, not console.log: in the job (no TTY) the default reporter of vitest drops the console
// output of a test that passes, while a direct write reaches the log.
const print = (label: string, value: unknown): void => {
  process.stdout.write(`[probe41 ${label}] ${JSON.stringify(value)}\n`)
}
const ms = (value: number): number => Math.round(value * 10) / 10
const sleep = (wait: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, wait))

interface Entry {
  t: number
  kind: 'out' | 'typed' | 'exit'
  data: string
}

async function measure(label: string, cols: number, path?: string): Promise<void> {
  const h = await harness(path === undefined ? {} : { path: [path] })
  const record: Entry[] = []
  let text = ''
  let t0 = performance.now()
  const at = (pattern: RegExp | string): number | null => {
    let seen = ''
    for (const entry of record) {
      if (entry.kind !== 'out') continue
      seen += entry.data
      if (typeof pattern === 'string' ? seen.includes(pattern) : pattern.test(seen)) return entry.t
    }
    return null
  }
  // The registry keeps the sender of the open and calls its `send` for each event: wrapped here, every
  // chunk gets its time when it arrives.
  const send = h.sender.send
  h.sender.send = (channel: string, payload: unknown) => {
    const t = ms(performance.now() - t0)
    const event = payload as { data?: string; exitCode?: number }
    if (channel.endsWith('terminal.output') && typeof event.data === 'string') {
      record.push({ t, kind: 'out', data: event.data })
      text += event.data
    } else if (channel.endsWith('terminal.exit')) record.push({ t, kind: 'exit', data: JSON.stringify(payload) })
    send(channel, payload)
  }
  const typeLine = async (line: string) => {
    record.push({ t: ms(performance.now() - t0), kind: 'typed', data: line })
    await h.type(`${line}\r`)
  }
  const waitFor = async (pattern: RegExp, until: number): Promise<boolean> => {
    while (performance.now() - t0 < until) {
      if (pattern.test(text)) return true
      await sleep(50)
    }
    return pattern.test(text)
  }

  t0 = performance.now()
  const opened = await h.open(NODE, { cols, rows: 24 })
  const openMs = ms(performance.now() - t0)
  // Typed right after the open, as `run` of the harness does in the failing tests.
  await typeLine(PROBE)
  let info = false
  const probe = await waitFor(PROBE_OUTPUT, SECOND_INPUT_MS)
  if (probe) {
    await typeLine(INFO)
    info = await waitFor(INFO_OUTPUT, LIMIT_MS)
  } else {
    await typeLine(INFO)
    const late = await waitFor(new RegExp(`${PROBE_OUTPUT.source}|${INFO_OUTPUT.source}`), LIMIT_MS)
    if (late) info = await waitFor(INFO_OUTPUT, LIMIT_MS)
  }
  if (probe || info || PROBE_OUTPUT.test(text)) await sleep(AFTER_MS)
  const endMs = ms(performance.now() - t0)
  await h.ok('terminal.close', { projectId: PROJECT, nodeId: NODE })

  print(`${label} start`, { shell: opened.shell, pid: opened.pid, cols, rows: 24, openMs })
  for (const entry of record) print(`${label} chunk`, entry)
  print(`${label} summary`, {
    shell: opened.shell,
    cols,
    openMs,
    firstChunkMs: record.find((entry) => entry.kind === 'out')?.t ?? null,
    promptMs: at(/PS [^\r\n]*> /),
    echoMs: at("'probe-'"),
    probeOutputMs: at(PROBE_OUTPUT) ?? `never within ${LIMIT_MS / 1000} s`,
    infoOutputMs: at(INFO_OUTPUT) ?? `never within ${LIMIT_MS / 1000} s`,
    info: INFO_OUTPUT.exec(text)?.[0] ?? null,
    chunks: record.filter((entry) => entry.kind === 'out').length,
    // The exit that terminal.close causes comes after endMs and does not count here.
    exitedBeforeClose: record.some((entry) => entry.kind === 'exit' && entry.t <= endMs),
    endMs,
  })
}

/** The pwsh of the Path of this process, or null. */
const pwsh = (): string | null => findOnPath('pwsh', process.env)

describe('worfy-windows ticket 41: Windows PowerShell output on a pseudo-console (temporary measurement)', () => {
  it('the machine and the shells, asked without a pseudo-console', { timeout: CASE_TIMEOUT_MS }, async (context) => {
    if (!WINDOWS) context.skip(NOT_WINDOWS)
    const script = [
      '$m = Get-Module -ListAvailable PSReadLine | Sort-Object Version -Descending | Select-Object -First 1',
      "'ps=' + $PSVersionTable.PSVersion + ' edition=' + $PSVersionTable.PSEdition + ' psrl-available=' + $m.Version + ' psrl-base=' + $m.ModuleBase + ' enc=' + [Console]::OutputEncoding.WebName + ' psstyle=' + [bool](Get-Variable PSStyle -ErrorAction SilentlyContinue) + ' culture=' + (Get-Culture).Name",
    ].join('; ')
    const ask = async (file: string): Promise<string> => {
      try {
        const { stdout } = await promisify(execFile)(file, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env: windowsEnv(home), encoding: 'utf8', timeout: 30_000, windowsHide: true })
        return stdout.trim()
      } catch (error) {
        return `failed: ${String(error)}`
      }
    }
    const nodePty = (createRequire(import.meta.url)('node-pty/package.json') as { version: string }).version
    const found = pwsh()
    print('machine', {
      os: release(),
      imageOs: process.env['ImageOS'] ?? null,
      imageVersion: process.env['ImageVersion'] ?? null,
      node: process.versions.node,
      electron: process.versions['electron'] ?? null,
      nodePty,
      powershell: await ask(win32.join(SYSTEM_ROOT, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')),
      pwshPath: found,
      pwsh: found === null ? null : await ask(found),
    })
  })

  for (const cols of [80, 200]) {
    it(`Windows PowerShell at ${cols} columns`, { timeout: CASE_TIMEOUT_MS }, async (context) => {
      if (!WINDOWS) context.skip(NOT_WINDOWS)
      await measure(`powershell-${cols}`, cols)
    })
  }

  for (const cols of [80, 200]) {
    it(`pwsh at ${cols} columns (control)`, { timeout: CASE_TIMEOUT_MS }, async (context) => {
      if (!WINDOWS) context.skip(NOT_WINDOWS)
      const found = pwsh()
      if (found === null) context.skip('this machine has no pwsh on its Path')
      await measure(`pwsh-${cols}`, cols, win32.dirname(found ?? ''))
    })
  }
})
