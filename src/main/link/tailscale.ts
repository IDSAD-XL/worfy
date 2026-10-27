// The machines of the user's tailnet for "Link a machine" (worfy-link ticket 30; ADR-0070, point 5):
// read from the Tailscale CLI, `tailscale status --json`. Bonjour does not cross the tailnet, so
// without this list a Machine there is found only by a name or an address typed by hand.
//
// The CLI is not on every computer, nor always on the PATH: the macOS app keeps it inside its
// bundle, the Windows installer in its own folder. It is looked for on the PATH first, then where
// those installers put it (findTailscale). No CLI means no list and nothing in the log: the window
// works as before. A CLI that fails, hangs past TAILSCALE_TIMEOUT_MS or prints something that is not
// its status means no list either, with one warning in the log; the window shows no error.
//
// The CLI is started with an argument array, never through a shell. Tests inject the runner and the
// file check: no test starts a real `tailscale`.
import { execFile } from 'node:child_process'
import { posix, win32 } from 'node:path'
import { z } from 'zod'
import type { TailscalePeerView } from '../../shared/ipc/link'
import { fileOrAlias, findOnPath, getVar, type FileExists } from '../agent/env'

/** How long `tailscale status --json` may run before it is stopped and the list left empty. */
export const TAILSCALE_TIMEOUT_MS = 3_000

/** Where the macOS installers put the CLI: inside the app (App Store and standalone), and the Homebrew/CLI install. */
export const MACOS_TAILSCALE_PATHS = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale'] as const

/**
 * The Tailscale CLI, or null: the PATH of `env` first; then on macOS MACOS_TAILSCALE_PATHS, on
 * Windows `%ProgramFiles%\Tailscale\tailscale.exe`. Entries of the PATH that are not full paths are
 * skipped: they would be looked for in worfy's own working folder.
 */
export function findTailscale(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, exists: FileExists = fileOrAlias): string | null {
  if (platform === 'win32') {
    const onPath = findOnPath('tailscale.exe', env, exists)
    if (onPath !== null) return onPath
    const programFiles = getVar(env, 'ProgramFiles')
    if (programFiles === undefined || programFiles === '') return null
    const installed = win32.join(programFiles, 'Tailscale', 'tailscale.exe')
    return exists(installed) ? installed : null
  }
  for (const dir of (env.PATH ?? '').split(':')) {
    if (!posix.isAbsolute(dir)) continue
    const candidate = posix.join(dir, 'tailscale')
    if (exists(candidate)) return candidate
  }
  if (platform !== 'darwin') return null
  return MACOS_TAILSCALE_PATHS.find((path) => exists(path)) ?? null
}

// What worfy reads of `tailscale status --json`; every other field is ignored. `Peer` is a map by
// node key, null when the tailnet has no other machine; `Self` (this Machine) is never listed.
const nodeSchema = z.object({
  HostName: z.string().optional(),
  DNSName: z.string().optional(),
  TailscaleIPs: z.array(z.string()).nullable().optional(),
  Online: z.boolean().optional(),
})
const statusSchema = z.object({ Peer: z.record(z.string(), z.unknown()).nullable().optional() })

/**
 * The machines of the tailnet in the output of `tailscale status --json`, online ones first, then by
 * name; this Machine (`Self`) is not among them. Name: the MagicDNS name, the first label of
 * `DNSName` (which ends with a dot), else `HostName`. Address: the first IPv4 of `TailscaleIPs`,
 * else its first address; a peer without one is left out, as is an entry of another shape. Throws
 * when the text is not JSON or not a status.
 */
export function parseTailscaleStatus(text: string): TailscalePeerView[] {
  const status = statusSchema.parse(JSON.parse(text))
  const peers: TailscalePeerView[] = []
  for (const entry of Object.values(status.Peer ?? {})) {
    const node = nodeSchema.safeParse(entry)
    if (!node.success) continue
    const ips = node.data.TailscaleIPs ?? []
    const address = ips.find((ip) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) ?? ips[0]
    if (address === undefined || address === '') continue
    const name = node.data.DNSName?.split('.')[0] || node.data.HostName || address
    peers.push({ name, address, online: node.data.Online === true })
  }
  return peers.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
}

/** Runs `file` with `args` (no shell) and gives its standard output; rejects on a failure or after `timeoutMs`. */
export type TailscaleRunner = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>

export const runTailscaleCli: TailscaleRunner = (file, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })

export interface TailscaleReadOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  exists?: FileExists
  run?: TailscaleRunner
  /** Warnings for the worfy log; console.warn by default. */
  warn?: (message: string) => void
}

/**
 * The machines of the user's tailnet (parseTailscaleStatus); empty when the CLI is not found, and
 * empty with one warning when it fails, hangs or prints no status. Never throws.
 */
export async function readTailscalePeers(options: TailscaleReadOptions = {}): Promise<TailscalePeerView[]> {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const cli = findTailscale(options.platform ?? process.platform, options.env ?? process.env, options.exists)
  if (cli === null) return []
  try {
    return parseTailscaleStatus(await (options.run ?? runTailscaleCli)(cli, ['status', '--json'], TAILSCALE_TIMEOUT_MS))
  } catch (error) {
    const reason =
      error instanceof SyntaxError || error instanceof z.ZodError
        ? 'its output is not a status'
        : (error as { killed?: boolean } | null)?.killed === true
          ? `no answer within ${TAILSCALE_TIMEOUT_MS} ms`
          : error instanceof Error
            ? error.message
            : String(error)
    warn(`[link] the tailnet machines could not be read from ${cli} status --json: ${reason.split('\n')[0]}`)
    return []
  }
}
