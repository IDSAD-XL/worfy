// The machines of the user's tailnet for "Link a machine" (worfy-link ticket 30; ADR-0070, point 5):
// reading `tailscale status --json` (a recorded output, test/fixtures/tailscale/status.json),
// finding the Tailscale CLI, and what a missing, failing, hanging or garbled CLI gives. No test
// starts a real `tailscale`: the runner and the file check are injected; the default runner is
// tested against a shell script that stands in for it. The login shell's environment (agentEnv) is
// a stub: no shell starts.
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { findTailscale, parseTailscaleStatus, readTailscalePeers, runTailscaleCli, TAILSCALE_TIMEOUT_MS } from '../../src/main/link/tailscale'

const login = vi.hoisted(() => ({ agentEnv: vi.fn() }))
vi.mock('../../src/main/agent/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/main/agent/env')>()),
  agentEnv: login.agentEnv,
}))

const STATUS = readFileSync(join(__dirname, '../fixtures/tailscale/status.json'), 'utf8')

describe('parseTailscaleStatus', () => {
  it('lists the peers of a recorded status: MagicDNS names without the trailing dot, IPv4 picked, online first, this Machine left out', () => {
    expect(parseTailscaleStatus(STATUS)).toEqual([
      // HostName when DNSName is empty.
      { name: 'Alexeys-iPhone', address: '100.101.102.106', online: true },
      // An IPv6-only peer keeps its IPv6 address.
      { name: 'lab', address: 'fd7a:115c:a1e0::6501:6670', online: true },
      // IPv4 although IPv6 comes first; the MagicDNS name, not the HostName.
      { name: 'pc', address: '100.101.102.104', online: true },
      { name: 'nas', address: '100.101.102.105', online: false },
      // `expired` has no Tailscale address: left out. `studio` is Self: left out.
    ])
  })

  it.each([
    ['its IPv4', '100.101.102.104'],
    ['an IPv6 that is not the one shown', 'FD7A:115C:A1E0::6501:6668'],
    ['the same IPv6 in brackets', '[fd7a:115c:a1e0::6501:6668]'],
    ['its full MagicDNS name, with the trailing dot and in another case', 'PC.tail1234.ts.net.'],
    ['its full MagicDNS name', 'pc.tail1234.ts.net'],
    ['the first label of its MagicDNS name', 'Pc'],
  ])('leaves out a Linked machine remembered by %s', (_case, remembered) => {
    expect(parseTailscaleStatus(STATUS, [remembered]).map((peer) => peer.name)).toEqual(['Alexeys-iPhone', 'lab', 'nas'])
  })

  it('keeps a peer whose address only looks like a remembered one: a LAN address, another name, a longer name', () => {
    expect(parseTailscaleStatus(STATUS, ['192.168.1.30', 'pc2', 'pc.other.example', '100.101.102.10']).map((peer) => peer.name)).toEqual(['Alexeys-iPhone', 'lab', 'pc', 'nas'])
  })

  it('gives no machines for a tailnet without peers (Peer null or absent)', () => {
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'studio.ts.net.' }, Peer: null }))).toEqual([])
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: 'NeedsLogin' }))).toEqual([])
  })

  it('leaves out a peer of another shape and keeps the rest', () => {
    const text = JSON.stringify({ Peer: { a: 'nonsense', b: { DNSName: 7 }, c: { DNSName: 'pc.ts.net.', TailscaleIPs: ['100.64.0.2'], Online: true } } })
    expect(parseTailscaleStatus(text)).toEqual([{ name: 'pc', address: '100.64.0.2', online: true }])
  })

  it('counts a peer without Online as offline', () => {
    expect(parseTailscaleStatus(JSON.stringify({ Peer: { a: { DNSName: 'pc.ts.net.', TailscaleIPs: ['100.64.0.2'] } } }))).toEqual([{ name: 'pc', address: '100.64.0.2', online: false }])
  })

  it('throws on text that is not JSON or not a status', () => {
    expect(() => parseTailscaleStatus('failed to connect to local tailscaled')).toThrow(SyntaxError)
    expect(() => parseTailscaleStatus('[]')).toThrow()
    expect(() => parseTailscaleStatus('{"Peer": 5}')).toThrow()
  })
})

describe('findTailscale', () => {
  const only = (...files: string[]) => (path: string) => files.includes(path)

  it('takes the PATH first on macOS, then the app bundle, then /usr/local/bin', () => {
    const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
    expect(findTailscale('darwin', { PATH: '/usr/bin:/opt/homebrew/bin' }, only('/opt/homebrew/bin/tailscale', app, '/usr/local/bin/tailscale'))).toBe('/opt/homebrew/bin/tailscale')
    expect(findTailscale('darwin', { PATH: '/usr/bin:/bin' }, only(app, '/usr/local/bin/tailscale'))).toBe(app)
    expect(findTailscale('darwin', { PATH: '/usr/bin:/bin' }, only('/usr/local/bin/tailscale'))).toBe('/usr/local/bin/tailscale')
    expect(findTailscale('darwin', {}, only())).toBeNull()
  })

  it('skips relative PATH entries, and looks nowhere else on Linux', () => {
    expect(findTailscale('linux', { PATH: 'bin:.:/usr/bin' }, only('bin/tailscale', 'tailscale', '/usr/bin/tailscale'))).toBe('/usr/bin/tailscale')
    expect(findTailscale('linux', { PATH: '/usr/bin' }, only('/usr/local/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'))).toBeNull()
  })

  it('takes the Path first on Windows, then %ProgramFiles%\\Tailscale\\tailscale.exe', () => {
    const installed = 'C:\\Program Files\\Tailscale\\tailscale.exe'
    expect(findTailscale('win32', { Path: 'C:\\Windows;D:\\tools', ProgramFiles: 'C:\\Program Files' }, only('D:\\tools\\tailscale.exe', installed))).toBe('D:\\tools\\tailscale.exe')
    expect(findTailscale('win32', { Path: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }, only(installed))).toBe(installed)
    expect(findTailscale('win32', { Path: 'C:\\Windows', ProgramFiles: 'C:\\Program Files' }, only())).toBeNull()
    expect(findTailscale('win32', { Path: 'C:\\Windows' }, only(installed))).toBeNull()
  })
})

