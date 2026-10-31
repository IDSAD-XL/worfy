// Linking through Tailscale by hand (worfy-link ticket 29; ADR-0070, point 5): the address field
// takes a MagicDNS name or a Tailscale address with the port the other window shows; the Host check
// takes this machine's MagicDNS names while "Link through Tailscale" is on; "Link a machine" lists
// the Tailscale address first while the setting is on, and the window marks it.
import { readFileSync } from 'node:fs'
import type { NetworkInterfaceInfo } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { allowedHostNames, isAllowedHost, isAllowedHostName, isTailscaleAddress, type HostNames } from '../../src/main/link/checks'
import { appLinkEnvironment, linkAddresses } from '../../src/main/link/service'
import { parseSelfDnsName, readSelfDnsName, TAILSCALE_TIMEOUT_MS, TailnetSelfName } from '../../src/main/link/tailscale'
import { isTailscaleHost, parseLinkAddress } from '../../src/shared/ipc/link'

const info = (address: string, internal = false): NetworkInterfaceInfo =>
  (address.includes(':')
    ? { address, family: 'IPv6', netmask: '', mac: '00:00:00:00:00:00', internal, cidr: null, scopeid: 0 }
    : { address, family: 'IPv4', netmask: '', mac: '00:00:00:00:00:00', internal, cidr: null }) as NetworkInterfaceInfo

const STATUS = readFileSync(join(__dirname, '../fixtures/tailscale/status.json'), 'utf8')

describe('an address typed by hand', () => {
  it.each([
    ['pc:52000', { host: 'pc', port: 52000 }],
    ['pc.example.ts.net:52000', { host: 'pc.example.ts.net', port: 52000 }],
    ['100.101.102.103:52000', { host: '100.101.102.103', port: 52000 }],
    ['[fd7a:115c:a1e0::1]:52000', { host: 'fd7a:115c:a1e0::1', port: 52000 }],
  ])('reads %s', (text, address) => {
    expect(parseLinkAddress(text)).toEqual({ ok: true, address })
  })

  it('asks for the port of a MagicDNS name typed without one', () => {
    expect(parseLinkAddress('pc')).toEqual({ ok: false, error: 'Add the port: host:port' })
  })
})

describe('the MagicDNS names of this machine in the Host check', () => {
  const interfaces = { en0: [info('192.168.0.119')], utun4: [info('100.101.102.103'), info('fd7a:115c:a1e0::1')] }
  const port = 52000
  const machine = (hostname: string, tailscale: boolean): HostNames => ({ interfaces, hostname, tailscale })

  it.each([
    ['pc.local', 'macOS: os.hostname() in .local'],
    ['PC', 'Windows: the bare computer name, upper case'],
    ['pc', 'the bare name'],
  ])('takes pc and pc.<tailnet>.ts.net for %s (%s) while the setting is on', (hostname) => {
    const on = machine(hostname, true)
    expect(allowedHostNames(on).has('pc')).toBe(true)
    for (const name of ['pc', 'pc.example.ts.net', 'pc.tail1234.ts.net', 'PC.Example.TS.NET'.toLowerCase()]) expect(isAllowedHostName(name, on), name).toBe(true)
    for (const host of [`pc:${port}`, `PC:${port}`, `pc.example.ts.net:${port}`]) expect(isAllowedHost(host, port, on), host).toBe(true)
  })

  it.each([
    ['other.example.ts.net', 'another machine of the tailnet'],
    ['other', 'another bare name'],
    ['pc.ts.net', 'no tailnet between the name and ts.net'],
    ['xpc.example.ts.net', 'a name that only ends in pc'],
    ['pc-2.example.ts.net', 'a name that only starts with pc'],
    ['pc.example.ts.net.evil.test', 'ts.net not at the end (DNS rebinding)'],
    ['pc.example.ts.netx', 'not the ts.net zone'],
    ['pc..ts.net', 'an empty tailnet label'],
    ['pc.exa_mple.ts.net', 'a tailnet label that is not a DNS label'],
    ['pc.example.com', 'another zone'],
  ])('refuses %s (%s) with the setting on', (name) => {
    expect(isAllowedHostName(name, machine('pc.local', true))).toBe(false)
    expect(isAllowedHost(`${name}:${port}`, port, machine('pc.local', true))).toBe(false)
  })

  it('takes none of the MagicDNS names while the setting is off; the rest of the list stays', () => {
    const off = machine('pc.local', false)
    expect(allowedHostNames(off).has('pc')).toBe(false)
    for (const name of ['pc', 'pc.example.ts.net', 'other.example.ts.net']) expect(isAllowedHostName(name, off), name).toBe(false)
    expect(isAllowedHost(`pc:${port}`, port, off)).toBe(false)
    // The interface addresses, the Tailscale ones included, and the .local name pass either way.
    for (const host of [`100.101.102.103:${port}`, `[fd7a:115c:a1e0::1]:${port}`, `pc.local:${port}`]) {
      expect(isAllowedHost(host, port, off), host).toBe(true)
      expect(isAllowedHost(host, port, machine('pc.local', true)), host).toBe(true)
    }
  })

  it('takes no bare name when os.hostname() is empty', () => {
    const on = machine('', true)
    expect(isAllowedHostName('.example.ts.net', on)).toBe(false)
    expect([...allowedHostNames(on)].sort()).toEqual([...allowedHostNames(machine('', false))].sort())
  })

  it('keeps the port check for a MagicDNS name', () => {
    expect(isAllowedHost(`pc:${port + 1}`, port, machine('pc.local', true))).toBe(false)
    expect(isAllowedHost('pc', port, machine('pc.local', true))).toBe(false)
  })
})

