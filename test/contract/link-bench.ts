// A bench for link tests (worfy-link tickets 01, 02, 13, 14, 15): several link services over
// temporary data folders in one vitest process, listening on 127.0.0.1 only (no firewall prompt,
// passes on Linux CI), with a clock the test moves and console.* captured.
//
// Secrets stay out of the output: the bench remembers every pairing code a service showed and
// reads every token from the secrets files, and leakedSecrets() lists those that appear in the
// captured console output or in error texts the test hands it. The bench itself never prints one.
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'
import { vi, type MockInstance } from 'vitest'
import type { ModuleLoader } from '../../src/main/ipc/index'
import { LinkService, type LinkedMachineInfo, type LinkServiceOptions } from '../../src/main/link/service'

export interface BenchMachine {
  /** A short label, also the machine's host name (`<label>.local`) and so its Machine name. */
  readonly label: string
  readonly dataDir: string
  service: LinkService
  /** Messages of 'pairing-failed' this service emitted. */
  readonly pairingFailures: string[]
}

const CONSOLE_METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const

export interface BenchOptions {
  /** Handler modules for IPC over the link; by default only src/main/ipc/link.ts. */
  ipcModules?: Record<string, ModuleLoader>
  pingIntervalMs?: number
  pairingStepTimeoutMs?: number
  /** Adds a connection's client with access on to main's clients (worfy-link ticket 08); none by default. */
  addClient?: LinkServiceOptions['addClient']
}

export class LinkBench {
  /** The bench clock, in ms; services read it for pairing-code expiry. */
  now = Date.parse('2026-10-08T10:00:00.000Z')
  /** Everything console.* printed while the bench was open, formatted as the console would. */
  readonly captured: string[] = []
  private readonly codes = new Set<string>()
  private readonly machines: BenchMachine[] = []
  private readonly spies: MockInstance[] = []
  private readonly root = mkdtempSync(join(tmpdir(), 'worfy-link-bench-'))

  constructor(private readonly options: BenchOptions = {}) {
    for (const method of CONSOLE_METHODS) {
      this.spies.push(
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
          this.captured.push(format(...args))
        }),
      )
    }
  }

  advance(ms: number): void {
    this.now += ms
  }

  private serviceOptions(label: string, dataDir: string): LinkServiceOptions {
    return {
      dataDir,
      buildKind: 'packaged',
      buildVersion: '0.2.0+bench',
      listenHost: '127.0.0.1',
      hostname: () => `${label}.local`,
      networkInterfaces: () => ({ lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: true, cidr: '127.0.0.1/8' }] }),
      now: () => this.now,
      ipcModules: this.options.ipcModules ?? { './link.ts': () => import('../../src/main/ipc/link').then((module) => module.default) },
      ...(this.options.pingIntervalMs === undefined ? {} : { pingIntervalMs: this.options.pingIntervalMs }),
      ...(this.options.pairingStepTimeoutMs === undefined ? {} : { pairingStepTimeoutMs: this.options.pairingStepTimeoutMs }),
      ...(this.options.addClient === undefined ? {} : { addClient: this.options.addClient }),
    }
  }

  private watch(machine: BenchMachine): void {
    machine.service.on('pairing-code', () => {
      const current = machine.service.pairingCode()
      if (current !== null) this.codes.add(current.code)
    })
    machine.service.on('pairing-failed', ({ message }) => machine.pairingFailures.push(message))
  }

  /** A new Machine over a fresh data folder. */
  async machine(label: string): Promise<BenchMachine> {
    const dataDir = join(this.root, label)
    const service = await LinkService.start(this.serviceOptions(label, dataDir))
    const machine: BenchMachine = { label, dataDir, service, pairingFailures: [] }
    this.watch(machine)
    this.machines.push(machine)
    return machine
  }

  /** Stops the machine's service and starts a new one over the same data folder. */
  async restart(machine: BenchMachine): Promise<void> {
    await machine.service.stop()
    machine.service = await LinkService.start(this.serviceOptions(machine.label, machine.dataDir))
    this.watch(machine)
  }

  /** The code `machine` shows now; opens "Link a machine" on it first when needed. */
  async codeOf(machine: BenchMachine): Promise<string> {
    if (machine.service.pairingCode() === null) await machine.service.openLinking()
    const current = machine.service.pairingCode()
    if (current === null) throw new Error(`${machine.label}: no pairing code`)
    this.codes.add(current.code)
    return current.code
  }

  /** The port `machine` listens on; throws when it does not. */
  portOf(machine: BenchMachine): number {
    const { port, listening } = machine.service.status()
    if (!listening || port === null) throw new Error(`${machine.label} is not listening`)
    return port
  }

  /** Links `a` to `b` the way a user does: "Link a machine" on b, its code typed on a, b closes linking. */
  async link(a: BenchMachine, b: BenchMachine): Promise<LinkedMachineInfo> {
    const code = await this.codeOf(b)
    const linked = await a.service.pair({ host: '127.0.0.1', port: this.portOf(b), code })
    await b.service.closeLinking()
    return linked
  }

  /** Every token in the secrets files of the bench machines (machine keys excluded). */
  tokens(): string[] {
    const found: string[] = []
    for (const machine of this.machines) {
      let text: string
      try {
        text = readFileSync(join(machine.dataDir, 'link', 'secrets.json'), 'utf8')
      } catch {
        continue
      }
      const { secrets } = JSON.parse(text) as { secrets: Record<string, string> }
      for (const [key, value] of Object.entries(secrets)) if (key.startsWith('outgoing:')) found.push(value)
    }
    return found
  }

  /** Every pairing code a bench machine showed. */
  pairingCodes(): string[] {
    return [...this.codes]
  }

  /**
   * Remembers tokens seen right now (call it before a revoke, whose tokens the files then lose)
   * and returns how many secrets the bench knows.
   */
  rememberTokens(): number {
    for (const token of this.tokens()) this.remembered.add(token)
    return this.remembered.size + this.codes.size
  }

  private readonly remembered = new Set<string>()

  /**
   * Which kinds of secrets (never the secrets themselves) appear in the captured console output
   * or in `texts`: `token` or `code`. Empty when nothing leaked.
   */
  leakedSecrets(texts: readonly string[] = []): string[] {
    this.rememberTokens()
    const haystack = [...this.captured, ...texts].join('\n')
    const leaks: string[] = []
    if ([...this.remembered].some((token) => haystack.includes(token))) leaks.push('token')
    // A code is six digits: only a standalone run of exactly those six counts, not part of a port or a time.
    if ([...this.codes].some((code) => new RegExp(`(?<!\\d)${code}(?!\\d)`).test(haystack))) leaks.push('code')
    return leaks
  }

  /** Files under a machine's data folder, recursively, with their bytes. */
  files(machine: BenchMachine): { path: string; bytes: Buffer; mode: number }[] {
    const out: { path: string; bytes: Buffer; mode: number }[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        const stat = statSync(path)
        if (stat.isDirectory()) walk(path)
        else out.push({ path, bytes: readFileSync(path), mode: stat.mode & 0o777 })
      }
    }
    walk(machine.dataDir)
    return out
  }

  async close(): Promise<void> {
    for (const machine of this.machines) await machine.service.stop()
    for (const spy of this.spies) spy.mockRestore()
    rmSync(this.root, { recursive: true, force: true })
  }
}