describe('readTailscalePeers', () => {
  const cli = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
  const found = { platform: 'darwin' as const, env: { PATH: '/usr/bin' }, exists: (path: string) => path === cli }

  it('without the CLI: no list, nothing started, nothing in the log', async () => {
    const run = vi.fn(async () => STATUS)
    const warn = vi.fn()
    expect(await readTailscalePeers({ platform: 'darwin', env: { PATH: '/usr/bin' }, exists: () => false, run, warn })).toEqual([])
    expect(run).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('starts the CLI it found with status --json and the timeout, and lists its machines', async () => {
    const run = vi.fn(async () => STATUS)
    const warn = vi.fn()
    const peers = await readTailscalePeers({ ...found, run, warn })
    expect(run).toHaveBeenCalledWith(cli, ['status', '--json'], TAILSCALE_TIMEOUT_MS, { PATH: '/usr/bin' })
    expect(peers.map((peer) => peer.name)).toEqual(['Alexeys-iPhone', 'lab', 'pc', 'nas'])
    expect(warn).not.toHaveBeenCalled()
  })

  it("looks for the CLI on the PATH of the login shell's environment, not worfy's own, and runs it with that environment", async () => {
    // worfy opened from Finder: its own PATH has no /opt/homebrew/bin; the login shell's has.
    vi.stubEnv('PATH', '/usr/bin:/bin:/usr/sbin:/sbin')
    const env = { PATH: '/usr/bin:/bin:/opt/homebrew/bin', HOME: '/Users/test' }
    login.agentEnv.mockResolvedValue({ env, from: 'login-shell', error: null })
    const run = vi.fn(async () => STATUS)
    const homebrew = '/opt/homebrew/bin/tailscale'
    try {
      const peers = await readTailscalePeers({ platform: 'darwin', exists: (path) => path === homebrew, run, warn: vi.fn() })
      expect(peers).toHaveLength(4)
    } finally {
      vi.unstubAllEnvs()
    }
    expect(login.agentEnv).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(homebrew, ['status', '--json'], TAILSCALE_TIMEOUT_MS, env)
  })

  it('leaves out the Linked machines it is given', async () => {
    const peers = await readTailscalePeers({ ...found, run: async () => STATUS, linked: ['nas', '100.101.102.106'] })
    expect(peers.map((peer) => peer.name)).toEqual(['lab', 'pc'])
  })

  it.each([
    ['garbled output', async () => '{"Peer": ', /its output is not a status/],
    ['output of another shape', async () => '{"Peer": []}', /its output is not a status/],
    ['a failure', async () => Promise.reject(new Error('Command failed: tailscale status --json\nfailed to connect to local tailscaled')), /Command failed: tailscale status --json$/],
    ['a timeout', async () => Promise.reject(Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' })), new RegExp(`no answer within ${TAILSCALE_TIMEOUT_MS} ms`)],
  ])('on %s: no list, no error, one warning line', async (_case, run, reason) => {
    const warn = vi.fn()
    expect(await readTailscalePeers({ ...found, run, warn })).toEqual([])
    expect(warn).toHaveBeenCalledTimes(1)
    const [line] = warn.mock.calls[0] as [string]
    expect(line).toMatch(reason)
    expect(line).toContain(cli)
    expect(line).not.toContain('\n')
  })
})

// The default runner against a shell script in place of the CLI; Windows does not start a script as a program.
describe.skipIf(process.platform === 'win32')('runTailscaleCli', () => {
  const script = (body: string): string => {
    const file = join(mkdtempSync(join(tmpdir(), 'worfy-tailscale-')), 'tailscale')
    writeFileSync(file, `#!/bin/sh\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }

  it('passes the arguments as they are, without a shell', async () => {
    expect(await runTailscaleCli(script(`printf '%s\\n' "$@"`), ['status', '--json', '$(echo no); echo no'], 5_000, process.env)).toBe('status\n--json\n$(echo no); echo no\n')
  })

  it('runs the CLI with the environment it is given', async () => {
    expect(await runTailscaleCli(script('printf %s "$WORFY_TAILSCALE_PROBE"'), [], 5_000, { ...process.env, WORFY_TAILSCALE_PROBE: 'from the login shell' })).toBe('from the login shell')
  })

  it('stops a CLI that does not answer in time', async () => {
    await expect(runTailscaleCli(script('exec sleep 30'), ['status', '--json'], 200, process.env)).rejects.toMatchObject({ killed: true })
  })
})