describe('the Tailscale address in "Link a machine"', () => {
  it('isTailscaleHost of the window agrees with isTailscaleAddress of main', () => {
    const table = [
      '100.64.0.0',
      '100.101.102.103',
      '100.127.255.255',
      '100.63.255.255',
      '100.128.0.0',
      '10.0.0.5',
      '192.168.1.20',
      'fd7a:115c:a1e0::1',
      'fd7a:115c:a1e0:ab12:4843:cd96:6258:b240',
      'FD7A:115C:A1E0::5',
      'fd7a:115c:a1e1::1',
      'fd7a:115c::1',
      'fd7a::115c:a1e0:1',
      'fd00::1',
      '::1',
      'pc',
      'pc.example.ts.net',
      '100.101.102',
      '100.101.102.103.4',
    ]
    for (const host of table) expect(isTailscaleHost(host), host).toBe(isTailscaleAddress(host))
    expect(table.filter((host) => isTailscaleHost(host))).toEqual(['100.64.0.0', '100.101.102.103', '100.127.255.255', 'fd7a:115c:a1e0::1', 'fd7a:115c:a1e0:ab12:4843:cd96:6258:b240', 'FD7A:115C:A1E0::5'])
  })

  const interfaces = {
    en0: [info('192.168.1.20'), info('fe80::1cf6:52ec:1e29:a090'), info('2a02:2378::5')],
    lo0: [info('127.0.0.1', true), info('::1', true)],
    utun4: [info('100.101.102.103'), info('fd7a:115c:a1e0::1'), info('fe80::abcd')],
  }

  it('lists the Tailscale addresses first while the setting is on', () => {
    expect(linkAddresses(interfaces, 52000, true)).toEqual(['100.101.102.103:52000', '[fd7a:115c:a1e0::1]:52000', '192.168.1.20:52000', '[2a02:2378::5]:52000'])
  })

  it('keeps the order of the interfaces while the setting is off: IPv4, then IPv6', () => {
    expect(linkAddresses(interfaces, 52000, false)).toEqual(['192.168.1.20:52000', '100.101.102.103:52000', '[2a02:2378::5]:52000', '[fd7a:115c:a1e0::1]:52000'])
  })
})

