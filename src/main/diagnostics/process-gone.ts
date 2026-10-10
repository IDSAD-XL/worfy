// The record of a process that ended. Electron sends `render-process-gone` when the process of a
// window ends and `child-process-gone` when a helper process (GPU, utility) does; without a record
// a crashed renderer is just an empty window. Each event becomes one JSON line appended to
// <data root>/logs/process-gone.jsonl:
//
//   {"time":"2026-10-10T12:00:00.000Z","process":"renderer","reason":"crashed","exitCode":11}
//   {"time":"…","process":"Utility","reason":"oom","exitCode":-1,"service":"network.mojom.NetworkService"}
//
// Only the time, the kind of process, the reason and the exit code go in. The window's URL does
// not: in a packaged app it is a file:// path under the user's home folder, and nothing of a
// Session, no path and no token may reach this file. So the record is built field by field, and
// each text field is cut to a short word (plain()).
//
// The window is not reopened: this only records. The file is not trimmed: a line is about 100
// bytes and worfy starts no process again after it ends, so the events stay few.
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app as electronApp } from 'electron'
import { dataRoot } from '../storage/paths'

/** What Electron documents for the details of both events; read as unknown, since it goes to a file. */
type Details = { type?: unknown; reason?: unknown; exitCode?: unknown; serviceName?: unknown } | null | undefined

export interface ProcessGoneDeps {
  app: {
    on(event: 'render-process-gone', listener: (event: unknown, webContents: unknown, details: Details) => void): unknown
    on(event: 'child-process-gone', listener: (event: unknown, details: Details) => void): unknown
  }
  /** The file the lines go to; asked for on every event, so installing creates and reads nothing. */
  file: () => string
  now: () => Date
}

const defaults = (): ProcessGoneDeps => ({ app: electronApp, file: () => processGoneLogPath(), now: () => new Date() })

/** logs/process-gone.jsonl in worfy's data folder; scripts/hang-sample.mjs writes next to it. */
export function processGoneLogPath(root: string = dataRoot()): string {
  return join(root, 'logs', 'process-gone.jsonl')
}

const MAX_WORD = 80

/**
 * A value of Electron's fixed vocabulary (`crashed`, `GPU`, `network.mojom.NetworkService`) as it
 * is; anything else loses what a path, a URL or a line of text needs — separators and line breaks
 * become `?` — and is cut to 80 characters. Not a string at all: `unknown`.
 */
function plain(value: unknown): string {
  if (typeof value !== 'string') return 'unknown'
  return value.replace(/[^A-Za-z0-9 ._-]/g, '?').slice(0, MAX_WORD)
}

function record(time: Date, process: string, details: Details): string {
  const exitCode = details?.exitCode
  return JSON.stringify({
    time: time.toISOString(),
    process,
    reason: plain(details?.reason),
    exitCode: Number.isInteger(exitCode) ? exitCode : null,
    ...(typeof details?.serviceName === 'string' ? { service: plain(details.serviceName) } : {}),
  })
}

/** Subscribes to both events. A line that cannot be written goes to console.error; nothing is thrown into Electron. */
export function installProcessGone(deps: ProcessGoneDeps = defaults()): void {
  const { app, file, now } = deps
  const write = (process: string, details: Details): void => {
    let line = ''
    try {
      line = record(now(), process, details)
      const path = file()
      mkdirSync(dirname(path), { recursive: true })
      appendFileSync(path, `${line}\n`)
    } catch (error) {
      console.error(`[worfy] could not record a process that ended (${line}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  app.on('render-process-gone', (_event, _webContents, details) => write('renderer', details))
  app.on('child-process-gone', (_event, details) => write(plain(details?.type), details))
}