describe('WORFY_LINK_INTERFACES: the interfaces an e2e test gives the app', () => {
  const MAP = '{"en0":["192.168.1.20"],"utun4":["100.101.102.103","fd7a:115c:a1e0::1"]}'

  /** Runs `body` with console.warn recorded; returns what it warned. */
  function warned(body: () => void): string[] {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    try {
      body()
      return warn.mock.calls.map((call) => String(call[0]))
    } finally {
      warn.mockRestore()
    }
  }

  it('reads a JSON map of interface names to addresses, as non-internal entries, in an unpacked build', () => {
    const env = appLinkEnvironment('dev', { WORFY_LINK_HOST: '127.0.0.1', WORFY_LINK_INTERFACES: MAP })
    expect(env.listenHost).toBe('127.0.0.1')
    expect(Object.keys(env.interfaces ?? {})).toEqual(['en0', 'utun4'])
    expect(linkAddresses(env.interfaces ?? {}, 52000, true)).toEqual(['100.101.102.103:52000', '[fd7a:115c:a1e0::1]:52000', '192.168.1.20:52000'])
    expect(env.interfaces?.utun4?.map((entry) => [entry.family, entry.internal])).toEqual([
      ['IPv4', false],
      ['IPv6', false],
    ])
  })

  it('is not read by a packaged build: the app keeps its real interfaces', () => {
    const env = appLinkEnvironment('packaged', { WORFY_LINK_HOST: '127.0.0.1', WORFY_LINK_BONJOUR: '0', WORFY_LINK_INTERFACES: MAP })
    expect(env.interfaces).toBeUndefined()
    // The other two variables keep working as before.
    expect(env).toEqual({ listenHost: '127.0.0.1', bonjour: false })
  })

  it('keeps only IP literals: a name would join the Host allowlist and pass DNS rebinding', () => {
    let env: ReturnType<typeof appLinkEnvironment> | undefined
    const warnings = warned(() => {
      env = appLinkEnvironment('dev', { WORFY_LINK_INTERFACES: '{"x":["evil.test","100.101.102.103","","localhost","100.101.102","fe80::1%en0"]}' })
    })
    expect(env?.interfaces?.x?.map((entry) => entry.address)).toEqual(['100.101.102.103', 'fe80::1%en0'])
    expect(warnings).toEqual(['"evil.test"', '""', '"localhost"', '"100.101.102"'].map((value) => expect.stringContaining(`WORFY_LINK_INTERFACES: ${value} is not an IP address`)))
    const names = allowedHostNames({ interfaces: env?.interfaces ?? {}, hostname: 'pc.local', tailscale: true })
    expect(names.has('evil.test')).toBe(false)
    expect(isAllowedHost('evil.test:52000', 52000, { interfaces: env?.interfaces ?? {}, hostname: 'pc.local', tailscale: true })).toBe(false)
  })

  it('gives none when unset, and none with a warning when it is not such a map', () => {
    expect(warned(() => expect(appLinkEnvironment('dev', {}).interfaces).toBeUndefined())).toEqual([])
    for (const text of ['not json', '[]', '{"en0":"192.168.1.20"}', '{"en0":[5]}', 'null']) {
      expect(warned(() => expect(appLinkEnvironment('dev', { WORFY_LINK_INTERFACES: text }).interfaces, text).toBeUndefined()), text).toEqual([
        expect.stringContaining('WORFY_LINK_INTERFACES'),
      ])
    }
  })
})

// worfy-link ticket 39: the name of a machine in the tailnet is not always the first label of
// os.hostname(). On the owner's Mac os.hostname() is `Alexeys-MacBook-Pro-164.local` (macOS adds
// `-164` when the name is taken on the network) and `Self.DNSName` of `tailscale status --json` is
// `alexeys-macbook-pro.taila00ba6.ts.net.`. Known, that exact name is the MagicDNS name of this
// machine; not known (no CLI, a failure), the rule by os.hostname() stays. No test starts a real
// `tailscale`: the runner and the file check are injected.
describe('the MagicDNS name Tailscale gives this machine', () => {
  const interfaces = { en0: [info('192.168.0.119')], utun4: [info('100.71.20.55')] }
  const port = 57769
  const MAC = 'Alexeys-MacBook-Pro-164.local'
  const DNS_NAME = 'alexeys-macbook-pro.taila00ba6.ts.net'
  const owner = (tailscale: boolean, magicDnsName: string | null = DNS_NAME): HostNames => ({ interfaces, hostname: MAC, tailscale, ...(magicDnsName === null ? {} : { magicDnsName }) })

  it('takes the exact name and its first label while the setting is on, though os.hostname() differs', () => {
    for (const name of [DNS_NAME, 'alexeys-macbook-pro']) expect(isAllowedHostName(name, owner(true)), name).toBe(true)
    expect(isAllowedHost(`${DNS_NAME}:${port}`, port, owner(true))).toBe(true)
    expect(isAllowedHost(`ALEXEYS-MACBOOK-PRO.taila00ba6.ts.net:${port}`, port, owner(true))).toBe(true)
    expect(isAllowedHost(`${DNS_NAME}:${port + 1}`, port, owner(true))).toBe(false)
  })

  it.each([
    ['alexeys-macbook-pro-164.taila00ba6.ts.net', 'the os.hostname() guess, once Tailscale named the machine'],
    ['alexeys-macbook-pro.other.ts.net', 'the same label in another tailnet'],
    ['pc.taila00ba6.ts.net', 'another machine of the tailnet'],
    ['alexeys-macbook-pro-164', 'the bare os.hostname() label, not a MagicDNS name here'],
    [`${DNS_NAME}.evil.test`, 'the name followed by another zone'],
  ])('refuses %s (%s)', (name) => {
    expect(isAllowedHostName(name, owner(true))).toBe(false)
  })

  it('takes none of them while the setting is off; .local and the addresses stay', () => {
    for (const name of [DNS_NAME, 'alexeys-macbook-pro']) expect(isAllowedHostName(name, owner(false)), name).toBe(false)
    for (const name of ['alexeys-macbook-pro-164.local', '100.71.20.55']) expect(isAllowedHostName(name, owner(false)), name).toBe(true)
  })

  it('keeps the rule by os.hostname() when the name is not known', () => {
    const unknown = owner(true, null)
    expect(isAllowedHostName('alexeys-macbook-pro-164.taila00ba6.ts.net', unknown)).toBe(true)
    expect(isAllowedHostName(DNS_NAME, unknown)).toBe(false)
  })

  describe('parseSelfDnsName', () => {
    it('reads Self.DNSName of a recorded status, lower case, without the trailing dot', () => {
      expect(parseSelfDnsName(STATUS)).toBe('studio.tail1234.ts.net')
      expect(parseSelfDnsName(JSON.stringify({ Self: { DNSName: 'Alexeys-MacBook-Pro.taila00ba6.ts.net.' } }))).toBe(DNS_NAME)
    })

    it.each<[unknown, string]>([
      [{ Self: { DNSName: '' } }, 'MagicDNS off'],
      [{ Self: {} }, 'no DNSName'],
      [{ Peer: null }, 'no Self'],
      [{ Self: { DNSName: 'single-label.' } }, 'one label'],
      [{ Self: { DNSName: 'bad name.ts.net.' } }, 'not a DNS name'],
    ])('gives undefined for %j (%s)', (status) => {
      expect(parseSelfDnsName(JSON.stringify(status))).toBeUndefined()
    })

    it('throws on a text that is not JSON', () => {
      expect(() => parseSelfDnsName('not json')).toThrow()
    })
  })

  describe('readSelfDnsName', () => {
    const env = { PATH: '/opt/tools' }
    const cli = '/opt/tools/tailscale'
    const exists = (path: string): boolean => path === cli

    it('runs `status --json` of the CLI it finds and gives the name', async () => {
      const run = vi.fn(async () => STATUS)
      expect(await readSelfDnsName({ platform: 'linux', env, exists, run, warn: () => undefined })).toBe('studio.tail1234.ts.net')
      expect(run).toHaveBeenCalledWith(cli, ['status', '--json'], TAILSCALE_TIMEOUT_MS, env)
    })

    it('gives undefined and warns nothing without a CLI', async () => {
      const run = vi.fn(async () => STATUS)
      const warn = vi.fn()
      expect(await readSelfDnsName({ platform: 'linux', env, exists: () => false, run, warn })).toBeUndefined()
      expect(run).not.toHaveBeenCalled()
      expect(warn).not.toHaveBeenCalled()
    })

    it('gives undefined with one [link] warning when the CLI fails or prints no status', async () => {
      for (const run of [vi.fn(async () => Promise.reject(new Error('Tailscale is stopped.\nmore'))), vi.fn(async () => 'garbage')]) {
        const warn = vi.fn()
        expect(await readSelfDnsName({ platform: 'linux', env, exists, run, warn })).toBeUndefined()
        expect(warn).toHaveBeenCalledTimes(1)
        expect(warn.mock.calls[0]?.[0]).toMatch(/^\[link\] the MagicDNS name of this machine could not be read from \/opt\/tools\/tailscale status --json: /)
      }
    })
  })

  describe('TailnetSelfName: the cache', () => {
    it('reads once per network, shares a read in flight, and reads again when the network changes', async () => {
      let release: ((name: string | undefined) => void) | undefined
      const read = vi.fn(() => new Promise<string | undefined>((resolve) => (release = resolve)))
      const cache = new TailnetSelfName(read)
      const first = cache.get(interfaces)
      const second = cache.get(interfaces)
      expect(read).toHaveBeenCalledTimes(1)
      release?.(DNS_NAME)
      expect(await first).toBe(DNS_NAME)
      expect(await second).toBe(DNS_NAME)
      expect(await cache.get({ ...interfaces })).toBe(DNS_NAME)
      expect(read).toHaveBeenCalledTimes(1)

      // Another network: the Tailscale adapter got another address, or came up.
      const moved = { ...interfaces, utun4: [info('100.71.20.56')] }
      const third = cache.get(moved)
      expect(read).toHaveBeenCalledTimes(2)
      release?.('renamed.taila00ba6.ts.net')
      expect(await third).toBe('renamed.taila00ba6.ts.net')
    })

    it('keeps an unknown name for the network, and gives undefined when the read rejects', async () => {
      const read = vi.fn(async (): Promise<string | undefined> => Promise.reject(new Error('boom')))
      const cache = new TailnetSelfName(read)
      expect(await cache.get(interfaces)).toBeUndefined()
      expect(await cache.get(interfaces)).toBeUndefined()
      expect(read).toHaveBeenCalledTimes(1)
    })
  })
})
